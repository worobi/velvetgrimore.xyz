(() => {
  const forms = ['signInForm', 'inviteForm', 'passwordForm'];
  let inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite') || sessionStorage.getItem('vg_invite_token') || '';
  if (location.hash) history.replaceState(null, '', '/');
  if (inviteToken) sessionStorage.setItem('vg_invite_token', inviteToken);
  const message = text => { document.getElementById('loginMessage').textContent = text; };
  function show(form, title, intro) {
    forms.forEach(id => { document.getElementById(id).hidden = id !== form; });
    document.getElementById('loginTitle').textContent = title; document.getElementById('loginIntro').textContent = intro;
  }
  async function api(route, body) {
    const response = await fetch(`/api/accounts/${route}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to connect. Please try again.'); return data;
  }
  function signedIn(user) {
    localStorage.setItem('vg_account_session', JSON.stringify({ user }));
    if (user.mustResetPassword) show('passwordForm', 'Choose a new password.', 'Replace your temporary password before entering.');
    else location.assign('/members.html');
  }
  for (const id of forms) document.getElementById(id).addEventListener('submit', async event => {
    event.preventDefault(); message(''); const submit = event.currentTarget.querySelector('button[type=submit]'); submit.disabled = true;
    try {
      let data;
      if (id === 'signInForm') data = await api('login', { username: document.getElementById('loginEmail').value.trim(), password: document.getElementById('loginPassword').value });
      if (id === 'inviteForm') {
        if (document.getElementById('invitePassword').value !== document.getElementById('inviteConfirm').value) throw new Error('The passwords do not match.');
        data = await api('invites/accept', { token: inviteToken, email: document.getElementById('inviteEmail').value, displayName: document.getElementById('inviteName').value, password: document.getElementById('invitePassword').value, adultConfirmed: document.getElementById('adultConfirmed').checked });
        sessionStorage.removeItem('vg_invite_token');
      }
      if (id === 'passwordForm') {
        if (document.getElementById('newPassword').value !== document.getElementById('confirmPassword').value) throw new Error('The passwords do not match.');
        data = await api('password', { currentPassword: document.getElementById('currentPassword').value, newPassword: document.getElementById('newPassword').value });
      }
      signedIn(data.user);
    } catch (error) { message(error.message); } finally { submit.disabled = false; }
  });
  (async () => {
    if (inviteToken) {
      try {
        const invite = await api('invites/preview', { token: inviteToken }); show('inviteForm', 'Your seat is waiting.', 'Create the account reserved for you.');
        document.getElementById('inviteEmail').value = invite.email; document.getElementById('inviteName').value = invite.displayName || '';
        document.getElementById('accessNotice').textContent = 'Private invitation. One account, one seat at the table.';
      } catch (error) { sessionStorage.removeItem('vg_invite_token'); message(error.message); }
    } else { try { signedIn((await api('me')).user); } catch {
      Object.keys(localStorage).filter(key => key.startsWith('vg_') || key.startsWith('npc_response_')).forEach(key => localStorage.removeItem(key));
    } }
  })();
})();
