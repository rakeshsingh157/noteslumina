const { Pool } = require('pg');

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
        console.log('Database initialized');
    } catch (err) {
        console.error('Error initializing DB:', err);
    }
}

// Initialize on cold start
initDB();

exports.handler = async (event, context) => {
    // Handle CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    const path = event.path.replace('/.netlify/functions/notes', '');
    const method = event.httpMethod;

    try {
        // GET /api/notes - Get all notes
        if (method === 'GET' && path === '') {
            const result = await pool.query('SELECT * FROM notes');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(result.rows)
            };
        }

        // GET /api/notes/:id - Get single note
        if (method === 'GET' && path.startsWith('/')) {
            const id = path.substring(1);
            const result = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);
            
            if (result.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Note not found' })
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(result.rows[0])
            };
        }

        // POST /api/notes - Create or Update note
        if (method === 'POST' && path === '') {
            const { id, title, content, passwordHash, timestamp, immutable } = JSON.parse(event.body);

            // Check if exists
            const check = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);

            if (check.rows.length > 0) {
                // Update
                const current = check.rows[0];
                if (current.immutable) {
                    return {
                        statusCode: 403,
                        headers,
                        body: JSON.stringify({ error: 'Note is immutable' })
                    };
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

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true })
            };
        }

        // DELETE /api/notes/:id - Delete note
        if (method === 'DELETE' && path.startsWith('/')) {
            const id = path.substring(1);
            await pool.query('DELETE FROM notes WHERE id = $1', [id]);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true })
            };
        }

        // Route not found
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Not found' })
        };

    } catch (err) {
        console.error('Error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: err.message })
        };
    }
};
