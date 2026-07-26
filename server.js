// 轻量级在线客服聊天系统 - 主服务端
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const db = require('./database');
const mailer = require('./mailer');
const knowledge = require('./knowledge');
const ai = require('./ai');

// ============ 初始化 ============
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 管理员密码
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('❌ 错误：请在 .env 文件中设置 ADMIN_PASSWORD');
  process.exit(1);
}

// 会话密钥（优先环境变量，否则随机生成并持久化）
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const secretFile = path.join(DATA_DIR, '.session_secret');
  if (fs.existsSync(secretFile)) {
    SESSION_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    SESSION_SECRET = uuidv4();
    fs.writeFileSync(secretFile, SESSION_SECRET);
    console.log('[Session] 已生成并持久化会话密钥到', secretFile);
  }
}

// sql.js 是异步初始化
db.initDatabase().then(() => {
  // 注入数据库引用到 mailer 和 ai 模块
  mailer.setDb(db);
  ai.setDb(db);

  mailer.initMailer();
  ai.initAI();

  // 启动服务
  startServer();
});

function startServer() {
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============ 中间件 ============
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 使用内建 SQLite session 存储（纯 JS，无需编译）
const sessionMiddleware = session({
  store: new (class extends session.Store {
    get(sid, cb) { db.sessionGet(sid, cb); }
    set(sid, sess, cb) { db.sessionSet(sid, sess, cb); }
    destroy(sid, cb) { db.sessionDestroy(sid, cb); }
    touch(sid, sess, cb) { db.sessionTouch(sid, sess, cb); }
  })(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24小时
});
app.use(sessionMiddleware);

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ============ 管理员认证中间件 ============
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  if (req.path === '/index.html' || req.path === '/') {
    return res.redirect('/admin/login.html');
  }
  res.status(401).json({ error: '请先登录' });
}

// 登录频率限制器：15分钟内最多10次
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============ API 路由 ============

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    adminOnline: adminSockets.size > 0,
    aiEnabled: ai.isEnabled(),
    mailEnabled: mailer.isEnabled(),
    conversations: db.getActiveConversations().length,
  });
});

// 管理员登录
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ error: '密码格式无效' });
  }

  const storedHash = db.getSetting('admin_password_hash');

  let isValid = false;

  if (storedHash) {
    isValid = await bcrypt.compare(password, storedHash);
  } else {
    isValid = password === ADMIN_PASSWORD;
    if (isValid) {
      const hash = await bcrypt.hash(password, 10);
      db.setSetting('admin_password_hash', hash);
    }
  }

  if (isValid) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    // 登录失败慢响应（防爆破）
    await new Promise(r => setTimeout(r, 1000));
    res.status(401).json({ error: '密码错误' });
  }
});

// 管理员登出
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// 修改管理员密码
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ error: '新密码需 6-128 个字符' });
  }
  const storedHash = db.getSetting('admin_password_hash');

  const isValid = await bcrypt.compare(oldPassword, storedHash);
  if (!isValid) {
    return res.status(400).json({ error: '原密码错误' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  db.setSetting('admin_password_hash', newHash);
  res.json({ success: true });
});

// 获取活跃会话列表
app.get('/api/conversations', requireAdmin, (req, res) => {
  const conversations = db.getActiveConversations();
  res.json(conversations);
});

// 获取单个会话详情（支持分页）
app.get('/api/conversations/:id', requireAdmin, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const total = db.getMessageCount(req.params.id);
  const messages = db.getMessages(req.params.id, limit, offset);
  res.json({
    conversation,
    messages,
    total,
    hasMore: offset + messages.length < total,
  });
});

// 获取知识库
app.get('/api/knowledge', requireAdmin, (req, res) => {
  const items = db.getAllKnowledge();
  res.json(items);
});

// 添加知识库词条
app.post('/api/knowledge', requireAdmin, (req, res) => {
  const { keywords, reply } = req.body;
  if (!keywords || !reply) {
    return res.status(400).json({ error: '关键词和回复内容不能为空' });
  }
  if (reply.length > 2000) {
    return res.status(400).json({ error: '回复内容不能超过 2000 字符' });
  }
  const id = db.addKnowledge(keywords, reply);
  res.json({ success: true, id });
});

// 删除知识库词条
app.delete('/api/knowledge/:id', requireAdmin, (req, res) => {
  db.deleteKnowledge(req.params.id);
  res.json({ success: true });
});

