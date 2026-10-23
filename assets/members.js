(() => {
  const message = text => { document.getElementById('hubMessage').textContent = text; };
  const when = value => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet saved';
  async function loadTables() {
    message('');
    try {
      const { tables } = await VGSync.tableDirectory(); const list = document.getElementById('tableList'); list.replaceChildren();
      if (!tables.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No tables assigned yet.'; list.append(empty); }
      for (const table of tables) {
        const card = document.createElement('article'); card.className = 'table-item';
        const status = document.createElement('span'); status.className = `status ${table.status}`; status.textContent = table.archived ? 'Archived' : table.status === 'paused' ? 'Saved for a break' : table.status;
        const title = document.createElement('h2'); title.textContent = table.name;
        const meta = document.createElement('div'); meta.className = 'meta';
        for (const text of [`Last saved ${when(table.savedAt)}`, `${table.onlineCount} online`, table.wardenName ? `Warden: ${table.wardenName}` : 'Warden seat available']) { const line = document.createElement('span'); line.textContent = text; meta.append(line); }
        const button = document.createElement('button'); button.className = 'primary'; button.textContent = table.archived ? 'Archived' : 'Resume table'; button.disabled = !!table.archived; button.addEventListener('click', () => enter(table, button)); card.append(status, title, meta, button); list.append(card);
      }
    } catch (error) { message(error.message); }
  }
  async function enter(table, button) {
    button.disabled = true; message('');
    try { VGSync.stop(); const result = await VGSync.joinTable(table.code); const manage = !!result.table.permissions.canWriteSharedState; localStorage.setItem('vg_role', manage ? 'dm' : 'player'); location.assign(manage ? '/admin/' : '/player/player.html'); }
    catch (error) { message(error.message); button.disabled = false; }
  }
  document.getElementById('refreshTables').addEventListener('click', loadTables);
  document.getElementById('createTableForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { VGSync.stop(); await VGSync.createTable(document.getElementById('newTableName').value.trim()); localStorage.setItem('vg_role', 'dm'); location.assign('/admin/'); }
    catch (error) { message(error.message); button.disabled = false; }
  });
  document.getElementById('logoutButton').addEventListener('click', async () => { try { await VGSync.accountLogout(); location.assign('/'); } catch (error) { message(error.message); } });
  const dialog = document.getElementById('accountDialog');
  document.getElementById('accountButton').addEventListener('click', () => dialog.showModal()); document.getElementById('closeAccount').addEventListener('click', () => dialog.close());
  document.getElementById('changePasswordForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const output = document.getElementById('accountMessage'); output.textContent = '';
    try {
      if (document.getElementById('newPassword').value !== document.getElementById('confirmNewPassword').value) throw new Error('The passwords do not match.');
      const response = await fetch('/api/accounts/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: document.getElementById('oldPassword').value, newPassword: document.getElementById('newPassword').value }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); form.reset(); output.className = 'message success'; output.textContent = 'Password updated. Other sessions have been signed out.';
    } catch (error) { output.className = 'message'; output.textContent = error.message; }
  });
  (async () => {
    try { const user = await VGSync.accountMe(); if (user.mustResetPassword) return location.assign('/'); document.getElementById('memberGreeting').textContent = `Welcome back, ${user.displayName}`; document.getElementById('accountIdentity').textContent = user.email || user.username; document.getElementById('adminLink').hidden = !['owner', 'admin'].includes(user.role); document.getElementById('createSection').hidden = !['owner', 'admin', 'warden'].includes(user.role); await loadTables(); }
    catch { location.assign('/'); }
  })();
})();
