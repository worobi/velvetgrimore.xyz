(() => {
  let me, allTables = [], editing;
  const message = (text, good = false) => { const el = document.getElementById('adminMessage'); el.className = `message${good ? ' success' : ''}`; el.textContent = text; };
  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api/accounts/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The request failed.'); return data;
  }
  function options(select, selected = []) {
    select.replaceChildren();
    for (const table of allTables.filter(t => !t.archived)) { const option = document.createElement('option'); option.value = table.code; option.textContent = `${table.name} (${table.code})`; option.selected = selected.includes(table.code); select.append(option); }
  }
  function row(title, subtitle, buttonText, action) {
    const item = document.createElement('div'); item.className = 'list-row';
    const details = document.createElement('div'); details.className = 'details'; const strong = document.createElement('strong'); strong.textContent = title; const small = document.createElement('small'); small.textContent = subtitle; details.append(strong, small); item.append(details);
    if (action) { const button = document.createElement('button'); button.textContent = buttonText; button.addEventListener('click', action); item.append(button); }
    return item;
  }
  async function refresh() {
    const [users, invites, tables] = await Promise.all([api('users'), api('invites'), VGSync.tableDirectory()]);
    allTables = tables.tables; options(document.getElementById('inviteTables'));
    const list = document.getElementById('memberList'); list.replaceChildren();
    for (const user of users.users) list.append(row(user.displayName, `${user.email || user.username} | ${user.role} | ${user.active ? 'Enabled' : 'Disabled'}`, 'Edit access', () => edit(user)));
    const invitations = document.getElementById('invitationList'); invitations.replaceChildren();
    if (!invites.invites.length) invitations.append(row('No invitations yet', '', '', null));
    for (const invite of invites.invites) {
      const active = invite.active && !invite.usedAt && Date.parse(invite.expiresAt) > Date.now();
      const status = invite.usedAt ? 'Accepted' : active ? `Sent; expires ${new Date(invite.expiresAt).toLocaleDateString()}` : invite.delivery === 'failed' ? 'Delivery failed' : 'Expired or withdrawn';
      invitations.append(row(invite.email, `${invite.role} | ${status}`, 'Withdraw', active ? async () => { try { await api(`invites/${invite.id}`, 'PATCH', { active: false }); await refresh(); } catch (error) { message(error.message); } } : null));
    }
    if (me.role === 'owner') {
      const { mail } = await api('mail'); document.getElementById('mailStatus').textContent = mail.configured ? 'Connected to Spacemail.' : 'Not connected. Invitations cannot be sent yet.'; document.getElementById('sendInvitation').disabled = !mail.configured;
    }
  }
  document.getElementById('mailForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = document.getElementById('connectMail'); button.disabled = true; message('Verifying Spacemail...');
    try { await api('mail', 'PUT', { password: document.getElementById('mailPassword').value }); form.reset(); message('Spacemail is connected. Email invitations are ready.', true); await refresh(); }
    catch (error) { message(error.message); } finally { button.disabled = false; }
  });
  document.getElementById('invitationForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = document.getElementById('sendInvitation'); button.disabled = true; message('Sending invitation...');
    try {
      const recipient = document.getElementById('inviteEmail').value.trim();
      await api('invites', 'POST', { email: recipient, displayName: document.getElementById('inviteName').value.trim(), role: document.getElementById('inviteRole').value, tableCodes: [...document.getElementById('inviteTables').selectedOptions].map(o => o.value) });
      form.reset(); message(`Invitation sent to ${recipient}.`, true); await refresh();
    } catch (error) { message(error.message); } finally { button.disabled = false; }
  });
  function edit(user) {
    editing = user; document.getElementById('editMemberIdentity').textContent = user.email || user.username; document.getElementById('editMemberName').value = user.displayName; document.getElementById('editMemberRole').value = user.role; document.getElementById('editMemberRole').disabled = user.role === 'owner'; document.getElementById('editMemberActive').checked = user.active; document.getElementById('editMemberMessage').textContent = ''; options(document.getElementById('editMemberTables'), user.tableCodes); document.getElementById('editMemberDialog').showModal();
  }
  document.getElementById('closeEditMember').addEventListener('click', () => document.getElementById('editMemberDialog').close());
  document.getElementById('editMemberForm').addEventListener('submit', async event => {
    event.preventDefault();
    try { await api(`users/${editing.id}`, 'PATCH', { displayName: document.getElementById('editMemberName').value, role: document.getElementById('editMemberRole').value, active: document.getElementById('editMemberActive').checked, tableCodes: [...document.getElementById('editMemberTables').selectedOptions].map(o => o.value) }); document.getElementById('editMemberDialog').close(); await refresh(); }
    catch (error) { document.getElementById('editMemberMessage').textContent = error.message; }
  });
  document.getElementById('refreshAdmin').addEventListener('click', () => refresh().catch(error => message(error.message)));
  document.getElementById('logoutButton').addEventListener('click', async () => { await VGSync.accountLogout(); location.assign('/'); });
  (async () => { try { me = await VGSync.accountMe(); document.getElementById('mailSection').hidden = me.role !== 'owner'; document.getElementById('adminRoleOption').hidden = me.role !== 'owner'; await refresh(); } catch (error) { message(error.message); } })();
})();
