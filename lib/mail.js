const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

module.exports = function mailService(store, dataDir) {
  const keyPath = path.join(dataDir, 'mail.key');
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = fs.readFileSync(keyPath);
  function encrypt(password) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
  }
  function decrypt(value) {
    const [iv, tag, encrypted] = value.split('.').map(v => Buffer.from(v, 'base64'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  }
  function config() {
    const saved = store.readSetting('mail', {});
    return {
      host: process.env.SMTP_HOST || saved.host || 'mail.spacemail.com',
      port: Number(process.env.SMTP_PORT || saved.port || 465),
      from: process.env.SMTP_FROM || saved.from || 'Daddy@velvetgrimore.xyz',
      user: process.env.SMTP_USER || saved.user || 'Daddy@velvetgrimore.xyz',
      password: process.env.SMTP_PASSWORD || (saved.password ? decrypt(saved.password) : ''),
    };
  }
  function transport(settings = config()) {
    if (!settings.password) throw new Error('Configure invitation email in Member Administration first.');
    const test = process.env.NODE_ENV === 'test' && process.env.SMTP_TEST_MODE === '1';
    return nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.port === 465,
      requireTLS: !test && settings.port !== 465,
      auth: test ? undefined : { user: settings.user, pass: settings.password },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      tls: { minVersion: 'TLSv1.2' },
    });
  }
  return {
    status() {
      const { host, port, from, user, password } = config();
      return { host, port, from, user, configured: !!password };
    },
    async configure(input) {
      const current = config();
      const next = { ...current, password: String(input.password || current.password) };
      // This installation uses the approved Spacemail mailbox, not an open relay.
      if (process.env.NODE_ENV !== 'test') {
        next.host = 'mail.spacemail.com'; next.port = 465;
        next.from = 'Daddy@velvetgrimore.xyz'; next.user = next.from;
      }
      await transport(next).verify();
      store.writeSetting('mail', { ...next, password: encrypt(next.password) });
      return this.status();
    },
    async invite(to, url, displayName) {
      const settings = config();
      const result = await transport(settings).sendMail({
        from: { name: 'Velvet Grimoire', address: settings.from }, to,
        subject: 'Your invitation to Velvet Grimoire',
        text: `You have been invited to the private Velvet Grimoire table${displayName ? `, ${displayName}` : ''}.\n\nCreate your member account:\n${url}\n\nThis invitation is for ${to} only, expires in 7 days, and can be used once. If you did not expect it, you can ignore this email.`,
      });
      if (!result.accepted?.length) throw new Error('The mail server did not accept this invitation.');
      return result.messageId;
    },
  };
};
