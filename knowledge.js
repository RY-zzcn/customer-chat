// 知识库模块 - 关键词匹配自动回复
const db = require('./database');

/**
 * 根据访客消息匹配知识库，返回自动回复内容
 * @param {string} message - 访客消息
 * @returns {string|null} 匹配到的回复，未匹配则返回 null
 */
function matchKnowledge(message) {
  const items = db.getAllKnowledge();
  if (!items || items.length === 0) return null;

  const msg = message.trim().toLowerCase();

  for (const item of items) {
    const keywords = item.keywords.split(',').map(k => k.trim().toLowerCase());
    for (const keyword of keywords) {
      if (keyword && msg.includes(keyword)) {
        console.log('[知识库] 匹配到关键词:', keyword, '→', item.reply.substring(0, 30));
        return item.reply;
      }
    }
  }

  return null;
}

/**
 * 无人值守自动回复 - 当管理员不在线时，检查是否需要发送自动回复
 * 只在会话的第一条消息触发，避免重复自动回复
 */
function shouldAutoReply(conversationId, message) {
  const dbModule = require('./database');
  const messages = dbModule.getMessages(conversationId);
  // 只有访客的第一条消息才触发自动回复
  const visitorMessages = messages.filter(m => m.sender_type === 'visitor');
  if (visitorMessages.length > 1) return null;

  return matchKnowledge(message);
}

module.exports = { matchKnowledge, shouldAutoReply };
