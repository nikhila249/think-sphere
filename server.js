const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

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
      
      // Call Ollama AI
      const system = 'You are Aria, a warm, friendly female voice guide on the ThinkSphere Super Intelligence website. '
        + 'You are speaking aloud to a visitor. Reply with exactly one or two short sentences, maximum 30 words total. '
        + 'Speak directly to the visitor. Do not describe the section or your answer. '
        + 'Never use markdown, bullet points, emojis, quotes, or reasoning.'
        + ' You may begin with a short welcome.';
      const user = 'Section title: "ThinkSphere Super Intelligence". '
        + 'Material: The website is about intelligent AI-powered products and solutions that simplify lives, empower people, and create a smarter future. '
        + 'Now speak as Aria to the visitor about this section.';

      const payload = {
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.55, num_predict: 110 }
      };

      const resFetch = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
      });
      
      if (!resFetch.ok) throw new Error('Ollama responded ' + resFetch.status);
      const data = await resFetch.json();
      const raw = (data.message && data.message.content) || data.response || '';
      let text = cleanSpeech(raw);
      if (!text) throw new Error('Empty response from Ollama');
      if (text.length > 200) text = text.slice(0, 197) + '…';
      
      return json(res, 200, { text });
    } catch (err) {
      console.error('/api/explain error:', err.message);
      return json(res, 502, { error: String(err.message || err) });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log('ThinkSphere Super Intelligence is running at http://localhost:' + PORT);
  console.log('Ollama model : ' + OLLAMA_MODEL + '  (' + OLLAMA_URL + ')');
});