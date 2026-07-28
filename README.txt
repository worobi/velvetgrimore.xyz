VELVET GRIMOIRE
A trauma-informed dark-fantasy tabletop engine for two.

QUICK START
1. Open index.html in a browser, or deploy this folder to a static web host.
2. Confirm the age gate and choose Warden if you are setting up the table.
3. Open the DM Admin Panel.
4. Click First Run -> Load Demo Campaign.
5. Open Player View and Map Editor from the admin sidebar.
6. Open pause.html before play and seal the Threshold.
7. After the final scene, use pause.html -> Hearth to close the session.

VPS BACKEND MODE
1. Copy the whole folder to the VPS, or deploy the repo through Coolify using the included Dockerfile.
2. Run `node server.js`, install the included systemd service, or let Docker run `node server.js` on PORT=80.
3. Point the domain/proxy at the Node service so `/` and `/api/` share the same domain.
4. In Admin -> Settings -> Remote Multiplayer, create a table code.
5. Send the code to the player.

WHAT IS INCLUDED
- index.html: landing, age gate, role picker, demo loader
- admin/index.html: campaign, scene, template, session, dice, backup tools
- player/player.html: player scene view and warded entry
- map/dm-map.html: map editor and event placement
- map/player-map.html: fog-of-war player map
- dice/index.html: standalone player dice roller
- engine/engine.js: campaign, scene, ward, session, dice engine
- engine/map-engine.js: map and fog-of-war engine
- engine/sync.js: browser sync client for VPS table-code multiplayer
- demo/demo-data.js: The Crimson Veil demo campaign installer
- engine/intimacy.js: scene chat, consent ceiling, heat, prompt, and want/boundary card layer
- server.js: Node backend for static hosting and remote table sync
- package.json: npm start entrypoint for the backend
- Dockerfile: Coolify/container entrypoint for the backend
- deploy/velvetgrimore.service: systemd service template
- deploy/nginx-velvetgrimore.conf: nginx reverse-proxy template
- pause.html: Threshold, Ember, Hearth, and Compact surface
- compact/SAFETY.md and compact/TAGS.md: safety framework and ward vocabulary
- velvet-grimoire-cliff-notes.docx: first-session quick reference
- DEMO-WALKTHROUGH.md: guided first-run demo
- INTIMATE-TABLE.md: guide to the in-character intimate messaging layer
- CONTENT-PACKS.md: starter content pack ideas
- ROADMAP.md: next product milestones

KNOWN LIMITATIONS
- State is stored in the browser. Clearing browser data clears campaigns unless you export a backup first.
- Remote play requires the included VPS backend (`node server.js`) or an equivalent hosted `/api/` service.
- Table-code sync currently uses whole-snapshot, last-write-wins conflict handling.
- Discord webhooks send selected events to Discord only if you configure one.
- Before private play, replace demo characters, safety answers, and ward decisions with your real table's choices.

BACKUPS
Use Admin -> Settings -> Backup Everything before and after meaningful edits.
