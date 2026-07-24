// ============================================================
// VELVET GRIMOIRE — Core Engine
// ============================================================

const VGEngine = (() => {

  // ── State ──────────────────────────────────────────────────
  let state = {
    campaign: null,
    session: {
      id: null,
      currentSceneId: null,
      history: [],       // [{sceneId, choiceMade, roll, timestamp}]
      characters: {},
      startedAt: null,
      lastSaved: null,
    },
    discordWebhook: null,
  };

  // ── Storage Keys ───────────────────────────────────────────
  const KEYS = {
    campaigns: 'vg_campaigns',
    session:   'vg_session',
    webhook:   'vg_webhook',
    templates: 'vg_templates',
    seeded:    'vg_seeded',
  };

  // ── Ward Vocabulary (from compact/TAGS.md §II–IV, §XI) ────
  // The canonical element-ward roster is grouped for UI display.
  // Adding new wards is additive: campaign.customWards lives alongside these.
  const CANONICAL_ELEMENT_WARDS = {
    'Presence & power': ['intimacy','nudity','arousal','power-exchange','dubcon-roleplay','noncon-roleplay','humiliation','praise','voyeurism','exhibition'],
    'Body & sensation': ['restraint','impact','pain','blood','wax','edge','breath','marking'],
    'Threat & narrative': ['violence','weaponry','captivity','interrogation','surveillance','pursuit','betrayal','manipulation'],
    'Substance & state': ['intoxication','drugs','dissociation','mind-altering'],
    'Body autonomy': ['body-modification','transformation','possession','body-horror'],
    'Social & institutional': ['religious-imagery','blasphemy','family-dynamics','authority','financial-coercion'],
    'Dark fantasy staples': ['undeath','fey','demon-pact','horror'],
  };

  // Hard-gated element wards require an explicit ack from the protagonist
  // owner at campaign creation (TAGS.md §II). Enforcement lands in Tier 2 (b).
  const HARD_GATED_WARDS = [
    'noncon-roleplay','dubcon-roleplay','captivity','pain','blood','breath','body-horror','humiliation'
  ];

  const INTENSITY_WARDS = ['suggested','explicit','visceral'];
  const FRAME_WARDS     = ['consensual-if','dubcon-if','noncon-if'];

  // Non-removable floor seeded on every new campaign (TAGS.md §XI).
  const DEFAULT_HALLOWED = ['child-harm','real-world-sexual-assault'];

  function normalizeTagText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeStringList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(normalizeTagText).filter(Boolean))];
  }

  function normalizeBanishedNames(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.reduce((acc, entry) => {
      if (entry == null) return acc;
      const tag = normalizeTagText(typeof entry === 'string' ? entry : entry.tag);
      if (!tag || seen.has(tag)) return acc;
      seen.add(tag);
      acc.push({
        tag,
        declaredAt: (typeof entry === 'object' && entry && entry.declaredAt) ? entry.declaredAt : new Date().toISOString(),
        note: (typeof entry === 'object' && entry && typeof entry.note === 'string') ? entry.note.trim() : '',
      });
      return acc;
    }, []);
  }

  function normalizeProtagonist(protagonist) {
    const base = defaultProtagonist();
    const merged = Object.assign({}, base, protagonist || {});
    merged.traits = normalizeStringList(merged.traits);
    merged.limits = normalizeStringList(merged.limits);
    merged.notes = typeof merged.notes === 'string' ? merged.notes : '';
    merged.banishedNames = normalizeBanishedNames(merged.banishedNames || merged.limits || []);
    return merged;
  }

  function safeReadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getWardRegistry() {
    return {
      elementGroups: CANONICAL_ELEMENT_WARDS,
      hardGated: HARD_GATED_WARDS.slice(),
      intensity: INTENSITY_WARDS.slice(),
      frame: FRAME_WARDS.slice(),
      defaultHallowed: DEFAULT_HALLOWED.slice(),
    };
  }

  // ── Campaign CRUD ──────────────────────────────────────────
  function getCampaigns() {
    return JSON.parse(localStorage.getItem(KEYS.campaigns) || '[]');
  }

  function saveCampaign(campaign) {
    const campaigns = getCampaigns();
    const idx = campaigns.findIndex(c => c.id === campaign.id);
    campaign.updatedAt = Date.now();
    campaign.protagonist = normalizeProtagonist(campaign.protagonist);
    // Defensive normalization so every write has clean ward state
    // regardless of which caller shaped the object.
    if (Array.isArray(campaign.ackedWards)) {
      campaign.ackedWards = [...new Set(
        campaign.ackedWards.filter(w => HARD_GATED_WARDS.includes(w))
      )];
    } else {
      campaign.ackedWards = [];
    }
    // Protagonist sign-off — null = not yet signed off by the player.
    // Once signed, it's the list of hard-gated wards the protagonist accepted.
    if (campaign.protagonistAckedWards === undefined) {
      campaign.protagonistAckedWards = null;
    } else if (Array.isArray(campaign.protagonistAckedWards)) {
      campaign.protagonistAckedWards = [...new Set(
        campaign.protagonistAckedWards.filter(w =>
          HARD_GATED_WARDS.includes(w) && campaign.ackedWards.includes(w)
        )
      )];
    }
    campaign.hallowed = normalizeStringList(
      Array.isArray(campaign.hallowed) ? campaign.hallowed : DEFAULT_HALLOWED.slice()
    );
    campaign.veiled = normalizeStringList(campaign.veiled);
    if (!Array.isArray(campaign.customWards)) campaign.customWards = [];
    // Ensure the hallowed floor is always present after any save.
    DEFAULT_HALLOWED.forEach(h => { if (!campaign.hallowed.includes(h)) campaign.hallowed.push(h); });
    // Antagonists: clamp to 5, give every row an id/controlledBy.
    if (!Array.isArray(campaign.antagonists)) campaign.antagonists = [];
    if (campaign.antagonists.length > 5) campaign.antagonists = campaign.antagonists.slice(0, 5);
    campaign.antagonists.forEach(a => {
      if (!a.id) a.id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      if (!a.controlledBy) a.controlledBy = 'dm';
    });
    if (idx >= 0) campaigns[idx] = campaign;
    else campaigns.push(campaign);
    localStorage.setItem(KEYS.campaigns, JSON.stringify(campaigns));
    return campaign;
  }

  function deleteCampaign(id) {
    const campaigns = getCampaigns().filter(c => c.id !== id);
    localStorage.setItem(KEYS.campaigns, JSON.stringify(campaigns));
  }

  function getCampaign(id) {
    return getCampaigns().find(c => c.id === id) || null;
  }

  function createCampaign(data) {
    // Merge the default Hallowed floor with any explicitly-supplied list,
    // deduped. The floor is never silently dropped.
    const hallowedIn = Array.isArray(data.hallowed) ? data.hallowed : [];
    const mergedHallowed = [...new Set([...DEFAULT_HALLOWED, ...hallowedIn])];

    // Antagonists — new multi-antagonist roster (max 5). If the caller
    // passed a list, clamp to max and ensure each has an id. Legacy callers
    // that only set `data.npc` fall through to defaultNPC() and get a
    // matching single-entry antagonists list so both shapes stay consistent.
    let antagonistsIn = Array.isArray(data.antagonists) ? data.antagonists.slice(0, 5) : null;
    if (antagonistsIn) {
      antagonistsIn = antagonistsIn.map(a => defaultAntagonist(a));
    } else if (data.npc) {
      antagonistsIn = [defaultAntagonist({
        name: data.npc.name || '',
        role: data.npc.role || '',
        personality: data.npc.personality || '',
        agenda: data.npc.agenda || '',
        notes: data.npc.notes || '',
      })];
    } else {
      antagonistsIn = [];
    }

    const campaign = {
      id: uid(),
      name: data.name || 'Untitled Campaign',
      description: data.description || '',
      setting: data.setting || 'tavern',
      protagonist: normalizeProtagonist(data.protagonist),
      npc: data.npc || (antagonistsIn[0] ? { ...antagonistsIn[0] } : defaultNPC()),   // legacy mirror
      antagonists: antagonistsIn,
      scenes: data.scenes || [],
      templates: data.templates || [],
      tags: data.tags || [],
      // ── Ward state (TAGS.md §VI, §XI) ────────────────────
      hallowed:    mergedHallowed,                        // non-removable floor included
      veiled:      normalizeStringList(data.veiled),
      customWards: Array.isArray(data.customWards) ? data.customWards : [],
      // Hard-gated wards the protagonist owner has explicitly acked
      // at campaign setup (TAGS.md §II). Anything here must be a
      // member of HARD_GATED_WARDS; other entries are silently dropped.
      ackedWards:  Array.isArray(data.ackedWards)
                     ? data.ackedWards.filter(w => HARD_GATED_WARDS.includes(w))
                     : [],
      contentRating: data.contentRating || 'mature',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return saveCampaign(campaign);
  }

  // ── Scene CRUD ─────────────────────────────────────────────
  function createScene(campaignId, data) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    const scene = {
      id: uid(),
      title: data.title || 'New Scene',
      narrative: data.narrative || '',       // DM reads this
      npcCue: data.npcCue || '',             // NPC player sees this
      setting: data.setting || {},
      tags: data.tags || [],                 // legacy free-text tags (kept for back-compat)
      attributes: data.attributes || {},
      dc: data.dc || { fight: 12, flight: 8, fawn: 4, freeze: 5 },
      requiresRoll: data.requiresRoll !== false,
      branches: {
        fight:  { label: data.fightLabel  || 'Stand & Fight',  narrative: data.fightNarrative  || '', nextSceneId: data.fightNext  || null },
        flight: { label: data.flightLabel || 'Take Flight',    narrative: data.flightNarrative || '', nextSceneId: data.flightNext || null },
        fawn:   { label: data.fawnLabel   || 'Appease & Yield', narrative: data.fawnNarrative   || '', nextSceneId: data.fawnNext   || null },
        freeze: { label: data.freezeLabel || 'Hold Position',  narrative: data.freezeNarrative || '', nextSceneId: data.freezeNext || null },
      },
      // ── Ward schema (TAGS.md §I) ─────────────────────────
      elementWards:  Array.isArray(data.elementWards) ? data.elementWards : [],
      intensityWard: INTENSITY_WARDS.includes(data.intensityWard) ? data.intensityWard : 'suggested',
      frameWard:     FRAME_WARDS.includes(data.frameWard) ? data.frameWard : 'consensual-if',
      isStart: data.isStart || false,
      isEnd: data.isEnd || false,
      templateId: data.templateId || null,
      createdAt: Date.now(),
    };
    campaign.scenes.push(scene);
    saveCampaign(campaign);
    return scene;
  }

  // ── Scene Validation — TAGS.md §VIII authoring checklist ──
  // Returns {
  //   ok:        boolean,
  //   errors:    string[],                   // hard-halts that block save
  //   warnings:  string[],                   // advisories (e.g. veil downgrade)
  //   adjusted:  sceneData,                  // same object with any auto-adjustments applied
  // }
  // Scope for this Tier 2 slice (schema foundations only):
  //   ✓ at least one element ward
  //   ✓ intensity and frame chosen from canonical values
  //   ✓ frame→element requirement (dubcon-if needs dubcon-roleplay, noncon-if needs noncon-roleplay)
  //   ✓ hallowed intersection → red-halt
  //   ✓ veiled intersection → silent downgrade to 'suggested'
  function validateScene(sceneData, campaign) {
    const wards     = Array.isArray(sceneData.elementWards) ? sceneData.elementWards : [];
    const intensity = sceneData.intensityWard;
    const frame     = sceneData.frameWard;
    const adjusted  = { ...sceneData, elementWards: wards.slice() };
    const result    = { ok: true, errors: [], warnings: [], adjusted };

    if (wards.length === 0) {
      result.ok = false;
      result.errors.push('Select at least one element ward.');
    }
    if (!INTENSITY_WARDS.includes(intensity)) {
      result.ok = false;
      result.errors.push('Choose an intensity ward (suggested / explicit / visceral).');
    }
    if (!FRAME_WARDS.includes(frame)) {
      result.ok = false;
      result.errors.push('Choose a frame ward (consensual-if / dubcon-if / noncon-if).');
    }

    // Frame → element requirement
    if (frame === 'dubcon-if' && !wards.includes('dubcon-roleplay')) {
      result.ok = false;
      result.errors.push('Frame "dubcon-if" requires the element ward "dubcon-roleplay".');
    }
    if (frame === 'noncon-if' && !wards.includes('noncon-roleplay')) {
      result.ok = false;
      result.errors.push('Frame "noncon-if" requires the element ward "noncon-roleplay".');
    }

    // Hallowed — hard halt
    const hallowed = (campaign && campaign.hallowed) || [];
    const hallowedHits = wards.filter(w => hallowed.includes(w));
    if (hallowedHits.length > 0) {
      result.ok = false;
      result.errors.push(
        `⛔ Hallowed Ground — this campaign does not permit: ${hallowedHits.join(', ')}. The scene cannot be saved as authored.`
      );
    }

    // Hard-gated acks (TAGS.md §II) — any 🔒 ward in the scene must
    // appear in campaign.ackedWards. Missing acks halt the save.
    const acked = Array.isArray(campaign && campaign.ackedWards) ? campaign.ackedWards : [];
    const gatedInScene   = wards.filter(w => HARD_GATED_WARDS.includes(w));
    const unackedGated   = gatedInScene.filter(w => !acked.includes(w));
    if (unackedGated.length > 0) {
      result.ok = false;
      result.errors.push(
        `🔒 Hard-gated — this campaign hasn't acked: ${unackedGated.join(', ')}. ` +
        `Open the campaign, tick the ack for each, then save again.`
      );
    }

    // Banished Names — protagonist-level hard limits.
    const banished = Array.isArray(campaign?.protagonist?.banishedNames)
      ? campaign.protagonist.banishedNames.map(entry => normalizeTagText(entry.tag))
      : [];
    const banishedHits = wards.filter(w => banished.includes(w));
    if (banishedHits.length > 0) {
      const name = campaign?.protagonist?.name || 'the protagonist';
      result.ok = false;
      result.errors.push(
        `⛔ Banished Names — ${name} bars: ${banishedHits.join(', ')}. ` +
        `Remove the ward or revise the protagonist's standing limits first.`
      );
    }

    // Veiled — silent downgrade to 'suggested'
    const veiled = (campaign && campaign.veiled) || [];
    const veiledHits = wards.filter(w => veiled.includes(w));
    if (veiledHits.length > 0 && intensity !== 'suggested') {
      adjusted.intensityWard = 'suggested';
      result.warnings.push(
        `🌫️ Veiled Ground — intensity downgraded to 'suggested' because the scene carries: ${veiledHits.join(', ')}.`
      );
    }

    // First scene of a campaign stays suggested-only.
    if (sceneData.isStart && adjusted.intensityWard !== 'suggested') {
      result.ok = false;
      result.errors.push('The starting scene of a campaign must use the "suggested" intensity ward.');
    }

    // Do not allow consecutive visceral scenes in the scene graph.
    if (adjusted.intensityWard === 'visceral' && Array.isArray(campaign?.scenes)) {
      const currentId = sceneData.id || null;
      const otherScenes = campaign.scenes.filter(s => s.id !== currentId);
      const inboundVisceral = otherScenes.filter(s =>
        s.intensityWard === 'visceral' &&
        ['fight','flight','fawn','freeze'].some(branch => s.branches?.[branch]?.nextSceneId === currentId)
      );
      const outboundIds = ['fight','flight','fawn','freeze']
        .map(branch => adjusted.branches?.[branch]?.nextSceneId)
        .filter(Boolean);
      const outboundVisceral = otherScenes.filter(s =>
        s.intensityWard === 'visceral' && outboundIds.includes(s.id)
      );
      const consecutive = [...new Set([
        ...inboundVisceral.map(s => s.title),
        ...outboundVisceral.map(s => s.title),
      ])];
      if (consecutive.length > 0) {
        result.ok = false;
        result.errors.push(
          `Visceral scenes must be separated by a softer beat. Consecutive visceral link(s): ${consecutive.join(', ')}.`
        );
      }
    }

    return result;
  }

  // ── Ward-ack API (TAGS.md §II) ─────────────────────────────
  // Set the full list of acked hard-gated wards for a campaign.
  // Non-gated entries are dropped. Duplicates deduped.
  function setAckedWards(campaignId, list) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    const cleaned = Array.isArray(list)
      ? [...new Set(list.filter(w => HARD_GATED_WARDS.includes(w)))]
      : [];
    campaign.ackedWards = cleaned;
    saveCampaign(campaign);
    return cleaned;
  }

  // Toggle a single hard-gated ward's ack state. Returns the new list.
  function toggleAckedWard(campaignId, ward) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    if (!HARD_GATED_WARDS.includes(ward)) return campaign.ackedWards || [];
    const list = Array.isArray(campaign.ackedWards) ? campaign.ackedWards.slice() : [];
    const idx = list.indexOf(ward);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(ward);
    campaign.ackedWards = list;
    saveCampaign(campaign);
    return list;
  }

  // Protagonist sign-off — sets the player-side ack list. Only wards
  // the DM has already acked are accepted; other values are dropped.
  // Pass [] to record "signed off but declined everything" (still a
  // valid sign-off — the player has seen the stack).
  function setProtagonistAcks(campaignId, list) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    const dmAcked = Array.isArray(campaign.ackedWards) ? campaign.ackedWards : [];
    const cleaned = Array.isArray(list)
      ? [...new Set(list.filter(w => HARD_GATED_WARDS.includes(w) && dmAcked.includes(w)))]
      : [];
    campaign.protagonistAckedWards = cleaned;
    saveCampaign(campaign);
    return cleaned;
  }

  // Per-campaign schema migration. Returns { campaign, dirty } so callers
  // can decide whether to persist. Used by both the bulk migrator and by
  // importCampaign() so old exports come in fully-shaped.
  function migrateOneCampaign(c) {
    let dirty = false;
    const normalizedProtagonist = normalizeProtagonist(c.protagonist);
    if (JSON.stringify(normalizedProtagonist) !== JSON.stringify(c.protagonist || {})) {
      c.protagonist = normalizedProtagonist;
      dirty = true;
    }
    if (!Array.isArray(c.ackedWards))  { c.ackedWards  = []; dirty = true; }
    if (c.protagonistAckedWards === undefined) { c.protagonistAckedWards = null; dirty = true; }
    if (!Array.isArray(c.hallowed))    { c.hallowed    = DEFAULT_HALLOWED.slice(); dirty = true; }
    if (!Array.isArray(c.veiled))      { c.veiled      = []; dirty = true; }
    const normalizedHallowed = normalizeStringList(c.hallowed);
    const normalizedVeiled = normalizeStringList(c.veiled);
    if (JSON.stringify(normalizedHallowed) !== JSON.stringify(c.hallowed)) { c.hallowed = normalizedHallowed; dirty = true; }
    if (JSON.stringify(normalizedVeiled) !== JSON.stringify(c.veiled)) { c.veiled = normalizedVeiled; dirty = true; }
    if (!Array.isArray(c.customWards)) { c.customWards = []; dirty = true; }
    // Make sure the hallowed floor is always present.
    DEFAULT_HALLOWED.forEach(h => {
      if (!c.hallowed.includes(h)) { c.hallowed.push(h); dirty = true; }
    });
    // Multi-antagonist migration: if antagonists missing but legacy
    // npc present, seed the roster from it.
    if (!Array.isArray(c.antagonists)) {
      c.antagonists = c.npc
        ? [{
            id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
            name: c.npc.name || '',
            role: c.npc.role || '',
            personality: c.npc.personality || '',
            agenda: c.npc.agenda || '',
            notes: c.npc.notes || '',
            controlledBy: 'dm',
          }]
        : [];
      dirty = true;
    }
    // Ensure every antagonist has an id + controlledBy.
    c.antagonists.forEach(a => {
      if (!a.id) { a.id = Date.now().toString(36) + Math.random().toString(36).slice(2,7); dirty = true; }
      if (!a.controlledBy) { a.controlledBy = 'dm'; dirty = true; }
    });
    if (c.antagonists.length > 5) { c.antagonists = c.antagonists.slice(0, 5); dirty = true; }
    // Scene ward defaults — make sure every scene has the ward fields so
    // the authoring UI doesn't crash on legacy imports.
    if (Array.isArray(c.scenes)) {
      c.scenes.forEach(s => {
        if (!Array.isArray(s.elementWards)) { s.elementWards = []; dirty = true; }
        if (!INTENSITY_WARDS.includes(s.intensityWard)) { s.intensityWard = 'suggested'; dirty = true; }
        if (!FRAME_WARDS.includes(s.frameWard)) { s.frameWard = 'consensual-if'; dirty = true; }
        // Fawn branch — add to any legacy scene that pre-dates the 4-branch schema.
        if (!s.branches) { s.branches = {}; dirty = true; }
        if (!s.branches.fawn) {
          s.branches.fawn = { label: 'Appease & Yield', narrative: '', nextSceneId: null };
          dirty = true;
        }
        if (s.dc && s.dc.fawn === undefined) { s.dc.fawn = 4; dirty = true; }
      });
    }
    return { campaign: c, dirty };
  }

  function migrateCampaignsSchema() {
    const campaigns = getCampaigns();
    let anyDirty = false;
    campaigns.forEach(c => {
      const { dirty } = migrateOneCampaign(c);
      if (dirty) anyDirty = true;
    });
    if (anyDirty) localStorage.setItem(KEYS.campaigns, JSON.stringify(campaigns));
  }

  function updateScene(campaignId, sceneId, data) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    const idx = campaign.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return null;
    campaign.scenes[idx] = { ...campaign.scenes[idx], ...data, id: sceneId };
    saveCampaign(campaign);
    return campaign.scenes[idx];
  }

  function deleteScene(campaignId, sceneId) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return;
    campaign.scenes = campaign.scenes.filter(s => s.id !== sceneId);
    // Clear references to deleted scene
    campaign.scenes.forEach(s => {
      ['fight','flight','fawn','freeze'].forEach(b => {
        if (s.branches[b] && s.branches[b].nextSceneId === sceneId) s.branches[b].nextSceneId = null;
      });
    });
    saveCampaign(campaign);
  }

  // ── Templates ──────────────────────────────────────────────
  function getTemplates() {
    return JSON.parse(localStorage.getItem(KEYS.templates) || '[]');
  }

  function saveTemplate(template) {
    const templates = getTemplates();
    const idx = templates.findIndex(t => t.id === template.id);
    template.updatedAt = Date.now();
    if (idx >= 0) templates[idx] = template;
    else templates.push(template);
    localStorage.setItem(KEYS.templates, JSON.stringify(templates));
    return template;
  }

  function deleteTemplate(id) {
    const templates = getTemplates().filter(t => t.id !== id);
    localStorage.setItem(KEYS.templates, JSON.stringify(templates));
    return id;
  }

  function createTemplate(data) {
    const template = {
      id: uid(),
      name: data.name || 'New Template',
      description: data.description || '',
      tags: data.tags || [],
      attributes: data.attributes || {},
      defaultDC: data.defaultDC || { fight: 12, flight: 8, fawn: 4, freeze: 5 },
      narrativeBlocks: data.narrativeBlocks || { dm: '', npc: '', fight: '', flight: '', fawn: '', freeze: '' },
      setting: data.setting || {},
      contentRating: data.contentRating || 'mature',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return saveTemplate(template);
  }

  function applyTemplate(campaignId, sceneId, templateId) {
    const template = getTemplates().find(t => t.id === templateId);
    if (!template) return null;
    return updateScene(campaignId, sceneId, {
      tags: template.tags,
      attributes: template.attributes,
      dc: template.defaultDC,
      narrative: template.narrativeBlocks.dm,
      npcCue: template.narrativeBlocks.npc,
      templateId,
    });
  }

  // ── Session / Save State ───────────────────────────────────
  function startSession(campaignId) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return null;
    const startScene = campaign.scenes.find(s => s.isStart) || campaign.scenes[0];
    state.campaign = campaign;
    state.session = {
      id: uid(),
      campaignId,
      currentSceneId: startScene?.id || null,
      history: [],
      characters: { protagonist: campaign.protagonist, npc: campaign.npc },
      startedAt: Date.now(),
      lastSaved: Date.now(),
    };
    persistSession();
    return state.session;
  }

  function resumeSession() {
    const saved = localStorage.getItem(KEYS.session);
    if (!saved) return null;
    state.session = JSON.parse(saved);
    state.campaign = getCampaign(state.session.campaignId);
    return state.session;
  }

  function persistSession() {
    state.session.lastSaved = Date.now();
    localStorage.setItem(KEYS.session, JSON.stringify(state.session));
  }

  function clearSession() {
    localStorage.removeItem(KEYS.session);
    state.session = { id: null, currentSceneId: null, history: [], characters: {}, startedAt: null };
    state.campaign = null;
  }

  function makeChoice(branch, rollResult) {
    if (!state.session || !state.campaign) return null;
    const scene = getCurrentScene();
    if (!scene) return null;

    const entry = {
      sceneId: scene.id,
      sceneTitle: scene.title,
      choiceMade: branch,
      roll: rollResult,
      timestamp: Date.now(),
    };
    state.session.history.push(entry);

    const nextId = scene.branches[branch]?.nextSceneId;
    state.session.currentSceneId = nextId || null;
    persistSession();

    if (state.discordWebhook) {
      postToDiscord({
        scene: scene.title,
        choice: branch,
        roll: rollResult,
        nextScene: nextId ? getScene(nextId)?.title : 'END',
      });
    }

    return { entry, nextScene: nextId ? getScene(nextId) : null };
  }

  function goBack() {
    if (!state.session || state.session.history.length === 0) return null;
    state.session.history.pop();
    const prev = state.session.history[state.session.history.length - 1];
    state.session.currentSceneId = prev ? prev.sceneId : (state.campaign?.scenes.find(s => s.isStart)?.id || null);
    persistSession();
    return getCurrentScene();
  }

  function getCurrentScene() {
    if (!state.campaign || !state.session.currentSceneId) return null;
    return state.campaign.scenes.find(s => s.id === state.session.currentSceneId) || null;
  }

  function getScene(id) {
    if (!state.campaign) return null;
    return state.campaign.scenes.find(s => s.id === id) || null;
  }

  // ── Dice ───────────────────────────────────────────────────
  const DICE = {
    d4:   () => roll(4),
    d6:   () => roll(6),
    d8:   () => roll(8),
    d10:  () => roll(10),
    d12:  () => roll(12),
    d20:  () => roll(20),
    d100: () => roll(100),
    custom: (sides) => roll(sides),
    withModifier: (sides, mod) => {
      const base = roll(sides);
      return { ...base, modifier: mod, total: base.result + mod };
    },
    advantage: (sides) => {
      const a = roll(sides), b = roll(sides);
      return { rolls: [a.result, b.result], result: Math.max(a.result, b.result), type: 'advantage', sides };
    },
    disadvantage: (sides) => {
      const a = roll(sides), b = roll(sides);
      return { rolls: [a.result, b.result], result: Math.min(a.result, b.result), type: 'disadvantage', sides };
    },
  };

  function roll(sides) {
    const result = Math.floor(Math.random() * sides) + 1;
    return { result, sides, type: 'normal' };
  }

  function checkDC(rollResult, dc) {
    if (rollResult >= dc.fight)  return 'fight';
    if (rollResult >= dc.flight) return 'flight';
    if (rollResult >= dc.fawn)   return 'fawn';
    return 'freeze';
  }

  // ── Discord ────────────────────────────────────────────────
  function setWebhook(url) {
    state.discordWebhook = url;
    localStorage.setItem(KEYS.webhook, url);
  }

  function getWebhook() {
    return state.discordWebhook || localStorage.getItem(KEYS.webhook) || '';
  }

  async function postToDiscord(data) {
    const webhook = getWebhook();
    if (!webhook) return;
    const embed = {
      embeds: [{
        title: `⚔️ Scene: ${data.scene}`,
        color: data.choice === 'fight' ? 0xcc2200 : data.choice === 'flight' ? 0x2266cc : data.choice === 'fawn' ? 0x7a3a8a : 0x886600,
        fields: [
          { name: 'Choice Made', value: `**${data.choice.toUpperCase()}**`, inline: true },
          { name: 'Roll Result', value: data.roll ? `🎲 ${data.roll.result} / d${data.roll.sides}` : 'No Roll', inline: true },
          { name: 'Next Scene', value: data.nextScene || 'End of Campaign', inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Velvet Grimoire Campaign Engine' },
      }]
    };
    try {
      await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
    } catch(e) { console.warn('Discord webhook failed:', e); }
  }

  async function postCustomToDiscord(message) {
    const webhook = getWebhook();
    if (!webhook) return false;
    try {
      await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) });
      return true;
    } catch(e) { return false; }
  }

  // ── Tags ───────────────────────────────────────────────────
  function getAllTags(campaignId) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return [];
    const tagSet = new Set(campaign.tags || []);
    campaign.scenes.forEach(s => (s.tags || []).forEach(t => tagSet.add(t)));
    return [...tagSet];
  }

  function addCampaignTag(campaignId, tag) {
    const campaign = getCampaign(campaignId);
    if (!campaign) return;
    if (!campaign.tags.includes(tag)) campaign.tags.push(tag);
    saveCampaign(campaign);
  }

  function getCurrentThreshold() {
    return safeReadJSON('vg_threshold_current', null);
  }

  function getSignalLog() {
    return safeReadJSON('vg_signals', []);
  }

  function getLatestSignal() {
    const log = getSignalLog();
    return log.length ? log[log.length - 1] : null;
  }

  // ── Defaults ───────────────────────────────────────────────
  function defaultProtagonist() {
    return { name: 'The Protagonist', class: 'Rogue', level: 5, traits: [], limits: [], notes: '', banishedNames: [] };
  }

  function defaultNPC() {
    return { name: 'The Stranger', role: 'Antagonist', personality: '', agenda: '', notes: '' };
  }

  // A default antagonist shape suitable for the new multi-antagonist
  // roster (max 5 per campaign). controlledBy is the forward-compat
  // hook for handing an antagonist to another seated player later.
  const MAX_ANTAGONISTS = 5;
  function defaultAntagonist(overrides) {
    return Object.assign({
      id: uid(),
      name: '',
      role: '',
      personality: '',
      agenda: '',
      notes: '',
      controlledBy: 'dm',
    }, overrides || {});
  }

  // ── Helpers ────────────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function exportCampaign(id) {
    const campaign = getCampaign(id);
    if (!campaign) return;
    const blob = new Blob([JSON.stringify(campaign, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${campaign.name.replace(/\s+/g,'-').toLowerCase()}.json`;
    a.click();
  }

  // Import returns { ok: boolean, campaign?, error? } so callers can show
  // a useful message. Old exports (pre-ward, pre-multi-antagonist) are
  // migrated through the same path new campaigns use. Scene ids are
  // rewritten so importing twice doesn't collide on the branch graph.
  function importCampaign(jsonString) {
    let data;
    try { data = JSON.parse(jsonString); }
    catch(e) { return { ok: false, error: 'Not valid JSON.' }; }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'Import payload must be a single campaign object.' };
    }
    if (typeof data.name !== 'string' || !data.name.trim()) {
      return { ok: false, error: 'Campaign is missing a name.' };
    }
    if (!Array.isArray(data.scenes)) {
      return { ok: false, error: 'Campaign has no scenes array.' };
    }

    // Fresh campaign id to avoid collisions with existing local campaigns.
    data.id = uid();
    // Remap every scene to a fresh id and rewrite branch pointers so
    // the imported arc keeps its shape without colliding with other
    // local scenes.
    const idMap = {};
    data.scenes.forEach(s => {
      const freshId = uid();
      idMap[s.id] = freshId;
      s.id = freshId;
    });
    data.scenes.forEach(s => {
      if (s.branches && typeof s.branches === 'object') {
        ['fight','flight','fawn','freeze'].forEach(b => {
          const next = s.branches[b] && s.branches[b].nextSceneId;
          if (next && idMap[next]) s.branches[b].nextSceneId = idMap[next];
          else if (next && !idMap[next]) s.branches[b].nextSceneId = null;
        });
      }
    });

    // Run the same schema migration new campaigns get, so old exports
    // come in fully-shaped (ward fields, antagonists, hallowed floor).
    migrateOneCampaign(data);

    const saved = saveCampaign(data);
    return { ok: true, campaign: saved };
  }

  function getSessionHistory() {
    return state.session?.history || [];
  }

  function getState() { return state; }

  // ── Seed Sample Campaign ───────────────────────────────────
  // Runs once, on first install only. Marking the flag prevents the sample
  // campaign from re-seeding if a DM intentionally starts from an empty state.
  function seedSampleCampaign() {
    if (localStorage.getItem(KEYS.seeded) === '1') return;
    const existing = getCampaigns();
    localStorage.setItem(KEYS.seeded, '1'); // mark seeded regardless of whether we actually write, so future empty-state deletions don't re-seed
    if (existing.length > 0) return; // don't overwrite an existing setup

    // Three-antagonist roster. The Warden runs all three; they pull
    // on the protagonist from different angles so every branch choice
    // matters beyond a single scene.
    const antagAldric = defaultAntagonist({
      name: 'Lord Aldric Voss',
      role: 'Employer / Obsession',
      personality: 'Cold and calculating on the surface. Possessive underneath. Never raises his voice; his silences are the weapon.',
      agenda: 'Owns the city. Wants to own her too — on terms he can call consent.',
      notes: 'Measures her constantly. Pays obscenely well. Hates being told "no" but respects it more than "yes".',
    });
    const antagKira = defaultAntagonist({
      name: 'Kira Vashen',
      role: 'Rival Handler',
      personality: 'Practical, wry, dangerous. The mentor you left behind — and she never forgave you for it.',
      agenda: 'Wants Seraphine back in the Guild. Or dead, if back isn\'t on offer.',
      notes: 'Knows Seraphine\'s real name and the real reason she left. Will use either when useful.',
    });
    const antagRavenna = defaultAntagonist({
      name: 'The Baroness Ravenna',
      role: 'The Mark',
      personality: 'Old money, old rituals, older patience. Pretends she doesn\'t see what\'s coming.',
      agenda: 'Outlive everyone in this story. Including you.',
      notes: 'The dossier target. Not a villain — just the wall you were paid to break through.',
    });

    const c = createCampaign({
      name: 'The Crimson Veil',
      description: 'A tale of seduction, power, and dark bargains set in a city where pleasure and danger intertwine. A rogue, a noble who wants to own her, the mentor she betrayed, and a mark who isn\'t what the dossier says.',
      setting: 'city',
      protagonist: { name: 'Seraphine', class: 'Rogue', level: 5, traits: ['cunning','seductive','ruthless'], limits: [], notes: 'Former Guild assassin turned free agent. Left under circumstances she doesn\'t discuss.' },
      antagonists: [antagAldric, antagKira, antagRavenna],
      // Pre-ack a modest subset so the sample plays out of the box.
      // The protagonist sign-off step can still untick any of these at session start.
      ackedWards: ['captivity', 'pain', 'humiliation'],
      contentRating: 'explicit',
      tags: ['seduction','power','betrayal','desire','dark','obsession'],
    });

    // ── Scene 1 — Arrival ──────────────────────────────────────
    const s1 = createScene(c.id, {
      title: '1. The Velvet Room',
      isStart: true,
      narrative: `The private room smells of amber and smoke. Lord Aldric Voss stands by the window, his back to you, the city glittering below like scattered embers. He doesn't turn when you enter.\n\n"I was told you were the best," he says. His voice is low, deliberate — the voice of a man who has never needed to raise it. "I'm not interested in the best. I'm interested in someone willing to do what others won't."\n\nHe turns. The look he gives you isn't merely assessment — it's possession, half-formed and dangerous. A dossier slides across the mahogany desk toward you. Inside: a name, a location, and an amount of gold that would change your life.\n\nThe door behind you is still open. His gaze is not.`,
      npcCue: `You are Lord Aldric Voss. You have wanted this particular rogue for months — not just for the job. You're measuring her reaction to your presence. You need her off-balance. You want her curious. Do not reveal how much you need her. Project absolute control.`,
      tags: ['tension','first-meeting','power-play'],
      elementWards: ['power-exchange','intimacy','voyeurism'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 8, intimacy: 3, danger: 6 },
      dc: { flight: 8, fight: 14, freeze: 5 },
      requiresRoll: true,
      flightLabel: 'Take the gold and walk',
      fightLabel: 'Push back — negotiate terms',
      freezeLabel: 'Hold still — read him',
      flightNarrative: 'You pocket the dossier, hold his gaze just long enough to be impolite, and walk out. His silence follows you down the corridor like a hand at your throat.',
      fightNarrative: 'You close the dossier, slide it back across the desk, and lean forward. "Double it. And I want answers before I take a single step." His jaw tightens — and something behind his eyes ignites.',
      freezeNarrative: 'You don\'t move. You let the silence stretch between you like a blade, watching every micro-expression cross his face. He notices you noticing. The corner of his mouth moves — almost a smile.',
    });

    // ── Scene 2 — The Counter-Offer (fight branch) ─────────────
    const s2 = createScene(c.id, {
      title: '2. The Counter-Offer',
      narrative: `He studies you for a long moment after your demand. Then he laughs — short, genuine, surprised. It transforms his face briefly into something almost human.\n\n"Triple," he says. "And you'll have every answer you want." He moves from behind the desk. The distance between you becomes deliberate. "But first — tell me why you left the Guild. The real reason."`,
      npcCue: `She pushed back. Good. You respect that. Move closer — not threateningly, but intentionally. You want her to feel the proximity. Ask about the Guild. You already know the answer. You want to see if she'll lie.`,
      tags: ['negotiation','proximity','backstory'],
      elementWards: ['power-exchange','intimacy','manipulation'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 9, intimacy: 5, danger: 5 },
      dc: { flight: 10, fight: 15, freeze: 6 },
      requiresRoll: true,
      flightLabel: 'Deflect — "That\'s not your business"',
      fightLabel: 'Tell him the truth',
      freezeLabel: 'Let him come closer — say nothing',
    });

    // ── Scene 3 — The Rooftop Exit (flight branch) ─────────────
    const s3 = createScene(c.id, {
      title: '3. The Rooftop Exit',
      narrative: `Night wind. Tiles slick with rain. Twelve stories below, the city pretends not to notice you.\n\nA figure steps out from behind the chimney stack. Small frame, easy stance — a familiarity that hurts before you recognize it.\n\n"Well, well." Kira Vashen smiles the way a blade smiles. "You're moving up in the world, Sera." She tilts her head. "Or down. Depends on who owns the world."`,
      npcCue: `You are Kira — her former handler, the Guild's cleanup. You want her back. Or finished. You don't know which yet. Read her. Don't draw steel first — she'll mirror you. Offer the truth like bait.`,
      tags: ['ambush','past','guild'],
      elementWards: ['weaponry','pursuit','betrayal','authority'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 9, intimacy: 2, danger: 8 },
      dc: { flight: 12, fight: 14, freeze: 8 },
      requiresRoll: true,
      flightLabel: 'Jump — trust the leap',
      fightLabel: 'Draw and circle',
      freezeLabel: 'Hear her out',
    });

    // ── Scene 4 — The Library (freeze branch from scene 1) ─────
    const s4 = createScene(c.id, {
      title: '4. The Library',
      narrative: `He walks you into the library without asking whether you want to go. Firelight. Old leather. A decanter already filled.\n\n"I read your file twice," he says, pouring. "The first time I was impressed. The second time I was furious." He turns, holds out the glass. "Because I realized you'd been wasted on small men." Their fingers touch when you take the glass. Neither of you moves away.`,
      npcCue: `She stayed. She let you close the door. That is not consent to more — only to this moment. Offer the drink as a ritual, not a trap. Your hand to hers must be deliberate but brief. Let her choose the next second.`,
      tags: ['seduction','privacy','slow-burn'],
      elementWards: ['intimacy','arousal','praise'],
      intensityWard: 'explicit',
      frameWard: 'consensual-if',
      attributes: { tension: 7, intimacy: 7, danger: 4 },
      dc: { flight: 8, fight: 12, freeze: 5 },
      requiresRoll: true,
      flightLabel: 'Set the glass down — leave',
      fightLabel: 'Ask what he really wants',
      freezeLabel: 'Drink. Let him talk.',
    });

    // ── Scene 5 — The Mark ─────────────────────────────────────
    const s5 = createScene(c.id, {
      title: '5. The Baroness',
      narrative: `The Baroness Ravenna's salon is a performance of permanence — portraits of ancestors who all share her mouth, a fireplace that has never gone out in three generations, servants who do not look at you.\n\nShe does. She looks at you the moment you enter, and keeps looking. No surprise. No alarm.\n\n"You took longer than I expected," she says, setting down her book. "Sit. We have, I think, about an hour before they notice."`,
      npcCue: `You are Ravenna. You've been expecting this since you made her employer rich. You are not afraid. You are tired. You want her to see you — not the target. If she can, you may both walk out of this.`,
      tags: ['confrontation','identity','mark'],
      elementWards: ['manipulation','authority','surveillance'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 8, intimacy: 4, danger: 7 },
      dc: { flight: 10, fight: 13, freeze: 6 },
      requiresRoll: true,
      flightLabel: 'Leave — the job is compromised',
      fightLabel: 'Finish what you came for',
      freezeLabel: 'Sit. Hear her hour out.',
    });

    // ── Scene 6 — The Bargain ──────────────────────────────────
    const s6 = createScene(c.id, {
      title: '6. The Bargain',
      narrative: `Voss is waiting for your report. He already knows you didn't kill her — you can see it in how still he is.\n\n"I'm not disappointed," he says quietly. "I'm curious." He rises from the chair, closes the distance, stops a hand's width away. "Tell me what she offered you. Tell me everything. And then tell me what you want from me, to stay." His voice drops, almost kind. "I will give it to you. Whatever it is."`,
      npcCue: `She didn't complete the job. You could have her killed by sunrise. Instead you walk toward her. This is the offer: ownership in exchange for transparency. You want her to name her price. You want to meet it. Do not flinch.`,
      tags: ['choice','power','negotiation','ownership'],
      elementWards: ['power-exchange','intimacy','captivity','humiliation'],
      intensityWard: 'explicit',
      frameWard: 'consensual-if',
      attributes: { tension: 10, intimacy: 8, danger: 6 },
      dc: { flight: 12, fight: 14, freeze: 7 },
      requiresRoll: true,
      flightLabel: 'Name an impossible price — force him to refuse',
      fightLabel: 'Refuse. Walk. Mean it.',
      freezeLabel: 'Name what you actually want',
    });

    // ── Scene 7 — The Ascension ────────────────────────────────
    const s7 = createScene(c.id, {
      title: '7. The Ascension',
      narrative: `He keeps his word. Whatever you named — he delivers it. And on the other side of the threshold, there is no more pretending what this is.\n\nThe private apartments. The door that locks from inside only. A ring of keys on the sideboard that includes the city gate. And him, across the room, waiting for you to say the thing you both already know.`,
      npcCue: `The transaction is done. The obsession is not. Everything from here is negotiated — breath by breath. Read her constantly. If she stalls, stall. If she moves, match. You have nothing to prove now. You have everything to lose.`,
      tags: ['climax','intimacy','surrender'],
      elementWards: ['intimacy','arousal','power-exchange','praise'],
      intensityWard: 'explicit',
      frameWard: 'consensual-if',
      attributes: { tension: 9, intimacy: 10, danger: 4 },
      dc: { flight: 14, fight: 16, freeze: 8 },
      requiresRoll: false,
      flightLabel: 'Name the safe word you never told him',
      fightLabel: 'Set the terms aloud',
      freezeLabel: 'Let him set them',
    });

    // ── Scene 8 — The Reckoning (alt path) ─────────────────────
    const s8 = createScene(c.id, {
      title: '8. The Reckoning',
      narrative: `Kira finds you before dawn. She doesn't draw. "I'm not here for the kill," she says. "I'm here because whatever you think you're building with him — he's built it before. Twice. Neither one walked out." She sets a single piece of paper on the table between you. "Read it. Then decide."`,
      npcCue: `You are Kira, and for once you are telling the truth. The paper is the Guild's file on Voss's previous companions. You don't want her back anymore. You want her to survive.`,
      tags: ['reveal','consequence','choice'],
      elementWards: ['betrayal','manipulation','authority'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 9, intimacy: 3, danger: 7 },
      dc: { flight: 11, fight: 13, freeze: 6 },
      requiresRoll: true,
      flightLabel: 'Leave the paper unread',
      fightLabel: 'Read it. Confront him.',
      freezeLabel: 'Read it. Say nothing.',
    });

    // ── Scene 9 — Blade to Blade (rooftop→fight detour) ────────
    const s9_duel = createScene(c.id, {
      title: '9. Blade to Blade',
      narrative: `The first exchange is fast. She's faster. Your dagger catches her sleeve, hers catches the inside of your wrist — a shallow kiss of steel that will ache by morning.\n\nKira steps back, breathing through her nose. "Still telegraphing your left," she says, almost tender. "I taught you better than that." Rain makes the tiles into a promise neither of you wants to keep. She lowers her blade half an inch — an invitation, not a surrender.\n\n"Walk off this roof with me," she says, "or prove you've actually outgrown me. You get one more pass, Sera. Choose."`,
      npcCue: `You are Kira. You will not kill her. You will also not let her know that. Keep your guard honest; let her see the old drills in your footwork. You want her to remember who taught her how to breathe through a cut. If she chooses the duel, lose on purpose — but only barely.`,
      tags: ['duel','past','mentor','blades'],
      elementWards: ['violence','weaponry','impact','pain','pursuit'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 9, intimacy: 3, danger: 9 },
      dc: { flight: 11, fight: 15, freeze: 8 },
      requiresRoll: true,
      flightLabel: 'Break off — take the gutter down',
      fightLabel: 'Close the distance — finish it',
      freezeLabel: 'Drop your blade. Make her do the same.',
      flightNarrative: 'You feint left, roll right, and find the gutter with the last clean footing on the roof. The night swallows you before her third step.',
      fightNarrative: 'You meet her. She lets you win by a breath. The point of your dagger rests against her collarbone — and she smiles like a proud teacher at a wake.',
      freezeNarrative: 'You drop the blade. It rings on the tile. For a moment she doesn\'t move. Then her blade joins yours at her feet. "All right," she says. "All right."',
    });

    // ── Scene 10 — The Morning Debt (ascension→hearth coda) ────
    const s10_debt = createScene(c.id, {
      title: '10. The Morning Debt',
      narrative: `Grey light, through shutters that no one remembered to close. The fire is embers. Voss is asleep or pretending to be; the difference, at this hour, is a courtesy.\n\nOn the nightstand, in his handwriting: a ledger page. Your name at the top. Underneath it — the city gate key. The deed to a house you've never seen. A list of people who will not look at you the same way tomorrow.\n\nThere is also a second page. A single line: "Whatever you want undone, say so before I wake. No questions. No cost." The ink is still faintly wet.`,
      npcCue: `You are Voss — and you are awake. You heard her sit up. You will not open your eyes until she speaks or leaves. The second page is the truest thing you have ever written. Whatever she says next, honour it without flinching. This is the only part of the night that was not a negotiation.`,
      tags: ['aftermath','consequence','intimacy','quiet'],
      elementWards: ['intimacy','power-exchange','praise'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 4, intimacy: 8, danger: 2 },
      dc: { flight: 6, fight: 8, freeze: 4 },
      requiresRoll: false,
      flightLabel: 'Take the key. Leave before he wakes.',
      fightLabel: 'Wake him. Undo the ledger. Keep the key.',
      freezeLabel: 'Burn the second page. Stay.',
      flightNarrative: 'You pocket the gate key. You leave the ledger. You do not look back; looking back is for people who still owe something.',
      fightNarrative: 'You shake him awake. "Undo it all except this one," you say, tapping the key. He nods once — and obeys before sunrise has finished arriving.',
      freezeNarrative: 'You hold the second page to the embers until it catches. The ash settles on the bedclothes. You lie back down. He does not pretend to be asleep anymore.',
    });

    // ── Scene 11 — The Hearth (epilogue) ───────────────────────
    const s11 = createScene(c.id, {
      title: '11. The Hearth',
      isEnd: true,
      narrative: `Whichever way the story bent, the morning still comes.\n\nThere is a room somewhere in the city — yours, his, neither, both — where the fire has burned down to coals and the day has not yet decided what it wants from you.\n\nSit. Breathe. Say the name of the person across from you. The year. The room. The door that is unlocked. The water beside you. The offer you have capacity for today.\n\nThe book closes itself when you are ready.`,
      npcCue: `Step out of character fully. This is the Hearth, not a scene. The pause page (top-right ember) has the full stations checklist — walk them together before you end.`,
      tags: ['epilogue','hearth','closure'],
      elementWards: ['intimacy'],
      intensityWard: 'suggested',
      frameWard: 'consensual-if',
      attributes: { tension: 2, intimacy: 6, danger: 1 },
      dc: { flight: 5, fight: 5, freeze: 5 },
      requiresRoll: false,
      flightLabel: 'End the session',
      fightLabel: 'End the session',
      freezeLabel: 'End the session',
    });

    // ── Link the arc (fight-heavy spine + branches) ────────────
    const fresh = getCampaign(c.id);
    const [a,b,rooftop,library,mark,bargain,ascension,reckoning,duel,debt,hearth] = fresh.scenes;
    function link(from, branch, to) {
      if (!from || !to) return;
      const upd = {
        branches: { ...from.branches, [branch]: { ...from.branches[branch], nextSceneId: to.id } }
      };
      updateScene(c.id, from.id, upd);
    }
    link(a, 'fight',  b);         // 1→2 : push back → counter-offer
    link(a, 'flight', rooftop);   // 1→3 : walk away → rooftop ambush
    link(a, 'freeze', library);   // 1→4 : hold still → library
    link(b, 'fight',  library);   // 2→4 : truth → library
    link(b, 'freeze', library);   // 2→4 : silence → library
    link(b, 'flight', rooftop);   // 2→3 : deflect → rooftop
    link(rooftop, 'freeze', library);   // 3→4 : hear her out → library
    link(rooftop, 'fight',  duel);      // 3→9 : fight → Blade-to-Blade duel
    link(rooftop, 'flight', reckoning); // 3→8 : jump → reckoning (Kira catches up later)
    link(duel,    'fight',  reckoning); // 9→8 : finish the duel → reckoning
    link(duel,    'freeze', reckoning); // 9→8 : surrender blades → reckoning
    link(duel,    'flight', reckoning); // 9→8 : break off → reckoning
    link(library, 'freeze', mark);      // 4→5 : drink → mark
    link(library, 'fight',  mark);      // 4→5 : ask → mark
    link(library, 'flight', hearth);    // 4→11 : leave → hearth
    link(mark, 'fight',  bargain);      // 5→6 : finish job → bargain
    link(mark, 'freeze', bargain);      // 5→6 : listen → bargain
    link(mark, 'flight', reckoning);    // 5→8 : abort → reckoning
    link(bargain, 'freeze', ascension); // 6→7 : name want → ascension
    link(bargain, 'fight',  reckoning); // 6→8 : refuse → reckoning
    link(bargain, 'flight', reckoning); // 6→8 : impossible price → reckoning
    link(ascension, 'fight',  debt);    // 7→10 : set terms → morning debt
    link(ascension, 'flight', debt);    // 7→10 : name safeword → morning debt
    link(ascension, 'freeze', debt);    // 7→10 : let him set → morning debt
    link(debt, 'fight',  hearth);       // 10→11
    link(debt, 'flight', hearth);       // 10→11
    link(debt, 'freeze', hearth);       // 10→11
    link(reckoning, 'fight',  hearth);  // 8→11
    link(reckoning, 'flight', hearth);  // 8→11
    link(reckoning, 'freeze', hearth);  // 8→11

    // Seed two templates — one slow-burn, one confrontation.
    createTemplate({
      name: 'Seduction Scene',
      description: 'Two characters, rising tension, desire barely contained.',
      tags: ['seduction','desire','tension','proximity'],
      attributes: { tension: 7, intimacy: 6, danger: 3 },
      defaultDC: { flight: 8, fight: 13, freeze: 5 },
      narrativeBlocks: {
        dm: '[DM: Describe the setting — the light, the scent, the distance between them. Build the tension slowly. End with a moment of decision.]',
        npc: '[NPC: Your character desires the protagonist but won\'t show it directly. Use body language, subtext, and deliberate proximity.]',
        flight: '[Flight: The protagonist creates distance — physically or emotionally. The NPC\'s reaction reveals more than they intend.]',
        fight: '[Fight: The protagonist challenges the dynamic directly. The confrontation escalates tension rather than resolving it.]',
        freeze: '[Freeze: The protagonist holds still and lets the NPC move. Observation becomes its own form of power.]',
      },
      contentRating: 'explicit',
    });

    createTemplate({
      name: 'Confrontation Scene',
      description: 'A rival or enemy forces the protagonist into a hard conversation. No one draws first.',
      tags: ['confrontation','rival','truth','stakes'],
      attributes: { tension: 9, intimacy: 2, danger: 7 },
      defaultDC: { flight: 12, fight: 14, freeze: 7 },
      narrativeBlocks: {
        dm: '[DM: Locate them somewhere neutral but not safe. Give the rival a reason to talk first. End on the moment before the protagonist has to answer.]',
        npc: '[NPC: You know something she hasn\'t said aloud in years. Use it. Not as a weapon — as a bridge she can either cross or burn.]',
        flight: '[Flight: The protagonist cuts the conversation short. They preserve the wall. They lose the information.]',
        fight: '[Fight: The protagonist meets the rival on their terms. Lines get drawn. Nobody is safer for it.]',
        freeze: '[Freeze: The protagonist listens. Everything the rival says becomes usable later — at a cost.]',
      },
      contentRating: 'mature',
    });

    return getCampaign(c.id);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    // Campaigns
    getCampaigns, getCampaign, createCampaign, saveCampaign, deleteCampaign,
    // Scenes
    createScene, updateScene, deleteScene, getCurrentScene, getScene,
    // Templates
    getTemplates, createTemplate, saveTemplate, deleteTemplate, applyTemplate,
    // Ward schema (TAGS.md)
    getWardRegistry, validateScene,
    setAckedWards, toggleAckedWard, setProtagonistAcks, migrateCampaignsSchema,
    WARD_INTENSITIES: INTENSITY_WARDS.slice(),
    WARD_FRAMES: FRAME_WARDS.slice(),
    WARD_HARD_GATED: HARD_GATED_WARDS.slice(),
    // Session
    startSession, resumeSession, persistSession, clearSession, makeChoice, goBack,
    getSessionHistory, getState,
    getCurrentThreshold, getSignalLog, getLatestSignal,
    // Dice
    DICE, checkDC,
    // Discord
    setWebhook, getWebhook, postToDiscord, postCustomToDiscord,
    // Tags
    getAllTags, addCampaignTag,
    // Utils
    exportCampaign, importCampaign, seedSampleCampaign, uid,
  };
})();

window.VGEngine = VGEngine;
