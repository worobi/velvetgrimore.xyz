const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createStories = require('../lib/story-submissions');
// Prefer the production SQLite driver; Node's built-in driver also exercises the same SQL.
let Database; try { Database = require('better-sqlite3'); } catch { Database = require('node:sqlite').DatabaseSync; }
test('private story submissions survive restart and enforce review permissions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-stories-'));
  let db;
  const open = () => { db = new Database(path.join(directory, 'stories.sqlite')); return createStories({ store: { db }, readBody: req => req.body, send: (_, status, data) => ({ status, data }) }); };
  let api = open();
  const player = { id: 'p1', role: 'player', displayName: 'Storyteller' }, other = { id: 'p2', role: 'warden' }, admin = { id: 'a1', role: 'owner' };
  const call = (user, method, body, suffix = '') => api({ method, body }, {}, `/api/story-submissions${suffix}`, user);
  const body = { requestId: crypto.randomUUID(), title: '<script>unsafe</script>', premise: 'A haunted archive', boundaries: 'No gore' };
  try {
    assert.equal((await call(null, 'POST', body)).status, 401);
    assert.equal((await call(player, 'POST', { ...body, premise: ' ' })).status, 400);
    assert.equal((await call(player, 'POST', { ...body, notes: 'x'.repeat(5001) })).status, 400);
    const created = await call(player, 'POST', { ...body, status: 'completed', userId: 'a1', reviewNotes: 'injected' });
    assert.equal(created.status, 201);
    let story = created.data.submission; const suffix = `/${story.id}`;
    assert.equal(story.userId, player.id); assert.equal(story.status, 'submitted'); assert.equal(story.reviewNotes, undefined);
    assert.equal((await call(player, 'POST', body)).data.submission.id, story.id);
    assert.equal((await call(other, 'GET')).data.submissions.length, 0);
    assert.equal((await call(other, 'GET', null, suffix)).status, 404);
    assert.equal((await call(player, 'PATCH', { status: 'reviewing', reviewNotes: '', updatedAt: story.updatedAt }, suffix)).status, 403);
    assert.equal((await call(admin, 'PATCH', { status: 'invalid', reviewNotes: '' }, suffix)).status, 400);
    const update = { status: 'developing', reviewNotes: 'Private development plan', updatedAt: story.updatedAt };
    story = (await call(admin, 'PATCH', update, suffix)).data.submission;
    assert.equal(story.status, 'developing');
    assert.equal((await call(admin, 'PATCH', update, suffix)).status, 409);
    assert.equal((await call(player, 'GET', null, suffix)).data.submission.reviewNotes, undefined);
    assert.equal((await call(player, 'GET')).data.submissions[0].reviewNotes, undefined);
    db.close(); api = open();
    const restored = (await call(admin, 'GET')).data;
    assert.equal(restored.canReview, true); assert.equal(restored.submissions.length, 1);
    assert.equal(restored.submissions[0].reviewNotes, 'Private development plan');
    assert.equal((await call(player, 'GET')).data.submissions[0].status, 'developing');
    assert.equal((await call(admin, 'DELETE', null, suffix)).status, 405);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
