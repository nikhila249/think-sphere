const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

const VENV_PIPER = process.platform === 'win32'
  ? path.join(ROOT, '.venv', 'Scripts', 'piper.exe')
  : path.join(ROOT, '.venv', 'bin', 'piper');
const PIPER_BIN = process.env.PIPER_BIN || (fs.existsSync(VENV_PIPER) ? VENV_PIPER : 'piper');
const VOICE_MODEL = process.env.PIPER_MODEL || path.join(ROOT, 'voice', 'en_US-amy-medium.onnx');
const CACHE_DIR = path.join(ROOT, '.voice-cache');

const SPLASH_SCRIPT = 'ThinkSphere Super Intelligence.';

const CARD_SCRIPTS = [
  'ThinkSphere Super Intelligence focuses first on education, opening new possibilities for learning with intelligent tools and human-first thinking.',
  'In technology and SaaS, ThinkSphere Super Intelligence builds intelligent products, software, and services for a changing world.',
  'ThinkSphere Super Intelligence finds the signal in complexity through research, data, and meaningful insight.',
  'ThinkSphere Super Intelligence supports stronger teams through skill development and thoughtful communication.'
];

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

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

async function ollamaExplain({ id, title, context }) {
  const allowGreeting = id === 'hero';
  const system = 'You are Aria, a warm, friendly female voice guide on the ThinkSphere Super Intelligence website. '
    + 'You are speaking aloud to a visitor. Reply with exactly one or two short sentences, maximum 30 words total. '
    + 'Speak directly to the visitor. Do not describe the section or your answer. '
    + 'Never use markdown, bullet points, emojis, quotes, or reasoning.'
    + (allowGreeting ? ' You may begin with a short welcome.' : ' Do not greet or say welcome; begin directly.');
  const user = 'Section title: "' + (title || id || 'ThinkSphere Super Intelligence') + '". '
    + 'Material: ' + (context || '') + ' '
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

  const res = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) throw new Error('Ollama responded ' + res.status);
  const data = await res.json();
  const raw = (data.message && data.message.content) || data.response || '';
  let text = cleanSpeech(raw);
  if (!text) throw new Error('Empty response from Ollama');
  if (id !== 'hero') {
    const stripped = text.replace(/^(welcome[^.!?]*[.!?]\s*)/i, '').trim();
    if (stripped.length > 20) text = stripped;
  }
  text = text.replace(/\bThinkSphere\b(?! Super Intelligence)/g, 'ThinkSphere Super Intelligence');
  text = text.replace(/^The ThinkSphere Super Intelligence\b/, 'ThinkSphere Super Intelligence');
  return text;
}

function synthesize(text, outFile) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(PIPER_BIN, ['-m', VOICE_MODEL, '-f', outFile], { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let err = '';
    proc.on('error', reject);
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outFile)) resolve();
      else reject(new Error('Piper failed (' + code + '): ' + err.slice(0, 300)));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

async function serveStatic(req, res, pathname) {
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
    let ollama = false;
    try {
      const r = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(2500) });
      ollama = r.ok;
    } catch (_) {}
    const tts = fs.existsSync(VOICE_MODEL) && (PIPER_BIN === 'piper' || fs.existsSync(PIPER_BIN));
    return json(res, 200, { server: true, ollama, tts, model: OLLAMA_MODEL, voice: path.basename(VOICE_MODEL) });
  }

  if (pathname === '/api/explain' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const text = await ollamaExplain(body);
      return json(res, 200, { text });
    } catch (err) {
      return json(res, 502, { error: String(err.message || err) });
    }
  }

  if (pathname === '/api/tts' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const text = cleanSpeech(body.text);
      if (!text) return json(res, 400, { error: 'No text to speak' });
      if (!fs.existsSync(VOICE_MODEL)) return json(res, 503, { error: 'Voice model missing' });
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      const outFile = path.join(CACHE_DIR, hash + '.wav');
      if (!fs.existsSync(outFile)) await synthesize(text, outFile);
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

function speechFileFor(text) {
  const clean = cleanSpeech(text);
  const hash = crypto.createHash('sha1').update(clean).digest('hex');
  return { clean, file: path.join(CACHE_DIR, hash + '.wav') };
}

async function warmScript(text) {
  if (!fs.existsSync(VOICE_MODEL)) return;
  const { clean, file } = speechFileFor(text);
  if (!fs.existsSync(file)) await synthesize(clean, file);
}

async function warmCardVoices() {
  for (const script of CARD_SCRIPTS) {
    try { await warmScript(script); } catch (_) {}
  }
  console.log('Card voice clips ready');
}

function warmUpModel() {
  return fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { num_predict: 1, temperature: 0 }
    }),
    signal: AbortSignal.timeout(180000)
  })
    .then(() => console.log('Model warmed: ' + OLLAMA_MODEL))
    .catch(() => console.log('Model warm-up skipped (Ollama not reachable yet)'));
}

server.listen(PORT, () => {
  console.log('ThinkSphere Super Intelligence is running at http://localhost:' + PORT);
  console.log('Ollama model : ' + OLLAMA_MODEL + '  (' + OLLAMA_URL + ')');
  console.log('Voice        : ' + path.basename(VOICE_MODEL) + '  (' + PIPER_BIN + ')');
  warmScript(SPLASH_SCRIPT).then(() => console.log('Splash voice ready')).catch(() => {});
  warmUpModel().then(() => setTimeout(warmCardVoices, 1500));
});
