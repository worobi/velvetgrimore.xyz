#!/usr/bin/env node
// Velvet Grimoire local backend: static hosting + table-code state sync.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'server-data');
const TABLES_FILE = path.join(DATA_DIR, 'tables.json');
const PORT = Number(process.env.PORT || 8765);
const PLAYER_ROLES = new Set(['warden', 'protagonist', 'boss', 'spectator']);

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
    const data = JSON.parse(fs.readFileSync(TABLES_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return { tables: {} };
    if (!data.tables || typeof data.tables !== 'object') data.tables = {};
    return data;
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

function cleanRole(role, fallback = 'protagonist') {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'dm') return 'warden';
  if (value === 'player') return 'protagonist';
  if (PLAYER_ROLES.has(value)) return value;
  return PLAYER_ROLES.has(fallback) ? fallback : 'protagonist';
}

function cleanPlayer(input = {}, fallbackRole = 'protagonist') {
  const now = new Date().toISOString();
  const id = String(input.clientId || input.id || '').trim().slice(0, 80);
  if (!id) return null;
  return {
    id,
    name: String(input.name || input.displayName || 'Seated Player').trim().slice(0, 80) || 'Seated Player',
    role: cleanRole(input.role, fallbackRole),
    ready: !!input.ready,
    joinedAt: input.joinedAt || now,
    lastSeenAt: now,
  };
}

function normalizeTable(table) {
  const now = new Date().toISOString();
  if (!table.players || typeof table.players !== 'object' || Array.isArray(table.players)) table.players = {};
  table.createdAt = table.createdAt || now;
  table.updatedAt = table.updatedAt || table.createdAt;
  table.status = table.status || 'lobby';
  table.snapshot = table.snapshot || {};
  table.rev = Number(table.rev || 1);
  Object.keys(table.players).forEach(id => {
    const normalized = cleanPlayer({ id, ...table.players[id] }, table.players[id]?.role || 'protagonist');
    if (normalized) table.players[id] = normalized;
    else delete table.players[id];
  });
  return table;
}

function upsertPlayer(table, playerInput, fallbackRole = 'protagonist') {
  normalizeTable(table);
  const cleaned = cleanPlayer(playerInput, fallbackRole);
  if (!cleaned) return null;
  const previous = table.players[cleaned.id] || {};
  const player = {
    ...previous,
    ...cleaned,
    joinedAt: previous.joinedAt || cleaned.joinedAt,
    ready: playerInput.ready === undefined ? !!previous.ready : !!cleaned.ready,
    lastSeenAt: cleaned.lastSeenAt,
  };
  table.players[player.id] = player;
  table.updatedAt = new Date().toISOString();
  return player;
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
  normalizeTable(table);
  return {
    code: table.code,
    name: table.name,
    status: table.status || 'lobby',
    rev: table.rev,
    snapshot: table.snapshot || {},
    players: Object.values(table.players || {}).sort((a, b) => {
      const rank = { warden: 0, protagonist: 1, boss: 2, spectator: 3 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
    }),
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
      players: {},
      status: 'lobby',
      createdAt: now,
      updatedAt: now,
      updatedBy: body.clientId || null,
    };
    upsertPlayer(table, {
      clientId: body.clientId,
      name: body.playerName || body.name || 'Warden',
      role: body.role || 'warden',
      ready: true,
    }, 'warden');
    data.tables[next] = table;
    writeTables(data);
    return send(res, 201, tablePayload(table));
  }

  const playerMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/players(?:\/([^/]+))?$/i);
  if (playerMatch) {
    const tableCode = playerMatch[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (req.method === 'GET') return send(res, 200, { code: table.code, players: tablePayload(table).players });

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await readBody(req);
      const id = playerMatch[2] ? decodeURIComponent(playerMatch[2]) : body.clientId;
      const player = upsertPlayer(table, { ...body, clientId: id || body.clientId }, body.role || 'protagonist');
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      table.rev += 1;
      table.updatedBy = player.id;
      data.tables[tableCode] = table;
      writeTables(data);
      return send(res, 200, tablePayload(table));
    }
  }

  const match = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})$/i);
  if (match) {
    const tableCode = match[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (req.method === 'GET') return send(res, 200, tablePayload(table));

    if (req.method === 'PUT') {
      const body = await readBody(req);
      upsertPlayer(table, body.player || { clientId: body.clientId, role: body.role }, body.role || 'protagonist');
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
