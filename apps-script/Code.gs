// apps-script/Code.gs — paste into Apps Script project "Replay Email Webhook"
// Verifies HMAC signature, looks up template, sends via GmailApp.
// Script property required: WEBHOOK_SECRET (generated via `openssl rand -hex 32`).

const FROM_ADDRESS = 'hello@boardgamecompany.in';

function doPost(e) {
  try {
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

    if (!secret || computed !== signature) {
      return jsonResponse({ ok: false, error: 'bad signature' });
    }

    const envelope = JSON.parse(body);
    const payloadJson = typeof envelope.payload_base64 === 'string'
      ? Utilities.newBlob(Utilities.base64Decode(envelope.payload_base64)).getDataAsString('UTF-8')
      : body;
    const payload = JSON.parse(payloadJson);
    const html = renderTemplate(payload.template, payload.variables);
    GmailApp.sendEmail(payload.to, payload.subject, '', {
      htmlBody: html,
      name: 'REPLAY',
      from: FROM_ADDRESS,
    });
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: 'email failed' });
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function renderTemplate(template, vars) {
  const urls = {
    'replay-registration': 'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/registration.html',
    'replay-preorder':     'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/preorder.html',
    'replay-partner':      'https://raw.githubusercontent.com/boredsid/replay-website/main/src/emails/partner.html',
  };
  const url = urls[template];
  if (!url) throw new Error('unknown template: ' + template);
  let html = UrlFetchApp.fetch(url).getContentText();
  html = renderConditionalBlocks(html, vars || {});
  Object.keys(vars || {}).forEach(function (k) {
    html = html.split('{{' + k + '}}').join(escapeHtml(vars[k]));
  });
  return html;
}

function renderConditionalBlocks(html, vars) {
  return html.replace(/\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, function (_, key, block) {
    return vars[key] ? block : '';
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
