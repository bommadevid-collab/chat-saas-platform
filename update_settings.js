const Database = require('better-sqlite3');
const db = new Database('chatbot.db');

const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

console.log('Updating settings to Groq...');
update.run('openai_key', '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');
update.run('openai_url', 'https://api.groq.com/openai/v1');
update.run('openai_model', 'llama3-8b-8192');
console.log('Settings updated successfully!');
