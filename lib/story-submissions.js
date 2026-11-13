const crypto = require('node:crypto');
const FIELDS = ['premise', 'setting', 'mood', 'scope', 'heroes', 'characters', 'hook', 'encounters', 'choices', 'endings', 'boundaries', 'notes'];
const STATUSES = ['submitted', 'reviewing', 'developing', 'completed'];
module.exports = function createStorySubmissions({ store, send, readBody }) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS story_submissions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL, json TEXT NOT NULL, UNIQUE(user_id, request_id)
  ); CREATE INDEX IF NOT EXISTS story_submissions_user ON story_submissions(user_id, created_at);`);
  const get = store.db.prepare('SELECT json FROM story_submissions WHERE id = ?');
  const duplicate = store.db.prepare('SELECT json FROM story_submissions WHERE user_id = ? AND request_id = ?');
  const insert = store.db.prepare('INSERT INTO story_submissions VALUES (?, ?, ?, ?, ?)');
  const update = store.db.prepare('UPDATE story_submissions SET json = ? WHERE id = ?');
  const reviewer = user => ['owner', 'admin'].includes(user?.role);
  const visible = (story, user) => {
    if (!reviewer(user)) { const { reviewNotes, ...publicStory } = story; return publicStory; }
    return story;
  };
  return async function handle(req, res, pathname, user) {
    if (!user) return send(res, 401, { error: 'Sign in to continue.' });
    const match = pathname.match(/^\/api\/story-submissions(?:\/([a-f0-9-]{36}))?$/);
    if (!match) return send(res, 404, { error: 'Submission not found.' });
    const id = match[1];
    if (!id && req.method === 'GET') {
      const rows = reviewer(user)
        ? store.db.prepare('SELECT json FROM story_submissions ORDER BY created_at DESC').all()
        : store.db.prepare('SELECT json FROM story_submissions WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      return send(res, 200, { canReview: reviewer(user), submissions: rows.map(r => visible(JSON.parse(r.json), user)) });
    }
    if (!id && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Please complete the story form.' });
      if (typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.requestId)) return send(res, 400, { error: 'Refresh the form and try again.' });
      const old = duplicate.get(user.id, body.requestId);
      if (old) return send(res, 200, { submission: visible(JSON.parse(old.json), user) });
      const answers = {};
      for (const key of ['title', 'author', ...FIELDS]) {
        const value = body[key] ?? '';
        const max = ['title', 'author'].includes(key) ? 160 : 5000;
        if (typeof value !== 'string' || value.length > max) return send(res, 400, { error: `${key}: use no more than ${max} characters.` });
        answers[key] = value.trim();
      }
      if (!answers.premise) return send(res, 400, { error: 'Give your adventure a spark: add a story idea.' });
      const now = new Date().toISOString();
      const story = { id: crypto.randomUUID(), userId: user.id, memberName: user.displayName || user.username, ...answers, title: answers.title || 'An untitled adventure', status: 'submitted', createdAt: now, updatedAt: now, reviewNotes: '' };
      insert.run(story.id, user.id, body.requestId, now, JSON.stringify(story));
      return send(res, 201, { submission: visible(story, user) });
    }
    if (id) {
      const row = get.get(id); const story = row && JSON.parse(row.json);
      if (!story || (!reviewer(user) && story.userId !== user.id)) return send(res, 404, { error: 'Submission not found.' });
      if (req.method === 'GET') return send(res, 200, { submission: visible(story, user) });
      if (req.method === 'PATCH') {
        if (!reviewer(user)) return send(res, 403, { error: 'Administrator access required.' });
        const body = await readBody(req);
        if (!body || !STATUSES.includes(body.status) || typeof body.reviewNotes !== 'string' || body.reviewNotes.length > 10000) return send(res, 400, { error: 'Choose a valid status and keep review notes under 10,000 characters.' });
        if (body.updatedAt !== story.updatedAt) return send(res, 409, { error: 'This tale changed since you opened it. Refresh before saving.' });
        story.status = body.status; story.reviewNotes = body.reviewNotes;
        story.updatedAt = new Date(Math.max(Date.now(), Date.parse(story.updatedAt) + 1)).toISOString();
        story.reviewedBy = user.id;
        update.run(JSON.stringify(story), id);
        return send(res, 200, { submission: story });
      }
    }
    return send(res, 405, { error: 'Method not allowed.' });
  };
};
