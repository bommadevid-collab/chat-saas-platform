const Database = require('better-sqlite3');
const db = new Database('chatbot.db');

const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

console.log('Fixing deprecated model...');
update.run('openai_model', 'llama-3.3-70b-versatile');
console.log('Model updated to llama-3.3-70b-versatile');
