// ============================================================
// VELVET GRIMOIRE — Remote Table Sync Client
// Polling sync for table-code multiplayer through server.js.
// ============================================================

const VGSync = (() => {
  const CONFIG_KEY = 'vg_sync_config';
  const SYNC_KEYS = [
    'vg_campaigns',
    'vg_session',
    'vg_maps',
    'vg_active_map_id',
    'vg_signals',
    'vg_threshold_current',
    'vg_thresholds',
    'vg_hearths',
    'vg_stations_done',
    'vg_intimacy_chat',
    'vg_intimacy_state',
    'vg_intimacy_cards',
  ];

  let timer = null;
  let callbacks = {};
  let lastFingerprint = '';
  let busy = false;
  let lastTable = null;
  let lastPresenceAt = 0;
  let lastMessageId = 0;
  let messages = [];
  let lastEventId = 0;
  let events = [];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getConfig() {
    const existing = readJSON(CONFIG_KEY, {});
    if (!existing.clientId) {
      existing.clientId = uid();
      saveConfig(existing);
    }
    return {
      enabled: false,
      apiBase: location.origin,
      code: '',
      role: localStorage.getItem('vg_role') || 'player',
      playerName: existing.playerName || defaultPlayerName(),
      ready: false,
      lastRev: 0,
      clientId: existing.clientId,
      ...existing,
    };
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return config;
  }

  function snapshot() {
    const values = {};
    SYNC_KEYS.forEach(key => {
      values[key] = localStorage.getItem(key);
    });
    return {
      version: 1,
      keys: values,
      capturedAt: new Date().toISOString(),
    };
  }

  function defaultPlayerName() {
    const role = localStorage.getItem('vg_role') || 'player';
    return role === 'dm' ? 'Warden' : 'Protagonist';
  }

  function syncRoleToTableRole(role) {
    if (role === 'dm' || role === 'warden') return 'warden';
    if (role === 'boss') return 'boss';
    if (role === 'spectator') return 'spectator';
    return 'protagonist';
  }

  function playerPayload(overrides = {}) {
    const config = getConfig();
    return {
      clientId: config.clientId,
      name: overrides.name || config.playerName || defaultPlayerName(),
      role: syncRoleToTableRole(overrides.role || config.role),
      ready: overrides.ready === undefined ? !!config.ready : !!overrides.ready,
    };
  }

  function canWriteSharedState() {
    const config = getConfig();
    return syncRoleToTableRole(config.role) === 'warden';
  }

  function fingerprint(snap = snapshot()) {
    return JSON.stringify(snap.keys || {});
  }

  function applySnapshot(snap) {
    if (!snap || !snap.keys) return;
    SYNC_KEYS.forEach(key => {
      const value = snap.keys[key];
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    callbacks.onApply?.(snap);
    window.dispatchEvent(new CustomEvent('vg-sync-applied', { detail: snap }));
  }

  async function request(path, options = {}) {
    const config = getConfig();
    const res = await fetch(`${config.apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Sync request failed (${res.status})`);
    return body;
  }

  async function createTable(name = 'Velvet Table') {
    const config = getConfig();
    const local = snapshot();
    const table = await request('/api/tables', {
      method: 'POST',
      body: JSON.stringify({
        name,
        snapshot: local,
        clientId: config.clientId,
        playerName: config.playerName || 'Warden',
        role: 'warden',
      }),
    });
    lastTable = table;
    messages = [];
    lastMessageId = 0;
    events = [];
    lastEventId = 0;
    const next = saveConfig({ ...config, enabled: true, code: table.code, lastRev: table.rev, role: 'warden', ready: true });
    lastFingerprint = fingerprint(local);
    start(callbacks);
    callbacks.onStatus?.(status());
    return { table, config: next };
  }

  async function joinTable(code, options = {}) {
    const config = getConfig();
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Enter a table code.');
    const table = await request(`/api/tables/${normalized}`);
    applySnapshot(table.snapshot);
    const role = options.role || syncRoleToTableRole(config.role);
    const playerName = options.name || config.playerName || defaultPlayerName();
    const joined = await request(`/api/tables/${normalized}/players`, {
      method: 'POST',
      body: JSON.stringify(playerPayload({ name: playerName, role, ready: !!options.ready })),
    });
    lastTable = joined;
    messages = [];
    lastMessageId = 0;
    events = [];
    lastEventId = 0;
    const next = saveConfig({
      ...config,
      enabled: true,
      code: table.code,
      lastRev: joined.rev || table.rev,
      role,
      playerName,
      ready: !!options.ready,
    });
    lastFingerprint = fingerprint(table.snapshot);
    start(callbacks);
    callbacks.onStatus?.(status());
    return { table: joined, config: next };
  }

  async function fetchLobby() {
    const config = getConfig();
    if (!config.code) return null;
    const table = await request(`/api/tables/${config.code}`);
    lastTable = table;
    callbacks.onLobby?.(table);
    callbacks.onStatus?.(status());
    return table;
  }

  async function heartbeat(force = false) {
    const config = getConfig();
    if (!config.enabled || !config.code) return null;
    if (!force && Date.now() - lastPresenceAt < 5000) return lastTable;
    lastPresenceAt = Date.now();
    const table = await request(`/api/tables/${config.code}/presence`, {
      method: 'POST',
      body: JSON.stringify({ player: playerPayload() }),
    });
    lastTable = table;
    callbacks.onLobby?.(table);
    callbacks.onStatus?.(status());
    return table;
  }

  async function fetchMessages(force = false) {
    const config = getConfig();
    if (!config.enabled || !config.code) return [];
    const payload = await request(`/api/tables/${config.code}/messages?since=${force ? 0 : lastMessageId}`);
    if (force) messages = [];
    const incoming = payload.messages || [];
    if (incoming.length) {
      const seen = new Set(messages.map(message => message.id));
      messages = [...messages, ...incoming.filter(message => !seen.has(message.id))].slice(-100);
      lastMessageId = Math.max(lastMessageId, payload.lastMessageId || 0, ...incoming.map(message => message.id || 0));
    } else {
      lastMessageId = Math.max(lastMessageId, payload.lastMessageId || 0);
    }
    callbacks.onChat?.(messages);
    callbacks.onStatus?.(status());
    return messages;
  }

  async function sendMessage(text) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    const payload = await request(`/api/tables/${config.code}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        player: playerPayload(),
      }),
    });
    const incoming = payload.messages || [];
    const seen = new Set(messages.map(message => message.id));
    messages = [...messages, ...incoming.filter(message => !seen.has(message.id))].slice(-100);
    lastMessageId = Math.max(lastMessageId, payload.lastMessageId || 0, payload.message?.id || 0);
    callbacks.onChat?.(messages);
    callbacks.onStatus?.(status());
    return payload.message;
  }

  async function fetchEvents(force = false, includePending = canWriteSharedState()) {
    const config = getConfig();
    if (!config.enabled || !config.code) return [];
    const since = force ? 0 : lastEventId;
    const pending = includePending ? '&pending=1' : '';
    const payload = await request(`/api/tables/${config.code}/events?since=${since}${pending}`);
    if (force) events = [];
    const incoming = payload.events || [];
    if (incoming.length) {
      const byId = new Map(events.map(event => [event.id, event]));
      incoming.forEach(event => byId.set(event.id, event));
      events = Array.from(byId.values()).sort((a, b) => a.id - b.id).slice(-120);
    }
    lastEventId = Math.max(lastEventId, payload.lastEventId || 0);
    callbacks.onEvents?.(events);
    callbacks.onStatus?.(status());
    return events;
  }

  async function recordEvent(type, detail = {}, options = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) return null;
    const payload = await request(`/api/tables/${config.code}/events`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        detail,
        text: options.text,
        approvalRequired: !!options.approvalRequired,
        player: playerPayload(),
      }),
    });
    const incoming = payload.events || [];
    if (incoming.length) {
      const byId = new Map(events.map(event => [event.id, event]));
      incoming.forEach(event => byId.set(event.id, event));
      events = Array.from(byId.values()).sort((a, b) => a.id - b.id).slice(-120);
    } else if (payload.event) {
      events = [...events.filter(event => event.id !== payload.event.id), payload.event].sort((a, b) => a.id - b.id).slice(-120);
    }
    if (payload.event?.status === 'pending' && !canWriteSharedState()) {
      lastEventId = Math.max(lastEventId, (payload.event.id || 1) - 1);
    } else {
      lastEventId = Math.max(lastEventId, payload.lastEventId || 0, payload.event?.id || 0);
    }
    callbacks.onEvents?.(events);
    callbacks.onStatus?.(status());
    return payload.event;
  }

  async function reviewEvent(eventId, action) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    const payload = await request(`/api/tables/${config.code}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action,
        player: playerPayload(),
      }),
    });
    const incoming = payload.events || [];
    if (incoming.length) {
      const byId = new Map(events.map(event => [event.id, event]));
      incoming.forEach(event => byId.set(event.id, event));
      events = Array.from(byId.values()).sort((a, b) => a.id - b.id).slice(-120);
    }
    callbacks.onEvents?.(events);
    callbacks.onStatus?.(status());
    return payload.event;
  }

  async function updatePlayer(updates = {}) {
    const config = getConfig();
    if (!config.code) throw new Error('Join or create a table first.');
    const nextConfig = saveConfig({
      ...config,
      playerName: updates.name || config.playerName || defaultPlayerName(),
      role: updates.role || config.role,
      ready: updates.ready === undefined ? !!config.ready : !!updates.ready,
    });
    const table = await request(`/api/tables/${config.code}/players/${encodeURIComponent(config.clientId)}`, {
      method: 'PATCH',
      body: JSON.stringify(playerPayload({
        name: nextConfig.playerName,
        role: nextConfig.role,
        ready: nextConfig.ready,
      })),
    });
    lastTable = table;
    callbacks.onLobby?.(table);
    callbacks.onStatus?.(status());
    return table;
  }

  async function setReady(ready) {
    return updatePlayer({ ready: !!ready });
  }

  async function pull() {
    const config = getConfig();
    if (!config.enabled || !config.code) return null;
    const table = await request(`/api/tables/${config.code}`);
    lastTable = table;
    if (table.rev > (config.lastRev || 0)) {
      if (table.updatedBy !== config.clientId) {
        applySnapshot(table.snapshot);
        lastFingerprint = fingerprint(table.snapshot);
      }
      saveConfig({ ...config, lastRev: table.rev });
    }
    callbacks.onStatus?.(status());
    return table;
  }

  async function push() {
    const config = getConfig();
    if (!config.enabled || !config.code) return null;
    if (!canWriteSharedState()) return null;
    const local = snapshot();
    const current = fingerprint(local);
    if (current === lastFingerprint) return null;
    const table = await request(`/api/tables/${config.code}`, {
      method: 'PUT',
      body: JSON.stringify({
        snapshot: local,
        baseRev: config.lastRev || 0,
        clientId: config.clientId,
        player: playerPayload(),
      }),
    });
    lastTable = table;
    saveConfig({ ...config, lastRev: table.rev });
    lastFingerprint = current;
    callbacks.onStatus?.(status());
    return table;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await pull();
      await heartbeat();
      await fetchMessages();
      await fetchEvents();
      await push();
    } catch (err) {
      callbacks.onError?.(err);
    } finally {
      busy = false;
    }
  }

  function start(nextCallbacks = {}) {
    callbacks = { ...callbacks, ...nextCallbacks };
    if (!lastFingerprint) lastFingerprint = fingerprint();
    if (timer) clearInterval(timer);
    const config = getConfig();
    if (config.enabled && config.code) timer = setInterval(tick, 2000);
    callbacks.onStatus?.(status());
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    const config = getConfig();
    saveConfig({ ...config, enabled: false });
    callbacks.onStatus?.(status());
  }

  function status() {
    const config = getConfig();
    return {
      enabled: !!config.enabled,
      code: config.code || '',
      apiBase: config.apiBase,
      lastRev: config.lastRev || 0,
      clientId: config.clientId,
      playerName: config.playerName || defaultPlayerName(),
      role: syncRoleToTableRole(config.role || localStorage.getItem('vg_role')),
      ready: !!config.ready,
      canWriteSharedState: canWriteSharedState(),
      permissions: lastTable?.permissions || null,
      messages,
      lastMessageId,
      events,
      lastEventId,
      table: lastTable,
      players: lastTable?.players || [],
    };
  }

  function setApiBase(apiBase) {
    const config = getConfig();
    return saveConfig({ ...config, apiBase: String(apiBase || location.origin).trim() || location.origin });
  }

  return {
    SYNC_KEYS,
    getConfig,
    saveConfig,
    setApiBase,
    createTable,
    joinTable,
    fetchLobby,
    heartbeat,
    fetchMessages,
    sendMessage,
    fetchEvents,
    recordEvent,
    reviewEvent,
    updatePlayer,
    setReady,
    pull,
    push,
    tick,
    start,
    stop,
    status,
  };
})();

window.VGSync = VGSync;
