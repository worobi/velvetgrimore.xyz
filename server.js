#!/usr/bin/env node
// Velvet Grimoire local backend: static hosting + table-code state sync.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(ROOT, 'server-data'));
const TABLES_FILE = path.join(DATA_DIR, 'tables.json');
const PORT = Number(process.env.PORT || 8765);
const PLAYER_ROLES = new Set(['warden', 'protagonist', 'boss', 'spectator']);
const PRESENCE_ONLINE_MS = 20_000;
const MAX_MESSAGES = 200;
const MAX_EVENTS = 500;
const MAX_CHECKPOINTS = 30;
const MAX_PROMPTS = 80;
const MAX_HANDOUTS = 80;
const MAX_ROOMS = 40;
const MAX_ROOM_MESSAGES = 300;
const LIVE_KEEPALIVE_MS = 15_000;
const EVENT_TYPES = new Set([
  'table.created',
  'player.joined',
  'player.ready',
  'chat.message',
  'snapshot.updated',
  'checkpoint.created',
  'checkpoint.restored',
  'checkpoint.deleted',
  'focus.changed',
  'prompt.sent',
  'prompt.responded',
  'handout.sent',
  'room.created',
  'room.updated',
  'room.message',
  'dice.roll',
  'scene.change',
  'safety.signal',
  'map.reveal',
  'intimacy.message',
  'intimacy.card',
  'movement.request',
  'note.added',
  'action.applied',
  'action.rejected',
]);
const SENSITIVE_EVENT_TYPES = new Set(['map.reveal', 'movement.request', 'scene.change']);
const APPLY_EVENT_TYPES = new Set(['map.reveal', 'movement.request', 'scene.change']);
const EVENT_CATEGORIES = {
  'table.created': 'table',
  'player.joined': 'table',
  'player.ready': 'table',
  'chat.message': 'chat',
  'snapshot.updated': 'sync',
  'checkpoint.created': 'sync',
  'checkpoint.restored': 'sync',
  'checkpoint.deleted': 'sync',
  'focus.changed': 'table',
  'prompt.sent': 'table',
  'prompt.responded': 'table',
  'handout.sent': 'table',
  'room.created': 'table',
  'room.updated': 'table',
  'room.message': 'chat',
  'dice.roll': 'roll',
  'scene.change': 'scene',
  'safety.signal': 'safety',
  'map.reveal': 'map',
  'intimacy.message': 'intimate',
  'intimacy.card': 'intimate',
  'movement.request': 'map',
  'note.added': 'note',
  'action.applied': 'approval',
  'action.rejected': 'approval',
};
const EVENT_BOOKMARKS = new Set(['', 'important', 'turning-point', 'follow-up', 'cut']);

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

const liveStreams = new Map();

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

function cleanPlayer(input = {}, fallbackRole = 'protagonist', options = {}) {
  const now = new Date().toISOString();
  const touch = options.touch !== false;
  const id = String(input.clientId || input.id || '').trim().slice(0, 80);
  if (!id) return null;
  return {
    id,
    name: String(input.name || input.displayName || 'Seated Player').trim().slice(0, 80) || 'Seated Player',
    role: cleanRole(input.role, fallbackRole),
    ready: !!input.ready,
    joinedAt: input.joinedAt || now,
    lastSeenAt: touch ? now : (input.lastSeenAt || input.joinedAt || now),
  };
}

function eventCategory(type, fallback = '') {
  return EVENT_CATEGORIES[type] || fallback || 'note';
}

function cleanBookmark(value) {
  const next = String(value || '').trim().toLowerCase();
  return EVENT_BOOKMARKS.has(next) ? next : '';
}