// 切换知识库状态
app.put('/api/knowledge/:id/toggle', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  db.toggleKnowledge(req.params.id, enabled ? 1 : 0);
  res.json({ success: true });
});

// 关闭会话
app.put('/api/conversations/:id/close', requireAdmin, (req, res) => {
  db.updateConversationStatus(req.params.id, 'closed');
  res.json({ success: true });
});

// ============ 邮件设置 API ============

// 获取邮件配置
app.get('/api/admin/mail-settings', requireAdmin, (req, res) => {
  res.json(mailer.getConfig());
});

// 更新邮件配置
app.post('/api/admin/mail-settings', requireAdmin, (req, res) => {
  const {
    enabled, host, port, secure, user, pass, notifyEmail
  } = req.body;

  // 校验
  if (enabled !== undefined) db.setSetting('mail_enabled', enabled ? 'true' : 'false');
  if (host) db.setSetting('mail_smtp_host', String(host).trim());
  if (port) db.setSetting('mail_smtp_port', String(port));
  if (secure !== undefined) db.setSetting('mail_smtp_secure', secure ? 'true' : 'false');
  if (user) db.setSetting('mail_smtp_user', String(user).trim());
  if (pass && pass !== '••••••') db.setSetting('mail_smtp_pass', pass); // 占位符密码不保存
  if (notifyEmail) db.setSetting('mail_notify_email', String(notifyEmail).trim());

  // 热重载
  const result = mailer.reloadMailer();
  res.json({
    success: true,
    message: '邮件配置已保存并生效',
    active: result,
  });
});

// 发送测试邮件
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  if (!mailer.isEnabled()) {
    return res.json({ success: false, error: '邮件服务未配置或已禁用，请先配置并启用' });
  }
  const result = await mailer.sendTestEmail();
  res.json(result);
});

// ============ AI 设置 API ============

// 获取 AI 配置
app.get('/api/admin/ai-settings', requireAdmin, (req, res) => {
  res.json(ai.getConfig());
});

// 更新 AI 配置
app.post('/api/admin/ai-settings', requireAdmin, (req, res) => {
  const {
    enabled, provider, apiUrl, apiKey, model
  } = req.body;

  // 校验
  if (enabled !== undefined) db.setSetting('ai_enabled', enabled ? 'true' : 'false');
  if (provider) db.setSetting('ai_provider', String(provider).trim());
  if (apiUrl) db.setSetting('ai_api_url', String(apiUrl).trim());
  if (apiKey && apiKey !== '••••••') db.setSetting('ai_api_key', apiKey);
  if (model) db.setSetting('ai_model', String(model).trim());

  // 热重载
  const result = ai.reloadAI();
  res.json({
    success: true,
    message: 'AI 配置已保存并生效',
    active: result,
  });
});

// ============ 系统状态 ============
app.get('/api/admin/status', requireAdmin, (req, res) => {
  const conversations = db.getActiveConversations();
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  res.json({
    mailEnabled: mailer.isEnabled(),
    aiEnabled: ai.isEnabled(),
    activeConversations: conversations.length,
    totalUnread,
  });
});

// 获取公开系统设置
app.get('/api/public/settings', (req, res) => {
  res.json({
    contactEmail: db.getSetting('contact_email') || '',
    siteName: db.getSetting('site_name') || '在线客服',
    welcomeMessage: db.getSetting('welcome_message') || '您好！欢迎咨询，请问有什么可以帮您的？',
    workingHours: db.getSetting('working_hours') || '9:00-21:00',
  });
});

// 获取管理员系统设置
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    contactEmail: db.getSetting('contact_email') || '',
    siteName: db.getSetting('site_name') || '在线客服',
    welcomeMessage: db.getSetting('welcome_message') || '您好！欢迎咨询，请问有什么可以帮您的？',
    workingHours: db.getSetting('working_hours') || '9:00-21:00',
  });
});

// 更新系统设置
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { contactEmail, siteName, welcomeMessage, workingHours } = req.body;
  if (contactEmail !== undefined) {
    if (contactEmail && (contactEmail.length > 255 || !contactEmail.includes('@'))) {
      return res.status(400).json({ error: '邮箱格式无效' });
    }
    db.setSetting('contact_email', contactEmail);
  }
  if (siteName !== undefined) {
    if (siteName.length > 100) return res.status(400).json({ error: '站点名称不能超过 100 字符' });
    db.setSetting('site_name', siteName);
  }
  if (welcomeMessage !== undefined) {
    if (welcomeMessage.length > 500) return res.status(400).json({ error: '欢迎语不能超过 500 字符' });
    db.setSetting('welcome_message', welcomeMessage);
  }
  if (workingHours !== undefined) db.setSetting('working_hours', workingHours);
  res.json({ success: true, message: '设置已保存' });
});

