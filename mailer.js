// 邮件通知模块
const nodemailer = require('nodemailer');

let transporter = null;
let notifyEmail = '';

function initMailer() {
  const smtpConfig = {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  notifyEmail = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;

  if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
    console.warn('[邮件] SMTP 未配置，邮件通知功能已禁用');
    console.warn('[邮件] 请复制 .env.example 为 .env 并填写邮箱配置');
    return false;
  }

  transporter = nodemailer.createTransport(smtpConfig);
  console.log('[邮件] 邮件通知已就绪，通知邮箱:', notifyEmail);
  return true;
}

/**
 * 发送新消息通知邮件
 */
async function sendNewMessageNotification(conversationId, visitorName, message) {
  if (!transporter) return false;

  const siteUrl = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const adminUrl = `${siteUrl}/admin`;

  try {
    await transporter.sendMail({
      from: `"客服系统通知" <${process.env.SMTP_USER}>`,
      to: notifyEmail,
      subject: `【新消息】${visitorName} 发来了一条消息`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
          <h2 style="color: #4F46E5;">📬 新消息通知</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">访客</td>
              <td style="padding: 8px 12px;">${visitorName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">消息内容</td>
              <td style="padding: 8px 12px;">${message}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-weight: bold;">会话编号</td>
              <td style="padding: 8px 12px; color: #6b7280; font-size: 12px;">${conversationId}</td>
            </tr>
          </table>
          <div style="margin-top: 24px; text-align: center;">
            <a href="${adminUrl}" style="display: inline-block; padding: 12px 32px; background: #4F46E5; color: #fff; text-decoration: none; border-radius: 6px; font-size: 16px;">
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

/**
 * 发送邮件测试
 */
async function sendTestEmail() {
  if (!transporter) return { success: false, error: '邮件服务未配置' };

  try {
    await transporter.sendMail({
      from: `"客服系统" <${process.env.SMTP_USER}>`,
      to: notifyEmail,
      subject: '【测试邮件】客服系统邮件通知正常',
      html: '<p>如果您收到此邮件，说明客服系统的邮件通知功能配置成功！</p>',
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { initMailer, sendNewMessageNotification, sendTestEmail };
