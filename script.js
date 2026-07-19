// --- DOM Elements ---
const views = {
    home: document.getElementById('home-view'),
    editor: document.getElementById('editor-view')
};
const navBtns = {
    home: document.getElementById('home-btn'),
    theme: document.getElementById('theme-toggle-btn')
};
const notesGrid = document.getElementById('notes-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const createBtn = document.getElementById('create-new-btn');

// Editor Elements
const noteArea = document.getElementById('note-area');
const noteTitleInput = document.getElementById('note-title');
const saveBtn = document.getElementById('save-btn');
const lockToggleBtn = document.getElementById('lock-toggle-btn');
const passwordPanel = document.getElementById('password-panel');
const passwordInput = document.getElementById('password-input');
const savePasswordBtn = document.getElementById('save-password-btn');
const copyBtn = document.getElementById('copy-btn');
const statusBadge = document.getElementById('status-badge');
const charCount = document.getElementById('char-count');
const lastUpdated = document.getElementById('last-updated');
const syncStatus = document.getElementById('sync-status');
const overlay = document.getElementById('overlay');
const unlockBtn = document.getElementById('unlock-btn');
const unlockInput = document.getElementById('unlock-password');
const errorMsg = document.getElementById('error-msg');
const immutableCheck = document.getElementById('immutable-check');

// Theme Elements
const themeModal = document.getElementById('theme-modal');
const closeThemeBtn = document.getElementById('close-theme-btn');
const themeOptions = document.querySelectorAll('.theme-option');

// Read Modal Elements
const readModal = document.getElementById('read-modal');
const readTitle = document.getElementById('read-title');
const readContent = document.getElementById('read-content');
const readDate = document.getElementById('read-date');
const readEditBtn = document.getElementById('read-edit-btn');
const readCloseBtn = document.getElementById('read-close-btn');
const readDeleteBtn = document.getElementById('read-delete-btn');
const readDownloadBtn = document.getElementById('read-download-btn');
const readCopyBtn = document.getElementById('read-copy-btn');
const readMailBtn = document.getElementById('read-mail-btn');
const readAiBtn = document.getElementById('read-ai-btn');
const editorMailBtn = document.getElementById('editor-mail-btn');
const editorAiBtn = document.getElementById('editor-ai-btn');

// --- State ---
let currentNoteId = null;
let isCreator = false;
const bc = new BroadcastChannel('notes_app_sync');

// --- API Helpers ---
const API_URL = '/.netlify/functions/notes';

async function fetchNotes() {
    try {
        const res = await fetch(API_URL);
        return await res.json();
    } catch (e) {
        console.error("API Error", e);
        return [];
    }
}

async function fetchNote(id) {
    try {
        const res = await fetch(`${API_URL}/${id}`);
        if (!res.ok) return null;
        const note = await res.json();
        return {
            id: note.id,
            title: note.title || '',
            content: note.content,
            passwordHash: note.password_hash,
            timestamp: parseInt(note.timestamp),
            immutable: note.immutable
        };
    } catch (e) {
        return null;
    }
}

async function saveNoteAPI(note) {
    try {
        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: note.id,
                title: note.title || '',
                content: note.content,
                passwordHash: note.passwordHash,
                timestamp: note.timestamp,
                immutable: note.immutable
            })
        });
    } catch (e) {
        console.error("Save Error", e);
        showToast("Error Saving Note");
    }
}

async function deleteNoteAPI(id) {
    try {
        await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    } catch (e) {
        console.error("Delete Error", e);
    }
}

// --- Initialization ---
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    handleRouting();
});

window.addEventListener('popstate', handleRouting);

function handleRouting() {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get('noteId');

    if (noteId) {
        showEditor(noteId);
    } else {
        showHome();
    }
}

// --- View Switching ---

function showHome() {
    views.editor.classList.remove('active');
    setTimeout(() => {
        views.editor.classList.add('hidden');
        views.home.classList.remove('hidden');
        // Small delay to allow display:block to apply before opacity transition
        requestAnimationFrame(() => {
            views.home.classList.add('active');
        });
    }, 300); // Wait for exit animation

    navBtns.home.classList.add('hidden');
    currentNoteId = null;
    loadDashboard();
}

