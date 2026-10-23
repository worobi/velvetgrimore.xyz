const fs = require('fs');
const path = require('path');
const openStore = require('../lib/store');
const directory = process.env.DATA_DIR || '/data';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(directory, 'backups', stamp);
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const store = openStore(directory);
(async () => {
  try {
    await store.backup(path.join(destination, 'velvet.sqlite'));
    const Database = require('better-sqlite3');
    const check = new Database(path.join(destination, 'velvet.sqlite'), { readonly: true });
    const healthy = check.pragma('quick_check', { simple: true }); check.close();
    if (healthy !== 'ok') throw new Error('Backup integrity check failed');
    const key = path.join(directory, 'mail.key');
    if (fs.existsSync(key)) fs.copyFileSync(key, path.join(destination, 'mail.key'));
    for (const name of fs.readdirSync(destination)) fs.chmodSync(path.join(destination, name), 0o600);
    console.log(`Verified SQLite backup: ${destination}`);
  } finally { store.close(); }
})().catch(() => { console.error('Backup failed'); process.exitCode = 1; });
