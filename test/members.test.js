const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');

test('members-only invitations, protected play, durable saves, and revocation', { timeout: 45000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-members-test-'));
  const emails = [];
  const smtp = net.createServer(socket => {
    socket.write('220 localhost ESMTP test\r\n');
    let buffer = '', readingMessage = false, message = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (readingMessage) {
          if (line === '.') { emails.push(message); message = ''; readingMessage = false; socket.write('250 queued\r\n'); }
          else message += `${line}\r\n`;
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (/^DATA/i.test(line)) { readingMessage = true; socket.write('354 Send message\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.end('221 Bye\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  smtp.listen(0, '127.0.0.1'); await once(smtp, 'listening');
  const reserve = net.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let server, output = '';
  async function start() {
    server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, NODE_ENV: 'test', BOOTSTRAP_TOKEN: 'test-bootstrap-only', SMTP_TEST_MODE: '1', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASSWORD: 'smtp-test-password' }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', b => { output += b; }); server.stderr.on('data', b => { output += b; });
    const until = Date.now() + 5000;
    while (Date.now() < until) { if (server.exitCode !== null) throw Error(output); try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 30)); }
    throw Error(`Startup failed: ${output}`);
  }
  async function stop() { const child = server; if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
  t.after(async () => { await stop(); await new Promise(resolve => smtp.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  await start();
  async function api(route, { cookie = '', method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, { method, redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  assert.equal((await api('/api/accounts/bootstrap', { method: 'POST', body: {} })).status, 403);
  const owner = await api('/api/accounts/bootstrap', { method: 'POST', headers: { 'x-bootstrap-token': 'test-bootstrap-only' }, body: { username: 'owner', email: 'owner@example.test', displayName: 'Test Owner', password: 'Owner-password-12345' } });
  assert.equal(owner.status, 201, JSON.stringify(owner.data)); assert.match(owner.headers.get('set-cookie'), /HttpOnly/); assert.equal(owner.data.token, undefined);
  const ownerCookie = owner.cookie;
  const snapshot = { keys: { vg_campaigns: JSON.stringify([{ id: 'campaign', name: 'Saved Campaign', notes: 'WARDEN_SECRET', scenes: [{ id: 'current', title: 'Current Scene', narrative: 'Shared story', npcCue: 'Shared cue', branches: {} }, { id: 'future', title: 'FUTURE_SECRET', narrative: 'UNREVEALED_SECRET' }] }]), vg_session: JSON.stringify({ id: 'session', campaignId: 'campaign', currentSceneId: 'current', history: [] }), vg_maps: '[]' } };
  const created = await api('/api/tables', { cookie: ownerCookie, method: 'POST', body: { name: 'Saved Table', snapshot } });
  assert.equal(created.status, 201, JSON.stringify(created.data)); const table = `/api/tables/${created.data.code}`;
  assert.equal((await api(table)).status, 401);
  assert.equal((await api('/admin/')).status, 303);
  assert.equal((await api('/api/accounts/users', { cookie: ownerCookie, method: 'POST', body: { username: 'signup' } })).status, 405);
  assert.equal((await api('/api/accounts/settings', { cookie: ownerCookie, method: 'PATCH', body: { allowGuestJoins: true } })).status, 400);
  const invitation = await api('/api/accounts/invites', { cookie: ownerCookie, method: 'POST', body: { email: 'member@example.test', displayName: 'Test Member', role: 'player', tableCodes: [created.data.code] } });
  assert.equal(invitation.status, 201, JSON.stringify(invitation.data)); assert.equal(emails.length, 1); assert.equal(invitation.data.invite.tokenHash, undefined);
  const decoded = emails[0].replace(/=\r\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const token = decoded.match(/#invite=([a-f0-9]{64})/)?.[1]; assert.ok(token, decoded);
  assert.equal((await api('/api/accounts/invites/accept', { method: 'POST', body: { token, email: 'other@example.test', displayName: 'Other', password: 'Member-password-12345', adultConfirmed: true } })).status, 400);
  assert.equal((await api('/api/accounts/invites/accept', { method: 'POST', body: { token, email: 'member@example.test', password: 'x', adultConfirmed: true } })).status, 400);
  const accepted = await api('/api/accounts/invites/accept', { method: 'POST', body: { token, email: 'member@example.test', displayName: 'Test Member', password: 'Member-password-12345', adultConfirmed: true } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data)); const memberCookie = accepted.cookie; const memberId = accepted.data.user.id;
  assert.equal((await api('/api/accounts/invites/accept', { method: 'POST', body: { token } })).status, 404);
  const directoryResult = await api('/api/tables', { cookie: memberCookie }); assert.equal(directoryResult.status, 200); assert.equal(directoryResult.data.tables.length, 1);
  const joined = await api(`${table}/players`, { cookie: memberCookie, method: 'POST', body: {} }); assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.ok(!JSON.stringify(joined.data).includes('WARDEN_SECRET')); assert.ok(!JSON.stringify(joined.data).includes('UNREVEALED_SECRET')); assert.ok(JSON.stringify(joined.data).includes('Shared story'));
  assert.equal((await api(table, { cookie: memberCookie, method: 'PUT', body: { clientId: owner.data.user.id, role: 'warden', baseRev: created.data.rev, snapshot } })).status, 403);
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { role: 'warden', type: 'table.archived' } })).status, 403);
  assert.equal((await api('/api/accounts/users', { cookie: memberCookie })).status, 403);
  const checkpoints = await api(`${table}/checkpoints`, { cookie: memberCookie }); assert.ok(!JSON.stringify(checkpoints.data).includes('WARDEN_SECRET'));
  const privateRoom = await api(`${table}/rooms/warden/messages`, { cookie: ownerCookie, method: 'POST', body: { text: 'ROOM_SECRET' } }); assert.equal(privateRoom.status, 201);
  assert.ok(!JSON.stringify((await api(`${table}/rooms?clientId=${owner.data.user.id}`, { cookie: memberCookie })).data).includes('ROOM_SECRET'));
  const hold = await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'safety.signal', detail: { tier: 'hold' } } }); assert.equal(hold.status, 201, JSON.stringify(hold.data));
  const held = await api(table, { cookie: ownerCookie }); assert.equal(held.data.status, 'paused'); assert.equal(JSON.parse(held.data.snapshot.keys.vg_signals).at(-1).tier, 'hold');
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'movement.request' } })).status, 409);
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'safety.signal', detail: { tier: 'resume' } } })).status, 403);
  assert.equal((await api(`${table}/events`, { cookie: ownerCookie, method: 'POST', body: { type: 'safety.signal', detail: { tier: 'resume' } } })).status, 201);
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'intimacy.message', detail: { message: 'Saved player message', mode: 'spoken' } } })).status, 201);
  assert.ok((await api(table, { cookie: ownerCookie })).data.snapshot.keys.vg_intimacy_chat.includes('Saved player message'));
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'intimacy.card', detail: { card: { note: 'PRIVATE_CARD' } } } })).status, 201);
  assert.ok(!JSON.stringify((await api(table, { cookie: ownerCookie })).data).includes('PRIVATE_CARD'));
  assert.ok(JSON.stringify((await api(table, { cookie: memberCookie })).data).includes('PRIVATE_CARD'));
  assert.equal((await api(`${table}/events`, { cookie: memberCookie, method: 'POST', body: { type: 'safety.threshold', detail: { threshold: { red: 'PERSONAL_THRESHOLD' } } } })).status, 201);
  assert.ok(!JSON.stringify((await api(table, { cookie: ownerCookie })).data).includes('PERSONAL_THRESHOLD'));
  const stale = await api(table, { cookie: ownerCookie, method: 'PUT', body: { baseRev: 0, snapshot } }); assert.equal(stale.status, 409);
  const before = await api(table, { cookie: ownerCookie });
  assert.equal((await api(table, { cookie: ownerCookie, method: 'PUT', body: { baseRev: before.data.rev, snapshot } })).status, 200);
  assert.ok((await api(table, { cookie: ownerCookie })).data.snapshot.keys.vg_intimacy_chat.includes('Saved player message'));

  const pending = http.request(`${base}${table}/presence`, { method: 'POST', headers: { Cookie: memberCookie, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } });
  const pendingDone = new Promise((resolve, reject) => { pending.on('error', reject); pending.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); });
  pending.write('{"ready":'); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await api(`${table}/messages`, { cookie: memberCookie, method: 'POST', body: { text: 'CONCURRENT_SAVED_MESSAGE' } })).status, 201);
  pending.end('true}'); assert.equal(await pendingDone, 200);
  assert.ok(JSON.stringify((await api(`${table}/messages`, { cookie: memberCookie })).data).includes('CONCURRENT_SAVED_MESSAGE'));

  const stream = await fetch(`${base}${table}/stream`, { headers: { Cookie: memberCookie } }); const reader = stream.body.getReader(); await reader.read();
  assert.equal((await api('/api/accounts/logout', { cookie: memberCookie, method: 'POST' })).status, 200);
  const ended = await reader.read(); assert.equal(ended.done, true); await reader.cancel();
  const memberLogin = await api('/api/accounts/login', { method: 'POST', body: { email: 'member@example.test', password: 'Member-password-12345' } }); assert.equal(memberLogin.status, 200);
  assert.equal((await api(`${table}/manage`, { cookie: ownerCookie, method: 'PATCH', body: { status: 'paused' } })).status, 200);
  await stop(); await start();
  const restored = await api(table, { cookie: ownerCookie }); assert.equal(restored.status, 200); assert.equal(restored.data.name, 'Saved Table'); assert.equal(restored.data.status, 'paused'); assert.ok(restored.data.savedAt); assert.ok(restored.data.snapshot.keys.vg_intimacy_chat.includes('Saved player message'));
  assert.equal((await api(`${table}/players/${memberId}`, { cookie: ownerCookie, method: 'DELETE' })).status, 200);
  assert.equal((await api(`${table}/presence`, { cookie: memberLogin.cookie, method: 'POST', body: {} })).status, 403);
  for (const file of ['/server.js', '/server-data/accounts.json', '/lib/store.js', '/.git/config']) assert.equal((await api(file)).status, 404);
  assert.equal((await api('/api/accounts/users/' + owner.data.user.id, { cookie: ownerCookie, method: 'PATCH', body: { active: false } })).status, 409);
});