function showEditor(id) {
    views.home.classList.remove('active');
    setTimeout(() => {
        views.home.classList.add('hidden');
        views.editor.classList.remove('hidden');
        requestAnimationFrame(() => {
            views.editor.classList.add('active');
        });
    }, 300);

    navBtns.home.classList.remove('hidden');
    loadNote(id);
}

// --- Dashboard Logic ---

async function loadDashboard() {
    notesGrid.innerHTML = '<div class="loading" style="color:white; text-align:center; width:100%; padding:2rem;"><i class="bx bx-loader-alt bx-spin" style="font-size:2rem;"></i><br>Loading Notes...</div>';

    // Migration Check
    await migrateLocalToDB();

    const notes = await fetchNotes();
    notesGrid.innerHTML = '';

    if (notes.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    // Sort by newest first
    notes.sort((a, b) => b.timestamp - a.timestamp);

    notes.forEach(note => {
        const mappedNote = {
            id: note.id,
            title: note.title || '',
            content: note.content,
            passwordHash: note.password_hash,
            timestamp: parseInt(note.timestamp),
            immutable: note.immutable
        };
        const card = createNoteCard(mappedNote);
        notesGrid.appendChild(card);
    });
}

// --- Migration Logic ---
async function migrateLocalToDB() {
    if (localStorage.getItem('migrated_to_db')) return;

    const localNotes = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('note_')) {
            try {
                const note = JSON.parse(localStorage.getItem(key));
                if (note && note.id) localNotes.push(note);
            } catch (e) { }
        }
    }

    if (localNotes.length > 0) {
        showToast("Migrating local notes to Database...");
        for (const note of localNotes) {
            await saveNoteAPI(note);
        }
        localStorage.setItem('migrated_to_db', 'true');
        showToast("Migration Complete");
    }
}

function createNoteCard(note) {
    const div = document.createElement('div');
    div.className = 'note-card';

    // Use custom title, fallback to first line of content
    const title = note.title || note.content.split('\n')[0] || 'Untitled Note';
    const preview = note.content.substring(0, 150) || 'No content...';
    const date = new Date(note.timestamp).toLocaleDateString();
    const isLocked = !!note.passwordHash;
    const isImmutable = !!note.immutable;

    div.innerHTML = `
        <button class="note-card-ai-btn" title="Ask AI about this note"><i class='bx bx-bot'></i></button>
        <h3>${isLocked ? '🔒 ' : ''}${title}</h3>
        <p>${isLocked ? '<i>This note is password protected.</i>' : preview}</p>
        <div class="meta">
            <span>${date}</span>
            <div class="badges">
                ${isLocked ? '<span class="lock-badge"><i class="bx bxs-lock-alt"></i> Protected</span>' : ''}
                ${isImmutable ? '<span class="lock-badge"><i class="bx bxs-check-shield"></i> Final</span>' : ''}
            </div>
        </div>
    `;

    // AI button click
    const aiBtn = div.querySelector('.note-card-ai-btn');
    aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = `/ai-chat.html?noteId=${note.id}`;
    });

    div.addEventListener('click', () => {
        if (isLocked) {
            // If locked, go to editor to unlock
            const newUrl = `${window.location.pathname}?noteId=${note.id}`;
            window.history.pushState({ path: newUrl }, '', newUrl);
            showEditor(note.id);
        } else {
            // Open Read Modal
            openReadModal(note);
        }
    });

    return div;
}

// Confirm Modal Elements
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMsg = document.getElementById('confirm-msg');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const confirmYesBtn = document.getElementById('confirm-yes-btn');

let confirmCallback = null;

function showConfirm(title, msg, callback) {
    confirmTitle.textContent = title;
    confirmMsg.textContent = msg;
    confirmCallback = callback;
    confirmModal.classList.remove('hidden');
}

confirmCancelBtn.onclick = () => {
    confirmModal.classList.add('hidden');
    confirmCallback = null;
    // If it was the checkbox, reset it
    if (document.activeElement === immutableCheck) {
        immutableCheck.checked = false;
    }
};

confirmYesBtn.onclick = () => {
    confirmModal.classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
};

// Close confirm on outside click
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
        confirmModal.classList.add('hidden');
        if (document.activeElement === immutableCheck) {
            immutableCheck.checked = false;
        }
    }
});

