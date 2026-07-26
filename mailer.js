// 邮件通知模块（支持数据库驱动 + 热重载）
const nodemailer = require('nodemailer');

let transporter = null;
let notifyEmail = '';
let enabled = false;
let dbRef = null; // 数据库引用，由 server.js 注入

/**
 * 设置数据库引用（由 server.js 在初始化时调用）
 */
function setDb(db) {
  dbRef = db;
}

/**
 * 发送消息时使用的 HTML 转义
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 从设置源加载配置。优先级：数据库 > process.env
 */
function loadConfig() {
  const get = (key, envKey, fallback) => {
    if (dbRef) {
      const dbVal = dbRef.getSetting(key);
      if (dbVal) return dbVal;
    }
    if (envKey && process.env[envKey]) return process.env[envKey];
    return fallback;
  };

  enabled = get('mail_enabled', null, null);
  // 如果 DB 中没有 enabled 记录，则根据 SMTP_USER/SMTP_PASS 是否存在判断
  if (enabled === null) {
    enabled = !!(process.env.SMTP_USER && process.env.SMTP_PASS) ? 'true' : 'false';
  }
  const active = enabled === 'true' || enabled === true;

  const host = get('mail_smtp_host', 'SMTP_HOST', 'smtp.qq.com');
  const port = parseInt(get('mail_smtp_port', 'SMTP_PORT', '465'), 10);
  const secure = get('mail_smtp_secure', 'SMTP_SECURE', 'true');
  const user = get('mail_smtp_user', 'SMTP_USER', '');
  const pass = get('mail_smtp_pass', 'SMTP_PASS', '');
  notifyEmail = get('mail_notify_email', 'NOTIFY_EMAIL', user);

  return { active, host, port, secure, user, pass, notifyEmail };
}

/**
 * 初始化/重新初始化邮件传输器
 */
function initMailer() {
  const config = loadConfig();

  if (!config.active) {
    console.log('[邮件] 邮件通知已禁用（可在管理后台开启）');
    transporter = null;
    return false;
  }

  if (!config.user || !config.pass) {
    console.warn('[邮件] SMTP 用户名/密码未配置，邮件通知不可用');
    transporter = null;
    return false;
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure !== 'false',
    auth: { user: config.user, pass: config.pass },
  });
  notifyEmail = config.notifyEmail;
  console.log('[邮件] 邮件通知已就绪，通知邮箱:', notifyEmail);
  return true;
}

/**
 * 热重载邮件配置（从数据库重新读取）
 */
function reloadMailer() {
  const wasEnabled = !!transporter;
  const result = initMailer();
  const nowEnabled = !!transporter;
  if (wasEnabled !== nowEnabled) {
    console.log(nowEnabled ? '[邮件] 邮件通知已重新启用' : '[邮件] 邮件通知已禁用');
  }
  return result;
}

/**
 * 获取当前邮件配置（不含密码）
 */
function getConfig() {
  const config = loadConfig();
  return {
    enabled: config.active,
    host: config.host,
    port: config.port,
    secure: config.secure !== 'false',
    user: config.user,
    notifyEmail: config.notifyEmail,
    // 密码不返回，用占位符表示是否已设置
    passConfigured: !!(config.user && config.pass),
  };
}

/**
 * 检查邮件是否可用
 */
function isEnabled() {
  return !!transporter;
}

/**
 * 发送新消息通知邮件（仅在无管理员在线时发送）
 */
async function sendNewMessageNotification(conversationId, visitorName, message, hasAdminOnline = false) {
  if (!transporter) return false;

  // 如果管理员在线，跳过邮件通知
  if (hasAdminOnline) return false;

  const siteUrl = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const adminUrl = `${siteUrl}/admin`;

  const safeVisitorName = escapeHtml(visitorName);
  const safeMessage = escapeHtml(message);
  const safeConversationId = escapeHtml(conversationId);
  const safeAdminUrl = escapeHtml(adminUrl);

  try {
    const config = loadConfig();
    await transporter.sendMail({
      from: `"客服系统通知" <${config.user}>`,
      to: notifyEmail,
      subject: `【新消息】${safeVisitorName} 发来了一条消息`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #4F46E5;">📬 新消息通知</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">访客</td>
              <td style="padding: 8px 12px;">${safeVisitorName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">消息内容</td>
              <td style="padding: 8px 12px;">${safeMessage}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">会话编号</td>
              <td style="padding: 8px 12px; color: #6b7280; font-size: 12px;">${safeConversationId}</td>
            </tr>
          </table>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${safeAdminUrl}" style="display: inline-block; padding: 12px 32px; background: #4F46E5; color: #fff; text-decoration: none; border-radius: 6px; font-size: 16px;">
              前往后台回复
            </a>
          </div>
          <p style="margin-top: 20px; color: #9ca3af; font-size: 12px; text-align: center;">
            此邮件由客服系统自动发送，请勿直接回复。
          </p>
        </div>
      `,
    });
    console.log('[邮件] 通知已发送:', visitorName, '-', message.substring(0, 30));
    return true;
  } catch (err) {
    console.error('[邮件] 发送失败:', err.message);
    return false;
  }
}

// 节流：每个会话每分钟最多发一次邮件
const throttleMap = new Map();
function isThrottled(conversationId) {
  const now = Date.now();
  const last = throttleMap.get(conversationId) || 0;
  if (now - last < 60000) return true;
  throttleMap.set(conversationId, now);
  return false;
}

/**
 * 带节流的发送新消息通知
 */
async function sendNewMessageNotificationThrottled(conversationId, visitorName, message, hasAdminOnline = false) {
  if (!transporter || hasAdminOnline) return false;
  if (isThrottled(conversationId)) return false;
  return sendNewMessageNotification(conversationId, visitorName, message, false);
}

/**
 * 发送邮件测试
 */
async function sendTestEmail() {
  if (!transporter) return { success: false, error: '邮件服务未配置或已禁用' };

  const config = loadConfig();
  try {
    await transporter.sendMail({
      from: `"客服系统" <${config.user}>`,
      to: notifyEmail,
      subject: '【测试邮件】客服系统邮件通知正常',
      html: '<p>如果您收到此邮件，说明客服系统的邮件通知功能配置成功！</p>',
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  setDb,
  initMailer,
  reloadMailer,
  getConfig,
  isEnabled,
  sendNewMessageNotification,
  sendNewMessageNotificationThrottled,
  sendTestEmail,
};
