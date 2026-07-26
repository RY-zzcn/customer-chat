// AI 机器人模块 - 接入 DeepSeek / OpenAI API
// 此模块为可选功能，需在 .env 中将 AI_ENABLED 设为 true

let aiConfig = null;

function initAI() {
  if (process.env.AI_ENABLED !== 'true') {
    console.log('[AI] AI 机器人未启用（设置 AI_ENABLED=true 以启用）');
    return false;
  }
  if (!process.env.AI_API_KEY) {
    console.warn('[AI] AI_API_KEY 未设置，AI 机器人无法使用');
    return false;
  }

  aiConfig = {
    provider: process.env.AI_PROVIDER || 'deepseek',
    apiUrl: process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions',
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL || 'deepseek-chat',
  };

  console.log('[AI] AI 机器人已就绪:', aiConfig.provider, '/', aiConfig.model);
  return true;
}

/**
 * 调用 AI 接口获取回复
 * @param {string} message - 访客消息
 * @param {Array} history - 对话历史 [{role, content}, ...]
 * @returns {Promise<string|null>} AI 回复内容
 */
async function getAIReply(message, history = []) {
  if (!aiConfig) return null;

  const systemPrompt = `你是一个客服助手，请用友好、专业的中文回答用户问题。回答要简洁、准确。
关于以下问题的标准回答：
- 激活/选号问题：告知用户请在套餐详情页查看客服二维码添加客服
- 售后/投诉问题：告知用户联系客服邮箱（管理员已配置的联系方式）
- 套餐、资费、流量等问题：引导用户查看产品详情页
请根据这些规则和用户的问题提供帮助。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10), // 只取最近10条历史
    { role: 'user', content: message },
  ];

  try {
    const response = await fetch(aiConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error('[AI] API 请求失败:', response.status);
      return null;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (reply) {
      console.log('[AI] 生成回复:', reply.substring(0, 50));
    }
    return reply || null;
  } catch (err) {
    console.error('[AI] 调用异常:', err.message);
    return null;
  }
}

module.exports = { initAI, getAIReply };
