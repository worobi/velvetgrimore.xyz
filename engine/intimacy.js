// ============================================================
// VELVET GRIMOIRE — Intimate Table Layer
// Scene chat, consent ceilings, heat, prompt assists, and want/boundary cards.
// ============================================================

const VGIntimacy = (() => {
  const CHAT_KEY = 'vg_intimacy_chat';
  const STATE_KEY = 'vg_intimacy_state';
  const CARD_KEY = 'vg_intimacy_cards';
  const MAX_MESSAGES = 180;

  const CONSENT_LEVELS = [
    { id: 'soft', label: 'Soft', rank: 0, hint: 'Tender, low-pressure, suggestive at most.' },
    { id: 'suggestive', label: 'Suggestive', rank: 1, hint: 'Flirtation and implication, no explicit detail.' },
    { id: 'explicit', label: 'Explicit', rank: 2, hint: 'Adult detail allowed only when both players select it.' },
    { id: 'veil', label: 'Veil / Fade Out', rank: -1, hint: 'Turn the camera away and move to aftermath.' },
  ];

  const MODES = [
    { id: 'spoken', label: 'Spoken' },
    { id: 'action', label: 'Action' },
    { id: 'thought', label: 'Thought' },
    { id: 'whisper', label: 'Whisper' },
    { id: 'ooc', label: 'OOC Check-in' },
  ];

  const PROMPTS = [
    { id: 'notice', label: 'Notice', text: 'I notice...', level: 'soft', heat: 2 },
    { id: 'ask', label: 'Ask Permission', text: 'Before I move closer, I ask...', level: 'soft', heat: 0 },
    { id: 'tease', label: 'Tease', text: 'I let the tension hang there, then...', level: 'suggestive', heat: 6 },
    { id: 'resist', label: 'Resist', text: 'I want to, but I make you earn the next step by...', level: 'suggestive', heat: 4 },
    { id: 'yield', label: 'Yield', text: 'I choose to give ground in this one way...', level: 'suggestive', heat: 5 },
    { id: 'slow', label: 'Slow Down', text: 'Slow this beat down. I want more room around...', level: 'soft', heat: -5 },
    { id: 'veil', label: 'Fade Out', text: 'This is where the camera turns away. What matters after is...', level: 'veil', heat: -12 },
    { id: 'hearth', label: 'Hearth Check', text: 'Out of character: I want to check in before we keep going.', level: 'soft', heat: -8 },
  ];

  const WANT_OPTIONS = [
    'flirtation',
    'praise',
    'dangerous bargain',
    'slow burn',
    'being pursued',
    'taking control',
    'yielding tactically',
    'fade-to-black',
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function sceneKey(sessionId, sceneId) {
    return `${sessionId || 'no-session'}::${sceneId || 'no-scene'}`;
  }

  function getAllState() {
    return readJSON(STATE_KEY, {});
  }

  function getSceneState(sessionId, sceneId) {
    const key = sceneKey(sessionId, sceneId);
    const all = getAllState();
    if (!all[key]) {
      all[key] = {
        sessionId,
        sceneId,
        heat: 12,
        consent: { dm: 'suggestive', player: 'suggestive' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      writeJSON(STATE_KEY, all);
    }
    return all[key];
  }

  function saveSceneState(sessionId, sceneId, patch) {
    const key = sceneKey(sessionId, sceneId);
    const all = getAllState();
    all[key] = { ...getSceneState(sessionId, sceneId), ...patch, updatedAt: Date.now() };
    writeJSON(STATE_KEY, all);
    return all[key];
  }

  function setConsent(sessionId, sceneId, role, level) {
    const current = getSceneState(sessionId, sceneId);
    const valid = CONSENT_LEVELS.some(l => l.id === level) ? level : 'suggestive';
    return saveSceneState(sessionId, sceneId, {
      consent: { ...(current.consent || {}), [role]: valid },
    });
  }

  function setHeat(sessionId, sceneId, value) {
    const heat = Math.max(0, Math.min(100, Number(value) || 0));
    return saveSceneState(sessionId, sceneId, { heat });
  }

  function adjustHeat(sessionId, sceneId, delta) {
    const current = getSceneState(sessionId, sceneId);
    return setHeat(sessionId, sceneId, (current.heat || 0) + delta);
  }

  function getLevel(id) {
    return CONSENT_LEVELS.find(level => level.id === id) || CONSENT_LEVELS[1];
  }

  function effectiveConsent(state) {
    const dm = getLevel(state?.consent?.dm || 'suggestive');
    const player = getLevel(state?.consent?.player || 'suggestive');
    return dm.rank <= player.rank ? dm : player;
  }

  function getMessages(sessionId, sceneId) {
    const key = sceneKey(sessionId, sceneId);
    return readJSON(CHAT_KEY, []).filter(msg => msg.key === key);
  }

  function sendMessage({ sessionId, sceneId, role, mode, text, heatDelta = 0 }) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const key = sceneKey(sessionId, sceneId);
    const messages = readJSON(CHAT_KEY, []);
    const msg = {
      id: uid(),
      key,
      sessionId,
      sceneId,
      role: role || 'player',
      mode: MODES.some(m => m.id === mode) ? mode : 'spoken',
      text: clean.slice(0, 1200),
      at: Date.now(),
    };
    messages.push(msg);
    writeJSON(CHAT_KEY, messages.slice(-MAX_MESSAGES));
    if (heatDelta) adjustHeat(sessionId, sceneId, heatDelta);
    return msg;
  }

  function getCards(sessionId, sceneId) {
    const key = sceneKey(sessionId, sceneId);
    const all = readJSON(CARD_KEY, {});
    return all[key] || {};
  }

  function saveCard(sessionId, sceneId, role, card) {
    const key = sceneKey(sessionId, sceneId);
    const all = readJSON(CARD_KEY, {});
    all[key] = {
      ...(all[key] || {}),
      [role]: {
        want: Array.isArray(card.want) ? card.want : [],
        pace: card.pace || 'slow',
        ceiling: card.ceiling || 'suggestive',
        notTonight: String(card.notTonight || '').trim().slice(0, 500),
        note: String(card.note || '').trim().slice(0, 500),
        updatedAt: Date.now(),
      },
    };
    writeJSON(CARD_KEY, all);
    return all[key][role];
  }

  function getCompatibility(sessionId, sceneId) {
    const cards = getCards(sessionId, sceneId);
    const dm = cards.dm;
    const player = cards.player;
    if (!dm || !player) return { status: 'waiting', label: 'Waiting for both cards', shared: [] };
    const shared = (dm.want || []).filter(w => (player.want || []).includes(w));
    if (dm.notTonight || player.notTonight) {
      return { status: 'caution', label: 'Check the not-tonight notes before escalating', shared };
    }
    if (!shared.length) return { status: 'slow', label: 'No shared wants selected yet. Keep it soft.', shared };
    return { status: 'open', label: `Shared wants: ${shared.join(', ')}`, shared };
  }

  function getPrompts(consentId) {
    const level = getLevel(consentId);
    if (level.id === 'veil') return PROMPTS.filter(p => p.level === 'veil' || p.id === 'hearth');
    return PROMPTS.filter(prompt => getLevel(prompt.level).rank <= level.rank && prompt.level !== 'veil');
  }

  function heatLabel(heat) {
    if (heat >= 80) return 'High heat';
    if (heat >= 55) return 'Rising';
    if (heat >= 30) return 'Warm';
    return 'Low ember';
  }

  function modeLabel(mode) {
    return (MODES.find(m => m.id === mode) || MODES[0]).label;
  }

  return {
    CONSENT_LEVELS,
    MODES,
    WANT_OPTIONS,
    getSceneState,
    setConsent,
    setHeat,
    adjustHeat,
    effectiveConsent,
    getMessages,
    sendMessage,
    getCards,
    saveCard,
    getCompatibility,
    getPrompts,
    heatLabel,
    modeLabel,
  };
})();

window.VGIntimacy = VGIntimacy;
