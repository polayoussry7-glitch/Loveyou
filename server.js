
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const ROOT = __dirname;
const PAGE = path.join(ROOT, 'index.html');
const STORE = path.join(ROOT, 'messages.json');

const MAX_LENGTH = 1500;
const MAX_BODY = 12 * 1024;
const MAX_MESSAGES = 5000;
const MAX_PER_MINUTE = 12;

const rate = new Map();

function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function allowed(ip) {
  const now = Date.now();
  let item = rate.get(ip);

  if (!item || now - item.start >= 60000) {
    item = { start: now, count: 0 };
    rate.set(ip, item);
  }

  item.count++;
  return item.count <= MAX_PER_MINUTE;
}

function readMessages() {
  try {
    if (!fs.existsSync(STORE)) return [];

    const data = fs.readFileSync(STORE, 'utf8');
    const messages = JSON.parse(data);

    return Array.isArray(messages) ? messages : [];
  } catch (error) {
    console.error('Read error:', error.message);
    return [];
  }
}

function saveMessages(messages) {
  const temp = STORE + '.tmp';

  fs.writeFileSync(
    temp,
    JSON.stringify(messages, null, 2),
    'utf8'
  );

  fs.renameSync(temp, STORE);
}

function sendJson(res, status, data) {
  if (res.headersSent) return;

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let finished = false;

    req.on('data', chunk => {
      if (finished) return;

      size += chunk.length;

      if (size > MAX_BODY) {
        finished = true;
        reject(new Error('BODY_TOO_LARGE'));
        req.resume();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (finished) return;

      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', error => {
      if (!finished) reject(error);
    });
  });
}

const server = http.createServer(async (req, res) => {
  let url;

  try {
    url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );
  } catch {
    return sendJson(res, 400, { error: 'طلب غير صحيح.' });
  }

  // Health check
  if (url.pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      server: 'Ona Birthday'
    });
  }

  // Messages API
  if (url.pathname === '/api/messages') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, {
        error: 'الطريقة دي غير مدعومة.'
      });
    }

    const ip = getIP(req);

    if (!allowed(ip)) {
      return sendJson(res, 429, {
        error: 'استني دقيقة وجربي تاني ❤️'
      });
    }

    if (req.method === 'GET') {
      const messages = readMessages()
        .sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        )
        .slice(0, 300);

      return sendJson(res, 200, { messages });
    }

    try {
      const body = await readBody(req);

      const content =
        typeof body.content === 'string'
          ? body.content.trim()
          : '';

      if (!content) {
        return sendJson(res, 400, {
          error: 'اكتبي رسالة الأول ❤️'
        });
      }

      if (content.length > MAX_LENGTH) {
        return sendJson(res, 413, {
          error: `الرسالة أطول من ${MAX_LENGTH} حرف.`
        });
      }

      const messages = readMessages();

      const message = {
        id: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`,
        content,
        created_at: new Date().toISOString()
      };

      messages.push(message);

      saveMessages(messages.slice(-MAX_MESSAGES));

      return sendJson(res, 201, { message });

    } catch (error) {
      console.error('Message error:', error);

      const status =
        error.message === 'INVALID_JSON' ? 400 :
        error.message === 'BODY_TOO_LARGE' ? 413 : 500;

      return sendJson(res, status, {
        error:
          status === 400 ? 'صيغة الرسالة غير صحيحة.' :
          status === 413 ? 'حجم الرسالة كبير.' :
          'حصلت مشكلة في حفظ الرسالة.'
      });
    }
  }

  // Website
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, {
      error: 'الطريقة دي غير مدعومة.'
    });
  }

  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8'
    });

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

    if (req.method === 'HEAD') {
      return res.end();
    }

    return res.end(page);

  } catch (error) {
    console.error('Page error:', error);

    res.writeHead(500, {
      'Content-Type': 'text/plain; charset=utf-8'
    });

    return res.end('index.html is missing.');
  }
});

server.listen(PORT, HOST, () => {
  console.log('❤️ Ona Birthday Server');
  console.log(`Running on port: ${PORT}`);
  console.log(`Messages file: ${STORE}`);
});

server.on('error', error => {
  console.error('Server error:', error);
  process.exit(1);
});
