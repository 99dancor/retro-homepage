'use strict';
const nodemailer = require('nodemailer');
const { getSetting } = require('./db');

// Schickt eine Benachrichtigung, wenn SMTP in den Einstellungen konfiguriert ist.
async function notify(subject, text) {
  const to = getSetting('notify_email');
  const host = getSetting('smtp_host');
  if (!to || !host) return false;
  const transport = nodemailer.createTransport({
    host,
    port: Number(getSetting('smtp_port', '587')),
    secure: getSetting('smtp_secure') === '1',
    auth: getSetting('smtp_user') ? { user: getSetting('smtp_user'), pass: getSetting('smtp_pass') } : undefined,
  });
  await transport.sendMail({
    from: getSetting('smtp_from') || getSetting('smtp_user') || to,
    to,
    subject: `[${getSetting('site_title')}] ${subject}`,
    text,
  });
  return true;
}

function notifyQuietly(subject, text) {
  notify(subject, text).catch(e => console.error('E-Mail-Versand fehlgeschlagen:', e.message));
}

module.exports = { notify, notifyQuietly };
