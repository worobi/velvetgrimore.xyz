(() => {
  const questions = [
    ['premise', 'What tale would you like to tell?', 'Describe the heart of your adventure. What happens, and what makes the idea interesting to you?'],
    ['setting', 'Where does the adventure unfold?', 'A haunted manor, royal court, bustling city, forgotten dungeon, or a realm of your own?'],
    ['mood', 'What mood should guide the tale?', 'Mysterious, romantic, eerie, funny, adventurous, tense, or cozy?'],
    ['scope', 'What shape should the adventure take?', 'A single encounter, a one-session quest, a longer tale, or an ongoing campaign?'],
    ['heroes', 'Who answers the call to adventure?', 'Describe the hero or adventuring party. What do they seek? May players create their own heroes?'],
    ['characters', 'Who else has a part to play?', 'Allies, rivals, patrons, love interests, or villains. What binds them together or sets them apart?'],
    ['hook', 'What sets the quest in motion?', 'A secret, invitation, disappearance, bargain, threat, or unexpected arrival?'],
    ['encounters', 'Which encounters belong in your tale?', 'A tavern bargain, hidden chamber, tense parley, discovery, or daring escape.'],
    ['choices', 'What choices should the adventurers face?', 'Trust someone, investigate, negotiate, confront a rival, leave, or take a risk.'],
    ['endings', 'How might the quest end?', 'Triumph, sacrifice, a bittersweet farewell, or several possible endings?'],
    ['boundaries', 'What are the boundaries of this tale?', 'Must-have themes, unwanted content, and anything to keep off-page or fade to black.'],
    ['notes', 'What else belongs in the quest notes?', 'Intended players, inspirations, existing lore, and details that must remain unchanged.']
  ];
  const statuses = { submitted: 'Awaiting review', reviewing: 'Under review', developing: 'In development', completed: 'Completed' };
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const n = document.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; };
  let submissions = [], canReview = false, dirty = false, requestId = crypto.randomUUID();
  for (const [i, [key, title, hint]] of questions.entries()) {
    const label = el('label', `${i + 1}. ${title}${key === 'premise' ? ' (required)' : ''}`); label.htmlFor = key;
    const help = el('p', hint, 'hint'); help.id = `${key}Hint`;
    const input = el('textarea'); input.id = input.name = key; input.maxLength = 5000; input.rows = 3; input.setAttribute('aria-describedby', help.id);
    if (key === 'premise') { input.required = true; input.className = 'required'; }
    $('questions').append(label, help, input);
  }
  async function api(path = '', options = {}) {
    const response = await fetch(`/api/story-submissions${path}`, { ...options, headers: { 'Content-Type': 'application/json' } });
    if (response.status === 401 || response.status === 428) throw new Error('Your session has ended. Sign in through Your tables, then return here to submit.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your changes could not be saved. Please try again.');
    return result;
  }
  function download(story) {
    const lines = [story.title, `Submitted by: ${story.author || story.memberName}`, `Submitted: ${story.createdAt}`, `Status: ${statuses[story.status]}`, '', ...questions.flatMap(([key, title]) => [title, story[key] || 'Open to ideas', ''])];
    if (canReview && story.reviewNotes) lines.push('Private review notes', story.reviewNotes);
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = el('a'); link.href = url; link.download = `tale-${story.id}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function render() {
    $('listTitle').textContent = canReview ? 'Tales awaiting your craft' : 'Your submitted tales';
    const list = $('storyList'); list.replaceChildren();
    const visible = submissions.filter(s => $('statusFilter').value === 'all' || s.status === $('statusFilter').value);
    if (!visible.length) list.append(el('p', submissions.length ? 'No tales match this status.' : 'No tales submitted yet. Your next adventure can begin above.', 'muted'));
    for (const story of visible) {
      const card = el('details'); card.append(el('summary', story.title), el('span', statuses[story.status], 'status'));
      card.append(el('p', `${story.author || story.memberName} · ${new Date(story.createdAt).toLocaleDateString()}`, 'muted'));
      for (const [key, title] of questions) card.append(el('h3', title), el('p', story[key] || 'Open to ideas', 'answer'));
      const button = el('button', 'Download story notes', 'secondary'); button.type = 'button'; button.addEventListener('click', () => download(story)); card.append(button);
      if (canReview) {
        const review = el('div', '', 'review');
        const status = el('select'); status.id = `status-${story.id}`;
        for (const [value, text] of Object.entries(statuses)) { const option = el('option', text); option.value = value; status.append(option); } status.value = story.status;
        const statusLabel = el('label', 'Review status'); statusLabel.htmlFor = status.id;
        const notes = el('textarea'); notes.id = `notes-${story.id}`; notes.value = story.reviewNotes || ''; notes.maxLength = 10000;
        const notesLabel = el('label', 'Private administrator notes'); notesLabel.htmlFor = notes.id;
        const save = el('button', 'Save review'); save.type = 'button';
        const message = el('p'); message.setAttribute('role', 'status');
        save.addEventListener('click', async () => {
          save.disabled = true; message.textContent = 'Saving review…';
          try { const result = await api(`/${story.id}`, { method: 'PATCH', body: JSON.stringify({ status: status.value, reviewNotes: notes.value, updatedAt: story.updatedAt }) }); Object.assign(story, result.submission); card.querySelector('.status').textContent = statuses[story.status]; message.textContent = 'Review saved.'; }
          catch (error) { message.textContent = error.message; }
          finally { save.disabled = false; }
        });
        review.append(statusLabel, status, notesLabel, notes, el('p', 'These notes are visible only to administrators.', 'muted'), save, message); card.append(review);
      }
      list.append(card);
    }
  }
  async function refresh() {
    $('refreshButton').disabled = true; $('listMessage').textContent = 'Opening the ledger…';
    try { const result = await api(); submissions = result.submissions; canReview = result.canReview; render(); $('listMessage').textContent = ''; }
    catch (error) { $('listMessage').textContent = error.message; }
    finally { $('refreshButton').disabled = false; }
  }
  $('storyForm').addEventListener('input', () => { dirty = true; });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  $('storyForm').addEventListener('submit', async event => {
    event.preventDefault(); $('submitButton').disabled = true; $('formMessage').textContent = 'Submitting your tale…';
    try {
      await api('', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(new FormData(event.target)), requestId }) });
      dirty = false; event.target.reset(); requestId = crypto.randomUUID();
      $('formMessage').textContent = 'Your tale has been submitted for review. Return to the story ledger below to follow its progress.'; $('formMessage').focus(); await refresh();
    } catch (error) { $('formMessage').textContent = error.message; $('formMessage').focus(); }
    finally { $('submitButton').disabled = false; }
  });
  $('statusFilter').addEventListener('change', render); $('refreshButton').addEventListener('click', refresh); refresh();
})();
