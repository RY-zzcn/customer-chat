// 数据库模块 - SQLite（基于 sql.js，纯 JavaScript，无需编译）
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'chat.db');

let db;
let SQL; // sql.js 模块引用

// ============ 持久化 ============

/** 将内存数据库写入磁盘 */
function saveToDisk() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    // 先写临时文件再原子替换，防止写入中断导致数据库损坏
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
  } catch (err) {
    console.error('[数据库] 写入磁盘失败:', err.message);
  }
}

// ============ 查询辅助函数 ============

/** 执行 SELECT 返回所有行（数组） */
function queryAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (err) {
    console.error('[数据库] 查询错误:', sql, err.message);
    return [];
  }
}

/** 执行 SELECT 返回第一行 */
function queryOne(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    let row = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  } catch (err) {
    console.error('[数据库] 查询错误:', sql, err.message);
    return null;
  }
}

/** 执行 INSERT/UPDATE/DELETE */
function execute(sql, params = []) {
  try {
    db.run(sql, params);
    saveToDisk();
  } catch (err) {
    console.error('[数据库] 执行错误:', sql, err.message);
    throw err;
  }
}

/** 执行 INSERT 并返回 lastInsertRowid */
function executeInsert(sql, params = []) {
  try {
    // sql.js 没有 lastInsertRowid 的直接支持，需要先执行插入再查询
    db.run(sql, params);
    const result = queryOne('SELECT last_insert_rowid() as id');
    saveToDisk();
    return result ? result.id : 0;
  } catch (err) {
    console.error('[数据库] 插入错误:', sql, err.message);
    throw err;
  }
}

// ============ 初始化 ============