function openReadModal(note) {
    readTitle.textContent = note.title || note.content.split('\n')[0] || 'Untitled Note';

    // Markdown Parsing
    readContent.innerHTML = parseMarkdown(note.content);

    readDate.textContent = `Last updated: ${new Date(note.timestamp).toLocaleString()}`;

    // Setup Actions
    if (note.immutable) {
        readEditBtn.classList.add('hidden');
    } else {
        readEditBtn.classList.remove('hidden');
        readEditBtn.onclick = () => {
            readModal.classList.add('hidden');
            const newUrl = `${window.location.pathname}?noteId=${note.id}`;
            window.history.pushState({ path: newUrl }, '', newUrl);
            showEditor(note.id);
        };
    }

    readDeleteBtn.onclick = () => {
        showConfirm(
            "Delete Note?",
            "Are you sure you want to delete this note? This action cannot be undone.",
            () => {
                deleteNote(note.id);
                readModal.classList.add('hidden');
            }
        );
    };

    readDownloadBtn.onclick = () => {
        downloadNote(note);
    };

    readCopyBtn.onclick = () => {
        navigator.clipboard.writeText(note.content).then(() => {
            showToast("Text Copied to Clipboard");
        });
    };

    readMailBtn.onclick = async () => {
        const email = await showInputModal("Email Note", "Enter your email address...");
        if (!email) return;
        if (!validateEmail(email)) {
            showToast("Invalid email address");
            return;
        }
        sendEmail('note', note.id, email);
    };

    readAiBtn.onclick = () => {
        readModal.classList.add('hidden');
        window.location.href = `/ai-chat.html?noteId=${note.id}`;
    };

    readModal.classList.remove('hidden');
}

readCloseBtn.addEventListener('click', () => {
    readModal.classList.add('hidden');
});

// Close modal on outside click
readModal.addEventListener('click', (e) => {
    if (e.target === readModal) {
        readModal.classList.add('hidden');
    }
});

async function deleteNote(id) {
    await deleteNoteAPI(id);
    sessionStorage.removeItem(`creator_${id}`);
    showToast("Note Deleted");
    loadDashboard();
}

