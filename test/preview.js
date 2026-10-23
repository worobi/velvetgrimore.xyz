// Disposable preview account, available only in the local test environment.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
if (process.env.NODE_ENV !== 'test') throw new Error('Test preview only');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-member-preview-'));
const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = crypto.pbkdf2Sync('Preview-password-12345', salt, 120000, 32, 'sha256').toString('hex');
fs.writeFileSync(path.join(directory, 'accounts.json'), JSON.stringify({ users: { 'user-1': { id: 'user-1', username: 'preview-owner', email: 'preview@example.test', displayName: 'Preview Warden', role: 'owner', active: true, passwordHash, passwordSalt: salt, passwordIterations: 120000, tableCodes: ['ABC123'] } }, sessions: {}, invites: {}, audit: [], userSeq: 1 }));
fs.writeFileSync(path.join(directory, 'tables.json'), JSON.stringify({ tables: { ABC123: { code: 'ABC123', name: 'The Crimson Veil', rev: 1, status: 'paused', savedAt: new Date().toISOString(), snapshot: { keys: { vg_campaigns: JSON.stringify([{ id: 'preview', name: 'The Crimson Veil', protagonist: { name: 'Mara', class: 'Rogue', level: 5 }, npc: { name: 'The Stranger' }, scenes: [{ id: 'arrival', title: 'The Velvet Room', narrative: 'The door is still open. Your story is waiting.', npcCue: 'You have returned to the table.', branches: {}, elementWards: ['intimacy'], intensityWard: 'suggested', frameWard: 'consensual-if' }] }]), vg_session: JSON.stringify({ id: 'preview-session', campaignId: 'preview', currentSceneId: 'arrival', history: [] }), vg_maps: '[]' } } } } }));
const port = process.env.PORT || '9880';
const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: port, PUBLIC_URL: `http://127.0.0.1:${port}`, DATA_DIR: directory }, stdio: 'inherit' });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGTERM'));
child.on('exit', code => { fs.rmSync(directory, { recursive: true, force: true }); process.exit(code || 0); });
