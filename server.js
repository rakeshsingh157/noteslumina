require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const path = require('path');
const https = require('https');

const app = express();

// Transporter for nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.APP_PASSWORD
    }
});

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rewrite /.netlify/functions/* to /api/* so frontend works locally
app.use((req, res, next) => {
    if (req.path.startsWith('/.netlify/functions/')) {
        req.url = req.url.replace('/.netlify/functions/', '/api/');
    }
    next();
});

app.use(express.static('.')); // Serve static files from current dir

app.get('/folders', (req, res) => {
    res.sendFile(path.join(__dirname, 'folders.html'));
});

app.get('/gallery', (req, res) => {
    res.sendFile(path.join(__dirname, 'gallery.html'));
});

app.get('/master', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/upload', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

app.get('/ai-chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'ai-chat.html'));
});

// --- AI Chat API Route ---
const aiRateLimitMap = new Map();

function callMistralAPI(apiKey, messages) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            model: 'mistral-small-latest',
            messages: messages,
            max_tokens: 1024
        });

        const options = {
            hostname: 'api.mistral.ai',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.choices && parsed.choices.length > 0) {
                        resolve(parsed.choices[0].message.content);
                    } else if (parsed.error) {
                        reject(new Error(parsed.error.message || 'Mistral API error'));
                    } else {
                        reject(new Error('Unexpected API response format'));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse API response'));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

app.post('/api/ai-chat', (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    if (!aiRateLimitMap.has(ip)) aiRateLimitMap.set(ip, []);
    let timestamps = aiRateLimitMap.get(ip).filter(t => now - t < 60000);
    if (timestamps.length >= 10) {
        return res.status(429).json({ error: 'Rate limit exceeded. Max 10 requests per minute.' });
    }
    timestamps.push(now);
    aiRateLimitMap.set(ip, timestamps);
    next();
}, async (req, res) => {
    try {
        const { messages, noteContext } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Messages array is required' });
        }

        const apiKey = process.env.MISTRAL_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'AI service not configured. Add MISTRAL_API_KEY to .env' });
        }

        const apiMessages = [];

        if (noteContext) {
            apiMessages.push({
                role: 'system',
                content: `You are Lumina AI, a helpful assistant integrated into a notes application called "Lumina Notes".
You were created by Mistral AI!
Lumina Notes was developed by Rakesh Kumar Singh.
Rakesh's links:
- Instagram: @rakeshsingh_157 (https://instagram.com/rakeshsingh_157)
- LinkedIn: https://www.linkedin.com/in/rakesh-kumar-singh-14b17331a/
- GitHub: https://github.com/rakeshsingh157

The user is asking questions about the following note content. Answer questions based on this context. Be concise, helpful, and friendly. If the question is unrelated to the note, you can still answer but mention it's outside the note's scope.

--- NOTE CONTENT ---
${noteContext}
--- END NOTE CONTENT ---`
            });
        } else {
            apiMessages.push({
                role: 'system',
                content: `You are Lumina AI, a helpful, friendly, and knowledgeable assistant integrated into a notes application called "Lumina Notes".
You were created by Mistral AI!
Lumina Notes was developed by Rakesh Kumar Singh.
Rakesh's links:
- Instagram: @rakeshsingh_157 (https://instagram.com/rakeshsingh_157)
- LinkedIn: https://www.linkedin.com/in/rakesh-kumar-singh-14b17331a/
- GitHub: https://github.com/rakeshsingh157

Help users with any questions they have. Be concise and informative. Use markdown formatting when appropriate for code blocks, lists, and emphasis.`
            });
        }

        const recentMessages = messages.slice(-20);
        recentMessages.forEach(msg => {
            apiMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });

        const reply = await callMistralAPI(apiKey, apiMessages);
        res.json({ reply });

    } catch (err) {
        console.error('AI Chat Error:', err);
        res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
    }
});

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize DB
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notes (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(500),
                content TEXT,
                password_hash TEXT,
                timestamp BIGINT,
                immutable BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS title VARCHAR(500)`).catch(() => {});
        await pool.query(`
            CREATE TABLE IF NOT EXISTS folders (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(500) NOT NULL,
                timestamp BIGINT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS folder_files (
                id VARCHAR(255) PRIMARY KEY,
                folder_id VARCHAR(255) REFERENCES folders(id) ON DELETE CASCADE,
                name VARCHAR(500) NOT NULL,
                content TEXT DEFAULT '',
                password_hash TEXT,
                immutable BOOLEAN DEFAULT FALSE,
                timestamp BIGINT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // Add columns if they don't exist (for existing tables)
        await pool.query(`ALTER TABLE folder_files ADD COLUMN IF NOT EXISTS password_hash TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE folder_files ADD COLUMN IF NOT EXISTS immutable BOOLEAN DEFAULT FALSE`).catch(() => {});
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gallery (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(500),
                url TEXT NOT NULL,
                display_url TEXT,
                thumb_url TEXT,
                delete_url TEXT,
                width INTEGER,
                height INTEGER,
                size INTEGER,
                password_hash TEXT,
                immutable BOOLEAN DEFAULT FALSE,
                timestamp BIGINT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS password_hash TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS immutable BOOLEAN DEFAULT FALSE`).catch(() => {});
        console.log('Database initialized');
    } catch (err) {
        console.error('Error initializing DB:', err);
    }
}
initDB();

// Routes

// Rate limiter: 1 user can only send 3 emails per minute
const mailRateLimitMap = new Map();
function mailRateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    if (!mailRateLimitMap.has(ip)) {
        mailRateLimitMap.set(ip, []);
    }
    let timestamps = mailRateLimitMap.get(ip);
    // Keep only timestamps from the last 60 seconds
    timestamps = timestamps.filter(t => now - t < 60000);
    if (timestamps.length >= 3) {
        return res.status(429).json({ error: 'Rate limit exceeded. You can only request 3 emails per minute.' });
    }
    timestamps.push(now);
    mailRateLimitMap.set(ip, timestamps);
    next();
}

app.post('/api/send-mail', mailRateLimiter, async (req, res) => {
    const { email, type, id, origin } = req.body;
    console.log('--- Send Mail Debug ---', { email, type, id, origin });
    if (!email || !type || !id) {
        return res.status(400).json({ error: 'Email, type, and id are required' });
    }

    try {
        let subject = '';
        let htmlContent = '';

        if (type === 'note') {
            const result = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Note not found' });
            }
            const note = result.rows[0];
            const title = note.title || 'Untitled Note';
            const noteUrl = `${origin || 'http://localhost:3000'}/?noteId=${id}`;
            subject = `[Lumina Notes] Note: ${title}`;
            htmlContent = `
                <div style="font-family: 'Outfit', sans-serif; background-color: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="margin-bottom: 20px; background: rgba(137, 180, 250, 0.1); border: 1px dashed #89b4fa; padding: 12px; border-radius: 8px; text-align: center;">
                        <a href="${noteUrl}" style="color: #89b4fa; text-decoration: none; font-weight: 600; font-size: 0.95rem;">🔗 View/Edit this Note Online</a>
                    </div>
                    <h2 style="color: #cba6f7; margin-bottom: 5px;">${title}</h2>
                    <p style="font-size: 0.8rem; color: #a6adc8; margin-bottom: 20px;">Last updated: ${new Date(parseInt(note.timestamp)).toLocaleString()}</p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <div style="white-space: pre-wrap; font-size: 1rem; line-height: 1.6; color: #cdd6f4;">${note.content}</div>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px; margin-bottom: 15px;">
                    <p style="font-size: 0.75rem; color: #89b4fa; text-align: center; margin: 0;">Sent via Lumina Notes</p>
                </div>
            `;
        } else if (type === 'file') {
            const result = await pool.query('SELECT * FROM folder_files WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'File not found' });
            }
            const file = result.rows[0];
            const noteUrl = `${origin || 'http://localhost:3000'}/?noteId=${id}`;
            subject = `[Lumina Notes] File: ${file.name}`;
            htmlContent = `
                <div style="font-family: 'Outfit', sans-serif; background-color: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="margin-bottom: 20px; background: rgba(137, 180, 250, 0.1); border: 1px dashed #89b4fa; padding: 12px; border-radius: 8px; text-align: center;">
                        <a href="${noteUrl}" style="color: #89b4fa; text-decoration: none; font-weight: 600; font-size: 0.95rem;">🔗 View/Edit this File Online</a>
                    </div>
                    <h2 style="color: #cba6f7; margin-bottom: 5px;">${file.name}</h2>
                    <p style="font-size: 0.8rem; color: #a6adc8; margin-bottom: 20px;">Last updated: ${new Date(parseInt(file.timestamp)).toLocaleString()}</p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <div style="white-space: pre-wrap; font-size: 1rem; line-height: 1.6; color: #cdd6f4;">${file.content}</div>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px; margin-bottom: 15px;">
                    <p style="font-size: 0.75rem; color: #89b4fa; text-align: center; margin: 0;">Sent via Lumina Notes</p>
                </div>
            `;
        } else if (type === 'folder') {
            const folderResult = await pool.query('SELECT * FROM folders WHERE id = $1', [id]);
            if (folderResult.rows.length === 0) {
                return res.status(404).json({ error: 'Folder not found' });
            }
            const folder = folderResult.rows[0];
            const filesResult = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [id]);
            const files = filesResult.rows;
            const folderUrl = `${origin || 'http://localhost:3000'}/folders?folderId=${id}`;

            subject = `[Lumina Notes] Folder: ${folder.name}`;
            
            let filesHtml = '';
            if (files.length === 0) {
                filesHtml = '<p style="font-style: italic; color: #a6adc8;">This folder is empty.</p>';
            } else {
                files.forEach((file, idx) => {
                    filesHtml += `
                        <div style="margin-bottom: 30px; background-color: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                            <h3 style="color: #89b4fa; margin-top: 0; margin-bottom: 5px;">${idx + 1}. ${file.name}</h3>
                            <p style="font-size: 0.75rem; color: #a6adc8; margin-top: 0; margin-bottom: 12px;">Last updated: ${new Date(parseInt(file.timestamp)).toLocaleString()}</p>
                            <div style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.6; color: #cdd6f4;">${file.content || '<i>Empty file</i>'}</div>
                        </div>
                    `;
                });
            }

            htmlContent = `
                <div style="font-family: 'Outfit', sans-serif; background-color: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="margin-bottom: 20px; background: rgba(137, 180, 250, 0.1); border: 1px dashed #89b4fa; padding: 12px; border-radius: 8px; text-align: center;">
                        <a href="${folderUrl}" style="color: #89b4fa; text-decoration: none; font-weight: 600; font-size: 0.95rem;">📁 Open Folder in Lumina</a>
                    </div>
                    <h2 style="color: #cba6f7; margin-bottom: 5px;"><span style="color: #ffd93d;">📁</span> Folder: ${folder.name}</h2>
                    <p style="font-size: 0.8rem; color: #a6adc8; margin-bottom: 25px;">Total files: ${files.length}</p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-bottom: 25px;">
                    ${filesHtml}
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px; margin-bottom: 15px;">
                    <p style="font-size: 0.75rem; color: #89b4fa; text-align: center; margin: 0;">Sent via Lumina Notes</p>
                </div>
            `;
        } else if (type === 'image') {
            const result = await pool.query('SELECT * FROM gallery WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Image not found' });
            }
            const img = result.rows[0];
            const title = img.title || 'Untitled Image';
            const galleryUrl = `${origin || 'http://localhost:3000'}/gallery`;
            subject = `[Lumina Notes] Image: ${title}`;
            htmlContent = `
                <div style="font-family: 'Outfit', sans-serif; background-color: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1); text-align: center;">
                    <div style="margin-bottom: 20px; background: rgba(137, 180, 250, 0.1); border: 1px dashed #89b4fa; padding: 12px; border-radius: 8px; text-align: center;">
                        <a href="${galleryUrl}" style="color: #89b4fa; text-decoration: none; font-weight: 600; font-size: 0.95rem;">🖼️ Open Gallery in Lumina</a>
                    </div>
                    <h2 style="color: #cba6f7; margin-bottom: 5px; text-align: left;">${title}</h2>
                    <p style="font-size: 0.8rem; color: #a6adc8; margin-bottom: 20px; text-align: left;">Uploaded: ${new Date(parseInt(img.timestamp)).toLocaleString()}</p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <div style="margin-bottom: 20px;">
                        <img src="${img.url}" alt="${title}" style="max-width: 100%; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 12px rgba(0,0,0,0.5);" />
                    </div>
                    <p style="font-size: 0.9rem; color: #a6adc8; margin-bottom: 20px;"><a href="${img.url}" style="color: #89b4fa; text-decoration: none;">View Original Image</a></p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin-top: 30px; margin-bottom: 15px;">
                    <p style="font-size: 0.75rem; color: #89b4fa; text-align: center; margin: 0;">Sent via Lumina Notes</p>
                </div>
            `;
        } else {
            return res.status(400).json({ error: 'Invalid item type' });
        }

        const mailOptions = {
            from: `"Lumina Notes" <${process.env.EMAIL}>`,
            to: email,
            subject: subject,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Email sent successfully!' });

    } catch (err) {
        console.error('Error sending email:', err);
        res.status(500).json({ error: 'Failed to send email. Please check configuration.' });
    }
});

// Get all notes
app.get('/api/notes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notes');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single note
app.get('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create or Update note
app.post('/api/notes', async (req, res) => {
    try {
        const { id, title, content, passwordHash, timestamp, immutable } = req.body;

        // Check if exists
        const check = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);

        if (check.rows.length > 0) {
            // Update
            const current = check.rows[0];
            if (current.immutable) {
                return res.status(403).json({ error: 'Note is immutable' });
            }

            await pool.query(
                'UPDATE notes SET title = $1, content = $2, password_hash = COALESCE($3, password_hash), timestamp = $4, immutable = $5 WHERE id = $6',
                [title || null, content, passwordHash, timestamp, immutable, id]
            );
        } else {
            // Insert
            await pool.query(
                'INSERT INTO notes (id, title, content, password_hash, timestamp, immutable) VALUES ($1, $2, $3, $4, $5, $6)',
                [id, title || null, content, passwordHash, timestamp, immutable]
            );
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM notes WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== FOLDER ROUTES =====

// Get all folders
app.get('/api/folders', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM folders ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create folder
app.post('/api/folders', async (req, res) => {
    try {
        const { id, name, timestamp } = req.body;
        await pool.query(
            'INSERT INTO folders (id, name, timestamp) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2, timestamp = $3',
            [id, name, timestamp]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rename folder
app.put('/api/folders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, timestamp } = req.body;
        await pool.query('UPDATE folders SET name = $1, timestamp = $2 WHERE id = $3', [name, timestamp, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete folder
app.delete('/api/folders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM folders WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get files in folder
app.get('/api/folders/:folderId/files', async (req, res) => {
    try {
        const { folderId } = req.params;
        const result = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [folderId]);
        const folder = await pool.query('SELECT * FROM folders WHERE id = $1', [folderId]);
        res.json({ folder: folder.rows[0] || null, files: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create/update file in folder
app.post('/api/folders/:folderId/files', async (req, res) => {
    try {
        const { folderId } = req.params;
        const { id, name, content, timestamp, passwordHash, immutable, syncToNotes } = req.body;
        await pool.query(
            `INSERT INTO folder_files (id, folder_id, name, content, password_hash, immutable, timestamp) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (id) DO UPDATE SET name = $3, content = $4, 
             password_hash = COALESCE($5, folder_files.password_hash), 
             immutable = COALESCE($6, folder_files.immutable), timestamp = $7`,
            [id, folderId, name, content, passwordHash || null, immutable || false, timestamp]
        );
        // Also sync to notes table if requested
        if (syncToNotes) {
            await pool.query(
                `INSERT INTO notes (id, content, password_hash, timestamp, immutable) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (id) DO UPDATE SET content = $2, 
                 password_hash = COALESCE($3, notes.password_hash), 
                 timestamp = $4, immutable = COALESCE($5, notes.immutable)`,
                [id, content, passwordHash || null, timestamp, immutable || false]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single file
app.get('/api/folders/:folderId/files/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const result = await pool.query('SELECT * FROM folder_files WHERE id = $1', [fileId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete file
app.delete('/api/folders/:folderId/files/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        await pool.query('DELETE FROM folder_files WHERE id = $1', [fileId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ADMIN ROUTES =====

// Admin auth middleware
function adminAuth(req, res, next) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const provided = req.headers['x-admin-password'];
    if (provided !== adminPassword) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    next();
}

// Admin stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        const notesCount = await pool.query('SELECT COUNT(*) as count FROM notes');
        const protectedCount = await pool.query("SELECT COUNT(*) as count FROM notes WHERE password_hash IS NOT NULL AND password_hash != ''");
        const immutableCount = await pool.query('SELECT COUNT(*) as count FROM notes WHERE immutable = true');
        const foldersCount = await pool.query('SELECT COUNT(*) as count FROM folders');
        const filesCount = await pool.query('SELECT COUNT(*) as count FROM folder_files');
        res.json({
            totalNotes: parseInt(notesCount.rows[0].count),
            protectedNotes: parseInt(protectedCount.rows[0].count),
            immutableNotes: parseInt(immutableCount.rows[0].count),
            totalFolders: parseInt(foldersCount.rows[0].count),
            totalFiles: parseInt(filesCount.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin get all notes
app.get('/api/admin/notes', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notes ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin force delete note
app.delete('/api/admin/notes/:id', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin force edit note (bypass password & immutable)
app.put('/api/admin/notes/:id', adminAuth, async (req, res) => {
    try {
        const { content, passwordHash, immutable, timestamp } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;
        if (content !== undefined) { fields.push(`content = $${idx++}`); values.push(content); }
        if (passwordHash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(passwordHash); }
        if (immutable !== undefined) { fields.push(`immutable = $${idx++}`); values.push(immutable); }
        if (timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(timestamp); }
        if (fields.length > 0) {
            values.push(req.params.id);
            await pool.query(`UPDATE notes SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin get all folders with file counts
app.get('/api/admin/folders', adminAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT f.*, COUNT(ff.id) as file_count 
            FROM folders f 
            LEFT JOIN folder_files ff ON f.id = ff.folder_id 
            GROUP BY f.id 
            ORDER BY f.timestamp DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin delete folder
app.delete('/api/admin/folders/:id', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM folders WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin get folder files
app.get('/api/admin/folders/:folderId/files', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [req.params.folderId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin delete folder file
app.delete('/api/admin/folders/:folderId/files/:fileId', adminAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM folder_files WHERE id = $1', [req.params.fileId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== GALLERY ROUTES =====

// Get all images
app.get('/api/gallery', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM gallery ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single image
app.get('/api/gallery/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM gallery WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Image not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save image metadata
app.post('/api/gallery', async (req, res) => {
    try {
        const { id, title, url, display_url, thumb_url, delete_url, width, height, size, timestamp, password_hash, immutable } = req.body;
        await pool.query(
            `INSERT INTO gallery (id, title, url, display_url, thumb_url, delete_url, width, height, size, timestamp, password_hash, immutable) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             ON CONFLICT (id) DO UPDATE SET title = $2, url = $3, display_url = $4, thumb_url = $5, 
             delete_url = $6, width = $7, height = $8, size = $9, timestamp = $10,
             password_hash = COALESCE($11, gallery.password_hash), immutable = COALESCE($12, gallery.immutable)`,
            [id, title, url, display_url, thumb_url, delete_url, width || 0, height || 0, size || 0, timestamp, password_hash || null, immutable || false]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update image metadata (password, immutable, title)
app.put('/api/gallery/:id', async (req, res) => {
    try {
        const body = req.body;
        const fields = [];
        const values = [];
        let idx = 1;
        if (body.title !== undefined) { fields.push(`title = $${idx++}`); values.push(body.title); }
        if (body.password_hash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(body.password_hash); }
        if (body.immutable !== undefined) { fields.push(`immutable = $${idx++}`); values.push(body.immutable); }
        if (body.timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(body.timestamp); }
        if (fields.length > 0) {
            values.push(req.params.id);
            await pool.query(`UPDATE gallery SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete image
app.delete('/api/gallery/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
