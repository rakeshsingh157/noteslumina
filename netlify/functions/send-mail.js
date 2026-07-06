const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Transporter for nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.APP_PASSWORD
    }
});

// In-memory rate limiting map
const mailRateLimitMap = new Map();

exports.handler = async (event, context) => {
    // Handle CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Rate limiting by IP
    const ip = event.headers['client-ip'] || event.headers['x-nf-client-connection-ip'] || 'unknown';
    const now = Date.now();
    if (!mailRateLimitMap.has(ip)) {
        mailRateLimitMap.set(ip, []);
    }
    let timestamps = mailRateLimitMap.get(ip);
    timestamps = timestamps.filter(t => now - t < 60000);
    if (timestamps.length >= 3) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'Rate limit exceeded. You can only request 3 emails per minute.' })
        };
    }
    timestamps.push(now);
    mailRateLimitMap.set(ip, timestamps);

    try {
        const { email, type, id, origin } = JSON.parse(event.body);

        if (!email || !type || !id) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Email, type, and id are required' })
            };
        }

        const host = event.headers.host || event.headers.Host || '';
        const proto = event.headers['x-forwarded-proto'] || 'https';
        const resolvedOrigin = origin || (host ? `${proto}://${host}` : 'https://noteslumina.netlify.app');

        let subject = '';
        let htmlContent = '';

        if (type === 'note') {
            const result = await pool.query('SELECT * FROM notes WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Note not found' })
                };
            }
            const note = result.rows[0];
            const title = note.title || 'Untitled Note';
            const noteUrl = `${resolvedOrigin}/?noteId=${id}`;
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
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'File not found' })
                };
            }
            const file = result.rows[0];
            const noteUrl = `${resolvedOrigin}/?noteId=${id}`;
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
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Folder not found' })
                };
            }
            const folder = folderResult.rows[0];
            const filesResult = await pool.query('SELECT * FROM folder_files WHERE folder_id = $1 ORDER BY timestamp DESC', [id]);
            const files = filesResult.rows;
            const folderUrl = `${resolvedOrigin}/folders?folderId=${id}`;

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
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Image not found' })
                };
            }
            const img = result.rows[0];
            const title = img.title || 'Untitled Image';
            const galleryUrl = `${resolvedOrigin}/gallery`;
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
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid item type' })
            };
        }

        const mailOptions = {
            from: `"Lumina Notes" <${process.env.EMAIL}>`,
            to: email,
            subject: subject,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Email sent successfully!' })
        };

    } catch (err) {
        console.error('Error sending email:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to send email. Please check configuration.' })
        };
    }
};
