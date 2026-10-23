const crypto = require('crypto');

const ROLES = new Set(['owner', 'admin', 'warden', 'player', 'spectator']);
const cookieName = 'vg_session';
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const email = value => String(value || '').trim().toLowerCase();
const validEmail = value => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 256;

module.exports = function membersAPI(ctx) {
  const { readAccounts, writeAccounts, safeUser, hashPassword, verifyPassword, createSession, addAudit, send, readBody, mail, closeSessions } = ctx;
  const admin = user => ['owner', 'admin'].includes(user?.role);
  const tableCodes = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(v => String(v).trim().toUpperCase()).filter(v => /^[A-Z0-9]{4,10}$/.test(v)))].slice(0, 40);
  const publicInvite = invite => ({ id: invite.id, email: invite.email, displayName: invite.displayName, role: invite.role, tableCodes: invite.tableCodes, active: invite.active, expiresAt: invite.expiresAt, usedAt: invite.usedAt || null, delivery: invite.delivery });
  function token(req) {
    const header = String(req.headers.authorization || '');
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    return String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  }
  function auth(req, accounts = readAccounts()) {
    const value = token(req);
    const session = accounts.sessions?.[value];
    const user = accounts.users?.[session?.userId];
    if (!session || !user || user.active === false || Date.parse(session.expiresAt) <= Date.now()) return null;
    return { user, token: value, session };
  }
  function setCookie(req, res, value, maxAge = 14 * 24 * 60 * 60) {
    const secure = process.env.NODE_ENV === 'production' || String(req.headers['x-forwarded-proto']).split(',')[0] === 'https';
    res.setHeader('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function revoke(accounts, userId) {
    for (const [key, session] of Object.entries(accounts.sessions)) if (session.userId === userId) delete accounts.sessions[key];
    closeSessions(userId);
  }
  function grantable(actor, role) {
    return ROLES.has(role) && role !== 'owner' && (role !== 'admin' || actor.role === 'owner');
  }
  async function handle(req, res, pathname) {
    const accounts = readAccounts();
    accounts.invites ||= {}; accounts.audit ||= []; accounts.sessions ||= {};
    const current = auth(req, accounts);
    const body = await readBody(req);
    const reply = (status, data) => send(res, status, data);
    const requireAdmin = () => current && admin(current.user);
    if (pathname === '/api/accounts/setup' && req.method === 'GET') {
      return reply(200, { needsSetup: Object.keys(accounts.users).length === 0, membersOnly: true, settings: { allowGuestJoins: false } });
    }
    if (pathname === '/api/accounts/bootstrap' && req.method === 'POST') {
      const expected = process.env.BOOTSTRAP_TOKEN;
      if (!expected || req.headers['x-bootstrap-token'] !== expected || Object.keys(accounts.users).length) return reply(403, { error: 'Account creation is by email invitation only.' });
      if (!validPassword(body.password)) return reply(400, { error: 'Use a password between 12 and 256 characters.' });
      const id = `user-${++accounts.userSeq}`;
      const hashed = hashPassword(body.password);
      const user = { id, username: String(body.username || 'owner').toLowerCase(), email: email(body.email), displayName: String(body.displayName || 'Owner').slice(0, 80), role: 'owner', active: true, tableCodes: [], mustResetPassword: false, passwordHash: hashed.hash, passwordSalt: hashed.salt, passwordIterations: hashed.iterations, createdAt: new Date().toISOString() };
      accounts.users[id] = user;
      const session = createSession(accounts, user);
      writeAccounts(accounts); setCookie(req, res, session);
      return reply(201, { user: safeUser(user) });
    }
    if (pathname === '/api/accounts/login' && req.method === 'POST') {
      const identifier = email(body.email || body.username);
      const user = Object.values(accounts.users).find(u => (u.email && email(u.email) === identifier) || u.username === identifier);
      if (!user || user.active === false || !verifyPassword(String(body.password || '').slice(0, 257), user)) return reply(401, { error: 'Email or password is incorrect.' });
      const session = createSession(accounts, user);
      addAudit(accounts, user, 'account.login', {});
      writeAccounts(accounts); setCookie(req, res, session);
      return reply(200, { user: safeUser(user) });
    }
    if (pathname === '/api/accounts/invites/preview' && req.method === 'POST') {
      const invite = Object.values(accounts.invites).find(i => i.tokenHash && i.tokenHash === digest(body.token));
      if (!invite || !invite.active || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) return reply(404, { error: 'This invitation has expired, was withdrawn, or has already been used. Ask the Warden for a new one.' });
      return reply(200, { email: invite.email, displayName: invite.displayName, expiresAt: invite.expiresAt });
    }
    if (pathname === '/api/accounts/invites/accept' && req.method === 'POST') {
      const invite = Object.values(accounts.invites).find(i => i.tokenHash && i.tokenHash === digest(body.token));
      if (!invite || !invite.active || invite.usedAt || Date.parse(invite.expiresAt) <= Date.now()) return reply(404, { error: 'This invitation is no longer available. Ask the Warden for a new one.' });
      if (email(body.email) !== invite.email) return reply(400, { error: 'Use the email address this invitation was sent to.' });
      if (!validPassword(body.password)) return reply(400, { error: 'Use a password between 12 and 256 characters.' });
      if (body.adultConfirmed !== true) return reply(400, { error: 'Confirm you are 18 or older before creating your account.' });
      if (Object.values(accounts.users).some(u => u.email && email(u.email) === invite.email)) return reply(409, { error: 'This email already has a member account. Sign in instead.' });
      const name = String(body.displayName || invite.displayName || '').trim().slice(0, 80);
      if (name.length < 2) return reply(400, { error: 'Enter your display name.' });
      const id = `user-${++accounts.userSeq}`;
      const hashed = hashPassword(body.password);
      const user = { id, email: invite.email, username: invite.email, displayName: name, role: invite.role, tableCodes: tableCodes(invite.tableCodes), active: true, mustResetPassword: false, emailVerifiedAt: new Date().toISOString(), adultConfirmedAt: new Date().toISOString(), createdAt: new Date().toISOString(), passwordHash: hashed.hash, passwordSalt: hashed.salt, passwordIterations: hashed.iterations };
      accounts.users[id] = user; invite.active = false; invite.usedAt = new Date().toISOString(); invite.usedBy = id;
      const session = createSession(accounts, user);
      addAudit(accounts, user, 'invite.accepted', { inviteId: invite.id });
      writeAccounts(accounts); setCookie(req, res, session);
      return reply(201, { user: safeUser(user) });
    }
    if (pathname === '/api/accounts/logout' && req.method === 'POST') {
      if (current) { delete accounts.sessions[current.token]; closeSessions(current.user.id, current.token); writeAccounts(accounts); }
      setCookie(req, res, '', 0);
      return reply(200, { ok: true });
    }
    if (!current) return reply(401, { error: 'Sign in to continue.' });
    if (pathname === '/api/accounts/me' && req.method === 'GET') {
      setCookie(req, res, current.token);
      return reply(200, { user: safeUser(current.user) });
    }
    if (pathname === '/api/accounts/password' && req.method === 'POST') {
      if (!verifyPassword(body.currentPassword, current.user)) return reply(400, { error: 'Your current password is incorrect.' });
      if (!validPassword(body.newPassword)) return reply(400, { error: 'Use a password between 12 and 256 characters.' });
      const hashed = hashPassword(body.newPassword);
      Object.assign(current.user, { passwordHash: hashed.hash, passwordSalt: hashed.salt, passwordIterations: hashed.iterations, mustResetPassword: false, updatedAt: new Date().toISOString() });
      revoke(accounts, current.user.id);
      const session = createSession(accounts, current.user);
      addAudit(accounts, current.user, 'account.password_changed', {});
      writeAccounts(accounts); setCookie(req, res, session);
      return reply(200, { user: safeUser(current.user) });
    }
    if (current.user.mustResetPassword) return reply(428, { error: 'Change your temporary password to continue.', mustResetPassword: true });
    if (!requireAdmin()) return reply(403, { error: 'Member administrator access is required.' });
    if (pathname === '/api/accounts/settings') {
      if (req.method !== 'GET') return reply(400, { error: 'This is a members-only installation. Guest access is disabled.' });
      return reply(200, { settings: { allowGuestJoins: false, membersOnly: true } });
    }
    if (pathname === '/api/accounts/mail') {
      if (current.user.role !== 'owner') return reply(403, { error: 'Only the owner can configure invitation email.' });
      if (req.method === 'GET') return reply(200, { mail: mail.status() });
      if (req.method === 'PUT') {
        try {
          const status = await mail.configure(body);
          addAudit(accounts, current.user, 'mail.configured', {}); writeAccounts(accounts);
          return reply(200, { mail: status });
        } catch { return reply(400, { error: 'Spacemail could not verify this mailbox password. Check the password and that SMTP access is enabled in Spacemail.' }); }
      }
    }
    if (pathname === '/api/accounts/invites' && req.method === 'GET') return reply(200, { invites: Object.values(accounts.invites).filter(i => i.email).map(publicInvite).reverse() });
    if (pathname === '/api/accounts/invites' && req.method === 'POST') {
      const recipient = email(body.email);
      if (!validEmail(recipient)) return reply(400, { error: 'Enter a valid invitation email address.' });
      if (!grantable(current.user, body.role || 'player')) return reply(403, { error: 'You cannot grant that account role.' });
      if (!mail.status().configured) return reply(503, { error: 'Invitation email needs to be connected by the owner first.' });
      if (Object.values(accounts.users).some(u => email(u.email) === recipient)) return reply(409, { error: 'This email already belongs to a member.' });
      const codes = tableCodes(body.tableCodes);
      const existing = ctx.readTables().tables;
      if (codes.some(code => !existing[code] || existing[code].archived)) return reply(400, { error: 'Choose an active table for the invitation.' });
      const secret = crypto.randomBytes(32).toString('hex');
      const id = crypto.randomUUID();
      const invite = { id, email: recipient, displayName: String(body.displayName || '').trim().slice(0, 80), role: body.role || 'player', tableCodes: codes, tokenHash: digest(secret), active: false, createdAt: new Date().toISOString(), createdBy: current.user.id, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), delivery: 'sending' };
      const url = `${ctx.publicUrl(req)}/#invite=${secret}`;
      try {
        await mail.invite(recipient, url, invite.displayName);
        for (const old of Object.values(accounts.invites)) if (old.email === recipient && !old.usedAt) old.active = false;
        invite.active = true; invite.delivery = 'sent';
        accounts.invites[id] = invite;
        addAudit(accounts, current.user, 'invite.sent', { inviteId: id, email: recipient }); writeAccounts(accounts);
        return reply(201, { invite: publicInvite(invite) });
      } catch {
        invite.delivery = 'failed'; accounts.invites[id] = invite; writeAccounts(accounts);
        return reply(502, { error: 'The invitation could not be sent. No active invitation was created. Check the mailbox connection and try again.' });
      }
    }
    const inviteMatch = pathname.match(/^\/api\/accounts\/invites\/([a-f0-9-]+)$/i);
    if (inviteMatch && req.method === 'PATCH') {
      const invite = accounts.invites[inviteMatch[1]];
      if (!invite) return reply(404, { error: 'Invitation not found.' });
      invite.active = false;
      addAudit(accounts, current.user, 'invite.withdrawn', { inviteId: invite.id }); writeAccounts(accounts);
      return reply(200, { invite: publicInvite(invite) });
    }
    if (pathname === '/api/accounts/audit' && req.method === 'GET') return reply(200, { audit: accounts.audit.slice(-100).reverse() });
    if (pathname === '/api/accounts/users' && req.method === 'GET') return reply(200, { users: Object.values(accounts.users).map(safeUser) });
    if (pathname === '/api/accounts/users' && req.method === 'POST') return reply(405, { error: 'New members must accept an email invitation.' });
    const userMatch = pathname.match(/^\/api\/accounts\/users\/([^/]+)$/);
    if (userMatch && req.method === 'PATCH') {
      const user = accounts.users[userMatch[1]];
      if (!user) return reply(404, { error: 'Member not found.' });
      if (user.role === 'owner' && current.user.id !== user.id) return reply(403, { error: 'Only the owner can update the owner account.' });
      if (body.role && body.role !== user.role && !grantable(current.user, body.role)) return reply(403, { error: 'You cannot grant that account role.' });
      const nextRole = body.role || user.role;
      const roleChanged = nextRole !== user.role;
      const nextActive = body.active === undefined ? user.active !== false : !!body.active;
      if (user.role === 'owner' && (nextRole !== 'owner' || !nextActive)) return reply(409, { error: 'Keep the owner account enabled.' });
      if (admin(user) && (!['owner', 'admin'].includes(nextRole) || !nextActive) && !Object.values(accounts.users).some(u => u.id !== user.id && u.active !== false && admin(u))) return reply(409, { error: 'Keep at least one active member administrator.' });
      if (body.resetPassword) return reply(400, { error: 'Members change their password from their account menu. Contact the owner for account recovery.' });
      if (body.displayName !== undefined) user.displayName = String(body.displayName).trim().slice(0, 80) || user.displayName;
      user.role = nextRole; user.active = nextActive;
      if (body.tableCodes !== undefined) {
        user.tableCodes = tableCodes(body.tableCodes);
        const data = ctx.readTables();
        for (const table of Object.values(data.tables)) {
          table.memberships ||= {};
          if (user.tableCodes.includes(table.code)) table.memberships[user.id] = { ...table.memberships[user.id], role: table.memberships[user.id]?.role || (user.role === 'warden' ? 'warden' : user.role === 'spectator' ? 'spectator' : 'protagonist'), removed: false };
          else if (!admin(user) && table.memberships[user.id]) table.memberships[user.id].removed = true;
        }
        ctx.writeTables(data);
      }
      user.updatedAt = new Date().toISOString();
      closeSessions(user.id);
      if (!nextActive || roleChanged) revoke(accounts, user.id);
      addAudit(accounts, current.user, 'account.updated', { userId: user.id }); writeAccounts(accounts);
      return reply(200, { user: safeUser(user) });
    }
    return reply(404, { error: 'Not found.' });
  }
  return { handle, auth, token };
};
