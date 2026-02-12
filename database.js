const Database = require('better-sqlite3');
const db = new Database('chatbot.db'); // Removed verbose to reduce console spam
db.pragma('journal_mode = WAL');

// Create settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )
`);

// Insert default user if not exists (admin/admin)
// In a real app, hash passwords! For simplicity as requested "make it simple", we'll store plain text or simple hash.
// Let's use simple check.
const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');
insertUser.run('admin', 'admin');

// Ensure default settings exist
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('system_prompt', 'You are a helpful assistant.');
insertSetting.run('openai_key', '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');
insertSetting.run('openai_model', 'llama-3.3-70b-versatile');
insertSetting.run('openai_url', 'https://api.groq.com/openai/v1');

module.exports = db;
