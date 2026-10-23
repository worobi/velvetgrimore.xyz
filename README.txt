VELVET GRIMOIRE - V16
Members-only tabletop play with persistent saved tables.

ENTRY
The public site is a login screen. New accounts require a single-use email invitation from a member administrator. There is no public signup or guest table access.

Members sign in at / and return to their assigned tables at /members.html.
Wardens can Save Now or Save and Pause, then resume the saved active session later.
Member administration and invitation email setup are at /member-admin.html.
Existing accounts keep their password; older accounts may still use their original username.

INVITATION EMAIL
The owner connects Daddy@velvetgrimore.xyz using the Spacemail mailbox password in the private member administration screen. The server verifies mail.spacemail.com:465 over TLS. The password is encrypted and is never returned by the API.

RUN LOCALLY
Use Node 24 (Node 22+ is supported).
Run npm ci, then npm start. The default development port is 8765.
For browser development, set PUBLIC_URL to the matching localhost origin.
Data is written to DATA_DIR, defaulting to server-data when /data does not exist.
First-owner provisioning is an operator-only step requiring BOOTSTRAP_TOKEN. Public setup cannot create accounts.

PRODUCTION
Use the Dockerfile through Coolify, port 8080, with persistent storage mounted at /data and /api/health enabled.
Do not replace an old container until its live accounts.json and tables.json have been backed up and copied to the persistent volume.
The first start imports legacy JSON into velvet.sqlite transactionally. Legacy files remain available for recovery.
Future saves use SQLite, with events stored separately from table snapshots.
Keep mail.key alongside the database when restoring a mail-configured installation.

CHECKS AND BACKUPS
npm test runs isolated invitation, permission, saved-state, concurrency, migration, and backup/restore checks.
node scripts/backup.js creates and verifies a consistent SQLite backup, including the mail encryption key.
The supplied deploy/velvet-grimoire-backup.sh runs this for the live Coolify app.
V16-RELEASE.md describes the release and remaining operational boundaries.
