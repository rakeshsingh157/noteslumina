const https = require('https');

// Rate limiting
const rateLimitMap = new Map();

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Rate limiting: 10 requests per minute per IP
    const ip = event.headers['client-ip'] || event.headers['x-nf-client-connection-ip'] || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
    let timestamps = rateLimitMap.get(ip).filter(t => now - t < 60000);
    if (timestamps.length >= 10) {
        return {
            statusCode: 429, headers,
            body: JSON.stringify({ error: 'Rate limit exceeded. Max 10 requests per minute.' })
        };
    }
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    try {
        const { messages, noteContext } = JSON.parse(event.body);

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return {
                statusCode: 400, headers,
                body: JSON.stringify({ error: 'Messages array is required' })
            };
        }

        const apiKey = process.env.MISTRAL_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500, headers,
                body: JSON.stringify({ error: 'AI service not configured' })
            };
        }

        // Build messages array for Mistral
        const apiMessages = [];

        // System prompt
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

        // Add conversation messages (limit to last 20 for token management)
        const recentMessages = messages.slice(-20);
        recentMessages.forEach(msg => {
            apiMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        });

        // Call Mistral API
        const mistralResponse = await callMistralAPI(apiKey, apiMessages);

        return {
            statusCode: 200, headers,
            body: JSON.stringify({ reply: mistralResponse })
        };

    } catch (err) {
        console.error('AI Chat Error:', err);
        return {
            statusCode: 500, headers,
            body: JSON.stringify({ error: 'Failed to get AI response. Please try again.' })
        };
    }
};

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
