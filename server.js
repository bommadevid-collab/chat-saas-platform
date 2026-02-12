const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const db = require('./database');
const SessionManager = require('./sessionManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const sessionManager = new SessionManager(io);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Routes

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    if (user) {
        res.json({ success: true, token: 'simple-token' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Settings
app.get('/api/settings', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    const settings = req.body;
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(settings)) {
        insert.run(key, value);
    }
    sessionManager.refreshSettingsCache(); // Update in-memory cache
    res.json({ success: true });
});

// Fetch Models
app.get('/api/models', async (req, res) => {
    const row = db.prepare("SELECT value FROM settings WHERE key='openai_key'").get();
    if (!row || !row.value) return res.json({ models: [] });

    // Only fetch if using Groq (checked via URL or assumed from user request)
    // For simplicity, we try fetching from Groq using the key
    const models = await sessionManager.getGroqModels(row.value);
    res.json({ models });
});

// Session Management (Single Session)
app.get('/api/session/status', (req, res) => {
    res.json({
        status: sessionManager.status,
        qr: sessionManager.qrCode
    });
});

app.post('/api/session/start', (req, res) => {
    sessionManager.startSession();
    res.json({ success: true, message: `Session starting...` });
});

app.post('/api/session/stop', (req, res) => {
    sessionManager.destroySession();
    res.json({ success: true, message: `Session stopped.` });
});

app.get('/api/history', (req, res) => {
    res.json({ history: sessionManager.chatHistory });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
