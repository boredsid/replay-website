// apps-script/Code.gs — paste into Apps Script project "Replay Email Webhook"
// Verifies HMAC signature, looks up template, sends via GmailApp.
// Script property required: WEBHOOK_SECRET (generated via `openssl rand -hex 32`).

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  const body = e.postData.contents;
  // Apps Script doPost cannot read custom HTTP headers reliably; the
  // replay worker also sends the signature as a query param.
  const signature = e.parameter['X-Signature'] || e.parameter['signature'] || '';

  const computed = Utilities.computeHmacSha256Signature(body, secret)
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');

  if (computed !== signature) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'bad signature' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const payload = JSON.parse(body);
  const html = renderTemplate(payload.template, payload.variables);
  GmailApp.sendEmail(payload.to, payload.subject, '', { htmlBody: html, name: 'REPLAY' });
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function renderTemplate(template, vars) {
  const urls = {
    'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/registration.html',
    'replay-preorder':     'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/preorder.html',
  };
  const url = urls[template];
  if (!url) throw new Error('unknown template: ' + template);
  let html = UrlFetchApp.fetch(url).getContentText();
  Object.keys(vars || {}).forEach(function (k) {
    html = html.split('{{' + k + '}}').join(escapeHtml(vars[k]));
  });
  return html;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
