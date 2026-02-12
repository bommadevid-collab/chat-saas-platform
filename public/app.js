const socket = io();

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('token')) window.location.href = 'login.html';

    loadSettings();
    updateStatus();
    loadHistory();

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSettings();
    });

    // Close modal when clicking outside
    window.onclick = function (event) {
        const modal = document.getElementById('settings-modal');
        if (event.target == modal) {
            closeSettings();
        }
    }
});

function openSettings() {
    document.getElementById('settings-modal').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();

        document.getElementById('system_prompt').value = settings.system_prompt || '';
        document.getElementById('openai_key').value = settings.openai_key || '';

        // Load models if key exists
        if (settings.openai_key) {
            await fetchModels(settings.openai_model);
        } else {
            // Default fallback
            const select = document.getElementById('openai_model');
            select.innerHTML = '<option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Default)</option>';
        }

    } catch (e) {
        console.error('Error loading settings', e);
    }
}

async function fetchModels(selectedModel) {
    const loading = document.getElementById('model-loading');
    const select = document.getElementById('openai_model');
    loading.style.display = 'block';
    select.disabled = true;

    try {
        const res = await fetch('/api/models');
        const data = await res.json();

        select.innerHTML = '';
        if (data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.innerText = model.id;
                if (model.id === selectedModel) option.selected = true;
                select.appendChild(option);
            });
        } else {
            select.innerHTML = '<option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Default)</option>';
        }
    } catch (e) {
        console.error("Failed to fetch models", e);
        select.innerHTML = '<option value="llama3-8b-8192">llama3-8b-8192 (Default)</option>';
    } finally {
        loading.style.display = 'none';
        select.disabled = false;
    }
}

async function saveSettings() {
    const settings = {
        system_prompt: document.getElementById('system_prompt').value,
        openai_key: document.getElementById('openai_key').value,
        openai_model: document.getElementById('openai_model').value,
        openai_url: 'https://api.groq.com/openai/v1' // Forced as per user request
    };

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        // Reload models if key changed
        await fetchModels(settings.openai_model);
        alert('Settings Saved!');
        closeSettings(); // Auto close on save
    } catch (e) {
        alert('Error saving settings');
    }
}

async function startSession() {
    await fetch('/api/session/start', { method: 'POST' });
}

async function stopSession() {
    await fetch('/api/session/stop', { method: 'POST' });
}

async function updateStatus() {
    const res = await fetch('/api/session/status');
    const data = await res.json();

    const statusEl = document.getElementById('connection-status');
    statusEl.innerText = data.status;
    statusEl.style.color = data.status === 'Ready' ? 'var(--success-color)' : 'var(--text-secondary)';

    if (data.qr) {
        document.getElementById('qr-container').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qr)}" alt="QR Code">`;
    } else if (data.status === 'Ready') {
        document.getElementById('qr-container').innerHTML = '<p style="color: var(--success-color); font-size: 3rem;">✅</p><p>Connected</p>';
    } else if (data.status === 'Initializing...') {
        document.getElementById('qr-container').innerHTML = '<p>Initializing...</p>';
    } else {
        document.getElementById('qr-container').innerHTML = '<p>Click "Start" in Settings to connect</p>';
    }
}

function loadHistory() {
    // History removed for Ultra-Low RAM usage
    console.log("Chat history disabled for performance.");
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
}

// Socket Events
socket.on('qr', ({ qr }) => {
    document.getElementById('qr-container').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}" alt="QR Code">`;
    // If modal is open, update that QR too if it exists there
    const modalQr = document.querySelector('#settings-modal #qr-container');
    if (modalQr) modalQr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr)}" alt="QR Code">`;
});

socket.on('ready', () => {
    updateStatus();
});

socket.on('status', ({ status }) => {
    document.getElementById('connection-status').innerText = status;
    updateStatus();
});

// Message handling removed for ultra-low resource usage
