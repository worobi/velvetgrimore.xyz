const parse = (value, fallback) => {
  try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; }
};
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));

function snapshot(table, viewer, canManage) {
  const source = table.snapshot || { keys: {} };
  const keys = { ...(source.keys || {}) };
  const personal = table.personal?.[viewer?.id] || {};
  // Safety answers and private cards belong to their author, including for Wardens.
  for (const key of ['vg_threshold_current', 'vg_thresholds', 'vg_hearths', 'vg_stations_done']) delete keys[key];
  keys.vg_threshold_current = JSON.stringify(personal.threshold || null);
  keys.vg_thresholds = JSON.stringify(personal.thresholds || []);
  keys.vg_hearths = JSON.stringify(personal.hearths || []);
  keys.vg_stations_done = JSON.stringify(personal.stations || []);
  const cards = parse(keys.vg_intimacy_cards, {});
  const ownCards = {};
  for (const [scene, entries] of Object.entries(cards)) {
    const owned = Object.fromEntries(Object.entries(entries).filter(([role, card]) => card?.clientId === viewer?.id || (!card?.clientId && role === 'dm' && currentWardenId(table) === viewer?.id)));
    if (Object.keys(owned).length) ownCards[scene] = owned;
  }
  keys.vg_intimacy_cards = JSON.stringify(ownCards);
  keys.vg_player_notes = JSON.stringify(personal.notes || {});
  if (canManage) return { ...source, keys };
  const session = parse(keys.vg_session, null);
  const campaigns = parse(keys.vg_campaigns, []);
  const campaign = Array.isArray(campaigns) && campaigns.find(c => c.id === session?.campaignId);
  const allowed = {};
  for (const key of ['vg_signals', 'vg_intimacy_chat', 'vg_intimacy_state', 'vg_active_map_id', 'vg_threshold_current', 'vg_thresholds', 'vg_hearths', 'vg_stations_done', 'vg_intimacy_cards', 'vg_player_notes']) if (keys[key] !== undefined) allowed[key] = keys[key];
  if (session) allowed.vg_session = JSON.stringify({ ...pick(session, ['id', 'campaignId', 'currentSceneId', 'startedAt', 'lastSaved']), history: (session.history || []).map(entry => pick(entry, ['sceneId', 'sceneTitle', 'choiceMade', 'roll', 'timestamp'])) });
  const sceneIds = new Set([session?.currentSceneId, ...(session?.history || []).map(h => h.sceneId)]);
  allowed.vg_campaigns = JSON.stringify(campaign ? [{
    ...pick(campaign, ['id', 'name', 'setting', 'contentRating', 'hallowed', 'veiled', 'customWards', 'ackedWards']),
    protagonist: pick(campaign.protagonist, ['name', 'class', 'level', 'traits', 'banishedNames', 'limits']),
    npc: pick(campaign.npc, ['name', 'role']),
    antagonists: (campaign.antagonists || []).map(npc => pick(npc, ['id', 'name', 'role', 'controlledBy'])),
    scenes: (campaign.scenes || []).filter(scene => sceneIds.has(scene.id)).map(scene => ({
      ...pick(scene, ['id', 'title', 'narrative', 'npcCue', 'setting', 'tags', 'attributes', 'dc', 'requiresRoll', 'elementWards', 'intensityWard', 'frameWard', 'isStart', 'isEnd']),
      branches: Object.fromEntries(Object.entries(scene.branches || {}).map(([name, branch]) => [name, pick(branch, ['label', 'nextSceneId'])])),
    })),
  }] : []);
  const maps = parse(keys.vg_maps, []);
  const activeMap = keys.vg_active_map_id || maps[0]?.id;
  allowed.vg_maps = JSON.stringify(maps.filter(map => map.id === activeMap).map(map => {
    const revealed = new Set(map.revealedTiles || []);
    const visible = tile => revealed.has(`${tile.x},${tile.y}`);
    return {
      ...pick(map, ['id', 'name', 'cols', 'rows', 'biome', 'partyPos', 'sightRadius', 'revealedTiles', 'updatedAt']),
      tiles: (map.tiles || []).map(tile => visible(tile) ? pick(tile, ['x', 'y', 'type', 'zoneId']) : { x: tile.x, y: tile.y, type: 'void' }),
      zones: (map.zones || []).filter(zone => zone.isDiscovered).map(zone => pick(zone, ['id', 'name', 'biome', 'isDiscovered'])),
      events: (map.events || []).filter(event => event.triggered && visible(event)).map(event => pick(event, ['id', 'x', 'y', 'type', 'label', 'triggered'])),
    };
  }));
  return { ...source, keys: allowed };
}

function currentWardenId(table) {
  return table.wardenId || Object.values(table.players || {}).find(player => player.role === 'warden')?.id;
}

function events(table, records, viewer, canManage) {
  if (canManage) return records;
  return records.filter(event => {
    if (event.status === 'pending' && event.clientId !== viewer?.id) return false;
    const target = event.detail?.target;
    if (target && target !== 'all' && target !== viewer?.id) return false;
    const room = table.rooms?.find(room => room.id === event.detail?.roomId);
    if (room && (room.kind === 'warden' || !(room.members || []).some(id => id === 'all' || id === viewer?.id))) return false;
    return true;
  }).map(event => {
    if (['intimacy.card', 'safety.threshold', 'safety.hearth'].includes(event.type) && event.clientId !== viewer?.id) return { ...event, detail: {}, text: `${event.name} updated their table check-in.` };
    return event;
  });
}

module.exports = { snapshot, events };
