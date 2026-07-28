// ============================================================
// VELVET GRIMOIRE — Remote Table Sync Client
// Live sync for table-code multiplayer through server.js, with polling fallback.
// ============================================================

const VGSync = (() => {
  const CONFIG_KEY = 'vg_sync_config';
  const ACCOUNT_KEY = 'vg_account_session';
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
  let checkpoints = [];
  let flowState = { flow: {}, prompts: [], handouts: [] };
  let roomState = { rooms: [], messages: [], lastRoomMessageId: 0 };
  let liveStream = null;
  let liveState = 'off';

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

  function getAccountSession() {
    return readJSON(ACCOUNT_KEY, null);
  }

  function saveAccountSession(session) {
    if (!session?.token || !session?.user) localStorage.removeItem(ACCOUNT_KEY);
    else localStorage.setItem(ACCOUNT_KEY, JSON.stringify(session));
    return session;
  }

  function accountRoleToTableRole(role) {
    if (['owner', 'admin', 'warden'].includes(role)) return 'warden';
    if (role === 'spectator') return 'spectator';
    return 'protagonist';
  }

  function effectiveClientId(config = getConfig()) {
    return getAccountSession()?.user?.id || config.clientId;
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
    const account = getAccountSession()?.user || null;
    return {
      clientId: account?.id || config.clientId,
      accountId: account?.id || null,
      name: account?.displayName || overrides.name || config.playerName || defaultPlayerName(),
      role: account ? accountRoleToTableRole(account.role) : syncRoleToTableRole(overrides.role || config.role),
      ready: overrides.ready === undefined ? !!config.ready : !!overrides.ready,
    };
  }

  function canWriteSharedState() {
    const config = getConfig();
    const account = getAccountSession()?.user || null;
    if (account) return ['owner', 'admin', 'warden'].includes(account.role);
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
    const account = getAccountSession();
    const res = await fetch(`${config.apiBase}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(account?.token ? { Authorization: `Bearer ${account.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Sync request failed (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function mergeMessages(incoming = [], payloadLastMessageId = 0) {
    if (incoming.length) {
      const seen = new Set(messages.map(message => message.id));
      messages = [...messages, ...incoming.filter(message => !seen.has(message.id))].slice(-100);
      lastMessageId = Math.max(lastMessageId, payloadLastMessageId || 0, ...incoming.map(message => message.id || 0));
    } else {
      lastMessageId = Math.max(lastMessageId, payloadLastMessageId || 0);
    }
  }

  function mergeEvents(incoming = [], payloadLastEventId = 0) {
    if (incoming.length) {
      const byId = new Map(events.map(event => [event.id, event]));
      incoming.forEach(event => byId.set(event.id, event));
      events = Array.from(byId.values()).sort((a, b) => a.id - b.id).slice(-120);
    }
    lastEventId = Math.max(lastEventId, payloadLastEventId || 0);
  }

  function applyLivePayload(payload = {}) {
    const config = getConfig();
    if (payload.table) {
      lastTable = payload.table;
      if (payload.table.rev > (config.lastRev || 0)) {
        if (payload.table.updatedBy !== effectiveClientId(config)) {
          applySnapshot(payload.table.snapshot);
          lastFingerprint = fingerprint(payload.table.snapshot);
        }
        saveConfig({ ...config, lastRev: payload.table.rev });
      }
      callbacks.onLobby?.(payload.table);
    }
    if (payload.messages) {
      mergeMessages(payload.messages.messages || [], payload.messages.lastMessageId || 0);
      callbacks.onChat?.(messages);
    }
    if (payload.events) {
      mergeEvents(payload.events.events || [], payload.events.lastEventId || 0);
      callbacks.onEvents?.(events);
    }
    if (payload.checkpoints) {
      checkpoints = payload.checkpoints.checkpoints || payload.checkpoints || [];
      callbacks.onCheckpoints?.(checkpoints);
    }
    if (payload.flow) {
      flowState = {
        flow: payload.flow.flow || {},
        prompts: payload.flow.prompts || [],
        handouts: payload.flow.handouts || [],
        lastPromptId: payload.flow.lastPromptId || 0,
        lastHandoutId: payload.flow.lastHandoutId || 0,
      };
      callbacks.onFlow?.(flowState);
    }
    if (payload.rooms) {
      roomState = {
        rooms: payload.rooms.rooms || [],
        messages: payload.rooms.messages || [],
        lastRoomMessageId: payload.rooms.lastRoomMessageId || 0,
      };
      callbacks.onRooms?.(roomState);
    }
    callbacks.onLive?.({ state: liveState, reason: payload.reason || 'sync', sentAt: payload.sentAt || null });
    callbacks.onStatus?.(status());
  }

  function streamUrl(config = getConfig()) {
    const base = new URL(config.apiBase || location.origin, location.href);
    const url = new URL(`/api/tables/${config.code}/stream`, base);
    const account = getAccountSession();
    url.searchParams.set('clientId', effectiveClientId(config));
    url.searchParams.set('role', syncRoleToTableRole(config.role));
    url.searchParams.set('lastMessageId', String(lastMessageId || 0));
    url.searchParams.set('lastEventId', String(lastEventId || 0));
    if (account?.token) url.searchParams.set('token', account.token);
    if (canWriteSharedState()) url.searchParams.set('pending', '1');
    return url.toString();
  }

  function closeLiveStream() {
    if (liveStream) liveStream.close();
    liveStream = null;
    liveState = 'off';
  }

  function openLiveStream() {
    const config = getConfig();
    if (!config.enabled || !config.code || typeof EventSource === 'undefined') {
      closeLiveStream();
      callbacks.onStatus?.(status());
      return;
    }
    if (liveStream) liveStream.close();
    liveState = 'connecting';
    liveStream = new EventSource(streamUrl(config));
    liveStream.addEventListener('open', () => {
      liveState = 'live';
      callbacks.onLive?.({ state: liveState, reason: 'connected' });
      callbacks.onStatus?.(status());
    });
    liveStream.addEventListener('sync', event => {
      liveState = 'live';
      try {
        applyLivePayload(JSON.parse(event.data || '{}'));
      } catch (err) {
        callbacks.onError?.(err);
      }
    });
    liveStream.addEventListener('error', () => {
      liveState = 'reconnecting';
      callbacks.onLive?.({ state: liveState, reason: 'stream-error' });
      callbacks.onStatus?.(status());
    });
  }

  async function createTable(name = 'Velvet Table') {
    const config = getConfig();
    const local = snapshot();
    const player = playerPayload({ role: 'warden' });
    const table = await request('/api/tables', {
      method: 'POST',
      body: JSON.stringify({
        name,
        snapshot: local,
        clientId: player.clientId,
        playerName: player.name || 'Warden',
        role: player.role || 'warden',
      }),
    });
    lastTable = table;
    messages = [];
    lastMessageId = 0;
    events = [];
    lastEventId = 0;
    checkpoints = [];
    flowState = { flow: {}, prompts: [], handouts: [] };
    roomState = { rooms: [], messages: [], lastRoomMessageId: 0 };
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
    checkpoints = [];
    flowState = { flow: {}, prompts: [], handouts: [] };
    roomState = { rooms: [], messages: [], lastRoomMessageId: 0 };
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
    mergeMessages(payload.messages || [], payload.lastMessageId || 0);
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
    mergeMessages(incoming, payload.lastMessageId || 0);
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
    mergeEvents(payload.events || [], payload.lastEventId || 0);
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
    const previousLastEventId = lastEventId;
    const incoming = payload.events || [];
    mergeEvents(incoming, payload.lastEventId || 0);
    if (!incoming.length && payload.event) {
      events = [...events.filter(event => event.id !== payload.event.id), payload.event].sort((a, b) => a.id - b.id).slice(-120);
    }
    if (payload.event?.status === 'pending' && !canWriteSharedState()) {
      lastEventId = Math.max(previousLastEventId, (payload.event.id || 1) - 1);
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
    mergeEvents(incoming, payload.lastEventId || 0);
    if (canWriteSharedState()) await fetchCheckpoints().catch(() => checkpoints);
    callbacks.onEvents?.(events);
    callbacks.onStatus?.(status());
    return payload.event;
  }

  async function updateEventMeta(eventId, meta = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    const payload = await request(`/api/tables/${config.code}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'meta',
        bookmark: meta.bookmark,
        recapHidden: meta.recapHidden,
        category: meta.category,
        player: playerPayload(),
      }),
    });
    mergeEvents(payload.events || [], payload.lastEventId || 0);
    callbacks.onEvents?.(events);
    callbacks.onStatus?.(status());
    return payload.event;
  }

  async function fetchCheckpoints() {
    const config = getConfig();
    if (!config.enabled || !config.code) return [];
    const payload = await request(`/api/tables/${config.code}/checkpoints`);
    checkpoints = payload.checkpoints || [];
    callbacks.onCheckpoints?.(checkpoints);
    callbacks.onStatus?.(status());
    return checkpoints;
  }

  async function createCheckpoint(name = '', note = '', options = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can save checkpoints.');
    const payload = await request(`/api/tables/${config.code}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        note,
        reason: options.reason || 'manual',
        player: playerPayload(),
      }),
    });
    checkpoints = payload.checkpoints || [];
    callbacks.onCheckpoints?.(checkpoints);
    callbacks.onStatus?.(status());
    return payload.checkpoint;
  }

  async function restoreCheckpoint(checkpointId) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can restore checkpoints.');
    const payload = await request(`/api/tables/${config.code}/checkpoints/${encodeURIComponent(checkpointId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'restore',
        player: playerPayload(),
      }),
    });
    checkpoints = payload.checkpoints || [];
    if (payload.table) {
      lastTable = payload.table;
      applySnapshot(payload.table.snapshot);
      saveConfig({ ...config, lastRev: payload.table.rev || config.lastRev || 0 });
      lastFingerprint = fingerprint(payload.table.snapshot);
      callbacks.onLobby?.(payload.table);
    }
    callbacks.onCheckpoints?.(checkpoints);
    callbacks.onStatus?.(status());
    return payload.table || null;
  }

  async function deleteCheckpoint(checkpointId) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can delete checkpoints.');
    const payload = await request(`/api/tables/${config.code}/checkpoints/${encodeURIComponent(checkpointId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ player: playerPayload() }),
    });
    checkpoints = payload.checkpoints || [];
    callbacks.onCheckpoints?.(checkpoints);
    callbacks.onStatus?.(status());
    return checkpoints;
  }

  function applyFlowPayload(payload = {}) {
    flowState = {
      flow: payload.flow || {},
      prompts: payload.prompts || [],
      handouts: payload.handouts || [],
      lastPromptId: payload.lastPromptId || 0,
      lastHandoutId: payload.lastHandoutId || 0,
    };
    callbacks.onFlow?.(flowState);
    callbacks.onStatus?.(status());
    return flowState;
  }

  async function fetchFlow() {
    const config = getConfig();
    if (!config.enabled || !config.code) return flowState;
    const payload = await request(`/api/tables/${config.code}/flow?clientId=${encodeURIComponent(effectiveClientId(config))}`);
    return applyFlowPayload(payload);
  }

  async function setFocus(focusClientId = '', focusNote = '') {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can change spotlight.');
    const payload = await request(`/api/tables/${config.code}/flow`, {
      method: 'PATCH',
      body: JSON.stringify({
        focusClientId,
        focusNote,
        player: playerPayload(),
      }),
    });
    return applyFlowPayload(payload);
  }

  async function sendPrompt(question, options = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can send prompts.');
    const payload = await request(`/api/tables/${config.code}/prompts`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        target: options.target || 'all',
        kind: options.kind || 'freeform',
        player: playerPayload(),
      }),
    });
    return applyFlowPayload(payload);
  }

  async function respondPrompt(promptId, response) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    const payload = await request(`/api/tables/${config.code}/prompts/${encodeURIComponent(promptId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'respond',
        response,
        player: playerPayload(),
      }),
    });
    return applyFlowPayload(payload);
  }

  async function closePrompt(promptId) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can close prompts.');
    const payload = await request(`/api/tables/${config.code}/prompts/${encodeURIComponent(promptId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'close',
        player: playerPayload(),
      }),
    });
    return applyFlowPayload(payload);
  }

  async function sendHandout(title, text, options = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can send handouts.');
    const payload = await request(`/api/tables/${config.code}/handouts`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        text,
        target: options.target || 'all',
        kind: options.kind || 'note',
        player: playerPayload(),
      }),
    });
    return applyFlowPayload(payload);
  }

  function applyRoomsPayload(payload = {}) {
    roomState = {
      rooms: payload.rooms || [],
      messages: payload.messages || [],
      lastRoomMessageId: payload.lastRoomMessageId || 0,
    };
    callbacks.onRooms?.(roomState);
    callbacks.onStatus?.(status());
    return roomState;
  }

  async function fetchRooms() {
    const config = getConfig();
    if (!config.enabled || !config.code) return roomState;
    const payload = await request(`/api/tables/${config.code}/rooms?clientId=${encodeURIComponent(effectiveClientId(config))}`);
    return applyRoomsPayload(payload);
  }

  async function createRoom(name, options = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can create rooms.');
    const payload = await request(`/api/tables/${config.code}/rooms`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        kind: options.kind || 'split',
        members: options.members || ['all'],
        player: playerPayload(),
      }),
    });
    return applyRoomsPayload(payload);
  }

  async function updateRoom(roomId, updates = {}) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    if (!canWriteSharedState()) throw new Error('Only the Warden can update rooms.');
    const payload = await request(`/api/tables/${config.code}/rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...updates,
        player: playerPayload(),
      }),
    });
    return applyRoomsPayload(payload);
  }

  async function sendRoomMessage(roomId, text) {
    const config = getConfig();
    if (!config.enabled || !config.code) throw new Error('Join or create a table first.');
    const payload = await request(`/api/tables/${config.code}/rooms/${encodeURIComponent(roomId || 'main')}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        player: playerPayload(),
      }),
    });
    return applyRoomsPayload(payload);
  }

  async function accountSetupStatus() {
    return request('/api/accounts/setup');
  }

  async function accountBootstrap(input = {}) {
    const payload = await request('/api/accounts/bootstrap', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    saveAccountSession({ token: payload.token, user: payload.user });
    return payload;
  }

  async function accountLogin(username, password) {
    const payload = await request('/api/accounts/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    saveAccountSession({ token: payload.token, user: payload.user });
    const config = getConfig();
    saveConfig({
      ...config,
      playerName: payload.user?.displayName || config.playerName,
      role: accountRoleToTableRole(payload.user?.role || config.role),
    });
    callbacks.onAccount?.(payload.user);
    if (config.enabled && config.code) openLiveStream();
    callbacks.onStatus?.(status());
    return payload;
  }

  async function accountLogout() {
    await request('/api/accounts/logout', { method: 'POST' }).catch(() => null);
    saveAccountSession(null);
    callbacks.onAccount?.(null);
    const config = getConfig();
    if (config.enabled && config.code) openLiveStream();
    callbacks.onStatus?.(status());
  }

  async function accountMe() {
    const payload = await request('/api/accounts/me');
    const session = getAccountSession();
    if (session?.token) saveAccountSession({ token: session.token, user: payload.user });
    callbacks.onAccount?.(payload.user);
    callbacks.onStatus?.(status());
    return payload.user;
  }

  async function accountUsers() {
    return request('/api/accounts/users');
  }

  async function accountSettings() {
    return request('/api/accounts/settings');
  }

  async function accountUpdateSettings(updates = {}) {
    return request('/api/accounts/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async function accountCreateUser(input = {}) {
    return request('/api/accounts/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function accountUpdateUser(userId, updates = {}) {
    return request(`/api/accounts/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async function accountAudit() {
    return request('/api/accounts/audit');
  }

  async function tableDirectory() {
    return request('/api/tables');
  }

  async function tableManage(code, updates = {}) {
    const normalized = String(code || getConfig().code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Enter a table code.');
    const payload = await request(`/api/tables/${normalized}/manage`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (payload.table && normalized === getConfig().code) {
      lastTable = payload.table;
      callbacks.onLobby?.(payload.table);
      callbacks.onStatus?.(status());
    }
    return payload;
  }

  async function tableAudit(code) {
    const normalized = String(code || getConfig().code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Enter a table code.');
    return request(`/api/tables/${normalized}/audit`);
  }

  async function tableKickPlayer(code, playerId) {
    const normalized = String(code || getConfig().code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Enter a table code.');
    if (!playerId) throw new Error('Choose a player to remove.');
    const table = await request(`/api/tables/${normalized}/players/${encodeURIComponent(playerId)}`, {
      method: 'DELETE',
    });
    if (normalized === getConfig().code) {
      lastTable = table;
      callbacks.onLobby?.(table);
      callbacks.onStatus?.(status());
    }
    return table;
  }

  async function tableTransferWarden(code, playerId) {
    return tableManage(code, { transferWardenTo: playerId });
  }

  async function accountInvites() {
    return request('/api/accounts/invites');
  }

  async function accountCreateInvite(input = {}) {
    return request('/api/accounts/invites', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function accountUpdateInvite(code, updates = {}) {
    return request(`/api/accounts/invites/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async function accountAcceptInvite(input = {}) {
    const payload = await request('/api/accounts/invites/accept', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    saveAccountSession({ token: payload.token, user: payload.user });
    const config = getConfig();
    saveConfig({
      ...config,
      playerName: payload.user?.displayName || config.playerName,
      role: accountRoleToTableRole(payload.user?.role || config.role),
    });
    callbacks.onAccount?.(payload.user);
    callbacks.onStatus?.(status());
    return payload;
  }

  function assignedTables() {
    const user = getAccountSession()?.user || null;
    if (!user) return [];
    if (['owner', 'admin'].includes(user.role)) return [];
    return Array.isArray(user.tableCodes) ? user.tableCodes : [];
  }

  async function updatePlayer(updates = {}) {
    const config = getConfig();
    if (!config.code) throw new Error('Join or create a table first.');
    const roleChanged = updates.role !== undefined && syncRoleToTableRole(updates.role) !== syncRoleToTableRole(config.role);
    const nextConfig = saveConfig({
      ...config,
      playerName: updates.name || config.playerName || defaultPlayerName(),
      role: updates.role || config.role,
      ready: updates.ready === undefined ? !!config.ready : !!updates.ready,
    });
    const table = await request(`/api/tables/${config.code}/players/${encodeURIComponent(effectiveClientId(config))}`, {
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
    if (roleChanged) openLiveStream();
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
      if (table.updatedBy !== effectiveClientId(config)) {
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
    const player = playerPayload();
    const table = await request(`/api/tables/${config.code}`, {
      method: 'PUT',
      body: JSON.stringify({
        snapshot: local,
        baseRev: config.lastRev || 0,
        clientId: player.clientId,
        player,
      }),
    });
    lastTable = table;
    saveConfig({ ...config, lastRev: table.rev });
    lastFingerprint = current;
    await fetchCheckpoints().catch(() => checkpoints);
    callbacks.onStatus?.(status());
    return table;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const liveActive = liveState === 'live';
      if (!liveActive) await pull();
      await heartbeat();
      if (!liveActive) {
        await fetchMessages();
        await fetchEvents();
        if (!checkpoints.length && canWriteSharedState()) await fetchCheckpoints();
        await fetchFlow();
        await fetchRooms();
      }
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
    if (config.enabled && config.code) {
      openLiveStream();
      timer = setInterval(tick, 2000);
    } else {
      closeLiveStream();
    }
    callbacks.onStatus?.(status());
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    closeLiveStream();
    const config = getConfig();
    saveConfig({ ...config, enabled: false });
    callbacks.onStatus?.(status());
  }

  function status() {
    const config = getConfig();
    const account = getAccountSession()?.user || null;
    return {
      enabled: !!config.enabled,
      code: config.code || '',
      apiBase: config.apiBase,
      lastRev: config.lastRev || 0,
      clientId: effectiveClientId(config),
      playerName: account?.displayName || config.playerName || defaultPlayerName(),
      role: account ? accountRoleToTableRole(account.role) : syncRoleToTableRole(config.role || localStorage.getItem('vg_role')),
      account,
      ready: !!config.ready,
      canWriteSharedState: canWriteSharedState(),
      locked: !!lastTable?.locked,
      archived: !!lastTable?.archived,
      liveState,
      liveConnected: liveState === 'live',
      permissions: lastTable?.permissions || null,
      messages,
      lastMessageId,
      events,
      lastEventId,
      checkpoints,
      flow: flowState.flow || {},
      prompts: flowState.prompts || [],
      handouts: flowState.handouts || [],
      rooms: roomState.rooms || [],
      roomMessages: roomState.messages || [],
      lastRoomMessageId: roomState.lastRoomMessageId || 0,
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
    updateEventMeta,
    fetchCheckpoints,
    createCheckpoint,
    restoreCheckpoint,
    deleteCheckpoint,
    fetchFlow,
    setFocus,
    sendPrompt,
    respondPrompt,
    closePrompt,
    sendHandout,
    fetchRooms,
    createRoom,
    updateRoom,
    sendRoomMessage,
    getAccountSession,
    accountSetupStatus,
    accountBootstrap,
    accountLogin,
    accountLogout,
    accountMe,
    accountUsers,
    accountSettings,
    accountUpdateSettings,
    accountCreateUser,
    accountUpdateUser,
    accountAudit,
    accountInvites,
    accountCreateInvite,
    accountUpdateInvite,
    accountAcceptInvite,
    assignedTables,
    tableDirectory,
    tableManage,
    tableAudit,
    tableKickPlayer,
    tableTransferWarden,
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
