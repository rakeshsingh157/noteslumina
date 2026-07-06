const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
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
        console.log('Gallery DB initialized');
    } catch (err) {
        console.error('Error initializing Gallery DB:', err);
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

    const path = event.path.replace('/.netlify/functions/gallery', '');
    const method = event.httpMethod;
    const segments = path.split('/').filter(Boolean);

    try {
        // GET / - list all images
        if (method === 'GET' && segments.length === 0) {
            const result = await pool.query('SELECT * FROM gallery ORDER BY timestamp DESC');
            return { statusCode: 200, headers, body: JSON.stringify(result.rows) };
        }

        // GET /:id - get single image
        if (method === 'GET' && segments.length === 1) {
            const result = await pool.query('SELECT * FROM gallery WHERE id = $1', [segments[0]]);
            if (result.rows.length === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Image not found' }) };
            }
            return { statusCode: 200, headers, body: JSON.stringify(result.rows[0]) };
        }

        // POST / - save image metadata
        if (method === 'POST' && segments.length === 0) {
            const { id, title, url, display_url, thumb_url, delete_url, width, height, size, timestamp, password_hash, immutable } = JSON.parse(event.body);
            await pool.query(
                `INSERT INTO gallery (id, title, url, display_url, thumb_url, delete_url, width, height, size, timestamp, password_hash, immutable) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
                 ON CONFLICT (id) DO UPDATE SET title = $2, url = $3, display_url = $4, thumb_url = $5, 
                 delete_url = $6, width = $7, height = $8, size = $9, timestamp = $10,
                 password_hash = COALESCE($11, gallery.password_hash), immutable = COALESCE($12, gallery.immutable)`,
                [id, title, url, display_url, thumb_url, delete_url, width || 0, height || 0, size || 0, timestamp, password_hash || null, immutable || false]
            );
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // PUT /:id - update image metadata (password, immutable, title)
        if (method === 'PUT' && segments.length === 1) {
            const body = JSON.parse(event.body);
            const fields = [];
            const values = [];
            let idx = 1;
            if (body.title !== undefined) { fields.push(`title = $${idx++}`); values.push(body.title); }
            if (body.password_hash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(body.password_hash); }
            if (body.immutable !== undefined) { fields.push(`immutable = $${idx++}`); values.push(body.immutable); }
            if (body.timestamp !== undefined) { fields.push(`timestamp = $${idx++}`); values.push(body.timestamp); }
            if (fields.length > 0) {
                values.push(segments[0]);
                await pool.query(`UPDATE gallery SET ${fields.join(', ')} WHERE id = $${idx}`, values);
            }
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        // DELETE /:id - delete image record
        if (method === 'DELETE' && segments.length === 1) {
            await pool.query('DELETE FROM gallery WHERE id = $1', [segments[0]]);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

    } catch (err) {
        console.error('Gallery Error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