function normalizeTable(table) {
  const now = new Date().toISOString();
  if (!table.players || typeof table.players !== 'object' || Array.isArray(table.players)) table.players = {};
  if (!Array.isArray(table.messages)) table.messages = [];
  if (!Array.isArray(table.events)) table.events = [];
  if (!Array.isArray(table.checkpoints)) table.checkpoints = [];
  if (!Array.isArray(table.prompts)) table.prompts = [];
  if (!Array.isArray(table.handouts)) table.handouts = [];
  if (!Array.isArray(table.rooms)) table.rooms = [];
  if (!Array.isArray(table.roomMessages)) table.roomMessages = [];
  table.createdAt = table.createdAt || now;
  table.updatedAt = table.updatedAt || table.createdAt;
  table.status = table.status || 'lobby';
  table.snapshot = table.snapshot || {};
  table.rev = Number(table.rev || 1);
  table.msgSeq = Number(table.msgSeq || 0);
  table.evtSeq = Number(table.evtSeq || 0);
  table.checkpointSeq = Number(table.checkpointSeq || 0);
  table.promptSeq = Number(table.promptSeq || 0);
  table.handoutSeq = Number(table.handoutSeq || 0);
  table.roomSeq = Number(table.roomSeq || 0);
  table.roomMsgSeq = Number(table.roomMsgSeq || 0);
  table.flow = table.flow && typeof table.flow === 'object' && !Array.isArray(table.flow) ? table.flow : {};
  table.flow.focusClientId = String(table.flow.focusClientId || '').slice(0, 80);
  table.flow.focusName = String(table.flow.focusName || '').slice(0, 80);
  table.flow.focusNote = String(table.flow.focusNote || '').slice(0, 500);
  table.flow.updatedAt = table.flow.updatedAt || null;
  table.flow.updatedBy = table.flow.updatedBy || null;
  Object.keys(table.players).forEach(id => {
    const normalized = cleanPlayer({ id, ...table.players[id] }, table.players[id]?.role || 'protagonist', { touch: false });
    if (normalized) table.players[id] = normalized;
    else delete table.players[id];
  });
  table.messages = table.messages.map((message, index) => ({
    id: Number(message.id || index + 1),
    clientId: String(message.clientId || '').slice(0, 80),
    name: String(message.name || 'Seated Player').slice(0, 80),
    role: cleanRole(message.role, 'protagonist'),
    text: String(message.text || '').slice(0, 1000),
    createdAt: message.createdAt || now,
  })).filter(message => message.text.trim()).slice(-MAX_MESSAGES);
  table.msgSeq = Math.max(table.msgSeq, ...table.messages.map(message => message.id), 0);
  table.events = table.events.map((event, index) => ({
    id: Number(event.id || index + 1),
    type: EVENT_TYPES.has(event.type) ? event.type : 'note.added',
    status: ['posted', 'pending', 'approved', 'rejected'].includes(event.status) ? event.status : 'posted',
    approvalRequired: !!event.approvalRequired,
    clientId: String(event.clientId || '').slice(0, 80),
    name: String(event.name || 'Seated Player').slice(0, 80),
    role: cleanRole(event.role, 'protagonist'),
    text: String(event.text || '').slice(0, 1000),
    detail: event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail : {},
    category: eventCategory(event.type, event.category),
    bookmark: cleanBookmark(event.bookmark),
    recapHidden: !!event.recapHidden,
    createdAt: event.createdAt || now,
    approvedAt: event.approvedAt || null,
    approvedBy: event.approvedBy || null,
    appliedAt: event.appliedAt || null,
    applyResult: event.applyResult && typeof event.applyResult === 'object' && !Array.isArray(event.applyResult) ? event.applyResult : null,
  })).slice(-MAX_EVENTS);
  table.evtSeq = Math.max(table.evtSeq, ...table.events.map(event => event.id), 0);
  table.checkpoints = table.checkpoints.map((checkpoint, index) => ({
    id: Number(checkpoint.id || index + 1),
    name: String(checkpoint.name || `Checkpoint ${index + 1}`).slice(0, 120),
    note: String(checkpoint.note || '').slice(0, 1000),
    reason: String(checkpoint.reason || 'manual').slice(0, 80),
    snapshot: checkpoint.snapshot && typeof checkpoint.snapshot === 'object' && !Array.isArray(checkpoint.snapshot) ? checkpoint.snapshot : {},
    rev: Number(checkpoint.rev || table.rev || 1),
    eventId: Number(checkpoint.eventId || table.evtSeq || 0),
    createdAt: checkpoint.createdAt || now,
    createdBy: checkpoint.createdBy || null,
    createdByName: checkpoint.createdByName || null,
  })).slice(-MAX_CHECKPOINTS);
  table.checkpointSeq = Math.max(table.checkpointSeq, ...table.checkpoints.map(checkpoint => checkpoint.id), 0);
  table.prompts = table.prompts.map((prompt, index) => ({
    id: Number(prompt.id || index + 1),
    target: String(prompt.target || 'all').slice(0, 80) || 'all',
    targetName: String(prompt.targetName || '').slice(0, 80),
    question: String(prompt.question || '').slice(0, 1000),
    kind: String(prompt.kind || 'freeform').slice(0, 40),
    status: ['open', 'answered', 'closed'].includes(prompt.status) ? prompt.status : 'open',
    response: String(prompt.response || '').slice(0, 1000),
    respondedBy: prompt.respondedBy || null,
    respondedByName: prompt.respondedByName || null,
    respondedAt: prompt.respondedAt || null,
    createdAt: prompt.createdAt || now,
    createdBy: prompt.createdBy || null,
    createdByName: prompt.createdByName || null,
  })).filter(prompt => prompt.question.trim()).slice(-MAX_PROMPTS);
  table.promptSeq = Math.max(table.promptSeq, ...table.prompts.map(prompt => prompt.id), 0);
  table.handouts = table.handouts.map((handout, index) => ({
    id: Number(handout.id || index + 1),
    target: String(handout.target || 'all').slice(0, 80) || 'all',
    targetName: String(handout.targetName || '').slice(0, 80),
    title: String(handout.title || `Handout ${index + 1}`).slice(0, 120),
    text: String(handout.text || '').slice(0, 2000),
    kind: String(handout.kind || 'note').slice(0, 40),
    createdAt: handout.createdAt || now,
    createdBy: handout.createdBy || null,
    createdByName: handout.createdByName || null,
  })).filter(handout => handout.title.trim() || handout.text.trim()).slice(-MAX_HANDOUTS);
  table.handoutSeq = Math.max(table.handoutSeq, ...table.handouts.map(handout => handout.id), 0);
  if (!table.rooms.length) table.rooms = defaultRooms(now);
  table.rooms = table.rooms.map((room, index) => ({
    id: cleanRoomId(room.id || `room-${index + 1}`),
    name: String(room.name || `Room ${index + 1}`).slice(0, 80),
    kind: ['main', 'private', 'split', 'safety', 'warden'].includes(room.kind) ? room.kind : 'split',
    members: cleanRoomMembers(room.members),
    active: room.active !== false,
    createdAt: room.createdAt || now,
    createdBy: room.createdBy || null,
    createdByName: room.createdByName || null,
  })).filter(room => room.id && room.name.trim()).slice(-MAX_ROOMS);
  table.roomMessages = table.roomMessages.map((message, index) => ({
    id: Number(message.id || index + 1),
    roomId: cleanRoomId(message.roomId || 'main'),
    clientId: String(message.clientId || '').slice(0, 80),
    name: String(message.name || 'Seated Player').slice(0, 80),
    role: cleanRole(message.role, 'protagonist'),
    text: String(message.text || '').slice(0, 1000),
    createdAt: message.createdAt || now,
  })).filter(message => message.text.trim()).slice(-MAX_ROOM_MESSAGES);
  table.roomMsgSeq = Math.max(table.roomMsgSeq, ...table.roomMessages.map(message => message.id), 0);
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

function playerPresence(player) {
  const lastSeen = Date.parse(player.lastSeenAt || player.joinedAt || 0);
  const idleMs = Number.isFinite(lastSeen) ? Math.max(0, Date.now() - lastSeen) : Number.MAX_SAFE_INTEGER;
  return {
    online: idleMs <= PRESENCE_ONLINE_MS,
    idleSeconds: Math.floor(idleMs / 1000),
  };
}

function canWriteSnapshot(table, clientId) {
  const player = table.players?.[clientId];
  return !!player && player.role === 'warden';
}

function currentWarden(table) {
  return Object.values(table.players || {}).find(player => player.role === 'warden') || null;
}

function canUseRole(table, clientId, role) {
  const nextRole = cleanRole(role);
  if (nextRole !== 'warden') return true;
  const warden = currentWarden(table);
  return !warden || warden.id === clientId;
}

function cleanMessage(input = {}, player = null) {
  const text = String(input.text || input.message || '').trim().slice(0, 1000);
  if (!text) return null;
  return {
    clientId: String(input.clientId || player?.id || '').trim().slice(0, 80),
    name: String(input.name || player?.name || 'Seated Player').trim().slice(0, 80) || 'Seated Player',
    role: cleanRole(input.role || player?.role, player?.role || 'protagonist'),
    text,
  };
}

function addMessage(table, input, player) {
  normalizeTable(table);
  const cleaned = cleanMessage(input, player);
  if (!cleaned || !cleaned.clientId) return null;
  const now = new Date().toISOString();
  table.msgSeq = Number(table.msgSeq || 0) + 1;
  const message = {
    id: table.msgSeq,
    ...cleaned,
    createdAt: now,
  };
  table.messages.push(message);
  table.messages = table.messages.slice(-MAX_MESSAGES);
  table.updatedAt = now;
  return message;
}

function messagesPayload(table, since = 0) {
  normalizeTable(table);
  const after = Number(since || 0);
  const messages = table.messages.filter(message => message.id > after);
  return {
    code: table.code,
    lastMessageId: table.msgSeq || 0,
    messages,
  };
}

function cleanEvent(input = {}, player = null) {
  const type = EVENT_TYPES.has(input.type) ? input.type : 'note.added';
  const text = String(input.text || '').trim().slice(0, 1000);
  const detail = input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail) ? input.detail : {};
  return {
    type,
    clientId: String(input.clientId || player?.id || '').trim().slice(0, 80),
    name: String(input.name || player?.name || 'Seated Player').trim().slice(0, 80) || 'Seated Player',
    role: cleanRole(input.role || player?.role, player?.role || 'protagonist'),
    text,
    detail,
    category: eventCategory(type, input.category),
    bookmark: cleanBookmark(input.bookmark),
    recapHidden: !!input.recapHidden,
  };
}