test('legacy data migrates once and SQLite backups restore saved state', async () => {
  const openStore = require('../lib/store');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-migration-test-'));
  const restoredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-restore-test-'));
  let store, restored;
  try {
    fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify({ users: { owner: { id: 'owner', role: 'owner', active: true, tableCodes: [] } }, sessions: {}, invites: { OLD: { active: true } }, userSeq: 1 }));
    fs.writeFileSync(path.join(directory, 'tables.json'), JSON.stringify({ tables: { ABC123: { code: 'ABC123', players: { guest: { id: 'guest', role: 'warden' } }, snapshot: { keys: { vg_session: 'SAVED_STATE' } }, events: [{ id: 1, type: 'table.created' }] } } }));
    store = openStore(directory);
    const table = store.readTables().tables.ABC123;
    assert.equal(table.snapshot.keys.vg_session, 'SAVED_STATE'); assert.equal(table.wardenId, 'owner'); assert.equal(table.players.guest, undefined);
    assert.equal(store.readAccounts().settings.allowGuestJoins, false); assert.equal(store.readAccounts().invites.OLD.active, false);
    await store.backup(path.join(restoredDir, 'velvet.sqlite'));
    restored = openStore(restoredDir); assert.equal(restored.readTables().tables.ABC123.snapshot.keys.vg_session, 'SAVED_STATE'); assert.equal(restored.readTables().tables.ABC123.events[0].id, 1);
    store.close(); store = null;
    fs.writeFileSync(path.join(directory, 'tables.json'), 'invalid stale legacy file');
    store = openStore(directory); assert.equal(store.readTables().tables.ABC123.snapshot.keys.vg_session, 'SAVED_STATE');
  } finally {
    store?.close(); restored?.close(); fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(restoredDir, { recursive: true, force: true });
  }
});
