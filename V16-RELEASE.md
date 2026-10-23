# V16: Members and Saved Tables

The public entry is a login screen. New members can only create an account from a single-use invitation delivered to their email address. Public registration, direct generated accounts, short invite codes, and guest table access are disabled.

Members return to their assigned tables from `/members.html`. A table keeps its campaign, active scene, maps, chat, activity, checkpoints, and personal records on the server. Wardens can save explicitly or save and pause for a break; resuming opens the saved active session. Updates also save automatically during play.

Member administrators send and withdraw invitations and edit member access at `/member-admin.html`. The owner connects the existing `Daddy@velvetgrimore.xyz` mailbox using its Spacemail password. The application verifies SMTP before enabling invitations. Mail credentials are encrypted in the database with a separate key in the persistent volume; passwords and invitation tokens are never returned by the admin API.

Spacemail uses `mail.spacemail.com`, port 465, with TLS, as documented in [Spacemail's connection guide](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/). No email password is included in the source or release.

## Access and Privacy

- Sessions use HttpOnly cookies; live-stream URLs no longer contain session tokens.
- The server binds every table action and viewer to the signed-in account.
- Player responses omit unrevealed scenes, Warden notes, unrelated campaigns, hidden map details, other members' private cards, and personal check-in answers.
- Safety signals, private notes, consent, cards, and Intimate Table messages are applied to saved server state.
- Locking, removals, archives, role changes, logout, and password changes enforce access across requests and live connections.
- Passwords require at least 12 characters; temporary-password accounts must change their password before entering.
- Existing account passwords remain valid after migration. Existing owners can continue using their original username if their old account has no email address.

## Storage and Deployment

The Node 24 container runs as a non-root user. `/data` must be mounted persistently. On first start, the application imports legacy `accounts.json` and `tables.json` into `velvet.sqlite` in one transaction. Legacy files are retained for recovery and are not used after import. Events are stored separately from table snapshots. API mutations are serialized and transactional; stale snapshot writes are rejected.

`scripts/backup.js` produces a consistent SQLite backup and copies the mail encryption key to a protected backup directory. Restores require both the database and that key. The supplied server backup script can run nightly. Local VPS backups do not cover loss of the entire host; an off-host backup destination remains an operational follow-up.

The root `deploy/` folder outside this checkout is an older release. This `app/` checkout is the authoritative source. Deploy through Coolify from the reviewed Git commit, with `/data` mounted, port 8080, and `/api/health` enabled. Never replace the old live container before its data has been backed up and migrated to the host volume.

## Verification

`npm test` covers invitation mail through a local SMTP test server, single-use and email-bound acceptance, guest/signup denial, role and viewer spoofing, private data filtering, remote safety and personal state, stale saves, concurrent requests, logout stream revocation, durable restart recovery, legacy migration, and restoring a SQLite backup. Browser checks cover login, member tables, member administration, resuming the active session, and saving for a break.

Real Spacemail delivery requires the owner to connect the mailbox in member administration. Test SMTP acceptance does not establish delivery to a real inbox.