function eventNeedsApproval(event) {
  return event.role !== 'warden' && (event.approvalRequired || SENSITIVE_EVENT_TYPES.has(event.type));
}

function addEvent(table, input, player = null) {
  normalizeTable(table);
  const cleaned = cleanEvent(input, player);
  if (!cleaned.clientId) return null;
  const now = new Date().toISOString();
  const pending = eventNeedsApproval({ ...cleaned, approvalRequired: !!input.approvalRequired });
  table.evtSeq = Number(table.evtSeq || 0) + 1;
  const event = {
    id: table.evtSeq,
    ...cleaned,
    status: pending ? 'pending' : 'posted',
    approvalRequired: pending,
    createdAt: now,
    approvedAt: null,
    approvedBy: null,
  };
  table.events.push(event);
  table.events = table.events.slice(-MAX_EVENTS);
  table.updatedAt = now;
  return event;
}

function eventsPayload(table, since = 0, includePending = false) {
  normalizeTable(table);
  const after = Number(since || 0);
  const events = table.events.filter(event => {
    if (event.id <= after) return false;
    return includePending || event.status !== 'pending';
  });
  const lastVisibleId = events.reduce((max, event) => Math.max(max, event.id), after);
  return {
    code: table.code,
    lastEventId: includePending ? (table.evtSeq || 0) : lastVisibleId,
    events,
  };
}

function cloneJSON(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (err) {
    return {};
  }
}

