const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

// Use Hugging Face Inference API
const HF_API_KEY = process.env.HF_API_KEY;

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
      
      // Use Hugging Face Inference API with fallback model
      if (!HF_API_KEY) {
        return json(res, 500, { error: 'Hugging Face API key not configured' });
      }
      
      const systemPrompt = 'You are Aria, a warm, friendly female voice guide on the ThinkSphere Super Intelligence website. You are speaking aloud to a visitor. Reply with exactly one or two short sentences, maximum 30 words total. Speak directly to the visitor. Do not describe the section or your answer. Never use markdown, bullet points, emojis, quotes, or reasoning. You may begin with a short welcome.';
      
      const userPrompt = 'Section: ThinkSphere Super Intelligence. The website is about intelligent AI-powered products and solutions that simplify lives, empower people, and create a smarter future. Now speak as Aria to the visitor about this section.';
      
      const payload = {
        inputs: systemPrompt + ' ' + userPrompt,
        parameters: {
          max_new_tokens: 50,
          temperature: 0.3
        }
      };
      
      // Use a reliable, widely-accessible model
      const HF_MODEL = 'facebook/opt-350m';
      
      const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        timeout: 15000
      });
      
      if (!response.ok) {
        const errText = await response.text();
        // If the primary model fails, try a fallback
        if (response.status === 404 || response.status === 503) {
          return json(res, 502, { error: 'AI model temporarily unavailable - please try again' });
        }
        throw new Error('Hugging Face API error: ' + response.status + ' ' + errText);
      }
      
      const data = await response.json();
      let aiResponse = '';
      
      // Handle response format
      if (Array.isArray(data) && data[0] && data[0].generated_text) {
        aiResponse = data[0].generated_text;
      } else if (data && data.generated_text) {
        aiResponse = String(data.generated_text);
      } else if (typeof data === 'string') {
        aiResponse = data;
      } else {
        throw new Error('Unexpected Hugging Face response format');
      }
      
      let cleaned = cleanSpeech(aiResponse);
      if (!cleaned) throw new Error('Empty response from AI');
      if (cleaned.length > 200) cleaned = cleaned.slice(0, 197) + '…';
      
      return json(res, 200, { text: cleaned });
    } catch (err) {
      console.error('/api/explain error:', err.message);
      // Return a friendly fallback message instead of error
      return json(res, 502, { error: 'AI is thinking... please try again in a few moments' });
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