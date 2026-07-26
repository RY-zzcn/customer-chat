// 轻量级在线客服聊天系统 - 主服务端
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = require('./database');
const mailer = require('./mailer');
const knowledge = require('./knowledge');
const ai = require('./ai');

// ============ 初始化 ============
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

db.initDatabase();
const mailEnabled = mailer.initMailer();
ai.initAI();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============ 中间件 ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
  secret: uuidv4(),
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

// ============ API 路由 ============

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const storedHash = db.getSetting('admin_password_hash');

  let isValid = false;

  if (storedHash) {
    isValid = await bcrypt.compare(password, storedHash);
  } else {
    // 首次登录，使用默认密码
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
    res.status(401).json({ error: '密码错误' });
  }
});

// 修改管理员密码
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
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

// 获取单个会话详情
app.get('/api/conversations/:id', requireAdmin, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });
  const messages = db.getMessages(req.params.id);
  res.json({ conversation, messages });
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
  const id = db.addKnowledge(keywords, reply);
  res.json({ success: true, id: id.lastInsertRowid });
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

// 发送测试邮件
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  const result = await mailer.sendTestEmail();
  res.json(result);
});

// 获取系统状态
app.get('/api/admin/status', requireAdmin, (req, res) => {
  const conversations = db.getActiveConversations();
  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  res.json({
    mailEnabled,
    aiEnabled: process.env.AI_ENABLED === 'true' && !!process.env.AI_API_KEY,
    activeConversations: conversations.length,
    totalUnread,
  });
});

// 管理员页面路由
app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ============ Socket.IO ============

// 跟踪在线管理员
let adminSocket = null;

io.on('connection', (socket) => {
  let currentConversationId = null;
  let currentRole = null; // 'visitor' | 'admin'

  console.log('[Socket] 新连接:', socket.id);

  // ===== 访客逻辑 =====

  // 访客加入聊天
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

    // 通知管理员有新访客
    if (adminSocket) {
      adminSocket.emit('admin:visitor-joined', conversation);
    }
  });

  // 访客发送消息
  socket.on('visitor:message', async (data) => {
    if (!currentConversationId) return;

    const { content } = data;
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

    // 广播给管理员
    if (adminSocket) {
      adminSocket.emit('admin:new-message', {
        ...msgData,
        conversation_id: currentConversationId,
        visitor_name: visitorName,
      });
      adminSocket.emit('admin:conversation-update', db.getConversation(currentConversationId));
    }

    // 发送邮件通知
    if (mailEnabled) {
      mailer.sendNewMessageNotification(currentConversationId, visitorName, content);
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
      if (adminSocket) {
        adminSocket.emit('admin:new-message', replyData);
      }
      return;
    }

    // AI 自动回复（如果知识库没匹配到）
    if (process.env.AI_ENABLED === 'true') {
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
        if (adminSocket) {
          adminSocket.emit('admin:new-message', replyData);
        }
      }
    }
  });

  // 访客断线
  socket.on('visitor:leave', () => {
    // 不关闭会话，只是断开连接
  });

  // ===== 管理员逻辑 =====

  // 管理员登录
  socket.on('admin:join', () => {
    currentRole = 'admin';
    adminSocket = socket;
    const conversations = db.getActiveConversations();
    socket.emit('admin:init', conversations);
    console.log('[Socket] 管理员已上线');
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

    const messages = db.getMessages(conversationId);
    const conversation = db.getConversation(conversationId);
    socket.emit('admin:conversation-data', { conversation, messages });
  });

  // 管理员发送消息
  socket.on('admin:message', (data) => {
    if (!currentConversationId) return;

    const { content } = data;
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

    // 也发给管理员自己确认
    socket.emit('admin:message-sent', msgData);
  });

  // 断开连接
  socket.on('disconnect', () => {
    if (currentRole === 'admin' && adminSocket === socket) {
      adminSocket = null;
      console.log('[Socket] 管理员已离线');
    }
    console.log('[Socket] 断开连接:', socket.id);
  });
});

// ============ 启动服务 ============
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('  🚀 客服聊天系统已启动');
  console.log(`  顾客页面: http://localhost:${PORT}`);
  console.log(`  管理后台: http://localhost:${PORT}/admin`);
  console.log(`  邮件通知: ${mailEnabled ? '✅ 已启用' : '❌ 未配置'}`);
  console.log(`  AI 机器人: ${process.env.AI_ENABLED === 'true' ? '✅ 已启用' : '❌ 未启用'}`);
  console.log('='.repeat(50));
});