function readSnapshotValue(snapshot, key, fallback) {
  const raw = snapshot?.keys?.[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch (err) { return fallback; }
}

function checkpointSummary(snapshot = {}) {
  const session = readSnapshotValue(snapshot, 'vg_session', null);
  const maps = readSnapshotValue(snapshot, 'vg_maps', []);
  const activeMapId = snapshot?.keys?.vg_active_map_id || null;
  const activeMap = Array.isArray(maps)
    ? (maps.find(map => map.id === activeMapId) || maps[0] || null)
    : null;
  return {
    sceneId: session?.currentSceneId || null,
    mapName: activeMap?.name || null,
    partyPos: activeMap?.partyPos || null,
    capturedAt: snapshot?.capturedAt || null,
  };
}

function cleanCheckpointInput(input = {}) {
  return {
    name: String(input.name || '').trim().slice(0, 120),
    note: String(input.note || '').trim().slice(0, 1000),
  };
}

function checkpointPayload(table) {
  normalizeTable(table);
  return {
    code: table.code,
    lastCheckpointId: table.checkpointSeq || 0,
    checkpoints: table.checkpoints.slice().reverse().map(checkpoint => ({
      ...checkpoint,
      summary: checkpointSummary(checkpoint.snapshot),
    })),
  };
}

function visibleToPlayer(item, player) {
  if (!item) return false;
  if (player?.role === 'warden') return true;
  return item.target === 'all' || item.target === player?.id;
}

function tableFlowPayload(table, player = null) {
  normalizeTable(table);
  const prompts = table.prompts
    .filter(prompt => visibleToPlayer(prompt, player))
    .slice()
    .reverse();
  const handouts = table.handouts
    .filter(handout => visibleToPlayer(handout, player))
    .slice()
    .reverse();
  return {
    code: table.code,
    flow: table.flow || {},
    prompts,
    handouts,
    lastPromptId: table.promptSeq || 0,
    lastHandoutId: table.handoutSeq || 0,
  };
}

function defaultRooms(now = new Date().toISOString()) {
  return [
    { id: 'main', name: 'Main Table', kind: 'main', members: ['all'], active: true, createdAt: now },
    { id: 'safety', name: 'Safety', kind: 'safety', members: ['all'], active: true, createdAt: now },
    { id: 'warden', name: 'Warden', kind: 'warden', members: [], active: true, createdAt: now },
  ];
}

function cleanRoomId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function cleanRoomMembers(value) {
  const raw = Array.isArray(value) ? value : [];
  const members = raw.map(item => String(item || '').trim().slice(0, 80)).filter(Boolean);
  return [...new Set(members.length ? members : ['all'])].slice(0, 30);
}

function playerCanSeeRoom(room, player) {
  if (!room || room.active === false) return false;
  if (player?.role === 'warden') return true;
  if (room.kind === 'warden') return false;
  return room.members.includes('all') || room.members.includes(player?.id);
}

function roomsPayload(table, player = null) {
  normalizeTable(table);
  const rooms = table.rooms.filter(room => playerCanSeeRoom(room, player));
  const roomIds = new Set(rooms.map(room => room.id));
  const messages = table.roomMessages.filter(message => roomIds.has(message.roomId));
  return {
    code: table.code,
    rooms,
    messages,
    lastRoomMessageId: table.roomMsgSeq || 0,
  };
}

function roomName(table, roomId) {
  return table.rooms.find(room => room.id === roomId)?.name || 'Room';
}

function addRoom(table, input = {}, player = null) {
  normalizeTable(table);
  const name = String(input.name || input.title || '').trim().slice(0, 80);
  if (!name) return null;
  const kind = ['main', 'private', 'split', 'safety', 'warden'].includes(input.kind) ? input.kind : 'split';
  const members = cleanRoomMembers(input.members || (input.target && input.target !== 'all' ? [input.target] : ['all']));
  const now = new Date().toISOString();
  const baseId = cleanRoomId(input.id || name) || `room-${Date.now().toString(36)}`;
  let id = baseId;
  let suffix = 2;
  while (table.rooms.some(room => room.id === id)) id = `${baseId}-${suffix++}`.slice(0, 60);
  table.roomSeq = Number(table.roomSeq || 0) + 1;
  const room = {
    id,
    name,
    kind,
    members,
    active: true,
    createdAt: now,
    createdBy: player?.id || null,
    createdByName: player?.name || null,
  };
  table.rooms.push(room);
  table.rooms = table.rooms.slice(-MAX_ROOMS);
  table.updatedAt = now;
  return room;
}

function updateRoom(table, roomId, input = {}, player = null) {
  normalizeTable(table);
  const room = table.rooms.find(item => item.id === roomId);
  if (!room) return null;
  if (input.name !== undefined) room.name = String(input.name || room.name).trim().slice(0, 80) || room.name;
  if (input.kind !== undefined && ['main', 'private', 'split', 'safety', 'warden'].includes(input.kind)) room.kind = input.kind;
  if (input.members !== undefined) room.members = cleanRoomMembers(input.members);
  if (input.active !== undefined) room.active = !!input.active;
  table.updatedAt = new Date().toISOString();
  table.updatedBy = player?.id || null;
  return room;
}

function addRoomMessage(table, input = {}, player = null) {
  normalizeTable(table);
  const roomId = cleanRoomId(input.roomId || 'main') || 'main';
  const room = table.rooms.find(item => item.id === roomId);
  if (!room || !playerCanSeeRoom(room, player)) return null;
  const text = String(input.text || input.message || '').trim().slice(0, 1000);
  if (!text) return null;
  const now = new Date().toISOString();
  table.roomMsgSeq = Number(table.roomMsgSeq || 0) + 1;
  const message = {
    id: table.roomMsgSeq,
    roomId,
    clientId: player?.id || String(input.clientId || '').slice(0, 80),
    name: player?.name || String(input.name || 'Seated Player').slice(0, 80),
    role: cleanRole(player?.role || input.role, 'protagonist'),
    text,
    createdAt: now,
  };
  table.roomMessages.push(message);
  table.roomMessages = table.roomMessages.slice(-MAX_ROOM_MESSAGES);
  table.updatedAt = now;
  return message;
}

function targetName(table, target) {
  if (!target || target === 'all') return 'All players';
  return table.players?.[target]?.name || 'Selected player';
}

function addPrompt(table, input = {}, player) {
  normalizeTable(table);
  const question = String(input.question || input.text || '').trim().slice(0, 1000);
  if (!question) return null;
  const target = String(input.target || 'all').trim().slice(0, 80) || 'all';
  const now = new Date().toISOString();
  table.promptSeq = Number(table.promptSeq || 0) + 1;
  const prompt = {
    id: table.promptSeq,
    target,
    targetName: targetName(table, target),
    question,
    kind: String(input.kind || 'freeform').slice(0, 40),
    status: 'open',
    response: '',
    respondedBy: null,
    respondedByName: null,
    respondedAt: null,
    createdAt: now,
    createdBy: player?.id || null,
    createdByName: player?.name || null,
  };
  table.prompts.push(prompt);
  table.prompts = table.prompts.slice(-MAX_PROMPTS);
  table.updatedAt = now;
  return prompt;
}

function addHandout(table, input = {}, player) {
  normalizeTable(table);
  const title = String(input.title || '').trim().slice(0, 120);
  const text = String(input.text || input.body || '').trim().slice(0, 2000);
  if (!title && !text) return null;
  const target = String(input.target || 'all').trim().slice(0, 80) || 'all';
  const now = new Date().toISOString();
  table.handoutSeq = Number(table.handoutSeq || 0) + 1;
  const handout = {
    id: table.handoutSeq,
    target,
    targetName: targetName(table, target),
    title: title || 'Table handout',
    text,
    kind: String(input.kind || 'note').slice(0, 40),
    createdAt: now,
    createdBy: player?.id || null,
    createdByName: player?.name || null,
  };
  table.handouts.push(handout);
  table.handouts = table.handouts.slice(-MAX_HANDOUTS);
  table.updatedAt = now;
  return handout;
}

function setFocus(table, input = {}, player) {
  normalizeTable(table);
  const focusClientId = String(input.focusClientId || input.clientId || '').trim().slice(0, 80);
  const focusPlayer = focusClientId ? table.players?.[focusClientId] : null;
  const now = new Date().toISOString();
  table.flow = {
    focusClientId,
    focusName: String(input.focusName || focusPlayer?.name || '').slice(0, 80),
    focusNote: String(input.focusNote || input.note || '').slice(0, 500),
    updatedAt: now,
    updatedBy: player?.id || null,
  };
  table.updatedAt = now;
  return table.flow;
}

function addCheckpoint(table, input = {}, player = null, reason = 'manual') {
  normalizeTable(table);
  const cleaned = cleanCheckpointInput(input);
  const now = new Date().toISOString();
  const summary = checkpointSummary(table.snapshot || {});
  const suffix = summary.mapName
    ? `${summary.mapName}${summary.partyPos ? ` ${summary.partyPos.x},${summary.partyPos.y}` : ''}`
    : (summary.sceneId || 'Current table state');
  table.checkpointSeq = Number(table.checkpointSeq || 0) + 1;
  const checkpoint = {
    id: table.checkpointSeq,
    name: cleaned.name || `${reason.replace(/-/g, ' ')} - ${suffix}`.slice(0, 120),
    note: cleaned.note,
    reason,
    snapshot: cloneJSON(table.snapshot || {}),
    rev: table.rev || 1,
    eventId: table.evtSeq || 0,
    createdAt: now,
    createdBy: player?.id || null,
    createdByName: player?.name || null,
  };
  table.checkpoints.push(checkpoint);
  table.checkpoints = table.checkpoints.slice(-MAX_CHECKPOINTS);
  table.updatedAt = now;
  return checkpoint;
}

function restoreCheckpoint(table, checkpoint, player) {
  normalizeTable(table);
  table.snapshot = cloneJSON(checkpoint.snapshot || {});
  table.rev = Number(table.rev || 1) + 1;
  table.updatedAt = new Date().toISOString();
  table.updatedBy = player?.id || null;
  addEvent(table, {
    type: 'checkpoint.restored',
    text: `${player?.name || 'Warden'} restored checkpoint: ${checkpoint.name}.`,
    detail: { checkpointId: checkpoint.id, checkpointName: checkpoint.name, rev: table.rev },
  }, player);
  return table;
}

function activityText(type, player, detail = {}) {
  const name = player?.name || 'Someone';
  if (type === 'table.created') return `${name} created the table.`;
  if (type === 'player.joined') return `${name} joined as ${player?.role || 'protagonist'}.`;
  if (type === 'player.ready') return `${name} is ${detail.ready ? 'ready' : 'not ready'}.`;
  if (type === 'chat.message') return `${name} sent a table message.`;
  if (type === 'snapshot.updated') return `${name} synced the shared table state.`;
  if (type === 'checkpoint.created') return `${name} saved a session checkpoint.`;
  if (type === 'checkpoint.restored') return `${name} restored a session checkpoint.`;
  if (type === 'checkpoint.deleted') return `${name} deleted a session checkpoint.`;
  if (type === 'focus.changed') return `${name} changed the table spotlight.`;
  if (type === 'prompt.sent') return `${name} sent a table prompt.`;
  if (type === 'prompt.responded') return `${name} answered a table prompt.`;
  if (type === 'handout.sent') return `${name} sent a table handout.`;
  if (type === 'room.created') return `${name} created a table room.`;
  if (type === 'room.updated') return `${name} updated a table room.`;
  if (type === 'room.message') return `${name} sent a room message.`;
  if (type === 'dice.roll') return `${name} rolled d${detail.sides || '?'}${detail.result ? `: ${detail.result}` : ''}.`;
  if (type === 'scene.change') return `${name} changed scene${detail.sceneTitle ? ` to ${detail.sceneTitle}` : ''}.`;
  if (type === 'safety.signal') return `${name} raised ${detail.tier || 'a safety signal'}.`;
  if (type === 'map.reveal') return `${name} requested a map reveal.`;
  if (type === 'intimacy.message') return `${name} sent an Intimate Table message.`;
  if (type === 'intimacy.card') return `${name} updated an Intimate Table card.`;
  if (type === 'movement.request') return `${name} requested movement.`;
  if (type === 'action.applied') return `${name} applied an approved table action.`;
  if (type === 'action.rejected') return `${name} rejected a table action.`;
  return `${name} added a table note.`;
}

function readSnapshotJSON(table, key, fallback) {
  const raw = table.snapshot?.keys?.[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch (err) { return fallback; }
}

function writeSnapshotJSON(table, key, value) {
  if (!table.snapshot || typeof table.snapshot !== 'object') table.snapshot = {};
  if (!table.snapshot.keys || typeof table.snapshot.keys !== 'object') table.snapshot.keys = {};
  table.snapshot.keys[key] = JSON.stringify(value);
}

function setSnapshotValue(table, key, value) {
  if (!table.snapshot || typeof table.snapshot !== 'object') table.snapshot = {};
  if (!table.snapshot.keys || typeof table.snapshot.keys !== 'object') table.snapshot.keys = {};
  table.snapshot.keys[key] = value == null ? null : String(value);
}

function mapTile(map, x, y) {
  return Array.isArray(map.tiles) ? map.tiles.find(tile => tile.x === x && tile.y === y) : null;
}

function mapCanMove(map, x, y) {
  if (!map || x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
  const tile = mapTile(map, x, y);
  if (!tile) return false;
  return !['wall', 'water', 'void'].includes(tile.type);
}

function revealAround(map, cx, cy, radius = 4) {
  if (!Array.isArray(map.revealedTiles)) map.revealedTiles = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) continue;
        const key = `${x},${y}`;
        if (!map.revealedTiles.includes(key)) map.revealedTiles.push(key);
      }
    }
  }
}

