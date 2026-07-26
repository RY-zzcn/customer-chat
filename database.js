// 数据库模块 - SQLite
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'chat.db');

let db;

function initDatabase() {
  db = new Database(DB_PATH);

  // 开启 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 会话表 - 每个访客对应一个会话
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      visitor_name TEXT DEFAULT '访客',
      visitor_ip TEXT,
      status TEXT DEFAULT 'active',
      unread_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 消息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('visitor', 'admin', 'system', 'bot')),
      sender_name TEXT DEFAULT '',
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // 知识库表
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keywords TEXT NOT NULL,
      reply TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 管理员配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 插入默认知识库条目
  const count = db.prepare('SELECT COUNT(*) as count FROM knowledge').get();
  if (count.count === 0) {
    const insertKnowledge = db.prepare(
      'INSERT INTO knowledge (keywords, reply) VALUES (?, ?)'
    );
    const defaults = [
      ['你好,您好,hi,hello,在吗,在不在', '您好！欢迎咨询，请问有什么可以帮您的？'],
      ['激活,怎么激活,如何激活', '您好，激活/选号请在套餐详情页查看客服二维码添加客服进行操作。'],
      ['套餐,资费,月租,流量,通话', '您好，具体套餐详情请查看产品页面说明，需要选号请添加客服。'],
      ['快递,发货,物流,多久到', '您好，一般下单后48小时内发货，物流信息可在订单详情中查看。'],
      ['售后,退换,退款,投诉', '您好，售后问题请发送邮件至 ryzq@foxmail.com，我们会尽快为您处理。'],
      ['谢谢,感谢,good,ok', '不客气！如有其他问题随时联系我们。'],
    ];
    for (const [keywords, reply] of defaults) {
      insertKnowledge.run(keywords, reply);
    }
  }

  console.log('[数据库] 初始化完成');
  return db;
}

function getDB() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

// ============ 会话操作 ============

function createConversation(id, visitorName, visitorIp) {
  const db = getDB();
  return db.prepare(
    'INSERT INTO conversations (id, visitor_name, visitor_ip) VALUES (?, ?, ?)'
  ).run(id, visitorName || '访客', visitorIp);
}

function getConversation(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function getActiveConversations() {
  const db = getDB();
  return db.prepare(
    'SELECT * FROM conversations WHERE status = ? ORDER BY updated_at DESC'
  ).all('active');
}

function updateConversationStatus(id, status) {
  const db = getDB();
  return db.prepare(
    'UPDATE conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(status, id);
}

function updateConversationTime(id) {
  const db = getDB();
  return db.prepare(
    'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(id);
}

function incrementUnread(id) {
  const db = getDB();
  return db.prepare(
    'UPDATE conversations SET unread_count = unread_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(id);
}

function resetUnread(id) {
  const db = getDB();
  return db.prepare(
    'UPDATE conversations SET unread_count = 0 WHERE id = ?'
  ).run(id);
}

// ============ 消息操作 ============

function addMessage(conversationId, senderType, senderName, content) {
  const db = getDB();
  const result = db.prepare(
    'INSERT INTO messages (conversation_id, sender_type, sender_name, content) VALUES (?, ?, ?, ?)'
  ).run(conversationId, senderType, senderName || '', content);
  return result.lastInsertRowid;
}

function getMessages(conversationId, limit = 100) {
  const db = getDB();
  return db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(conversationId, limit);
}

function getLastMessageTime(conversationId) {
  const db = getDB();
  const row = db.prepare(
    'SELECT created_at FROM messages WHERE conversation_id = ? AND sender_type = ? ORDER BY created_at DESC LIMIT 1'
  ).get(conversationId, 'visitor');
  return row ? row.created_at : null;
}

// ============ 知识库操作 ============

function getAllKnowledge() {
  const db = getDB();
  return db.prepare('SELECT * FROM knowledge WHERE enabled = 1').all();
}

function addKnowledge(keywords, reply) {
  const db = getDB();
  return db.prepare(
    'INSERT INTO knowledge (keywords, reply) VALUES (?, ?)'
  ).run(keywords, reply);
}

function deleteKnowledge(id) {
  const db = getDB();
  return db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
}

function toggleKnowledge(id, enabled) {
  const db = getDB();
  return db.prepare('UPDATE knowledge SET enabled = ? WHERE id = ?').run(enabled, id);
}

// ============ 设置操作 ============

function getSetting(key) {
  const db = getDB();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDB();
  return db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run(key, value);
}

module.exports = {
  initDatabase,
  getDB,
  createConversation,
  getConversation,
  getActiveConversations,
  updateConversationStatus,
  updateConversationTime,
  incrementUnread,
  resetUnread,
  addMessage,
  getMessages,
  getLastMessageTime,
  getAllKnowledge,
  addKnowledge,
  deleteKnowledge,
  toggleKnowledge,
  getSetting,
  setSetting,
};
