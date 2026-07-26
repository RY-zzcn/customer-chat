// AI 机器人模块 - 接入 DeepSeek / OpenAI API（支持数据库驱动 + 热重载）
// 配置可在管理后台实时修改，无需重启服务

let aiConfig = null;
let enabled = false;
let dbRef = null; // 数据库引用，由 server.js 注入

/**
 * 设置数据库引用
 */
function setDb(db) {
  dbRef = db;
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

  enabled = get('ai_enabled', null, null);
  if (enabled === null) {
    enabled = process.env.AI_ENABLED === 'true' ? 'true' : 'false';
  }
  const active = enabled === 'true' || enabled === true;

  return {
    active,
    provider: get('ai_provider', 'AI_PROVIDER', 'deepseek'),
    apiUrl: get('ai_api_url', 'AI_API_URL', 'https://api.deepseek.com/v1/chat/completions'),
    apiKey: get('ai_api_key', 'AI_API_KEY', ''),
    model: get('ai_model', 'AI_MODEL', 'deepseek-chat'),
  };
}

/**
 * 初始化/重新初始化 AI 配置
 */
function initAI() {
  const config = loadConfig();

  if (!config.active) {
    console.log('[AI] AI 机器人未启用（可在管理后台开启）');
    aiConfig = null;
    return false;
  }
  if (!config.apiKey) {
    console.warn('[AI] API Key 未设置，AI 机器人无法使用（请在管理后台配置）');
    aiConfig = null;
    return false;
  }

  aiConfig = {
    provider: config.provider,
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    model: config.model,
  };

  console.log('[AI] AI 机器人已就绪:', aiConfig.provider, '/', aiConfig.model);
  return true;
}

/**
 * 热重载 AI 配置（从数据库重新读取）
 */
function reloadAI() {
  const wasEnabled = !!aiConfig;
  const result = initAI();
  const nowEnabled = !!aiConfig;
  if (wasEnabled !== nowEnabled) {
    console.log(nowEnabled ? '[AI] AI 机器人已重新启用' : '[AI] AI 机器人已禁用');
  }
  return result;
}

/**
 * 获取当前 AI 配置（不含 API Key 完整值）
 */
function getConfig() {
  const config = loadConfig();
  return {
    enabled: config.active,
    provider: config.provider,
    apiUrl: config.apiUrl,
    model: config.model,
    // 不返回完整 key，仅返回是否已配置
    keyConfigured: !!(config.apiKey && config.apiKey !== 'your_api_key_here'),
  };
}

/**
 * 检查 AI 是否可用
 */
function isEnabled() {
  return !!aiConfig;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
    if (err.name === 'AbortError') {
      console.error('[AI] 调用超时（15s）');
    } else {
      console.error('[AI] 调用异常:', err.message);
    }
    return null;
  }
}

module.exports = { setDb, initAI, reloadAI, getConfig, isEnabled, getAIReply };
