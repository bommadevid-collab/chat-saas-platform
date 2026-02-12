const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const OpenAI = require('openai');
const db = require('./database');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class SessionManager {
    constructor(io) {
        this.io = io;
        this.client = null;
        this.qrCode = null;
        this.status = 'Offline';
        // this.chatHistory = []; // REMOVED for Ultra-Low RAM
        this.userContext = {}; // { phoneNumber: [ { role: 'user'|'assistant', content: '...' } ] }
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectTimeout = null;

        // Cache settings in memory
        this.settingsCache = null;
        this.modelsCache = { data: [], timestamp: 0 };
        this.refreshSettingsCache();
    }

    refreshSettingsCache() {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        this.settingsCache = settings;
        console.log("Settings cache refreshed");
    }

    async startSession() {
        if (this.client) return;

        console.log(`Starting WhatsApp Client...`);
        this.updateStatus('Initializing...');

        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: 'whatsapp-bot' }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-accelerated-2d-canvas',
                    '--disable-software-rasterizer'
                ]
            }
        });

        this.client.on('qr', (qr) => {
            console.log(`QR Code received`);
            this.qrCode = qr;
            this.updateStatus('QR Code Ready');
            this.io.emit('qr', { qr });
        });

        this.client.on('ready', () => {
            console.log(`WhatsApp Client is ready!`);
            this.qrCode = null;
            this.reconnectAttempts = 0; // Reset counter on success
            this.updateStatus('Ready');
            this.io.emit('ready');
        });

        this.client.on('authenticated', () => {
            this.updateStatus('Authenticated');
        });

        this.client.on('auth_failure', () => {
            this.updateStatus('Auth Failure');
            this.qrCode = null;
        });

        this.client.on('disconnected', (reason) => {
            console.log(`Client disconnected:`, reason);
            this.updateStatus('Disconnected');

            // Auto-reconnect logic
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = 10000; // 10 seconds
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay / 1000}s...`);
                this.updateStatus(`Reconnecting in ${delay / 1000}s...`);

                this.reconnectTimeout = setTimeout(() => {
                    this.destroySession().then(() => {
                        this.startSession();
                    });
                }, delay);
            } else {
                console.log("Max reconnect attempts reached. Stopping.");
                this.updateStatus('Offline (Max Retries)');
                this.destroySession();
            }
        });

        this.client.on('message', async (msg) => {
            // Process message asynchronously to avoid blocking event loop
            this.handleIncomingMessage(msg).catch(err => {
                console.error("Error processing message:", err);
            });
        });

        this.client.on('message_create', (msg) => {
            if (msg.fromMe) {
                // Add to context (optional, but good for flow)
                // We need to know who it was sent TO, which is msg.to
                if (!this.userContext[msg.to]) {
                    this.userContext[msg.to] = [];
                }
                this.userContext[msg.to].push({ role: 'assistant', content: msg.body });
                // STRICT MEMORY LIMIT: Keep only last 10 messages
                if (this.userContext[msg.to].length > 10) {
                    this.userContext[msg.to] = this.userContext[msg.to].slice(-10);
                }
                this.cleanupContext(); // Periodic cleanup check
            }
        });

        try {
            await this.client.initialize();
        } catch (e) {
            console.error(`Failed to initialize client:`, e);
            this.updateStatus('Failed');
        }
    }

    async handleIncomingMessage(msg) {
        console.log(`[Message] ${msg.from}: ${msg.body}`);

        // Ignore status updates
        if (msg.from === 'status@broadcast' || msg.isStatus) return;

        // Update User Context (Memory)
        if (!this.userContext[msg.from]) {
            this.userContext[msg.from] = [];
        }
        this.userContext[msg.from].push({ role: 'user', content: msg.body });
        // STRICT MEMORY LIMIT: Keep only last 10 messages
        if (this.userContext[msg.from].length > 10) {
            this.userContext[msg.from] = this.userContext[msg.from].slice(-10);
        }
        this.cleanupContext(); // Periodic cleanup check

        // Auto-reply logic
        try {
            const settings = this.getSettings(); // Uses cache
            if (!settings.openai_key) {
                console.log('No OpenAI API Key set. Auto-reply skipped.');
                return;
            }

            console.log(`Generating reply for ${msg.from}...`);

            // Process with LLM using History
            const reply = await this.generateReply(msg.from, settings);

            if (reply) {
                await msg.reply(reply);

                // Add reply to memory
                this.userContext[msg.from].push({ role: 'assistant', content: reply });
                if (this.userContext[msg.from].length > 10) {
                    this.userContext[msg.from] = this.userContext[msg.from].slice(-10);
                }

                console.log(`[Replied] ${reply}`);
            } else {
                console.log('No reply generated by LLM.');
            }
        } catch (error) {
            console.error(`Error in auto-reply:`, error);
        }
    }

    // Simple manual cleanup to prevent memory leaks from inactive users
    cleanupContext() {
        // If we have more than 50 active conversations, verify/purge
        const users = Object.keys(this.userContext);
        if (users.length > 50) {
            console.log("Cleaning up old user contexts...");
            // Naive approach: just wipe half of them or reset. 
            // Ideally we'd track timestamps, but for "lowest RAM" 
            // just keeping the map small is priority.
            this.userContext = {};
            console.log("User context cleared to free memory.");
        }

        // Try to force GC if strict params are on
        if (global.gc) {
            try { global.gc(); } catch (e) { }
        }
    }

    async destroySession() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.client) {
            try {
                await this.client.destroy();
            } catch (e) {
                console.error(`Error destroying client:`, e);
            }
            this.client = null;
            this.qrCode = null;
            this.updateStatus('Offline');
        }
    }

    updateStatus(status) {
        this.status = status;
        this.io.emit('status', { status });
    }

    getSettings() {
        if (!this.settingsCache) {
            this.refreshSettingsCache();
        }
        return this.settingsCache;
    }

    async generateReply(userId, settings) {
        try {
            const openai = new OpenAI({
                apiKey: settings.openai_key,
                baseURL: settings.openai_url // Support for other providers
            });

            // Construct messages array from history
            const history = this.userContext[userId] || [];

            const messages = [
                { role: "system", content: settings.system_prompt },
                ...history
            ];

            const completion = await openai.chat.completions.create({
                messages: messages,
                model: settings.openai_model || "gpt-3.5-turbo",
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error("LLM Error:", error);
            // Log the full error object to help debug
            if (error.response) {
                console.error("LLM Response Data:", error.response.data);
                console.error("LLM Response Status:", error.response.status);
            }
            return null;
        }
    }

    async getGroqModels(apiKey) {
        // Cache models for 1 hour
        const now = Date.now();
        if (this.modelsCache.data.length > 0 && (now - this.modelsCache.timestamp) < 3600000) {
            return this.modelsCache.data;
        }

        try {
            const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            const models = data.data || [];
            if (models.length > 0) {
                this.modelsCache = { data: models, timestamp: now };
            }
            return models;
        } catch (e) {
            console.error("Error fetching models:", e);
            return [];
        }
    }
}

module.exports = SessionManager;
