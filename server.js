const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
      
      // Use OpenAI API
      if (!OPENAI_API_KEY) {
        return json(res, 500, { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to Render environment.' });
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are Aria, a warm, friendly female voice guide on the ThinkSphere Super Intelligence website. You are speaking aloud to a visitor. Reply with exactly one or two short sentences, maximum 30 words total. Speak directly to the visitor. Do not describe the section or your answer. Never use markdown, bullet points, emojis, quotes, or reasoning.' },
            { role: 'user', content: 'Section: ThinkSphere Super Intelligence. The website is about intelligent AI-powered products and solutions that simplify lives, empower people, and create a smarter future. Now speak as Aria to the visitor about this section.' }
          ],
          temperature: 0.55,
          max_tokens: 50
        }),
        timeout: 30000
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error('OpenAI API error: ' + response.status + ' ' + errText);
      }
      
      const data = await response.json();
      const text = data.choices[0].message.content;
      let cleaned = cleanSpeech(text);
      if (!cleaned) throw new Error('Empty response from OpenAI');
      if (cleaned.length > 200) cleaned = cleaned.slice(0, 197) + '…';
      
      return json(res, 200, { text: cleaned });
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
});