#!/usr/bin/env node
// Velvet Grimoire local backend: static hosting + table-code state sync.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'server-data');
const TABLES_FILE = path.join(DATA_DIR, 'tables.json');
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TABLES_FILE)) fs.writeFileSync(TABLES_FILE, JSON.stringify({ tables: {} }, null, 2));
}

function readTables() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(TABLES_FILE, 'utf8'));
  } catch (err) {
    return { tables: {} };
  }
}

function writeTables(data) {
  ensureDataFile();
  fs.writeFileSync(TABLES_FILE, JSON.stringify(data, null, 2));
}

function code() {
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new Error('Invalid JSON')); }
    });
  });
}

function tablePayload(table) {
  return {
    code: table.code,
    name: table.name,
    rev: table.rev,
    snapshot: table.snapshot || {},
    updatedAt: table.updatedAt,
    updatedBy: table.updatedBy || null,
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'velvet-grimoire-sync' });
  }

  if (req.method === 'POST' && pathname === '/api/tables') {
    const body = await readBody(req);
    const data = readTables();
    let next = code();
    while (data.tables[next]) next = code();
    const now = new Date().toISOString();
    const table = {
      code: next,
      name: String(body.name || 'Velvet Table').slice(0, 80),
      rev: 1,
      snapshot: body.snapshot || {},
      createdAt: now,
      updatedAt: now,
      updatedBy: body.clientId || null,
    };
    data.tables[next] = table;
    writeTables(data);
    return send(res, 201, tablePayload(table));
  }

  const match = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})$/i);
  if (match) {
    const tableCode = match[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode];
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (req.method === 'GET') return send(res, 200, tablePayload(table));

    if (req.method === 'PUT') {
      const body = await readBody(req);
      table.rev += 1;
      table.snapshot = body.snapshot || {};
      table.updatedAt = new Date().toISOString();
      table.updatedBy = body.clientId || null;
      data.tables[tableCode] = table;
      writeTables(data);
      return send(res, 200, tablePayload(table));
    }
  }

  return send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  if (pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    return send(res, err.message === 'Body too large' ? 413 : 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Velvet Grimoire backend listening on http://localhost:${PORT}/`);
});