function moveSnapshotParty(map, detail = {}) {
  const current = map.partyPos || { x: 1, y: 1 };
  const directions = {
    north: [0, -1],
    south: [0, 1],
    west: [-1, 0],
    east: [1, 0],
  };
  const dir = String(detail.direction || '').toLowerCase();
  const delta = directions[dir] || [Number(detail.dx || 0), Number(detail.dy || 0)];
  const x = Number.isFinite(Number(detail.x)) ? Number(detail.x) : Number(current.x || 0) + delta[0];
  const y = Number.isFinite(Number(detail.y)) ? Number(detail.y) : Number(current.y || 0) + delta[1];
  const override = !!detail.override;
  if (!override && !mapCanMove(map, x, y)) {
    return { applied: false, reason: 'Target tile is blocked or outside the map.' };
  }
  map.partyPos = { x, y };
  revealAround(map, x, y, Number(map.sightRadius || 4));
  const tile = mapTile(map, x, y);
  if (tile?.zoneId && Array.isArray(map.zones)) {
    const zone = map.zones.find(item => item.id === tile.zoneId);
    if (zone) zone.isDiscovered = true;
  }
  let triggeredEvent = null;
  if (Array.isArray(map.events)) {
    triggeredEvent = map.events.find(item => item.x === x && item.y === y) || null;
    if (triggeredEvent && (!triggeredEvent.triggered || triggeredEvent.repeatable)) {
      triggeredEvent.triggered = true;
      triggeredEvent.triggerCount = Number(triggeredEvent.triggerCount || 0) + 1;
    }
  }
  return {
    applied: true,
    summary: `Party moved to ${x},${y}${map.name ? ` on ${map.name}` : ''}.`,
    detail: { x, y, mapId: map.id || null, mapName: map.name || null, eventLabel: triggeredEvent?.label || null },
  };
}

function revealSnapshotMap(map, detail = {}) {
  const action = detail.action || 'reveal-around';
  if (!Array.isArray(map.revealedTiles)) map.revealedTiles = [];
  if (action === 'reveal-all') {
    (map.tiles || []).forEach(tile => {
      const key = `${tile.x},${tile.y}`;
      if (!map.revealedTiles.includes(key)) map.revealedTiles.push(key);
    });
    return { applied: true, summary: `Revealed all of ${map.name || 'the active map'}.`, detail: { action, mapId: map.id || null, mapName: map.name || null } };
  }
  if (action === 'reset-fog') {
    map.revealedTiles = [];
    revealAround(map, map.partyPos?.x || 1, map.partyPos?.y || 1, Number(map.sightRadius || 4));
    return { applied: true, summary: `Reset fog on ${map.name || 'the active map'}.`, detail: { action, mapId: map.id || null, mapName: map.name || null } };
  }
  revealAround(map, Number(detail.x ?? map.partyPos?.x ?? 1), Number(detail.y ?? map.partyPos?.y ?? 1), Number(detail.radius || map.sightRadius || 4));
  return { applied: true, summary: `Revealed nearby tiles on ${map.name || 'the active map'}.`, detail: { action, mapId: map.id || null, mapName: map.name || null } };
}

function applyMapAction(table, event) {
  const maps = readSnapshotJSON(table, 'vg_maps', []);
  if (!Array.isArray(maps) || !maps.length) return { applied: false, reason: 'No shared map is available.' };
  const activeMapId = event.detail.mapId || table.snapshot?.keys?.vg_active_map_id || maps[0]?.id;
  const index = maps.findIndex(map => map.id === activeMapId);
  if (index < 0) return { applied: false, reason: 'Requested map is not in the shared table state.' };
  const map = maps[index];
  const result = event.type === 'movement.request' ? moveSnapshotParty(map, event.detail) : revealSnapshotMap(map, event.detail);
  if (!result.applied) return result;
  map.updatedAt = Date.now();
  maps[index] = map;
  writeSnapshotJSON(table, 'vg_maps', maps);
  setSnapshotValue(table, 'vg_active_map_id', map.id || activeMapId);
  return result;
}

function applySceneAction(table, event) {
  const sceneId = String(event.detail.sceneId || '').trim();
  if (!sceneId) return { applied: false, reason: 'No target scene was supplied.' };
  const session = readSnapshotJSON(table, 'vg_session', null);
  if (!session || typeof session !== 'object') return { applied: false, reason: 'No active shared session is available.' };
  const previousSceneId = session.currentSceneId || null;
  if (!Array.isArray(session.history)) session.history = [];
  if (previousSceneId) {
    session.history.push({
      sceneId: previousSceneId,
      choiceMade: event.detail.branch || event.detail.action || 'warden-approved',
      roll: event.detail.roll || null,
      timestamp: Date.now(),
    });
  }
  session.currentSceneId = sceneId;
  session.lastSaved = Date.now();
  writeSnapshotJSON(table, 'vg_session', session);
  return {
    applied: true,
    summary: `Scene changed to ${event.detail.sceneTitle || sceneId}.`,
    detail: { sceneId, sceneTitle: event.detail.sceneTitle || null, previousSceneId },
  };
}

