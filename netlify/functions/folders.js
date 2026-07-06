const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize folders & files tables
async function initDB() {
    try {
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
        // Ensure notes table exists for syncing
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notes (
                id VARCHAR(255) PRIMARY KEY,
                content TEXT,
                password_hash TEXT,
                timestamp BIGINT,
                immutable BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('Folders DB initialized');
    } catch (err) {
        console.error('Error initializing Folders DB:', err);
    }
}
initDB();

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const path = event.path.replace('/.netlify/functions/folders', '');
    const method = event.httpMethod;
    const segments = path.split('/').filter(Boolean); // e.g. ['folderId', 'files', 'fileId']

    try {
        // ===== FOLDER ROUTES =====

        // GET / - list all folders
        if (method === 'GET' && segments.length === 0) {
            const result = await pool.query('SELECT * FROM folders ORDER BY timestamp DESC');
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // POST / - create folder
        if (method === 'POST' && segments.length === 0) {
            const { id, name, timestamp } = JSON.parse(event.body);
            await pool.query(
                'INSERT INTO folders (id, name, timestamp) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2, timestamp = $3',
                [id, name, timestamp]
            );
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // DELETE /:folderId - delete folder (cascades to files)
        if (method === 'DELETE' && segments.length === 1) {
            const folderId = segments[0];
            await pool.query('DELETE FROM folders WHERE id = $1', [folderId]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PUT /:folderId - rename folder
        if (method === 'PUT' && segments.length === 1) {
            const folderId = segments[0];
            const { name, timestamp } = JSON.parse(event.body);
            await pool.query('UPDATE folders SET name = $1, timestamp = $2 WHERE id = $3', [name, timestamp, folderId]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // ===== FILE ROUTES =====

        // GET /:folderId/files - list files in folder
        if (method === 'GET' && segments.length === 2 && segments[1] === 'files') {
            const folderId = segments[0];
            const result = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [folderId]);
            // Also get folder info
            const folder = await pool.query('SELECT * FROM folders WHERE id = $1', [folderId]);
            return {
                statusCode: 200, headers,
                body: JSON.stringify({ folder: folder.rows[0] || null, files: result.rows })
            };
        }

        // POST /:folderId/files - create/update file
        if (method === 'POST' && segments.length === 2 && segments[1] === 'files') {
            const folderId = segments[0];
            const { id, name, content, timestamp, passwordHash, immutable, syncToNotes } = JSON.parse(event.body);
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
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // GET /:folderId/files/:fileId - get single file
        if (method === 'GET' && segments.length === 3 && segments[1] === 'files') {
            const fileId = segments[2];
            const result = await pool.query('SELECT * FROM folder_files WHERE id = $1', [fileId]);
            if (result.rows.length === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'File not found' }) };
            }
            return { statusCode: 200, headers, body: JSON.stringify(result.rows[0]) };
        }

        // DELETE /:folderId/files/:fileId - delete file
        if (method === 'DELETE' && segments.length === 3 && segments[1] === 'files') {
            const fileId = segments[2];
            await pool.query('DELETE FROM folder_files WHERE id = $1', [fileId]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

    } catch (err) {
        console.error('Folders Error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
