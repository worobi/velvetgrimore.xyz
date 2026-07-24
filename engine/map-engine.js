// ============================================================
// VELVET GRIMOIRE — Map Engine v1.0
// Zone-based free grid, Diablo 4 style
// Fog of war, event tiles, party movement
// ============================================================

const VGMap = (() => {

  // ── Tile Types ─────────────────────────────────────────────
  const TILE_TYPES = {
    floor:    { label: 'Floor',      passable: true,  color: '#1a1520', icon: '' },
    wall:     { label: 'Wall',       passable: false, color: '#0a0810', icon: '' },
    door:     { label: 'Door',       passable: true,  color: '#3a2a10', icon: '🚪' },
    water:    { label: 'Water',      passable: false, color: '#0a1520', icon: '〰' },
    corridor: { label: 'Corridor',   passable: true,  color: '#141018', icon: '' },
    stairs:   { label: 'Stairs',     passable: true,  color: '#2a2030', icon: '⬆' },
    void:     { label: 'Void',       passable: false, color: '#050408', icon: '' },
  };

  // ── Event Types ────────────────────────────────────────────
  const EVENT_TYPES = {
    scene:    { label: 'Scene',        icon: '🎭', color: '#c8a060', desc: 'Triggers a campaign scene' },
    combat:   { label: 'Combat',       icon: '⚔️',  color: '#cc3322', desc: 'Combat encounter' },
    loot:     { label: 'Loot',         icon: '🎁', color: '#22aa44', desc: 'Item or reward discovery' },
    trap:     { label: 'Trap',         icon: '💀', color: '#aa2266', desc: 'Hidden danger' },
    locked:   { label: 'Locked',       icon: '🔒', color: '#6644aa', desc: 'Requires key or roll to pass' },
    rest:     { label: 'Safe Room',    icon: '🏕️', color: '#446688', desc: 'Rest point — restore resources' },
    npc:      { label: 'NPC',          icon: '🧑', color: '#4488aa', desc: 'NPC encounter or dialogue' },
    custom:   { label: 'Custom',       icon: '✦',  color: '#888888', desc: 'DM-defined event' },
  };

  // ── Zone Biomes ────────────────────────────────────────────
  const ZONE_BIOMES = {
    dungeon:  { label: 'Dungeon',       floorColor: '#1a1520', wallColor: '#0d0a10', accent: '#4a3a60', fogColor: 'rgba(10,8,15,0.92)' },
    tavern:   { label: 'Tavern',        floorColor: '#1e1508', wallColor: '#100c04', accent: '#6a4010', fogColor: 'rgba(15,10,5,0.92)' },
    forest:   { label: 'Forest',        floorColor: '#0a1408', wallColor: '#050a04', accent: '#1a4a10', fogColor: 'rgba(5,10,4,0.92)' },
    court:    { label: 'Royal Court',   floorColor: '#18100a', wallColor: '#0e0806', accent: '#5a3010', fogColor: 'rgba(14,8,6,0.92)' },
    ship:     { label: 'Ship',          floorColor: '#0a1218', wallColor: '#060a10', accent: '#104060', fogColor: 'rgba(6,10,16,0.92)' },
    city:     { label: 'City',          floorColor: '#141214', wallColor: '#0a080a', accent: '#3a2a3a', fogColor: 'rgba(10,8,10,0.92)' },
    ruins:    { label: 'Ruins',         floorColor: '#181410', wallColor: '#0e0a08', accent: '#4a3020', fogColor: 'rgba(14,10,8,0.92)' },
  };

  // ── Storage ────────────────────────────────────────────────
  const STORAGE_KEY = 'vg_maps';

  function getMaps() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  function saveMap(map) {
    const maps = getMaps();
    const idx = maps.findIndex(m => m.id === map.id);
    map.updatedAt = Date.now();
    if (idx >= 0) maps[idx] = map; else maps.push(map);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
    return map;
  }
  function getMap(id) { return getMaps().find(m => m.id === id) || null; }
  function deleteMap(id) {
    const maps = getMaps().filter(m => m.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  }

  // ── Map Creation ───────────────────────────────────────────
  function createMap(data) {
    const cols = data.cols || 20;
    const rows = data.rows || 15;
    const map = {
      id: uid(),
      campaignId: data.campaignId || null,
      name: data.name || 'New Map',
      biome: data.biome || 'dungeon',
      cols, rows,
      tiles: generateEmptyGrid(cols, rows, data.biome || 'dungeon'),
      zones: [],
      events: [],
      partyPos: data.startPos || { x: 1, y: 1 },
      revealedTiles: [],   // tiles the party has visited
      sightRadius: data.sightRadius || 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return saveMap(map);
  }

  function generateEmptyGrid(cols, rows, biome) {
    const tiles = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const isWall = x === 0 || y === 0 || x === cols-1 || y === rows-1;
        tiles.push({
          x, y,
          type: isWall ? 'wall' : 'floor',
          zoneId: null,
          eventId: null,
          label: '',
        });
      }
    }
    return tiles;
  }

  function getTile(map, x, y) {
    return map.tiles.find(t => t.x === x && t.y === y) || null;
  }

  function setTile(map, x, y, data) {
    const idx = map.tiles.findIndex(t => t.x === x && t.y === y);
    if (idx >= 0) { map.tiles[idx] = { ...map.tiles[idx], ...data }; }
    return map;
  }

  // ── Zones ──────────────────────────────────────────────────
  function createZone(map, data) {
    const zone = {
      id: uid(),
      name: data.name || 'New Zone',
      biome: data.biome || map.biome,
      color: data.color || '#2a1a3a',
      description: data.description || '',
      tiles: data.tiles || [],   // array of {x,y}
      connections: data.connections || [],  // zone ids this connects to
      isDiscovered: false,
    };
    map.zones.push(zone);
    // Tag tiles with this zone
    zone.tiles.forEach(({x,y}) => setTile(map, x, y, { zoneId: zone.id }));
    return { map, zone };
  }

  function getZone(map, id) { return map.zones.find(z => z.id === id) || null; }

  // ── Events ─────────────────────────────────────────────────
  function placeEvent(map, data) {
    // Remove any existing event at this position
    map.events = map.events.filter(e => !(e.x === data.x && e.y === data.y));
    const event = {
      id: uid(),
      x: data.x,
      y: data.y,
      type: data.type || 'scene',
      label: data.label || '',
      description: data.description || '',
      sceneId: data.sceneId || null,
      loot: data.loot || null,
      dc: data.dc || null,
      triggered: false,
      triggerCount: 0,
      repeatable: data.repeatable || false,
      hidden: data.hidden || false,   // trap / hidden event — only reveals on step
      customIcon: data.customIcon || null,
      customColor: data.customColor || null,
      notes: data.notes || '',
    };
    map.events.push(event);
    setTile(map, data.x, data.y, { eventId: event.id });
    return { map, event };
  }

  function removeEvent(map, eventId) {
    const event = map.events.find(e => e.id === eventId);
    if (event) {
      setTile(map, event.x, event.y, { eventId: null });
      map.events = map.events.filter(e => e.id !== eventId);
    }
    return map;
  }

  function getEventAt(map, x, y) {
    return map.events.find(e => e.x === x && e.y === y) || null;
  }

  // ── Random Event Seeding ───────────────────────────────────
  function seedRandomEvents(map, options = {}) {
    const {
      density = 0.15,        // % of passable tiles that get events
      types = ['scene','combat','loot','trap','npc','rest'],
      weights = { scene:25, combat:25, loot:20, trap:15, npc:10, rest:5 },
      avoidExisting = true,
      preserveManual = true,  // don't overwrite manually placed events
    } = options;

    const passableTiles = map.tiles.filter(t => {
      const tType = TILE_TYPES[t.type];
      if (!tType?.passable) return false;
      if (preserveManual && t.eventId) return false;
      // Don't place on start position
      if (t.x === map.partyPos.x && t.y === map.partyPos.y) return false;
      return true;
    });

    const count = Math.floor(passableTiles.length * density);
    const shuffled = [...passableTiles].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, count);

    chosen.forEach(tile => {
      const type = weightedRandom(types, weights);
      placeEvent(map, {
        x: tile.x,
        y: tile.y,
        type,
        label: `Random ${EVENT_TYPES[type]?.label || type}`,
        hidden: type === 'trap',
        repeatable: type === 'rest',
      });
    });

    return map;
  }

  function weightedRandom(types, weights) {
    const total = types.reduce((s, t) => s + (weights[t] || 1), 0);
    let r = Math.random() * total;
    for (const t of types) {
      r -= (weights[t] || 1);
      if (r <= 0) return t;
    }
    return types[0];
  }

  // ── Movement ───────────────────────────────────────────────
  function canMove(map, x, y) {
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
    const tile = getTile(map, x, y);
    if (!tile) return false;
    const tType = TILE_TYPES[tile.type];
    return tType?.passable !== false;
  }

  function moveParty(map, newX, newY, dmOverride = false) {
    if (!canMove(map, newX, newY) && !dmOverride) {
      return { map, moved: false, reason: 'impassable', event: null };
    }

    map.partyPos = { x: newX, y: newY };

    // Reveal tiles in sight radius
    revealAround(map, newX, newY, map.sightRadius);

    // Mark zone as discovered
    const tile = getTile(map, newX, newY);
    if (tile?.zoneId) {
      const zone = getZone(map, tile.zoneId);
      if (zone) zone.isDiscovered = true;
    }

    // Check for event
    const event = getEventAt(map, newX, newY);
    let triggeredEvent = null;
    if (event && (!event.triggered || event.repeatable)) {
      event.triggered = true;
      event.triggerCount++;
      triggeredEvent = event;
    }

    return { map, moved: true, event: triggeredEvent };
  }

  function revealAround(map, cx, cy, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist <= radius) {
          const key = `${cx+dx},${cy+dy}`;
          if (!map.revealedTiles.includes(key)) {
            map.revealedTiles.push(key);
          }
        }
      }
    }
  }

  function isTileRevealed(map, x, y) {
    return map.revealedTiles.includes(`${x},${y}`);
  }

  function isTileVisible(map, x, y) {
    const dx = x - map.partyPos.x;
    const dy = y - map.partyPos.y;
    return Math.sqrt(dx*dx + dy*dy) <= map.sightRadius;
  }

  function revealAll(map) {
    map.tiles.forEach(t => {
      const key = `${t.x},${t.y}`;
      if (!map.revealedTiles.includes(key)) map.revealedTiles.push(key);
    });
    return map;
  }

  function resetFog(map) {
    map.revealedTiles = [];
    revealAround(map, map.partyPos.x, map.partyPos.y, map.sightRadius);
    return map;
  }

  // ── Rect Zone Helper ───────────────────────────────────────
  function rectTiles(x1, y1, x2, y2) {
    const tiles = [];
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        tiles.push({ x, y });
    return tiles;
  }

  // ── Preset Maps ────────────────────────────────────────────
  function generatePresetMap(preset, campaignId) {
    if (preset === 'tavern') return generateTavernMap(campaignId);
    if (preset === 'dungeon') return generateDungeonMap(campaignId);
    if (preset === 'city') return generateCityMap(campaignId);
    return createMap({ campaignId, name: 'Custom Map', biome: 'dungeon' });
  }

  function generateTavernMap(campaignId) {
    const map = createMap({ campaignId, name: 'The Rusty Flagon', biome: 'tavern', cols: 24, rows: 18, startPos: { x: 12, y: 16 } });

    // Paint all interior as floor
    for (let y = 1; y < map.rows-1; y++)
      for (let x = 1; x < map.cols-1; x++)
        setTile(map, x, y, { type: 'floor' });

    // Walls dividing rooms
    // Main hall divider
    for (let x = 1; x < 24; x++) setTile(map, x, 6, { type: 'wall' });
    setTile(map, 8, 6, { type: 'door' }); setTile(map, 16, 6, { type: 'door' });

    // Left room divider
    for (let y = 1; y < 6; y++) setTile(map, 8, y, { type: 'wall' });
    setTile(map, 8, 3, { type: 'door' });

    // Right room divider
    for (let y = 1; y < 6; y++) setTile(map, 16, y, { type: 'wall' });
    setTile(map, 16, 3, { type: 'door' });

    // Upper corridor divider
    for (let x = 1; x < 24; x++) setTile(map, x, 12, { type: 'wall' });
    setTile(map, 6, 12, { type: 'door' }); setTile(map, 18, 12, { type: 'door' });

    // Zones
    const { map: m1 } = createZone(map, { name: 'Main Hall', biome: 'tavern', color: '#3a2010', tiles: rectTiles(1,7,23,11), description: 'Crowded tables, firelight, whispered deals.' });
    const { map: m2 } = createZone(m1, { name: 'Private Booth', biome: 'tavern', color: '#2a1808', tiles: rectTiles(1,1,7,5), description: 'Dark corner. Someone is always watching.' });
    const { map: m3 } = createZone(m2, { name: 'Barkeep\'s Room', biome: 'tavern', color: '#301a08', tiles: rectTiles(9,1,15,5), description: 'Stock, secrets, and a hidden cellar door.' });
    const { map: m4 } = createZone(m3, { name: 'The Red Room', biome: 'tavern', color: '#3a1015', tiles: rectTiles(17,1,23,5), description: 'Velvet curtains. Membership required.' });
    createZone(m4, { name: 'Back Alley', biome: 'city', color: '#1a1a1a', tiles: rectTiles(1,13,23,17), description: 'Where deals end — or begin.' });

    // Events
    placeEvent(map, { x:4, y:9, type:'npc', label:'Shady Merchant', description:'Offers rare goods. Asks no questions.' });
    placeEvent(map, { x:12, y:9, type:'scene', label:'Barkeep Confrontation', description:'They know something.' });
    placeEvent(map, { x:20, y:9, type:'combat', label:'Bar Fight Breaks Out' });
    placeEvent(map, { x:4, y:3, type:'loot', label:'Hidden Stash', description:'Under the booth seat.', hidden:true });
    placeEvent(map, { x:12, y:3, type:'scene', label:'Secret Meeting' });
    placeEvent(map, { x:20, y:3, type:'scene', label:'The Red Room Encounter', description:'Only for those with the token.' });
    placeEvent(map, { x:6, y:15, type:'trap', label:'Ambush', description:'They followed you.', hidden:true });
    placeEvent(map, { x:18, y:15, type:'rest', label:'Safe House', description:'A contact\'s room. Rest here.' });

    map.partyPos = { x: 12, y: 16 };
    revealAround(map, 12, 16, map.sightRadius);
    return saveMap(map);
  }

  function generateDungeonMap(campaignId) {
    const map = createMap({ campaignId, name: 'The Crimson Depths', biome: 'dungeon', cols: 28, rows: 22, startPos: { x: 14, y: 20 } });

    // Fill all as wall first
    map.tiles.forEach(t => { t.type = 'wall'; });

    // Carve rooms
    const rooms = [
      { x1:12,y1:18,x2:16,y2:20 }, // entrance
      { x1:8,y1:13,x2:19,y2:17 },  // main chamber
      { x1:2,y1:8,x2:10,y2:12 },   // left wing
      { x1:17,y1:8,x2:25,y2:12 },  // right wing
      { x1:5,y1:2,x2:12,y2:7 },    // upper left
      { x1:15,y1:2,x2:22,y2:7 },   // upper right
      { x1:11,y1:9,x2:16,y2:12 },  // center connector
    ];

    // Corridors
    const corridors = [
      { x1:13,y1:17,x2:13,y2:18 },
      { x1:13,y1:12,x2:13,y2:13 },
      { x1:10,y1:14,x2:12,y2:14 },
      { x1:17,y1:14,x2:19,y2:14 },
      { x1:6,y1:7,x2:6,y2:8 },
      { x1:19,y1:7,x2:19,y2:8 },
      { x1:12,y1:5,x2:15,y2:5 },
    ];

    [...rooms, ...corridors].forEach(r => {
      for (let y = r.y1; y <= r.y2; y++)
        for (let x = r.x1; x <= r.x2; x++)
          setTile(map, x, y, { type: 'floor' });
    });

    // Doors
    [[13,17],[10,13],[17,13],[6,7],[19,7],[13,5]].forEach(([x,y]) => setTile(map, x, y, { type:'door' }));

    // Zones
    createZone(map, { name:'Entrance Hall', biome:'dungeon', color:'#1a1830', tiles:rectTiles(12,18,16,20) });
    createZone(map, { name:'Main Chamber', biome:'dungeon', color:'#251525', tiles:rectTiles(8,13,19,17) });
    createZone(map, { name:'The Vault', biome:'dungeon', color:'#201520', tiles:[...rectTiles(2,8,10,12),...rectTiles(10,9,16,12)] });
    createZone(map, { name:'Torture Wing', biome:'dungeon', color:'#251008', tiles:rectTiles(17,8,25,12) });
    createZone(map, { name:'Ritual Chamber', biome:'dungeon', color:'#150820', tiles:rectTiles(5,2,12,7) });
    createZone(map, { name:'Throne Room', biome:'dungeon', color:'#200810', tiles:rectTiles(15,2,22,7) });

    // Events
    placeEvent(map, { x:13,y:19, type:'scene', label:'Enter the Dark', description:'The way forward. No turning back.' });
    placeEvent(map, { x:10,y:15, type:'combat', label:'Guard Patrol' });
    placeEvent(map, { x:17,y:15, type:'trap', label:'Pressure Plate', hidden:true });
    placeEvent(map, { x:5,y:10, type:'loot', label:'Ancient Chest' });
    placeEvent(map, { x:22,y:10, type:'scene', label:'Prisoner', description:'Someone is chained here. They know the layout.' });
    placeEvent(map, { x:8,y:4, type:'scene', label:'Ritual In Progress', description:'Three figures in robes. The air smells of blood.' });
    placeEvent(map, { x:18,y:4, type:'scene', label:'The Throne', label:'The one you came for sits here.' });
    placeEvent(map, { x:13,y:9, type:'rest', label:'Hidden Alcove', description:'Safe to rest for 1 turn.' });
    placeEvent(map, { x:3,y:9, type:'locked', label:'Sealed Door', dc:15, description:'Requires the iron key.' });

    map.partyPos = { x: 14, y: 20 };
    revealAround(map, 14, 20, map.sightRadius);
    return saveMap(map);
  }

  function generateCityMap(campaignId) {
    const map = createMap({ campaignId, name: 'City of Veils', biome: 'city', cols: 30, rows: 24, startPos: { x: 15, y: 22 } });

    map.tiles.forEach(t => { t.type = t.x===0||t.y===0||t.x===map.cols-1||t.y===map.rows-1?'wall':'floor'; });

    // Streets (walls forming city blocks)
    [6,13,20].forEach(x => { for(let y=1;y<23;y++) setTile(map,x,y,{type:'wall'}); });
    [7,14,21].forEach(x => { for(let y=1;y<23;y++) setTile(map,x,y,{type:'wall'}); });
    [7,15].forEach(y => { for(let x=1;x<29;x++) setTile(map,x,y,{type:'wall'}); });

    // Crossings (doors = open intersections)
    [[6,11],[7,11],[20,11],[21,11],[13,11],[14,11]].forEach(([x,y]) => setTile(map,x,y,{type:'floor'}));
    [[13,7],[14,7],[13,18],[14,18],[6,7],[7,7],[20,7],[21,7],[6,18],[7,18],[20,18],[21,18]].forEach(([x,y])=>setTile(map,x,y,{type:'floor'}));

    // Zones (city districts)
    createZone(map, { name:'Market District', biome:'city', color:'#201808', tiles:rectTiles(1,1,5,14) });
    createZone(map, { name:'The Pleasure Quarter', biome:'tavern', color:'#200a14', tiles:rectTiles(8,1,12,14) });
    createZone(map, { name:'Noble Row', biome:'court', color:'#18100a', tiles:rectTiles(15,1,19,14) });
    createZone(map, { name:'The Warrens', biome:'dungeon', color:'#10101a', tiles:rectTiles(22,1,28,14) });
    createZone(map, { name:'The Docks', biome:'ship', color:'#080e14', tiles:rectTiles(1,16,28,22) });

    // Events
    placeEvent(map, { x:3,y:6, type:'npc', label:'Fence', description:'Buys and sells. No questions.' });
    placeEvent(map, { x:3,y:11, type:'scene', label:'Market Confrontation' });
    placeEvent(map, { x:10,y:5, type:'scene', label:'Velvet Parlor', description:'Invitation only — unless you\'re persuasive.' });
    placeEvent(map, { x:10,y:11, type:'loot', label:'Stolen Pouch', hidden:true });
    placeEvent(map, { x:17,y:5, type:'scene', label:'Lord\'s Manor', description:'He\'s expecting someone. Not you.' });
    placeEvent(map, { x:17,y:11, type:'combat', label:'Assassin Ambush', hidden:true });
    placeEvent(map, { x:25,y:5, type:'locked', label:'Guild Hall', dc:14, description:'Password required.' });
    placeEvent(map, { x:25,y:11, type:'trap', label:'Rigged Staircase', hidden:true });
    placeEvent(map, { x:8,y:20, type:'scene', label:'The Smuggler\'s Ship' });
    placeEvent(map, { x:20,y:20, type:'combat', label:'Harbor Guard Patrol' });
    placeEvent(map, { x:15,y:22, type:'rest', label:'Safe House', description:'Your contact\'s bolt-hole.' });

    map.partyPos = { x: 15, y: 22 };
    revealAround(map, 15, 22, map.sightRadius);
    return saveMap(map);
  }

  // ── Helpers ────────────────────────────────────────────────
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function exportMap(id) {
    const map = getMap(id);
    if (!map) return;
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${map.name.replace(/\s+/g,'-').toLowerCase()}-map.json`; a.click();
  }

  function importMap(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      data.id = uid();
      return saveMap(data);
    } catch(e) { return null; }
  }

  // ── Public ─────────────────────────────────────────────────
  return {
    TILE_TYPES, EVENT_TYPES, ZONE_BIOMES,
    getMaps, getMap, saveMap, deleteMap, createMap,
    getTile, setTile,
    createZone, getZone,
    placeEvent, removeEvent, getEventAt,
    seedRandomEvents,
    moveParty, canMove, revealAround, isTileRevealed, isTileVisible, revealAll, resetFog,
    rectTiles, generatePresetMap,
    exportMap, importMap, uid,
  };
})();

window.VGMap = VGMap;
