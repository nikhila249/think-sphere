const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2'
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanSpeech(text) {
  let out = String(text || '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[\u201C\u201D\u2018\u2019]/g, '')
    .replace(/[*_`#>|~]/g, '')
    .replace(/^\s*(aria|assistant)\s*[:\-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = out.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 2) out = sentences.slice(0, 2).join(' ').trim();
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > 40) out = words.slice(0, 40).join(' ').replace(/[,;:.\s]+$/, '') + '.';
  if (out.length > 320) out = out.slice(0, 317).trim() + '…';
  return out;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const blocked = ['.venv', 'voice', '.voice-cache', 'server.js', 'node_modules'];
  const first = path.relative(ROOT, filePath).split(path.sep)[0];
  if (blocked.includes(first) || first.startsWith('.')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/favicon.ico' && req.method === 'GET') {
    res.writeHead(302, { Location: '/assets/thinksphere-icon.svg' });
    res.end();
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { server: true });
  }

  if (pathname === '/api/explain' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      return json(res, 200, { text: 'Hello! This service is running on Render.' });
    } catch (err) {
      return json(res, 502, { error: String(err.message || err) });
    }
  }

  if (pathname === '/api/tts' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const text = cleanSpeech(body.text);
      if (!text) return json(res, 400, { error: 'No text to speak' });
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      const outFile = path.join(ROOT, 'cache', hash + '.wav');
      if (!fs.existsSync(path.dirname(outFile))) fs.mkdirSync(path.dirname(outFile), { recursive: true });
      if (!fs.existsSync(outFile)) {
        return json(res, 501, { error: 'TTS not available - simplify server for Render' });
      }
      const stat = fs.statSync(outFile);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(outFile).pipe(res);
      return;
    } catch (err) {
      return json(res, 500, { error: String(err.message || err) });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log('ThinkSphere Super Intelligence is running at http://localhost:' + PORT);
});