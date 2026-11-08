// Ona Birthday - standalone Node.js message server
// Uses only Node.js built-in modules. No database or third-party service required.
// Run: node server.js
// Keep index.html in the same folder. Messages are saved in messages.json automatically.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PAGE = path.join(ROOT, 'index.html');
const STORE = path.join(ROOT, 'messages.json');
const MAX_LENGTH = 1500;
const MAX_BODY = 12 * 1024;
const MAX_MESSAGES = 5000;

// Lightweight per-IP rate limit to discourage accidental spam.
const rate = new Map();
function allowed(ip) {
  const now = Date.now();
  const item = rate.get(ip) || { start: now, count: 0 };
  if (now - item.start > 60_000) { item.start = now; item.count = 0; }
  item.count++;
  rate.set(ip, item);
  return item.count <= 12;
}

function readMessages() {
  try {
    const value = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function saveMessages(messages) {
  const temp = STORE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(messages, null, 2), 'utf8');
  fs.renameSync(temp, STORE);
}
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': 'same-origin'
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/messages') {
    if (!allowed(req.socket.remoteAddress || 'unknown')) {
      return sendJson(res, 429, { error: 'استني دقيقة وجربي تاني ❤️' });
    }
    if (req.method === 'GET') {
      const messages = readMessages()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 300);
      return sendJson(res, 200, { messages });
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) return sendJson(res, 400, { error: 'اكتبي رسالة الأول ❤️' });
        if (content.length > MAX_LENGTH) {
          return sendJson(res, 413, { error: `الرسالة أطول من ${MAX_LENGTH} حرف.` });
        }
        const messages = readMessages();
        const message = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          content,
          created_at: new Date().toISOString()
        };
        messages.push(message);
        saveMessages(messages.slice(-MAX_MESSAGES));
        return sendJson(res, 201, { message });
      } catch (error) {
        const status = error.message === 'INVALID_JSON' ? 400 :
          error.message === 'BODY_TOO_LARGE' ? 413 : 500;
        return sendJson(res, status, {
          error: status === 400 ? 'صيغة الرسالة غير صحيحة.' :
            status === 413 ? 'حجم الرسالة كبير.' : 'حصلت مشكلة في حفظ الرسالة.'
        });
      }
    }
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'الطريقة دي غير مدعومة.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'الطريقة دي غير مدعومة.' });
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  try {
    const page = fs.readFileSync(PAGE);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': page.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(page);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('index.html is missing. Put it beside server.js.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ona server is running at http://localhost:${PORT}`);
  console.log(`Messages are stored locally in: ${STORE}`);
});
