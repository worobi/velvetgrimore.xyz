document.addEventListener('DOMContentLoaded', async () => {
  if (!window.VGSync) return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/assets/member-bar.css'; document.head.append(style);
  const bar = document.createElement('nav'); bar.className = 'member-bar'; bar.setAttribute('aria-label', 'Table and account');
  const left = document.createElement('div'); left.className = 'actions'; const home = document.createElement('a'); home.href = '/members.html'; home.textContent = 'Your tables'; left.append(home);
  const status = document.createElement('span'); status.className = 'save-status'; status.setAttribute('role', 'status'); status.textContent = 'Checking saved table...';
  const actions = document.createElement('div'); actions.className = 'actions';
  const save = document.createElement('button'); save.textContent = 'Save now';
  const pause = document.createElement('button'); pause.textContent = 'Save and pause';
  const resume = document.createElement('button'); resume.textContent = 'Resume play';
  const logout = document.createElement('button'); logout.textContent = 'Sign out';
  actions.append(save, pause, resume, logout); bar.append(left, status, actions); document.body.prepend(bar); document.body.classList.add('has-member-bar');
  new ResizeObserver(() => document.documentElement.style.setProperty('--member-bar-height', `${bar.offsetHeight}px`)).observe(bar);
  async function saveState(breakTime) {
    save.disabled = true; pause.disabled = true; status.textContent = 'Saving...';
    try {
      await VGSync.flush();
      if (breakTime) { await VGSync.createCheckpoint('Saved for a break'); await VGSync.tableManage(VGSync.getConfig().code, { status: 'paused' }); VGSync.stop(); location.assign('/members.html'); }
      else { await VGSync.createCheckpoint('Manual save'); status.textContent = 'Saved to your table.'; }
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; pause.disabled = false; }
  }
  save.addEventListener('click', () => saveState(false)); pause.addEventListener('click', () => saveState(true));
  resume.addEventListener('click', async () => { try { await VGSync.recordEvent('safety.signal', { tier: 'resume' }); await VGSync.tableManage(VGSync.getConfig().code, { status: 'live' }); } catch (error) { status.textContent = error.message; } });
  home.addEventListener('click', async event => { event.preventDefault(); try { await VGSync.flush(); VGSync.stop(); location.assign('/members.html'); } catch (error) { status.textContent = error.message; } });
  logout.addEventListener('click', async () => { try { await VGSync.accountLogout(); location.assign('/'); } catch (error) { status.textContent = error.message; } });
  function render(state) {
    const table = state.table;
    const manage = !!table?.permissions?.canWriteSharedState && state.enabled && !table.archived;
    save.hidden = !manage; pause.hidden = !manage; resume.hidden = !manage || table?.status !== 'paused';
    if (table?.savedAt) status.textContent = `${table.name} | ${table.status === 'paused' ? 'Paused | ' : ''}Saved ${new Date(table.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    else status.textContent = 'No table selected';
  }
  try {
    const user = await VGSync.accountMe();
    if (['owner', 'admin'].includes(user.role)) { const members = document.createElement('a'); members.href = '/member-admin.html'; members.textContent = 'Members'; left.append(members); }
    if (VGSync.getConfig().enabled) await VGSync.fetchLobby();
    window.addEventListener('vg-sync-status', event => render(event.detail));
    VGSync.start(); render(VGSync.status());
  } catch { location.assign('/'); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) VGSync.push().catch(() => {}); });
});
