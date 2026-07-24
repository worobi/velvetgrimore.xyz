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
      body: JSON.stringify({ name, snapshot: local, clientId: config.clientId }),
    });
    const next = saveConfig({ ...config, enabled: true, code: table.code, lastRev: table.rev });
    lastFingerprint = fingerprint(local);
    start(callbacks);
    callbacks.onStatus?.(status());
    return { table, config: next };
  }

  async function joinTable(code) {
    const config = getConfig();
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) throw new Error('Enter a table code.');
    const table = await request(`/api/tables/${normalized}`);
    applySnapshot(table.snapshot);
    const next = saveConfig({ ...config, enabled: true, code: table.code, lastRev: table.rev });
    lastFingerprint = fingerprint(table.snapshot);
    start(callbacks);
    callbacks.onStatus?.(status());
    return { table, config: next };
  }

  async function pull() {
    const config = getConfig();
    if (!config.enabled || !config.code) return null;
    const table = await request(`/api/tables/${config.code}`);
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
    const local = snapshot();
    const current = fingerprint(local);
    if (current === lastFingerprint) return null;
    const table = await request(`/api/tables/${config.code}`, {
      method: 'PUT',
      body: JSON.stringify({
        snapshot: local,
        baseRev: config.lastRev || 0,
        clientId: config.clientId,
      }),
    });
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
    pull,
    push,
    tick,
    start,
    stop,
    status,
  };
})();

window.VGSync = VGSync;