function applyApprovedAction(table, event, player) {
  if (!APPLY_EVENT_TYPES.has(event.type)) {
    const result = { applied: true, summary: `${player.name || 'Warden'} accepted ${event.name || 'a player'}'s request.`, detail: { sourceEventId: event.id, sourceType: event.type } };
    event.appliedAt = new Date().toISOString();
    event.applyResult = result;
    addEvent(table, {
      type: 'action.applied',
      text: result.summary,
      detail: result.detail,
    }, player);
    return result;
  }
  const result = event.type === 'scene.change' ? applySceneAction(table, event) : applyMapAction(table, event);
  event.appliedAt = new Date().toISOString();
  event.applyResult = result;
  if (result.applied) {
    table.rev += 1;
    table.updatedBy = player.id;
    if (event.type === 'scene.change') {
      addCheckpoint(table, {
        name: `Scene checkpoint - ${result.detail?.sceneTitle || result.detail?.sceneId || 'new scene'}`,
        note: 'Saved automatically after an approved scene change.',
      }, player, 'scene-change');
    }
    addEvent(table, {
      type: 'action.applied',
      text: result.summary || `${player.name} applied an approved table action.`,
      detail: { sourceEventId: event.id, sourceType: event.type, ...(result.detail || {}) },
    }, player);
  } else {
    addEvent(table, {
      type: 'note.added',
      text: `Approved action could not apply: ${result.reason || 'No apply rule matched.'}`,
      detail: { sourceEventId: event.id, sourceType: event.type, applyFailed: true },
    }, player);
  }
  return result;
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
  const writer = currentWarden(table);
  return {
    code: table.code,
    name: table.name,
    status: table.status || 'lobby',
    rev: table.rev,
    snapshot: table.snapshot || {},
    players: Object.values(table.players || {}).sort((a, b) => {
      const rank = { warden: 0, protagonist: 1, boss: 2, spectator: 3 };
      return (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || String(a.name).localeCompare(String(b.name));
    }).map(player => ({ ...player, ...playerPresence(player) })),
    permissions: {
      snapshotWriterRole: 'warden',
      snapshotWriterId: writer?.id || null,
      snapshotWriterName: writer?.name || null,
    },
    flow: table.flow || {},
    updatedAt: table.updatedAt,
    updatedBy: table.updatedBy || null,
  };
}

function writeLive(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function liveClientPayload(table, client, reason = 'sync') {
  const messages = messagesPayload(table, client.lastMessageId || 0);
  const events = eventsPayload(table, client.lastEventId || 0, client.includePending);
  client.lastMessageId = Math.max(client.lastMessageId || 0, messages.lastMessageId || 0);
  client.lastEventId = Math.max(client.lastEventId || 0, events.lastEventId || 0);
  return {
    reason,
    table: tablePayload(table),
    messages,
    events,
    flow: tableFlowPayload(table, client.player || null),
    rooms: roomsPayload(table, client.player || null),
    sentAt: new Date().toISOString(),
  };
}

function broadcastTable(tableCode, reason, table) {
  const codeKey = String(tableCode || '').toUpperCase();
  const clients = liveStreams.get(codeKey);
  if (!clients || !clients.size) return;
  for (const client of Array.from(clients)) {
    try {
      writeLive(client.res, 'sync', liveClientPayload(table, client, reason));
    } catch (err) {
      clearInterval(client.keepalive);
      clients.delete(client);
    }
  }
  if (!clients.size) liveStreams.delete(codeKey);
}

function openLiveStream(req, res, tableCode) {
  const data = readTables();
  const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
  if (!table) return send(res, 404, { error: 'Table not found' });

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const includePending = url.searchParams.get('pending') === '1' || cleanRole(url.searchParams.get('role')) === 'warden';
  const client = {
    res,
    includePending,
    player: table.players?.[url.searchParams.get('clientId')] || null,
    lastMessageId: Number(url.searchParams.get('lastMessageId') || 0),
    lastEventId: Number(url.searchParams.get('lastEventId') || 0),
    keepalive: null,
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  if (!liveStreams.has(tableCode)) liveStreams.set(tableCode, new Set());
  liveStreams.get(tableCode).add(client);
  writeLive(res, 'sync', liveClientPayload(table, client, 'connected'));
  client.keepalive = setInterval(() => {
    try {
      writeLive(res, 'ping', { sentAt: new Date().toISOString() });
    } catch (err) {
      clearInterval(client.keepalive);
      liveStreams.get(tableCode)?.delete(client);
    }
  }, LIVE_KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(client.keepalive);
    const clients = liveStreams.get(tableCode);
    if (!clients) return;
    clients.delete(client);
    if (!clients.size) liveStreams.delete(tableCode);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'velvet-grimoire-sync' });
  }

  const streamMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/stream$/i);
  if (streamMatch && req.method === 'GET') {
    return openLiveStream(req, res, streamMatch[1].toUpperCase());
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
      messages: [],
      msgSeq: 0,
      events: [],
      evtSeq: 0,
      checkpoints: [],
      checkpointSeq: 0,
      prompts: [],
      promptSeq: 0,
      handouts: [],
      handoutSeq: 0,
      rooms: defaultRooms(now),
      roomSeq: 3,
      roomMessages: [],
      roomMsgSeq: 0,
      flow: {},
    };
    const player = upsertPlayer(table, {
      clientId: body.clientId,
      name: body.playerName || body.name || 'Warden',
      role: body.role || 'warden',
      ready: true,
    }, 'warden');
    if (player) addEvent(table, { type: 'table.created', text: activityText('table.created', player) }, player);
    if (player) addCheckpoint(table, { name: 'Opening checkpoint', note: 'Saved when the remote table was created.' }, player, 'table-created');
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
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      if (!canUseRole(table, id, body.role || table.players[id]?.role || 'protagonist')) {
        return send(res, 403, { error: 'Only the current Warden can keep the Warden seat.' });
      }
      const previous = table.players[id] || null;
      const fallbackRole = table.players[id]?.role || body.role || 'protagonist';
      const player = upsertPlayer(table, { ...body, clientId: id || body.clientId }, fallbackRole);
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      if (!previous) {
        addEvent(table, { type: 'player.joined', text: activityText('player.joined', player), detail: { role: player.role } }, player);
      } else if (body.ready !== undefined && !!previous.ready !== !!player.ready) {
        addEvent(table, { type: 'player.ready', text: activityText('player.ready', player, { ready: player.ready }), detail: { ready: player.ready } }, player);
      }
      table.rev += 1;
      table.updatedBy = player.id;
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, previous ? 'player.updated' : 'player.joined', table);
      return send(res, 200, tablePayload(table));
    }
  }

  const presenceMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/presence$/i);
  if (presenceMatch) {
    const tableCode = presenceMatch[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    if (req.method !== 'POST' && req.method !== 'PATCH') return send(res, 404, { error: 'Not found' });
    const body = await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || '').trim().slice(0, 80);
    if (!id) return send(res, 400, { error: 'Player clientId is required' });
    if (!canUseRole(table, id, input.role || table.players[id]?.role || 'protagonist')) {
      return send(res, 403, { error: 'Only the current Warden can keep the Warden seat.' });
    }
    const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
    const player = upsertPlayer(table, input, fallbackRole);
    if (!player) return send(res, 400, { error: 'Player clientId is required' });
    data.tables[tableCode] = table;
    writeTables(data);
    broadcastTable(tableCode, 'presence.updated', table);
    return send(res, 200, tablePayload(table));
  }

  const messagesMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/messages$/i);
  if (messagesMatch) {
    const tableCode = messagesMatch[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      return send(res, 200, messagesPayload(table, url.searchParams.get('since')));
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const input = body.player || body;
      const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
      const player = upsertPlayer(table, { ...input, clientId: id }, fallbackRole);
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      const messageInput = body.message && typeof body.message === 'object' ? body.message : body;
      const message = addMessage(table, { ...messageInput, clientId: id }, player);
      if (!message) return send(res, 400, { error: 'Message text is required' });
      addEvent(table, {
        type: 'chat.message',
        text: activityText('chat.message', player),
        detail: { messageId: message.id },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'message.created', table);
      return send(res, 201, { ...messagesPayload(table), message });
    }
  }

  const flowMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/flow$/i);
  if (flowMatch) {
    const tableCode = flowMatch[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const clientId = String(url.searchParams.get('clientId') || '').trim().slice(0, 80);
    const viewer = table.players?.[clientId] || null;

    if (req.method === 'GET') return send(res, 200, tableFlowPayload(table, viewer));

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const input = body.player || body;
      const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
      const player = upsertPlayer(table, { ...input, clientId: id }, fallbackRole);
      if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can change table focus.' });
      const flow = setFocus(table, body, player);
      addEvent(table, {
        type: 'focus.changed',
        text: flow.focusClientId ? `${player.name || 'Warden'} spotlighted ${flow.focusName || 'a player'}.` : `${player.name || 'Warden'} cleared the table spotlight.`,
        detail: flow,
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'flow.updated', table);
      return send(res, 200, tableFlowPayload(table, player));
    }
  }

  const promptMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/prompts(?:\/([0-9]+))?$/i);
  if (promptMatch) {
    const tableCode = promptMatch[1].toUpperCase();
    const promptId = promptMatch[2] ? Number(promptMatch[2]) : null;
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    const body = req.method === 'GET' ? {} : await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
    const player = id ? upsertPlayer(table, { ...input, clientId: id }, table.players[id]?.role || input.role || body.role || 'protagonist') : null;

    if (!promptId && req.method === 'GET') return send(res, 200, tableFlowPayload(table, player));

    if (!promptId && req.method === 'POST') {
      if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can send table prompts.' });
      const prompt = addPrompt(table, body, player);
      if (!prompt) return send(res, 400, { error: 'Prompt text is required' });
      addEvent(table, {
        type: 'prompt.sent',
        text: `${player.name || 'Warden'} prompted ${prompt.targetName || 'the table'}: ${prompt.question}`,
        detail: { promptId: prompt.id, target: prompt.target, targetName: prompt.targetName, kind: prompt.kind },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'prompt.sent', table);
      return send(res, 201, { ...tableFlowPayload(table, player), prompt });
    }

    const prompt = table.prompts.find(item => item.id === promptId);
    if (!prompt) return send(res, 404, { error: 'Prompt not found' });

    if (promptId && req.method === 'PATCH') {
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      const action = String(body.action || 'respond').toLowerCase();
      if (action === 'close') {
        if (player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can close prompts.' });
        prompt.status = 'closed';
      } else {
        if (!visibleToPlayer(prompt, player)) return send(res, 403, { error: 'This prompt is not assigned to this player.' });
        const response = String(body.response || body.text || '').trim().slice(0, 1000);
        if (!response) return send(res, 400, { error: 'Response text is required' });
        prompt.status = 'answered';
        prompt.response = response;
        prompt.respondedBy = player.id;
        prompt.respondedByName = player.name;
        prompt.respondedAt = new Date().toISOString();
        addEvent(table, {
          type: 'prompt.responded',
          text: `${player.name || 'A player'} answered: ${response}`,
          detail: { promptId: prompt.id, target: prompt.target },
        }, player);
      }
      table.updatedAt = new Date().toISOString();
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'prompt.updated', table);
      return send(res, 200, { ...tableFlowPayload(table, player), prompt });
    }
  }

  const handoutMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/handouts$/i);
  if (handoutMatch) {
    const tableCode = handoutMatch[1].toUpperCase();
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    const body = req.method === 'GET' ? {} : await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
    const player = id ? upsertPlayer(table, { ...input, clientId: id }, table.players[id]?.role || input.role || body.role || 'protagonist') : null;

    if (req.method === 'GET') return send(res, 200, tableFlowPayload(table, player));

    if (req.method === 'POST') {
      if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can send handouts.' });
      const handout = addHandout(table, body, player);
      if (!handout) return send(res, 400, { error: 'Handout title or text is required' });
      addEvent(table, {
        type: 'handout.sent',
        text: `${player.name || 'Warden'} sent ${handout.targetName || 'the table'} a handout: ${handout.title}.`,
        detail: { handoutId: handout.id, target: handout.target, targetName: handout.targetName, kind: handout.kind },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'handout.sent', table);
      return send(res, 201, { ...tableFlowPayload(table, player), handout });
    }
  }

  const roomMessageMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/rooms\/([^/]+)\/messages$/i);
  if (roomMessageMatch) {
    const tableCode = roomMessageMatch[1].toUpperCase();
    const roomId = cleanRoomId(decodeURIComponent(roomMessageMatch[2]));
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    const body = req.method === 'GET' ? {} : await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
    const player = id ? upsertPlayer(table, { ...input, clientId: id }, table.players[id]?.role || input.role || body.role || 'protagonist') : null;
    const room = table.rooms.find(item => item.id === roomId);
    if (!room) return send(res, 404, { error: 'Room not found' });
    if (!playerCanSeeRoom(room, player)) return send(res, 403, { error: 'This room is private.' });

    if (req.method === 'GET') return send(res, 200, roomsPayload(table, player));

    if (req.method === 'POST') {
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      const message = addRoomMessage(table, { ...body, roomId }, player);
      if (!message) return send(res, 400, { error: 'Room message text is required' });
      addEvent(table, {
        type: 'room.message',
        text: `${player.name || 'Someone'} messaged ${roomName(table, roomId)}.`,
        detail: { roomId, roomName: roomName(table, roomId), messageId: message.id },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'room.message', table);
      return send(res, 201, { ...roomsPayload(table, player), message });
    }
  }

  const roomMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/rooms(?:\/([^/]+))?$/i);
  if (roomMatch) {
    const tableCode = roomMatch[1].toUpperCase();
    const roomId = roomMatch[2] ? cleanRoomId(decodeURIComponent(roomMatch[2])) : null;
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryClientId = String(url.searchParams.get('clientId') || '').trim().slice(0, 80);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || body.clientId || queryClientId).trim().slice(0, 80);
    const player = id ? upsertPlayer(table, { ...input, clientId: id }, table.players[id]?.role || input.role || body.role || 'protagonist') : null;

    if (req.method === 'GET') return send(res, 200, roomsPayload(table, player));

    if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can manage rooms.' });

    if (!roomId && req.method === 'POST') {
      const room = addRoom(table, body, player);
      if (!room) return send(res, 400, { error: 'Room name is required' });
      addEvent(table, {
        type: 'room.created',
        text: `${player.name || 'Warden'} created room: ${room.name}.`,
        detail: { roomId: room.id, roomName: room.name, kind: room.kind },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'room.created', table);
      return send(res, 201, { ...roomsPayload(table, player), room });
    }

    if (roomId && req.method === 'PATCH') {
      const room = updateRoom(table, roomId, body, player);
      if (!room) return send(res, 404, { error: 'Room not found' });
      addEvent(table, {
        type: 'room.updated',
        text: `${player.name || 'Warden'} updated room: ${room.name}.`,
        detail: { roomId: room.id, roomName: room.name, kind: room.kind },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'room.updated', table);
      return send(res, 200, { ...roomsPayload(table, player), room });
    }
  }

  const checkpointMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/checkpoints(?:\/([0-9]+))?$/i);
  if (checkpointMatch) {
    const tableCode = checkpointMatch[1].toUpperCase();
    const checkpointId = checkpointMatch[2] ? Number(checkpointMatch[2]) : null;
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (!checkpointId && req.method === 'GET') return send(res, 200, checkpointPayload(table));

    const body = await readBody(req);
    const input = body.player || body;
    const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
    if (!id) return send(res, 400, { error: 'Player clientId is required' });
    const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
    const player = upsertPlayer(table, { ...input, clientId: id }, fallbackRole);
    if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can manage session checkpoints.' });

    if (!checkpointId && req.method === 'POST') {
      const checkpoint = addCheckpoint(table, body, player, String(body.reason || 'manual').slice(0, 80) || 'manual');
      addEvent(table, {
        type: 'checkpoint.created',
        text: `${player.name || 'Warden'} saved checkpoint: ${checkpoint.name}.`,
        detail: { checkpointId: checkpoint.id, checkpointName: checkpoint.name, reason: checkpoint.reason },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'checkpoint.created', table);
      return send(res, 201, { ...checkpointPayload(table), checkpoint: { ...checkpoint, summary: checkpointSummary(checkpoint.snapshot) } });
    }

    const checkpoint = table.checkpoints.find(item => item.id === checkpointId);
    if (!checkpoint) return send(res, 404, { error: 'Checkpoint not found' });

    if (checkpointId && req.method === 'PATCH') {
      const action = String(body.action || '').toLowerCase();
      if (action !== 'restore') return send(res, 400, { error: 'Checkpoint action must be restore.' });
      restoreCheckpoint(table, checkpoint, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'checkpoint.restored', table);
      return send(res, 200, { table: tablePayload(table), ...checkpointPayload(table), checkpoint: { ...checkpoint, summary: checkpointSummary(checkpoint.snapshot) } });
    }

    if (checkpointId && req.method === 'DELETE') {
      table.checkpoints = table.checkpoints.filter(item => item.id !== checkpointId);
      table.updatedAt = new Date().toISOString();
      addEvent(table, {
        type: 'checkpoint.deleted',
        text: `${player.name || 'Warden'} deleted checkpoint: ${checkpoint.name}.`,
        detail: { checkpointId: checkpoint.id, checkpointName: checkpoint.name },
      }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'checkpoint.deleted', table);
      return send(res, 200, checkpointPayload(table));
    }
  }

  const eventMatch = pathname.match(/^\/api\/tables\/([A-Z0-9]{4,10})\/events(?:\/([0-9]+))?$/i);
  if (eventMatch) {
    const tableCode = eventMatch[1].toUpperCase();
    const eventId = eventMatch[2] ? Number(eventMatch[2]) : null;
    const data = readTables();
    const table = data.tables[tableCode] && normalizeTable(data.tables[tableCode]);
    if (!table) return send(res, 404, { error: 'Table not found' });

    if (!eventId && req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      return send(res, 200, eventsPayload(table, url.searchParams.get('since'), url.searchParams.get('pending') === '1'));
    }

    if (!eventId && req.method === 'POST') {
      const body = await readBody(req);
      const input = body.player || body;
      const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
      const player = upsertPlayer(table, { ...input, clientId: id }, fallbackRole);
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      const detail = body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : {};
      const type = EVENT_TYPES.has(body.type) ? body.type : 'note.added';
      const event = addEvent(table, {
        type,
        text: body.text || activityText(type, player, detail),
        detail,
        approvalRequired: !!body.approvalRequired,
      }, player);
      if (!event) return send(res, 400, { error: 'Event could not be recorded' });
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'event.created', table);
      return send(res, event.status === 'pending' ? 202 : 201, { ...eventsPayload(table, 0, true), event });
    }

    if (eventId && req.method === 'PATCH') {
      const body = await readBody(req);
      const input = body.player || body;
      const id = String(input.clientId || input.id || body.clientId || '').trim().slice(0, 80);
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
      const player = upsertPlayer(table, { ...input, clientId: id }, fallbackRole);
      if (!player || player.role !== 'warden') return send(res, 403, { error: 'Only the Warden can update table actions.' });
      const event = table.events.find(item => item.id === eventId);
      if (!event) return send(res, 404, { error: 'Event not found' });
      const action = String(body.action || '').toLowerCase();

      if (action === 'meta') {
        if (body.bookmark !== undefined) event.bookmark = cleanBookmark(body.bookmark);
        if (body.recapHidden !== undefined) event.recapHidden = !!body.recapHidden;
        if (body.category !== undefined) event.category = eventCategory(event.type, body.category);
        data.tables[tableCode] = table;
        writeTables(data);
        broadcastTable(tableCode, 'event.meta', table);
        return send(res, 200, { ...eventsPayload(table, 0, true), event });
      }

      if (event.status !== 'pending') return send(res, 409, { error: 'Event is not pending approval.' });
      if (!['approve', 'reject'].includes(action)) return send(res, 400, { error: 'Approval action must be approve or reject.' });
      event.status = action === 'approve' ? 'approved' : 'rejected';
      event.approvedAt = new Date().toISOString();
      event.approvedBy = player.id;
      if (action === 'approve') {
        applyApprovedAction(table, event, player);
      } else {
        addEvent(table, {
          type: 'action.rejected',
          text: `${player.name || 'Warden'} rejected ${event.name || 'a player'}'s ${event.type.replace('.', ' ')} request.`,
          detail: { sourceEventId: event.id, sourceType: event.type },
        }, player);
      }
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, `event.${event.status}`, table);
      return send(res, 200, { ...eventsPayload(table, 0, true), event });
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
      const input = body.player || { clientId: body.clientId, role: body.role };
      const id = String(input.clientId || input.id || '').trim().slice(0, 80);
      if (!id) return send(res, 400, { error: 'Player clientId is required' });
      if (!canUseRole(table, id, input.role || table.players[id]?.role || 'protagonist')) {
        return send(res, 403, { error: 'Only the current Warden can sync shared table state.' });
      }
      const fallbackRole = table.players[id]?.role || input.role || body.role || 'protagonist';
      const player = upsertPlayer(table, input, fallbackRole);
      if (!player) return send(res, 400, { error: 'Player clientId is required' });
      if (!canWriteSnapshot(table, player.id)) {
        data.tables[tableCode] = table;
        writeTables(data);
        return send(res, 403, { error: 'Only the Warden can sync shared table state.', table: tablePayload(table) });
      }
      table.rev += 1;
      table.snapshot = body.snapshot || {};
      table.updatedAt = new Date().toISOString();
      table.updatedBy = body.clientId || null;
      if (body.autoCheckpoint !== false) {
        addCheckpoint(table, {
          name: body.checkpointName || `Warden sync - rev ${table.rev}`,
          note: 'Saved automatically during Warden sync.',
        }, player, 'warden-sync');
      }
      addEvent(table, { type: 'snapshot.updated', text: activityText('snapshot.updated', player), detail: { rev: table.rev } }, player);
      data.tables[tableCode] = table;
      writeTables(data);
      broadcastTable(tableCode, 'snapshot.updated', table);
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
