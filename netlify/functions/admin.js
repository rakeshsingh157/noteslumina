const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Admin password check
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const providedPassword = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];

    if (providedPassword !== adminPassword) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid admin password' }) };
    }

    const path = event.path.replace('/.netlify/functions/admin', '');
    const method = event.httpMethod;
    const segments = path.split('/').filter(Boolean);

    try {
        // ===== STATS =====
        // GET /stats
        if (method === 'GET' && segments[0] === 'stats') {
            const notesCount = await pool.query('SELECT COUNT(*) as count FROM notes');
            const protectedCount = await pool.query("SELECT COUNT(*) as count FROM notes WHERE password_hash IS NOT NULL AND password_hash != ''");
            const immutableCount = await pool.query('SELECT COUNT(*) as count FROM notes WHERE immutable = true');
            const foldersCount = await pool.query('SELECT COUNT(*) as count FROM folders');
            const filesCount = await pool.query('SELECT COUNT(*) as count FROM folder_files');
            let galleryCount = { rows: [{ count: 0 }] };
            try { galleryCount = await pool.query('SELECT COUNT(*) as count FROM gallery'); } catch(e) {}

            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    totalNotes: parseInt(notesCount.rows[0].count),
                    protectedNotes: parseInt(protectedCount.rows[0].count),
                    immutableNotes: parseInt(immutableCount.rows[0].count),
                    totalFolders: parseInt(foldersCount.rows[0].count),
                    totalFiles: parseInt(filesCount.rows[0].count),
                    totalGallery: parseInt(galleryCount.rows[0].count)
                })
            };
        }

        // ===== NOTES MANAGEMENT =====

        // GET /notes - get ALL notes with full content (no password block)
        if (method === 'GET' && segments[0] === 'notes' && segments.length === 1) {
            const result = await pool.query('SELECT * FROM notes ORDER BY timestamp DESC');
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // DELETE /notes/:id - force delete any note
        if (method === 'DELETE' && segments[0] === 'notes' && segments.length === 2) {
            const id = segments[1];
            await pool.query('DELETE FROM notes WHERE id = $1', [id]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PUT /notes/:id - force edit any note (bypass password & immutable)
        if (method === 'PUT' && segments[0] === 'notes' && segments.length === 2) {
            const id = segments[1];
            const body = JSON.parse(event.body);

            // Build dynamic update
            const fields = [];
            const values = [];
            let idx = 1;

            if (body.content !== undefined) { fields.push(`content = $${idx++}`); values.push(body.content); }
            if (body.passwordHash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(body.passwordHash); }
            if (body.immutable !== undefined) { fields.push(`immutable = $${idx++}`); values.push(body.immutable); }
            if (body.timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(body.timestamp); }

            if (fields.length > 0) {
                values.push(id);
                await pool.query(`UPDATE notes SET ${fields.join(', ')} WHERE id = $${idx}`, values);
            }

            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // ===== FOLDERS MANAGEMENT =====

        // GET /folders - get all folders with file counts
        if (method === 'GET' && segments[0] === 'folders' && segments.length === 1) {
            const result = await pool.query(`
                SELECT f.*, COUNT(ff.id) as file_count 
                FROM folders f 
                LEFT JOIN folder_files ff ON f.id = ff.folder_id 
                GROUP BY f.id 
                ORDER BY f.timestamp DESC
            `);
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // DELETE /folders/:id - force delete folder
        if (method === 'DELETE' && segments[0] === 'folders' && segments.length === 2) {
            const id = segments[1];
            await pool.query('DELETE FROM folders WHERE id = $1', [id]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // GET /folders/:id/files - get all files in folder
        if (method === 'GET' && segments[0] === 'folders' && segments.length === 3 && segments[2] === 'files') {
            const folderId = segments[1];
            const result = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [folderId]);
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // DELETE /folders/:folderId/files/:fileId - force delete file
        if (method === 'DELETE' && segments[0] === 'folders' && segments.length === 4 && segments[2] === 'files') {
            const fileId = segments[3];
            await pool.query('DELETE FROM folder_files WHERE id = $1', [fileId]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // ===== GALLERY MANAGEMENT =====

        // GET /gallery - get all gallery images
        if (method === 'GET' && segments[0] === 'gallery' && segments.length === 1) {
            const result = await pool.query('SELECT * FROM gallery ORDER BY timestamp DESC');
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // PUT /gallery/:id - force update gallery image (bypass immutable)
        if (method === 'PUT' && segments[0] === 'gallery' && segments.length === 2) {
            const id = segments[1];
            const body = JSON.parse(event.body);
            const fields = [];
            const values = [];
            let idx = 1;
            if (body.title !== undefined) { fields.push(`title = $${idx++}`); values.push(body.title); }
            if (body.password_hash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(body.password_hash); }
            if (body.immutable !== undefined) { fields.push(`immutable = $${idx++}`); values.push(body.immutable); }
            if (body.timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(body.timestamp); }
            if (fields.length > 0) {
                values.push(id);
                await pool.query(`UPDATE gallery SET ${fields.join(', ')} WHERE id = $${idx}`, values);
            }
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // DELETE /gallery/:id - force delete gallery image
        if (method === 'DELETE' && segments[0] === 'gallery' && segments.length === 2) {
            const id = segments[1];
            await pool.query('DELETE FROM gallery WHERE id = $1', [id]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

    } catch (err) {
        console.error('Admin Error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
