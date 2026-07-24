// ============================================================
// VELVET GRIMOIRE — Demo Content Installer
// Safe, public-facing starter data for screenshots and first-run testing.
// ============================================================

(function () {
  const CAMPAIGN_ID = 'vg-demo-crimson-veil';
  const MAP_ID = 'vg-demo-map-ashfall-manor';
  const NOW = 1760000000000;

  function scene(id, title, data) {
    return {
      id,
      title,
      narrative: data.narrative,
      npcCue: data.npcCue,
      setting: data.setting || {},
      tags: data.tags || [],
      attributes: data.attributes || { tension: 5, intimacy: 2, danger: 4 },
      dc: data.dc || { fight: 14, flight: 10, fawn: 7, freeze: 5 },
      requiresRoll: data.requiresRoll !== false,
      branches: data.branches,
      elementWards: data.elementWards || ['authority'],
      intensityWard: data.intensityWard || 'suggested',
      frameWard: data.frameWard || 'consensual-if',
      isStart: !!data.isStart,
      isEnd: !!data.isEnd,
      templateId: data.templateId || null,
      createdAt: NOW + Number(id.replace(/\D/g, '') || 0),
    };
  }

  function branch(label, narrative, nextSceneId) {
    return { label, narrative, nextSceneId: nextSceneId || null };
  }

  function buildCampaign() {
    const scenes = [
      scene('vg-demo-s01', 'The Oath at the Black Door', {
        isStart: true,
        narrative: 'Rain needles the iron steps of Ashfall Manor. The invitation in your glove is dry, warm, and sealed with red wax that has no right to remember your thumbprint. Beyond the black door, a bell rings once. Someone inside has counted your heartbeat and found it useful.',
        npcCue: 'You are the Warden of Ashfall tonight: precise, watchful, never cruel. Your first job is to make the table feel the door, the rain, and the choice to cross.',
        tags: ['opening', 'threshold', 'screenshot-safe'],
        elementWards: ['authority', 'surveillance', 'pursuit'],
        attributes: { tension: 6, intimacy: 1, danger: 3 },
        branches: {
          fight: branch('Knock like a challenge', 'The knocker lands hard enough to wake the portraits. Inside, a chain slides free with theatrical patience.', 'vg-demo-s02'),
          flight: branch('Circle the manor first', 'You leave the door unanswered and follow the wet stone path toward the servant alley, where the windows watch less politely.', 'vg-demo-s03'),
          fawn: branch('Offer the invitation to the door', 'You press the invitation beneath the knocker as if making tribute. The lock opens before your hand leaves the paper.', 'vg-demo-s04'),
          freeze: branch('Listen before entering', 'You still yourself. Under the rain you hear two voices: one rehearsing your name, one warning it not to.', 'vg-demo-s05'),
        },
      }),
      scene('vg-demo-s02', 'The Mirror Duel', {
        narrative: 'The hall is lined with mirrors, but only one reflection moves a breath too late. Captain Vale steps from that lagging glass with a ceremonial blade lowered at his side. "No blood unless you ask the house for judgment," he says. The floor has already begun counting steps.',
        npcCue: 'Vale tests boundaries before testing skill. He wants courage, not injury. Keep the pressure elegant and readable.',
        tags: ['duel', 'manners', 'public-safe'],
        elementWards: ['weaponry', 'violence', 'authority'],
        attributes: { tension: 7, intimacy: 1, danger: 6 },
        dc: { fight: 15, flight: 11, fawn: 8, freeze: 5 },
        branches: {
          fight: branch('Meet the blade', 'Steel rings against steel. Vale smiles because you did not flinch, and because the mirror behind him just cracked.', 'vg-demo-s06'),
          flight: branch('Break the rhythm', 'You step outside the counted pattern. The mirrors lose you for one priceless second.', 'vg-demo-s07'),
          fawn: branch('Ask what the house wants witnessed', 'Vale lowers the blade by an inch. "Better," he says. "It wants the truth dressed well enough to survive dinner."', 'vg-demo-s08'),
          freeze: branch('Let him reveal the rule', 'You do not draw. Vale is forced to explain the game before he can win it.', 'vg-demo-s05'),
        },
      }),
      scene('vg-demo-s03', 'The Alley of Moths', {
        narrative: 'Behind the manor, pale moths gather around a kitchen lamp that has been cold for years. A courier waits beneath it, face hidden by a hood, holding a ribbon tied around a small brass key.',
        npcCue: 'The courier is afraid of the house and more afraid of disappointing the person who sent them. Play them as useful, not helpless.',
        tags: ['investigation', 'map-event'],
        elementWards: ['surveillance', 'betrayal', 'pursuit'],
        attributes: { tension: 5, intimacy: 1, danger: 4 },
        branches: {
          fight: branch('Demand the sender', 'The courier almost runs. Almost. Then they name a woman who has been dead since winter.', 'vg-demo-s06'),
          flight: branch('Take the key and vanish', 'The key is warm. The alley behind you folds into a canal path that was not there before.', 'vg-demo-s09'),
          fawn: branch('Promise safe passage', 'The courier gives you the key and a warning: "Do not let Lord Sable pour the second glass."', 'vg-demo-s04'),
          freeze: branch('Watch the moths', 'The moths form letters on the lamp glass: LISTENING GALLERY.', 'vg-demo-s05'),
        },
      }),
      scene('vg-demo-s04', 'The Patron\'s Offer', {
        narrative: 'Lord Sable receives you in a room full of sealed letters and empty chairs. He never asks you to sit. He offers information, protection, and the kind of favor that becomes a leash if handled carelessly.',
        npcCue: 'Sable is charming because charm is cheaper than honesty. Keep his offer useful enough that refusing it costs something.',
        tags: ['social', 'bargain', 'ward-example'],
        elementWards: ['authority', 'manipulation', 'financial-coercion'],
        attributes: { tension: 6, intimacy: 2, danger: 3 },
        dc: { fight: 14, flight: 10, fawn: 6, freeze: 5 },
        branches: {
          fight: branch('Name the leash aloud', 'Sable\'s smile thins. He respects the accusation because it proves you saw the shape of the room.', 'vg-demo-s06'),
          flight: branch('Decline before terms are spoken', 'You leave with less information, but the door closes behind you without owning your name.', 'vg-demo-s07'),
          fawn: branch('Ask what service he requires', 'Sable gives you a sealed task and watches which hand takes it.', 'vg-demo-s08'),
          freeze: branch('Let the silence price itself', 'He fills the quiet with one detail too many: the missing heir is alive.', 'vg-demo-s10'),
        },
      }),
      scene('vg-demo-s05', 'The Gallery of Listening Glass', {
        narrative: 'Portraits line the gallery in two rows: the living on the left, the dead on the right. Your portrait hangs in the center, unfinished. Its painted eyes are closed, but its ear is turned toward you.',
        npcCue: 'This is the demonstration scene for Freeze. Reward attention. Make silence feel active.',
        tags: ['observation', 'mystery'],
        elementWards: ['surveillance', 'dissociation', 'horror'],
        attributes: { tension: 7, intimacy: 1, danger: 4 },
        dc: { fight: 16, flight: 11, fawn: 8, freeze: 4 },
        branches: {
          fight: branch('Tear down the portrait', 'Canvas splits. Behind it is a listening tube, and behind that, a breath held too long.', 'vg-demo-s02'),
          flight: branch('Leave no words behind', 'You exit before the gallery can borrow your voice.', 'vg-demo-s03'),
          fawn: branch('Tell the portrait a harmless truth', 'The painted eyes open. It accepts the offering and shows you a safer lie.', 'vg-demo-s08'),
          freeze: branch('Wait for it to speak first', 'The gallery gives up a secret in the voice of someone who once loved this house.', 'vg-demo-s10'),
        },
      }),
      scene('vg-demo-s06', 'The Bell Tower Confrontation', {
        narrative: 'The bell tower smells of lightning and old rope. Vale waits beside the cracked bell with his blade sheathed now. Below, the manor lights move room by room like a search party.',
        npcCue: 'This is the pressure peak. Keep agency clear: challenge, retreat, appease, or observe all move the story.',
        tags: ['climax', 'combat-or-parley'],
        elementWards: ['weaponry', 'violence', 'pursuit', 'captivity'],
        attributes: { tension: 8, intimacy: 1, danger: 7 },
        dc: { fight: 16, flight: 12, fawn: 8, freeze: 6 },
        branches: {
          fight: branch('Ring the cracked bell', 'The sound breaks every mirror in Ashfall Manor. No one below can pretend not to hear you now.', 'vg-demo-s11'),
          flight: branch('Take the outer stair', 'You descend into rain and rooflines, carrying the bell\'s last note in your teeth.', 'vg-demo-s09'),
          fawn: branch('Offer Vale the truth first', 'Vale accepts the truth like a weapon handed hilt-first. "Then we both turn on Sable."', 'vg-demo-s08'),
          freeze: branch('Count the searchlights', 'You find the blind interval between sweeps. Someone arranged it for you.', 'vg-demo-s10'),
        },
      }),
      scene('vg-demo-s07', 'The Canal Escape', {
        narrative: 'The canal behind Ashfall is black as ink and twice as patient. A narrow boat waits under the bridge. Its oars are wrapped in red thread; its lantern is shuttered.',
        npcCue: 'This is a breathing-room scene, not a punishment for Flight. Give the player new angles and a cost.',
        tags: ['escape', 'reposition'],
        elementWards: ['pursuit', 'surveillance'],
        attributes: { tension: 5, intimacy: 1, danger: 4 },
        branches: {
          fight: branch('Turn the chase around', 'The boat becomes a trap you spring upward, catching your pursuer between bridge and water.', 'vg-demo-s06'),
          flight: branch('Let the current take you', 'The manor falls behind. The city gate rises ahead, old and watchful.', 'vg-demo-s09'),
          fawn: branch('Pay the boatman in secrets', 'The boatman asks for a name. You give him one that is true enough to float.', 'vg-demo-s04'),
          freeze: branch('Read the red thread', 'The knots are a map. The destination is not escape. It is confession.', 'vg-demo-s10'),
        },
      }),
      scene('vg-demo-s08', 'The Mask Laid Down', {
        narrative: 'In the small music room, every mask worn tonight rests on a velvet stand. One is still warm. One is yours, though you never wore it. The room waits for someone to stop performing.',
        npcCue: 'This scene demonstrates Fawn as appeasement and negotiation, not weakness. Let yielding reveal power.',
        tags: ['fawn-demo', 'social-turn'],
        elementWards: ['intimacy', 'authority', 'manipulation'],
        attributes: { tension: 6, intimacy: 4, danger: 3 },
        branches: {
          fight: branch('Refuse the assigned mask', 'The stand splinters. Beneath the velvet is a ledger of everyone the house has renamed.', 'vg-demo-s06'),
          flight: branch('Leave your mask behind', 'You exit lighter, but someone else may wear your absence.', 'vg-demo-s09'),
          fawn: branch('Choose the mask and name the bargain', 'You set terms while appearing to accept theirs. The room mistakes grace for surrender.', 'vg-demo-s11'),
          freeze: branch('Wait until another mask moves', 'Sable\'s mask turns first. It has been lying even to him.', 'vg-demo-s10'),
        },
      }),
      scene('vg-demo-s09', 'The Old Gate', {
        narrative: 'The old city gate stands open by exactly the width of a shoulder. Dawn presses a thin grey blade under the clouds. Behind you, Ashfall Manor has gone quiet enough to be dangerous.',
        npcCue: 'This is an exit scene. Make every branch close a different emotional thread.',
        tags: ['exit', 'choice'],
        elementWards: ['pursuit', 'betrayal'],
        attributes: { tension: 5, intimacy: 1, danger: 3 },
        dc: { fight: 12, flight: 8, fawn: 6, freeze: 5 },
        branches: {
          fight: branch('Bar the gate behind you', 'The city keeps what the manor lost. For one morning, that is enough.', 'vg-demo-s11'),
          flight: branch('Pass through without looking back', 'You do not look back. Looking back is for stories that still own you.', 'vg-demo-s11'),
          fawn: branch('Leave a warning for the next guest', 'You pin one sentence to the gate: Do not drink the second glass.', 'vg-demo-s11'),
          freeze: branch('Wait for the final bell', 'When it rings, you know which secret survived the night.', 'vg-demo-s11'),
        },
      }),
      scene('vg-demo-s10', 'The Confession Under Glass', {
        narrative: 'The conservatory roof turns the rain into silver handwriting. Under glass, Lord Sable finally says the part no contract could carry: he was not protecting the heir from you. He was protecting you from the heir.',
        npcCue: 'This is the reveal. Keep the admission specific, contained, and playable. Do not solve the player\'s feelings for them.',
        tags: ['reveal', 'quiet-peak'],
        elementWards: ['betrayal', 'manipulation', 'family-dynamics'],
        attributes: { tension: 7, intimacy: 3, danger: 4 },
        dc: { fight: 14, flight: 10, fawn: 7, freeze: 5 },
        branches: {
          fight: branch('Demand the heir\'s location', 'Sable gives you the address because he knows refusing would finally make him honest.', 'vg-demo-s06'),
          flight: branch('Leave him with the confession', 'The confession follows you anyway, tapping on the glass with rain-soft fingers.', 'vg-demo-s09'),
          fawn: branch('Accept only what can be verified', 'You take the useful truth and leave the rest in his mouth.', 'vg-demo-s11'),
          freeze: branch('Let the lie finish dying', 'The final contradiction arrives on its own. You did not need to chase it.', 'vg-demo-s11'),
        },
      }),
      scene('vg-demo-s11', 'Hearth at Dawn', {
        isEnd: true,
        requiresRoll: false,
        narrative: 'Dawn finds the manor behind you and the city before you. No one has won cleanly. No one has been left without a door. The book closes with one thread still warm enough to pick up next session.',
        npcCue: 'End cleanly. Route both players to the Hearth after this scene and let the aftercare form do its job.',
        tags: ['ending', 'hearth', 'aftercare'],
        elementWards: ['intimacy', 'authority'],
        attributes: { tension: 2, intimacy: 3, danger: 1 },
        branches: {
          fight: branch('Close with a vow', 'You name what will be different next time.', null),
          flight: branch('Close with distance', 'You leave the night where it belongs: behind you.', null),
          fawn: branch('Close with thanks', 'You mark what helped without pretending every cost was beautiful.', null),
          freeze: branch('Close with silence', 'You let the quiet do its last honest work.', null),
        },
      }),
    ];

    return {
      id: CAMPAIGN_ID,
      name: 'The Crimson Veil',
      description: 'A screenshot-safe demo campaign for learning the flow: threshold, warded entry, four trauma-aware branches, map events, and Hearth closure.',
      setting: 'court',
      protagonist: {
        name: 'Mara Vey',
        class: 'Rogue / Court Fixer',
        level: 5,
        traits: ['watchful', 'silver-tongued', 'hard to corner'],
        limits: ['breath'],
        notes: 'Demo protagonist. Public-safe starter; revise before private play.',
        banishedNames: [
          { tag: 'breath', declaredAt: new Date(NOW).toISOString(), note: 'Permanent no for this demo protagonist.' },
        ],
      },
      npc: {
        name: 'Lord Sable',
        role: 'Patron / Suspect',
        personality: 'Elegant, useful, and never as calm as he sounds.',
        agenda: 'Keep the heir hidden until the house chooses a side.',
        notes: 'Primary demo antagonist.',
      },
      antagonists: [
        { id: 'vg-demo-a01', name: 'Lord Sable', role: 'Patron / Suspect', personality: 'Elegant, useful, evasive.', agenda: 'Control the terms of every truth.', notes: 'Use for social pressure scenes.', controlledBy: 'dm' },
        { id: 'vg-demo-a02', name: 'Captain Vale', role: 'Duelist / Gatekeeper', personality: 'Formal, restrained, secretly fair.', agenda: 'Test whether Mara is reckless or ready.', notes: 'Use for challenge scenes.', controlledBy: 'dm' },
        { id: 'vg-demo-a03', name: 'The Listening House', role: 'Haunted Environment', personality: 'Patient, archival, hungry for names.', agenda: 'Record what every guest refuses to say.', notes: 'Use for atmospheric prompts.', controlledBy: 'dm' },
      ],
      scenes,
      templates: [],
      tags: ['demo', 'public-safe', 'dark-fantasy', 'four-branch'],
      hallowed: ['child-harm', 'real-world-sexual-assault'],
      veiled: ['body-horror', 'blood'],
      customWards: [],
      ackedWards: ['captivity', 'pain', 'blood', 'humiliation', 'dubcon-roleplay'],
      protagonistAckedWards: ['captivity', 'pain', 'blood', 'humiliation', 'dubcon-roleplay'],
      contentRating: 'mature',
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  function buildTemplates() {
    const base = [
      ['vg-tmpl-negotiation', 'Dangerous Negotiation', 'A tense bargain where each branch changes leverage.', ['social', 'bargain']],
      ['vg-tmpl-chase', 'Pursuit and Escape', 'A moving scene for pressure, evasion, and reversed pursuit.', ['pursuit', 'motion']],
      ['vg-tmpl-ambush', 'Revealed Ambush', 'A threat appears and each response controls the shape of danger.', ['ambush', 'combat']],
      ['vg-tmpl-confession', 'Confession Under Pressure', 'A quiet reveal where silence and appeasement matter.', ['reveal', 'intimacy']],
      ['vg-tmpl-ritual', 'Bound Ritual', 'A ceremonial scene with strict wards and a visible exit.', ['ritual', 'warded']],
      ['vg-tmpl-aftermath', 'Aftermath and Hearth', 'A closing beat that hands the table back to aftercare.', ['closure', 'hearth']],
    ];
    return base.map(([id, name, description, tags], i) => ({
      id,
      name,
      description,
      tags,
      attributes: { tension: 4 + (i % 4), intimacy: i % 3, danger: 3 + (i % 5) },
      defaultDC: { fight: 14, flight: 10, fawn: 7, freeze: 5 },
      narrativeBlocks: {
        dm: `[DM: Frame the ${name.toLowerCase()} with one concrete sensory detail, one visible exit, and one meaningful pressure.]`,
        npc: '[NPC: State what your character wants, what they are hiding, and what they will not cross.]',
        fight: '[Fight: Confront directly. Change the power balance openly.]',
        flight: '[Flight: Create distance. Preserve agency at a cost.]',
        fawn: '[Fawn: Yield tactically. Trade posture for information or time.]',
        freeze: '[Freeze: Observe. Let the scene reveal a rule before acting.]',
      },
      setting: {},
      contentRating: 'mature',
      createdAt: NOW + i,
      updatedAt: NOW + i,
    }));
  }

  function makeTiles(cols, rows) {
    const tiles = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
        const hall = y === 8 || x === 12;
        tiles.push({ x, y, type: edge ? 'wall' : (hall ? 'corridor' : 'floor'), zoneId: null, eventId: null, label: '' });
      }
    }
    return tiles;
  }

  function rect(x1, y1, x2, y2) {
    const out = [];
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
    return out;
  }

  function buildMap() {
    const cols = 25;
    const rows = 17;
    const zones = [
      { id: 'zone-entry', name: 'Black Door Steps', biome: 'court', color: '#5a3010', description: 'Rain, iron, and a first choice.', tiles: rect(9, 13, 15, 15), connections: ['zone-hall'], isDiscovered: true },
      { id: 'zone-hall', name: 'Mirror Hall', biome: 'court', color: '#4a3a60', description: 'Reflections move a breath late.', tiles: rect(3, 6, 21, 10), connections: ['zone-gallery', 'zone-music'], isDiscovered: false },
      { id: 'zone-gallery', name: 'Listening Gallery', biome: 'court', color: '#3a2a3a', description: 'Portraits overhear what people bury.', tiles: rect(2, 2, 10, 5), connections: ['zone-hall'], isDiscovered: false },
      { id: 'zone-music', name: 'Music Room', biome: 'court', color: '#3a1015', description: 'Masks rest on velvet stands.', tiles: rect(14, 2, 22, 5), connections: ['zone-hall'], isDiscovered: false },
      { id: 'zone-canal', name: 'Canal Exit', biome: 'city', color: '#104060', description: 'A black-water escape route.', tiles: rect(2, 11, 22, 15), connections: ['zone-entry'], isDiscovered: false },
    ];
    const events = [
      { id: 'evt-door', x: 12, y: 14, type: 'scene', label: 'The Oath at the Black Door', description: 'Start the demo campaign.', sceneId: 'vg-demo-s01', hidden: false, triggered: false, repeatable: true, triggerCount: 0, notes: '' },
      { id: 'evt-mirror', x: 12, y: 8, type: 'scene', label: 'The Mirror Duel', description: 'Connects to the demo duel scene.', sceneId: 'vg-demo-s02', hidden: false, triggered: false, repeatable: true, triggerCount: 0, notes: '' },
      { id: 'evt-gallery', x: 6, y: 4, type: 'scene', label: 'Listening Gallery', description: 'Observation scene.', sceneId: 'vg-demo-s05', hidden: false, triggered: false, repeatable: true, triggerCount: 0, notes: '' },
      { id: 'evt-mask', x: 18, y: 4, type: 'npc', label: 'Mask Stand', description: 'Use the Fawn demo scene.', sceneId: 'vg-demo-s08', hidden: false, triggered: false, repeatable: true, triggerCount: 0, notes: '' },
      { id: 'evt-canal', x: 12, y: 13, type: 'locked', label: 'Canal Gate', description: 'Requires the brass key or a clever bargain.', sceneId: 'vg-demo-s09', hidden: false, triggered: false, repeatable: true, triggerCount: 0, notes: '' },
    ];
    const tiles = makeTiles(cols, rows).map(tile => {
      const zone = zones.find(z => z.tiles.some(t => t.x === tile.x && t.y === tile.y));
      const event = events.find(e => e.x === tile.x && e.y === tile.y);
      return { ...tile, zoneId: zone ? zone.id : tile.zoneId, eventId: event ? event.id : tile.eventId };
    });
    return {
      id: MAP_ID,
      campaignId: CAMPAIGN_ID,
      name: 'Ashfall Manor Demo Map',
      biome: 'court',
      cols,
      rows,
      tiles,
      zones,
      events,
      partyPos: { x: 12, y: 14 },
      revealedTiles: ['12,14', '11,14', '13,14', '12,13', '12,15', '11,13', '13,13'],
      sightRadius: 4,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  function mergeById(existing, incoming) {
    const map = new Map(existing.map(item => [item.id, item]));
    incoming.forEach(item => map.set(item.id, item));
    return Array.from(map.values());
  }

  function install(options = {}) {
    const campaign = buildCampaign();
    const templates = buildTemplates();
    const demoMap = buildMap();
    const campaigns = JSON.parse(localStorage.getItem('vg_campaigns') || '[]');
    const allTemplates = JSON.parse(localStorage.getItem('vg_templates') || '[]');
    const maps = JSON.parse(localStorage.getItem('vg_maps') || '[]');

    localStorage.setItem('vg_campaigns', JSON.stringify(mergeById(campaigns, [campaign])));
    localStorage.setItem('vg_templates', JSON.stringify(mergeById(allTemplates, templates)));
    localStorage.setItem('vg_maps', JSON.stringify(mergeById(maps, [demoMap])));
    localStorage.setItem('vg_active_map_id', MAP_ID);
    localStorage.setItem('vg_demo_mode', options.screenshot ? 'screenshot' : 'installed');
    localStorage.setItem('vg_role', options.role || localStorage.getItem('vg_role') || 'dm');

    const threshold = {
      id: 'vg-demo-threshold',
      at: new Date(NOW).toISOString(),
      playerName: 'Demo Table',
      role: 'dm',
      body: { tension: 4, fatigue: 3, hunger: 2, pain: 1 },
      bandwidth: 7,
      bandwidthLabel: 'hearth-fire',
      green: 'Court intrigue, clever reversals, visible exits, and tense choices.',
      yellow: 'Pressure is welcome when the exit stays clear.',
      red: 'No breath play, no child-harm, no real-world sexual assault.',
      note: 'Demo Threshold. Replace with real table answers before private play.',
    };
    localStorage.setItem('vg_threshold_current', JSON.stringify(threshold));
    localStorage.setItem('vg_thresholds', JSON.stringify([threshold]));

    const hearth = {
      id: 'vg-demo-hearth',
      at: new Date(NOW + 3600000).toISOString(),
      words: ['steady', 'curious'],
      stations: ['water', 'stretch', 'reassure'],
      offer: ['quiet', 'recap'],
      notes: 'Demo Hearth example. Seal a real Hearth after live play.',
    };
    localStorage.setItem('vg_hearths', JSON.stringify([hearth]));

    if (options.startSession) {
      localStorage.setItem('vg_session', JSON.stringify({
        id: 'vg-demo-session',
        campaignId: CAMPAIGN_ID,
        currentSceneId: 'vg-demo-s01',
        history: [],
        characters: { protagonist: campaign.protagonist, npc: campaign.npc },
        startedAt: Date.now(),
        lastSaved: Date.now(),
      }));
      const intimateKey = 'vg-demo-session::vg-demo-s01';
      localStorage.setItem('vg_intimacy_state', JSON.stringify({
        [intimateKey]: {
          sessionId: 'vg-demo-session',
          sceneId: 'vg-demo-s01',
          heat: 28,
          consent: { dm: 'suggestive', player: 'suggestive' },
          createdAt: NOW,
          updatedAt: NOW,
        },
      }));
      localStorage.setItem('vg_intimacy_cards', JSON.stringify({
        [intimateKey]: {
          dm: {
            want: ['flirtation', 'slow burn', 'dangerous bargain'],
            pace: 'slow',
            ceiling: 'suggestive',
            notTonight: '',
            note: 'Keep the first scene charged but public-safe.',
            updatedAt: NOW,
          },
          player: {
            want: ['flirtation', 'slow burn', 'fade-to-black'],
            pace: 'steady',
            ceiling: 'suggestive',
            notTonight: 'No breath play for this protagonist.',
            note: 'Invite tension, leave the exit visible.',
            updatedAt: NOW,
          },
        },
      }));
      localStorage.setItem('vg_intimacy_chat', JSON.stringify([
        {
          id: 'vg-demo-chat-01',
          key: intimateKey,
          sessionId: 'vg-demo-session',
          sceneId: 'vg-demo-s01',
          role: 'dm',
          mode: 'spoken',
          text: 'The door opens before you knock twice. A voice from the warm dark says, "You came in the rain. That means you wanted the choice to feel difficult."',
          at: NOW + 1000,
        },
        {
          id: 'vg-demo-chat-02',
          key: intimateKey,
          sessionId: 'vg-demo-session',
          sceneId: 'vg-demo-s01',
          role: 'player',
          mode: 'action',
          text: 'I keep one glove on the invitation and one hand free. "Difficult is fine. Unclear is not."',
          at: NOW + 2000,
        },
        {
          id: 'vg-demo-chat-03',
          key: intimateKey,
          sessionId: 'vg-demo-session',
          sceneId: 'vg-demo-s01',
          role: 'dm',
          mode: 'ooc',
          text: 'OOC check: staying suggestive and slow unless you lower or raise your ceiling.',
          at: NOW + 3000,
        },
      ]));
    }

    return { campaign, templates, map: demoMap };
  }

  function clearDemoModeFlag() {
    localStorage.removeItem('vg_demo_mode');
  }

  window.VGDemo = {
    campaignId: CAMPAIGN_ID,
    mapId: MAP_ID,
    install,
    clearDemoModeFlag,
  };
})();
