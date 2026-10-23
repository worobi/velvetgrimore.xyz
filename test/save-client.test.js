const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('flush waits for an in-flight save and includes the newest browser edits', async () => {
  const data = new Map([
    ['vg_account_session', JSON.stringify({ user: { id: 'owner', role: 'owner', displayName: 'Owner' } })],
    ['vg_sync_config', JSON.stringify({ enabled: true, apiBase: 'http://example.test', code: 'ABC123', clientId: 'owner', lastRev: 1 })],
    ['vg_campaigns', 'before'],
  ]);
  const writes = [];
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    URL, CustomEvent, setInterval: () => 1, clearInterval() {}, console,
    location: { origin: 'http://example.test', href: 'http://example.test/admin/', pathname: '/admin/' },
    window: { dispatchEvent() {} },
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) },
    fetch: async (url, options) => {
      let response = { checkpoints: [] };
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body); writes.push(body);
        if (writes.length === 1) await firstWrite;
        response = { code: 'ABC123', rev: writes.length + 1, snapshot: body.snapshot, permissions: { role: 'warden', canWriteSharedState: true } };
      }
      return { ok: true, json: async () => response };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../engine/sync.js'), 'utf8'), context);
  const sync = context.window.VGSync;
  sync.start();
  data.set('vg_campaigns', 'first edit');
  const saving = sync.push();
  data.set('vg_campaigns', 'newest edit');
  const flushing = sync.flush();
  release();
  await Promise.all([saving, flushing]);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].snapshot.keys.vg_campaigns, 'newest edit');
  assert.equal(writes[1].baseRev, 2);
});