function downloadNote(note) {
    const blob = new Blob([note.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `note-${note.id}.md`; // Default to Markdown
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Download Started");
}

function parseMarkdown(text) {
    // Basic Markdown Parser
    let html = text
        // Escape HTML
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Headers
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        // Bold
        .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
        // Italic
        .replace(/\*(.*)\*/gim, '<i>$1</i>')
        // Blockquote
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        // Code Block
        .replace(/```([^`]+)```/gim, '<pre><code>$1</code></pre>')
        // Inline Code
        .replace(/`([^`]+)`/gim, '<code>$1</code>')
        // Lists (unordered)
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
        // Line Breaks
        .replace(/\n/gim, '<br>');

    return html;
}

// --- Editor Logic ---

createBtn.addEventListener('click', () => {
    // Generate ID
    const newId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    // Set Creator Mode
    sessionStorage.setItem(`creator_${newId}`, 'true');

    // Navigate
    const newUrl = `${window.location.pathname}?noteId=${newId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    showEditor(newId);
});

async function loadNote(id) {
    currentNoteId = id;
    currentNoteHash = null;
    currentNoteContent = null;

    // Show loading state
    noteArea.value = "Loading...";
    noteArea.disabled = true;

    const data = await fetchNote(id);

    // Reset UI
    errorMsg.classList.add('hidden');
    unlockInput.value = '';

    isCreator = sessionStorage.getItem(`creator_${id}`) === 'true';

    if (!data) {
        // New Note
        if (isCreator) {
            noteTitleInput.value = '';
            noteTitleInput.disabled = false;
            noteArea.value = '';
            noteArea.disabled = false;
            noteArea.readOnly = false;
            lockToggleBtn.classList.remove('hidden', 'locked');
            lockToggleBtn.innerHTML = "<i class='bx bxs-lock-open-alt'></i>";
            passwordPanel.classList.add('hidden');
            immutableCheck.checked = false;
            immutableCheck.disabled = false;
            overlay.classList.add('hidden');
            updateMeta(Date.now());
        } else {
            noteArea.value = "Note not found.";
            noteArea.disabled = true;
        }
        return;
    }

    // Existing Note
    if (data.immutable) {
        // Immutable Note
        noteTitleInput.value = data.title || '';
        noteTitleInput.disabled = true;
        noteArea.readOnly = true;
        noteArea.disabled = false;
        saveBtn.classList.add('hidden');
        lockToggleBtn.classList.add('hidden');
        passwordPanel.classList.add('hidden');
        immutableCheck.checked = true;
        immutableCheck.disabled = true;
        statusBadge.textContent = "Finalized";
        statusBadge.classList.remove('hidden');
    } else {
        // Mutable Note — editable by anyone (password-protected ones unlock first)
        noteTitleInput.value = data.title || '';
        noteTitleInput.disabled = false;
        noteArea.disabled = false;
        noteArea.readOnly = false;
        saveBtn.classList.remove('hidden');
        if (data.passwordHash) {
            lockToggleBtn.classList.add('locked');
            lockToggleBtn.innerHTML = "<i class='bx bxs-lock-alt'></i>";
        } else {
            lockToggleBtn.classList.remove('locked');
            lockToggleBtn.innerHTML = "<i class='bx bxs-lock-open-alt'></i>";
        }
        lockToggleBtn.classList.remove('hidden');
        passwordPanel.classList.add('hidden');
        immutableCheck.checked = false;
        immutableCheck.disabled = false;
        isCreator = true; // grant editing rights
        sessionStorage.setItem(`creator_${id}`, 'true');
    }

    if (data.passwordHash) {
        overlay.classList.remove('hidden');
        // Store hash for unlock check
        currentNoteHash = data.passwordHash;
        currentNoteContent = data.content;
    } else {
        renderNoteContent(data);
    }
}

let currentNoteHash = null;
let currentNoteContent = null;

function renderNoteContent(data) {
    noteTitleInput.value = data.title || '';
    noteArea.value = data.content;
    updateCharCount();
    updateMeta(data.timestamp);
}

// Save & Sync
function triggerAutoSave() {
    if (!currentNoteId || !isCreator) return;

    const noteData = {
        id: currentNoteId,
        title: noteTitleInput.value.trim(),
        content: noteArea.value,
        passwordHash: currentNoteHash,
        timestamp: Date.now(),
        immutable: false
    };

    saveNoteAPI(noteData);
    broadcastUpdate(noteData);
    updateCharCount();
    updateMeta(noteData.timestamp);
    syncStatus.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Saving...";
    setTimeout(() => syncStatus.innerHTML = "<i class='bx bx-cloud-upload'></i> Synced", 500);
}

noteArea.addEventListener('input', triggerAutoSave);
noteTitleInput.addEventListener('input', triggerAutoSave);

saveBtn.addEventListener('click', () => {
    showToast("Note Saved Successfully");
});

editorMailBtn.addEventListener('click', async () => {
    if (!currentNoteId) return;
    const email = await showInputModal("Email Note", "Enter your email address...");
    if (!email) return;
    if (!validateEmail(email)) {
        showToast("Invalid email address");
        return;
    }
    sendEmail('note', currentNoteId, email);
});

editorAiBtn.addEventListener('click', () => {
    if (!currentNoteId) return;
    window.location.href = `/ai-chat.html?noteId=${currentNoteId}`;
});

// Password Setup — Lock Toggle
lockToggleBtn.addEventListener('click', () => {
    passwordPanel.classList.toggle('hidden');
    if (!passwordPanel.classList.contains('hidden')) {
        passwordInput.focus();
    }
});

savePasswordBtn.addEventListener('click', async () => {
    const password = passwordInput.value;
    if (!password) return;

    const hash = await hashPassword(password);
    currentNoteHash = hash;

    const noteData = {
        id: currentNoteId,
        title: noteTitleInput.value.trim(),
        content: noteArea.value,
        passwordHash: hash,
        timestamp: Date.now(),
        immutable: false
    };

    saveNoteAPI(noteData);
    broadcastUpdate(noteData);

    passwordInput.value = '';
    passwordPanel.classList.add('hidden');
    lockToggleBtn.classList.add('locked');
    lockToggleBtn.innerHTML = "<i class='bx bxs-lock-alt'></i>";
    statusBadge.classList.remove('hidden');
    showToast("Password Protection Enabled");
});

// Finalize Checkbox
immutableCheck.addEventListener('change', () => {
    if (!currentNoteId || !isCreator) return;

    if (immutableCheck.checked) {
        showConfirm(
            "Finalize Note?",
            "Once finalized, this note CANNOT be edited again. Are you sure?",
            () => {
                const noteData = {
                    id: currentNoteId,
                    title: noteTitleInput.value.trim(),
                    content: noteArea.value,
                    passwordHash: currentNoteHash,
                    timestamp: Date.now(),
                    immutable: true
                };
                saveNoteAPI(noteData);
                broadcastUpdate(noteData);
                loadNote(currentNoteId);
                showToast("Note Finalized");
            }
        );
    }
});

// Unlock
unlockBtn.addEventListener('click', async () => {
    const input = unlockInput.value;

    if (!currentNoteHash) return;

    const inputHash = await hashPassword(input);

    if (inputHash === currentNoteHash) {
        overlay.classList.add('hidden');
        isCreator = true;
        sessionStorage.setItem(`creator_${currentNoteId}`, 'true');
        noteArea.disabled = false;
        noteArea.readOnly = false;
        saveBtn.classList.remove('hidden');
        immutableCheck.disabled = false;
        renderNoteContent({ content: currentNoteContent, timestamp: Date.now() });
    } else {
        errorMsg.classList.remove('hidden');
        unlockInput.classList.add('shake');
        setTimeout(() => unlockInput.classList.remove('shake'), 500);
    }
});

// --- Theme Logic ---

navBtns.theme.addEventListener('click', () => {
    themeModal.classList.remove('hidden');
});

closeThemeBtn.addEventListener('click', () => {
    themeModal.classList.add('hidden');
});

themeOptions.forEach(btn => {
    btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        themeModal.classList.add('hidden');
    });
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'cosmic';
    document.body.setAttribute('data-theme', savedTheme);
}

// --- Helpers ---

navBtns.home.addEventListener('click', () => {
    // Clear URL param
    window.history.pushState({ path: window.location.pathname }, '', window.location.pathname);
    showHome();
});

copyBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link Copied to Clipboard");
    });
});

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showInputModal(title, placeholder, defaultVal) {
    return new Promise((resolve) => {
        const modal = document.getElementById('input-modal');
        const field = document.getElementById('input-modal-field');
        const okBtn = document.getElementById('input-modal-ok');
        const cancelBtn = document.getElementById('input-modal-cancel');
        document.getElementById('input-modal-title').textContent = title;
        field.placeholder = placeholder || 'Name...';
        field.value = defaultVal || '';
        modal.classList.remove('hidden');
        field.focus();

        function cleanup(val) {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            field.removeEventListener('keydown', onKey);
            resolve(val);
        }
        function onOk() { cleanup(field.value.trim()); }
        function onCancel() { cleanup(null); }
        function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel(); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        field.addEventListener('keydown', onKey);
    });
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

async function sendEmail(type, id, email) {
    showToast("Sending email...");
    try {
        const res = await fetch('/.netlify/functions/send-mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, id, email, origin: window.location.origin })
        });
        const data = await res.json();
        if (res.ok) {
            showToast("Email sent successfully!");
        } else {
            showToast(data.error || "Failed to send email");
        }
    } catch (e) {
        showToast("Error sending email");
    }
}

function updateCharCount() {
    charCount.textContent = `${noteArea.value.length} characters`;
}

function updateMeta(ts) {
    if (!ts) return;
    const date = new Date(ts);
    lastUpdated.textContent = `Last updated: ${date.toLocaleTimeString()}`;
}

function broadcastUpdate(data) {
    bc.postMessage({ type: 'UPDATE', data });
}

async function hashPassword(str) {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sync Listener
bc.onmessage = (event) => {
    const { type, data } = event.data;
    if (type === 'UPDATE') {
        if (data.id === currentNoteId && document.activeElement !== noteArea) {
            noteArea.value = data.content;
            updateCharCount();
            updateMeta(data.timestamp);
        }
    }
};

// Search
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.note-card');
    let hasVisible = false;

    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(term)) {
            card.style.display = 'flex';
            hasVisible = true;
        } else {
            card.style.display = 'none';
        }
    });

    if (!hasVisible) {
        emptyState.classList.remove('hidden');
        emptyState.querySelector('p').textContent = "No matching notes found.";
    } else {
        emptyState.classList.add('hidden');
    }
});
