const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

module.exports = function openStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(directory, 'velvet.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (name TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tables (code TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      table_code TEXT NOT NULL REFERENCES tables(code),
      id INTEGER NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (table_code, id)
    );
  `);
  const get = db.prepare('SELECT json FROM records WHERE name = ?');
  const put = db.prepare('INSERT INTO records(name,json) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json');
  const tablePut = db.prepare('INSERT INTO tables(code,json) VALUES (?,?) ON CONFLICT(code) DO UPDATE SET json=excluded.json');
  const eventPut = db.prepare('INSERT INTO events(table_code,id,json) VALUES (?,?,?) ON CONFLICT(table_code,id) DO UPDATE SET json=excluded.json');
  function writeTables(data) {
    for (const [code, table] of Object.entries(data.tables || {})) {
      const { events = [], ...record } = table;
      tablePut.run(code, JSON.stringify(record));
      for (const event of events) eventPut.run(code, event.id, JSON.stringify(event));
    }
  }
  // Import legacy JSON once, atomically. Invalid legacy files stop startup.
  if (!get.get('migrated')) {
    db.transaction(() => {
      const accountsPath = path.join(directory, 'accounts.json');
      const tablesPath = path.join(directory, 'tables.json');
      const accounts = fs.existsSync(accountsPath)
        ? JSON.parse(fs.readFileSync(accountsPath, 'utf8'))
        : { users: {}, sessions: {}, audit: [], invites: {}, userSeq: 0 };
      if (!accounts.users || !accounts.sessions) throw new Error('Invalid legacy accounts store');
      accounts.settings = { ...accounts.settings, allowGuestJoins: false, membersOnly: true };
      // Old short invitation codes are replaced with email-bound invitations.
      for (const invite of Object.values(accounts.invites || {})) invite.active = false;
      const tables = fs.existsSync(tablesPath) ? JSON.parse(fs.readFileSync(tablesPath, 'utf8')) : { tables: {} };
      if (!tables.tables || typeof tables.tables !== 'object') throw new Error('Invalid legacy tables store');
      const owner = Object.values(accounts.users).find(user => user.active !== false && user.role === 'owner') || Object.values(accounts.users).find(user => user.active !== false && user.role === 'admin');
      for (const table of Object.values(tables.tables)) {
        table.players ||= {}; table.memberships ||= {}; table.personal ||= {};
        for (const id of Object.keys(table.players)) if (!accounts.users[id]) delete table.players[id];
        const seatedWarden = Object.values(table.players).find(player => player.role === 'warden');
        table.ownerId ||= seatedWarden?.id || owner?.id;
        table.wardenId ||= table.ownerId;
        if (table.ownerId) table.memberships[table.ownerId] = { role: 'warden', removed: false };
        for (const player of Object.values(table.players)) table.memberships[player.id] = { role: player.role, removed: false };
        const author = accounts.users[table.ownerId];
        if (author) author.tableCodes = [...new Set([...(author.tableCodes || []), table.code])];
      }
      accounts.userSeq = Number(accounts.userSeq || 0);
      put.run('accounts', JSON.stringify(accounts));
      writeTables(tables);
      put.run('migrated', JSON.stringify({ at: new Date().toISOString() }));
    })();
  }
  fs.chmodSync(path.join(directory, 'velvet.sqlite'), 0o600);
  return {
    db,
    readAccounts: () => JSON.parse(get.get('accounts').json),
    writeAccounts: accounts => put.run('accounts', JSON.stringify(accounts)),
    readTables() {
      const tables = {};
      for (const row of db.prepare('SELECT code,json FROM tables').all()) {
        const table = JSON.parse(row.json);
        table.events = db.prepare('SELECT json FROM events WHERE table_code=? ORDER BY id DESC LIMIT 500').all(row.code).reverse().map(e => JSON.parse(e.json));
        tables[row.code] = table;
      }
      return { tables };
    },
    writeTables,
    readSetting(name, fallback = null) {
      const row = get.get(name);
      return row ? JSON.parse(row.json) : fallback;
    },
    writeSetting: (name, value) => put.run(name, JSON.stringify(value)),
    begin: () => db.exec('BEGIN IMMEDIATE'),
    commit() { if (db.inTransaction) db.exec('COMMIT'); },
    rollback() { if (db.inTransaction) db.exec('ROLLBACK'); },
    healthy: () => db.prepare('SELECT 1').get() !== undefined,
    backup: destination => db.backup(destination),
    close: () => db.close(),
  };
};