async function initDatabase() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      console.log('[数据库] 从磁盘加载，路径:', DB_PATH);
    } catch (err) {
      console.error('[数据库] 加载失败，将创建新数据库:', err.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('[数据库] 创建新数据库，路径:', DB_PATH);
  }

  // 开关 WAL 模式（sql.js 是内存数据库，忽略此 PRAGMA）
  db.run('PRAGMA foreign_keys = ON');

  // ===== 建表 =====

  db.run(`
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

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keywords TEXT NOT NULL,
      reply TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 会话存储表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expired INTEGER NOT NULL,
      sess TEXT NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)');

  saveToDisk();

  // 插入默认知识库条目
  const count = queryOne('SELECT COUNT(*) as count FROM knowledge');
  if (count && count.count === 0) {
    const defaults = [
      ['你好,您好,hi,hello,在吗,在不在', '您好！欢迎咨询，请问有什么可以帮您的？'],
      ['激活,怎么激活,如何激活', '您好，激活/选号请在套餐详情页查看客服二维码添加客服进行操作。'],
      ['套餐,资费,月租,流量,通话', '您好，具体套餐详情请查看产品页面说明，需要选号请添加客服。'],
      ['快递,发货,物流,多久到', '您好，一般下单后48小时内发货，物流信息可在订单详情中查看。'],
      ['售后,退换,退款,投诉', '您好，售后问题请联系客服邮箱（管理员可在后台系统设置中配置邮箱地址）。'],
      ['谢谢,感谢,good,ok', '不客气！如有其他问题随时联系我们。'],
    ];
    for (const [keywords, reply] of defaults) {
      execute('INSERT INTO knowledge (keywords, reply) VALUES (?, ?)', [keywords, reply]);
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
  execute(
    'INSERT INTO conversations (id, visitor_name, visitor_ip) VALUES (?, ?, ?)',
    [id, visitorName || '访客', visitorIp]
  );
}

function getConversation(id) {
  return queryOne('SELECT * FROM conversations WHERE id = ?', [id]);
}

function getActiveConversations() {
  return queryAll(
    'SELECT * FROM conversations WHERE status = ? ORDER BY updated_at DESC',
    ['active']
  );
}

function updateConversationStatus(id, status) {
  execute(
    'UPDATE conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, id]
  );
}

function updateConversationTime(id) {
  execute(
    'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
}

function incrementUnread(id) {
  execute(
    'UPDATE conversations SET unread_count = unread_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
}

function resetUnread(id) {
  execute('UPDATE conversations SET unread_count = 0 WHERE id = ?', [id]);
}

// ============ 消息操作 ============

function addMessage(conversationId, senderType, senderName, content) {
  return executeInsert(
    'INSERT INTO messages (conversation_id, sender_type, sender_name, content) VALUES (?, ?, ?, ?)',
    [conversationId, senderType, senderName || '', content]
  );
}

function getMessages(conversationId, limit = 50, offset = 0) {
  return queryAll(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
    [conversationId, limit, offset]
  );
}

function getMessageCount(conversationId) {
  const row = queryOne(
    'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
    [conversationId]
  );
  return row ? row.count : 0;
}

function getLastMessageTime(conversationId) {
  const row = queryOne(
    'SELECT created_at FROM messages WHERE conversation_id = ? AND sender_type = ? ORDER BY created_at DESC LIMIT 1',
    [conversationId, 'visitor']
  );
  return row ? row.created_at : null;
}

// ============ 知识库操作 ============

function getAllKnowledge() {
  return queryAll('SELECT * FROM knowledge WHERE enabled = 1');
}

function addKnowledge(keywords, reply) {
  return executeInsert(
    'INSERT INTO knowledge (keywords, reply) VALUES (?, ?)',
    [keywords, reply]
  );
}

function deleteKnowledge(id) {
  execute('DELETE FROM knowledge WHERE id = ?', [id]);
}

function toggleKnowledge(id, enabled) {
  execute('UPDATE knowledge SET enabled = ? WHERE id = ?', [enabled, id]);
}

// ============ 设置操作 ============

function getSetting(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

// ============ Session 存储 ============

function sessionGet(sid, callback) {
  try {
    const row = queryOne(
      'SELECT sess FROM sessions WHERE sid = ? AND expired > ?',
      [sid, Date.now()]
    );
    callback(null, row ? JSON.parse(row.sess) : null);
  } catch (err) {
    callback(err);
  }
}

function sessionSet(sid, session, callback) {
  try {
    const maxAge = (session.cookie && session.cookie.maxAge) ? session.cookie.maxAge : 86400000;
    const expired = Date.now() + maxAge;
    const sess = JSON.stringify(session);
    execute(
      'INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)',
      [sid, expired, sess]
    );
    callback(null);
  } catch (err) {
    callback(err);
  }
}

function sessionDestroy(sid, callback) {
  try {
    execute('DELETE FROM sessions WHERE sid = ?', [sid]);
    callback(null);
  } catch (err) {
    callback(err);
  }
}

function sessionTouch(sid, session, callback) {
  try {
    const maxAge = (session.cookie && session.cookie.maxAge) ? session.cookie.maxAge : 86400000;
    const expired = Date.now() + maxAge;
    execute('UPDATE sessions SET expired = ? WHERE sid = ?', [expired, sid]);
    callback(null);
  } catch (err) {
    callback(err);
  }
}

/** 清理过期会话（定期调用） */
function sessionCleanup() {
  try {
    execute('DELETE FROM sessions WHERE expired < ?', [Date.now()]);
  } catch (err) {
    // 忽略清理错误
  }
}

function close() {
  if (db) {
    saveToDisk();
    db.close();
    console.log('[数据库] 已关闭');
  }
}

module.exports = {
  initDatabase,
  getDB,
  close,
  createConversation,
  getConversation,
  getActiveConversations,
  updateConversationStatus,
  updateConversationTime,
  incrementUnread,
  resetUnread,
  addMessage,
  getMessages,
  getMessageCount,
  getLastMessageTime,
  getAllKnowledge,
  addKnowledge,
  deleteKnowledge,
  toggleKnowledge,
  getSetting,
  setSetting,
  // Session 存储方法
  sessionGet,
  sessionSet,
  sessionDestroy,
  sessionTouch,
  sessionCleanup,
};