// 管理员页面路由
app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ============ Socket.IO ============

// 在线管理员集合（支持多人同时在线）
const adminSockets = new Set();

io.on('connection', (socket) => {
  let currentConversationId = null;
  let currentRole = null; // 'visitor' | 'admin'

  console.log('[Socket] 新连接:', socket.id);

  // ===== 访客逻辑 =====

  socket.on('visitor:join', (data) => {
    currentRole = 'visitor';
    const conversationId = data.conversationId || uuidv4();
    const visitorName = data.name || '访客';

    currentConversationId = conversationId;
    socket.join(conversationId);

    // 检查会话是否存在
    let conversation = db.getConversation(conversationId);
    if (!conversation) {
      const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
      db.createConversation(conversationId, visitorName, ip);
      conversation = db.getConversation(conversationId);
    } else {
      db.updateConversationStatus(conversationId, 'active');
    }

    // 发送历史消息给访客
    const messages = db.getMessages(conversationId);
    socket.emit('visitor:history', {
      conversationId,
      visitorName,
      messages,
    });

    // 通知所有在线管理员有新访客
    for (const admin of adminSockets) {
      admin.emit('admin:visitor-joined', conversation);
    }
  });

  // 访客发送消息
  socket.on('visitor:message', async (data) => {
    if (!currentConversationId) return;

    const { content } = data;

    // 消息校验
    if (!content || typeof content !== 'string') return;
    if (content.length > 5000) {
      socket.emit('visitor:message', {
        id: Date.now(),
        conversation_id: currentConversationId,
        sender_type: 'bot',
        sender_name: '系统',
        content: '消息过长，请精简后重新发送（最多5000字符）。',
        created_at: new Date().toISOString(),
      });
      return;
    }

    const conversation = db.getConversation(currentConversationId);
    const visitorName = conversation ? conversation.visitor_name : '访客';

    // 保存消息
    const msgId = db.addMessage(currentConversationId, 'visitor', visitorName, content);
    db.incrementUnread(currentConversationId);

    const msgData = {
      id: msgId,
      conversation_id: currentConversationId,
      sender_type: 'visitor',
      sender_name: visitorName,
      content,
      created_at: new Date().toISOString(),
    };

    // 广播给所有在线管理员
    for (const admin of adminSockets) {
      admin.emit('admin:new-message', {
        ...msgData,
        conversation_id: currentConversationId,
        visitor_name: visitorName,
      });
      admin.emit('admin:conversation-update', db.getConversation(currentConversationId));
    }

    // 仅在没有管理员在线时发送邮件通知（带节流）
    if (adminSockets.size === 0) {
      mailer.sendNewMessageNotificationThrottled(currentConversationId, visitorName, content, false);
    }

    // 自动回复：知识库匹配
    const autoReply = knowledge.shouldAutoReply(currentConversationId, content);
    if (autoReply) {
      const replyId = db.addMessage(currentConversationId, 'bot', '智能客服', autoReply);
      const replyData = {
        id: replyId,
        conversation_id: currentConversationId,
        sender_type: 'bot',
        sender_name: '智能客服',
        content: autoReply,
        created_at: new Date().toISOString(),
      };
      socket.emit('visitor:message', replyData);
      for (const admin of adminSockets) {
        admin.emit('admin:new-message', replyData);
      }
      return;
    }

    // AI 自动回复（如果知识库没匹配到，且无管理员在线）
    if (ai.isEnabled() && adminSockets.size === 0) {
      const history = db.getMessages(currentConversationId).map(m => ({
        role: m.sender_type === 'visitor' ? 'user' : 'assistant',
        content: m.content,
      }));
      const aiReply = await ai.getAIReply(content, history);
      if (aiReply) {
        const replyId = db.addMessage(currentConversationId, 'bot', 'AI助手', aiReply);
        const replyData = {
          id: replyId,
          conversation_id: currentConversationId,
          sender_type: 'bot',
          sender_name: 'AI助手',
          content: aiReply,
          created_at: new Date().toISOString(),
        };
        socket.emit('visitor:message', replyData);
        for (const admin of adminSockets) {
          admin.emit('admin:new-message', replyData);
        }
      }
    }
  });

  // 访客断线
  socket.on('visitor:leave', () => {
    // 不关闭会话，只是断开连接
  });

  // ===== 管理员逻辑 =====

  // 管理员登录 Socket
  socket.on('admin:join', () => {
    const wasOnline = adminSockets.size > 0;
    currentRole = 'admin';
    adminSockets.add(socket);
    const conversations = db.getActiveConversations();
    socket.emit('admin:init', conversations);

    // 通知所有活跃会话的管理员状态变更
    if (!wasOnline) {
      io.emit('visitor:admin-status', { online: true });
    }

    console.log('[Socket] 管理员已上线，当前在线管理员数:', adminSockets.size);
  });

  // 管理员选择会话
  socket.on('admin:select-conversation', (data) => {
    const { conversationId } = data;
    if (currentConversationId) {
      socket.leave(currentConversationId);
    }
    currentConversationId = conversationId;
    socket.join(conversationId);
    db.resetUnread(conversationId);

    const messages = db.getMessages(conversationId, 50, 0);
    const total = db.getMessageCount(conversationId);
    const conversation = db.getConversation(conversationId);
    socket.emit('admin:conversation-data', {
      conversation, messages, total,
      hasMore: messages.length < total,
    });
  });

  // 管理员发送消息
  socket.on('admin:message', (data) => {
    if (!currentConversationId) return;

    const { content } = data;
    // 消息校验
    if (!content || typeof content !== 'string') return;
    if (content.length > 5000) return;

    const msgId = db.addMessage(currentConversationId, 'admin', '客服', content);
    db.updateConversationTime(currentConversationId);

    const msgData = {
      id: msgId,
      conversation_id: currentConversationId,
      sender_type: 'admin',
      sender_name: '客服',
      content,
      created_at: new Date().toISOString(),
    };

    // 发送给访客
    io.to(currentConversationId).emit('visitor:message', msgData);

    // 也发给所有在线管理员确认
    for (const admin of adminSockets) {
      admin.emit('admin:message-sent', msgData);
    }
  });

  // 访客正在输入（转发给管理员）
  socket.on('visitor:typing', (data) => {
    if (!currentConversationId) return;
    for (const admin of adminSockets) {
      admin.emit('admin:typing', {
        conversationId: currentConversationId,
        typing: data.typing,
      });
    }
  });

  // 管理员正在输入（转发给对应访客房间）
  socket.on('admin:typing', (data) => {
    if (!currentConversationId) return;
    io.to(currentConversationId).emit('visitor:typing', { typing: data.typing });
  });

  // 断开连接
  socket.on('disconnect', () => {
    if (currentRole === 'admin') {
      adminSockets.delete(socket);
      // 如果没有管理员在线了，通知所有访客
      if (adminSockets.size === 0) {
        io.emit('visitor:admin-status', { online: false });
      }
      console.log('[Socket] 管理员已离线，当前在线管理员数:', adminSockets.size);
    }
    console.log('[Socket] 断开连接:', socket.id);
  });
});

// ============ 全局异常处理 ============
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

// ============ 优雅关闭 ============
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] 正在优雅关闭服务...`);

  // 通知所有访客管理员下线
  for (const admin of adminSockets) {
    admin.disconnect(true);
  }

  server.close(() => {
    console.log('[Server] HTTP 服务已关闭');
    db.close();
    console.log('[DB] 数据库已关闭');
    process.exit(0);
  });

  // 5 秒强杀
  setTimeout(() => {
    console.error('[Server] 超时，强制退出');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 定期清理过期 session（每 30 分钟）
setInterval(() => {
  db.sessionCleanup();
}, 30 * 60 * 1000);

// ============ 启动服务 ============
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  🚀 客服聊天系统已启动');
  console.log(`  顾客页面: http://localhost:${PORT}`);
  console.log(`  管理后台: http://localhost:${PORT}/admin`);
  console.log(`  健康检查: http://localhost:${PORT}/api/health`);
  console.log(`  邮件通知: ${mailer.isEnabled() ? '✅ 已启用' : '❌ 未配置'}`);
  console.log(`  AI 机器人: ${ai.isEnabled() ? '✅ 已启用' : '❌ 未启用'}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log('='.repeat(50));
});

} // end startServer
