/**
 * REPLAY Store — Apps Script additions
 *
 * ADD these changes to your existing Apps Script project.
 * Do NOT create separate doGet/doPost — merge into the existing ones.
 *
 * SETUP:
 *   1. Create a new tab named "Orders" in your existing Google Sheet with headers:
 *      Timestamp | Name | Phone | Email | Items | Total
 *   2. Redeploy the web app (create a new version)
 *   (No new Script Properties needed — uses the same active spreadsheet)
 *
 * ═══════════════════════════════════════════════════════════
 *  STEP 1: Replace your existing doGet() with this version
 * ═══════════════════════════════════════════════════════════
 */

function doGet(e) {
  var action = e.parameter.action;
  var callback = e.parameter.callback || 'handleData';

  // ── Existing: registration data ──
  if (action === 'getData') {
    var guildUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRnxm_GrfdyAKghkS9b_CN3KTHtaS7ahis8bnHySOpwD9xI1GR9bnKwqEzg8QAt639AEekCeeeW-oNg/pub?gid=581649392&single=true&output=csv';
    var guildCsv = UrlFetchApp.fetch(guildUrl).getContentText();
    var guildRows = parseCsv(guildCsv);
    var guild = guildRows.map(function(row) {
      return {
        phone: row['Phone Number'] || '',
        name: row['Name'] || '',
        plan: row['Plan'] || '',
        state: row['Current State'] || ''
      };
    });

    var regUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQC1eHgoj6zeLisdUrlEZsq1xhSkGRe3kfmE_kG9Xxy-ErnfYj2dEB4h8xd1A1AgDV6irYItV_c2QeF/pub?gid=0&single=true&output=csv';
    var regCsv = UrlFetchApp.fetch(regUrl).getContentText();
    var regRows = parseCsv(regCsv);
    var registrations = regRows.map(function(row) {
      return {
        phone: row['Phone'] || '',
        quantity: row['Quantity'] || '1',
        passType: row['Pass Type'] || '',
        day: row['Day'] || ''
      };
    });

    var jsonData = JSON.stringify({ guild: guild, registrations: registrations });
    return ContentService.createTextOutput(callback + '(' + jsonData + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ── NEW: pre-order product data ──
  if (action === 'getPreorderData') {
    return servePreorderData(callback);
  }

  return ContentService.createTextOutput('// ok')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * ═══════════════════════════════════════════════════════════
 *  STEP 2: Replace your existing doPost() with this version
 * ═══════════════════════════════════════════════════════════
 */

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // ── NEW: pre-order submission ──
  if (data.action === 'preorder') {
    return handlePreorder(data);
  }

  // ── Existing: registration submission ──
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Name", "Phone", "Email", "Pass Type", "Day", "Quantity", "Total", "Discount"]);
  }

  sheet.appendRow([
    new Date(), data.name, data.phone, data.email,
    data.pass, data.day, data.quantity, data.total, data.discount
  ]);

  // Send registration confirmation email
  try {
    var day = data.day;
    if (day === 'Both days') {
      day = 'Saturday & Sunday, April 18-19';
    }

    var html = UrlFetchApp.fetch('https://raw.githubusercontent.com/boredsid/replay-website/main/email-confirmation.html').getContentText();
    html = html.replace(/\{\{name\}\}/g, data.name);
    html = html.replace(/\{\{phone\}\}/g, data.phone);
    html = html.replace(/\{\{passType\}\}/g, data.pass);
    html = html.replace(/\{\{day\}\}/g, day);
    html = html.replace(/\{\{quantity\}\}/g, data.quantity);

    GmailApp.sendEmail(data.email, "You're In! REPLAY Registration Confirmed", "", {
      htmlBody: html,
      name: "REPLAY Convention"
    });
  } catch (err) {
    Logger.log('Email error: ' + err.message);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ═══════════════════════════════════════════════════════════
 *  STEP 3: Add these NEW functions (paste below your existing parseCsv/parseCsvLine)
 * ═══════════════════════════════════════════════════════════
 */

// ── Serve pre-order product data + registrations for phone validation ──
function servePreorderData(callback) {
  // Fetch puzzles CSV (gid=0)
  var puzzleUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTHiksNCT0XRTczxBkQ5qBvOLqsW6iMpXihvhV8O3dYp_fwXyAaGfrSokBFhxFNJBQ7-aEmHdleoPn3/pub?gid=0&single=true&output=csv';
  var puzzleCsv = UrlFetchApp.fetch(puzzleUrl).getContentText();
  var puzzles = parseCsv(puzzleCsv);

  // Fetch board games CSV (gid=22445468)
  var gamesUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTHiksNCT0XRTczxBkQ5qBvOLqsW6iMpXihvhV8O3dYp_fwXyAaGfrSokBFhxFNJBQ7-aEmHdleoPn3/pub?gid=22445468&single=true&output=csv';
  var gamesCsv = UrlFetchApp.fetch(gamesUrl).getContentText();
  var games = parseCsv(gamesCsv);

  // Fetch registrations for phone validation (same URL as getData action)
  var regUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQC1eHgoj6zeLisdUrlEZsq1xhSkGRe3kfmE_kG9Xxy-ErnfYj2dEB4h8xd1A1AgDV6irYItV_c2QeF/pub?gid=0&single=true&output=csv';
  var regCsv = UrlFetchApp.fetch(regUrl).getContentText();
  var regRows = parseCsv(regCsv);
  var registrations = regRows.map(function(row) {
    return { phone: row['Phone'] || '' };
  });

  var jsonData = JSON.stringify({
    puzzles: puzzles,
    games: games,
    registrations: registrations
  });

  return ContentService.createTextOutput(callback + '(' + jsonData + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ── Handle pre-order POST submission ──
function handlePreorder(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');

  if (!sheet) {
    sheet = ss.insertSheet('Orders');
    sheet.appendRow(['Timestamp', 'Name', 'Phone', 'Email', 'Items', 'Total']);
  }

  var itemsJson = JSON.stringify(data.items || []);

  sheet.appendRow([
    new Date(),
    data.name || '',
    data.phone || '',
    data.email || '',
    itemsJson,
    data.total || 0
  ]);

  // Send confirmation email
  if (data.email) {
    sendPreorderConfirmation(data);
  }

  return ContentService.createTextOutput(JSON.stringify({status: "success"}))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Send pre-order confirmation email ──
function sendPreorderConfirmation(data) {
  var items = data.items || [];
  var name = data.name || 'there';
  var phone = data.phone || '';
  var total = data.total || 0;

  // Build items HTML rows
  var itemsHtml = '';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var lineTotal = (item.price || 0) * (item.qty || 1);
    itemsHtml += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      '<tr>' +
        '<td style="padding:8px 0; font-family:\'Trebuchet MS\', Helvetica, sans-serif; font-weight:700; font-size:14px; color:#0A0A0A; line-height:1.4;">' +
          item.name +
          '<br><span style="font-weight:400; font-size:12px; color:rgba(0,0,0,0.5);">Qty: ' + item.qty + ' x &#8377;' + item.price + '</span>' +
        '</td>' +
        '<td align="right" style="padding:8px 0; font-family:\'Trebuchet MS\', Helvetica, sans-serif; font-weight:900; font-size:14px; color:#0A0A0A; white-space:nowrap; vertical-align:top;">' +
          '&#8377;' + lineTotal +
        '</td>' +
      '</tr>' +
    '</table>';
  }

  var totalFormatted = '&#8377;' + total;

  // Fetch email template from GitHub (same pattern as registration email)
  try {
    var html = UrlFetchApp.fetch('https://raw.githubusercontent.com/boredsid/replay-website/main/preorder-confirmation-email.html').getContentText();
    html = html.replace(/\{\{name\}\}/g, name);
    html = html.replace(/\{\{phone\}\}/g, phone);
    html = html.replace(/\{\{items\}\}/g, itemsHtml);
    html = html.replace(/\{\{total\}\}/g, totalFormatted);

    GmailApp.sendEmail(data.email, "Order Confirmed! - REPLAY Store", "", {
      htmlBody: html,
      name: "REPLAY Convention"
    });
  } catch (err) {
    Logger.log('Pre-order email error: ' + err.message);
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  KEEP your existing parseCsv() and parseCsvLine() as-is
 *  (no changes needed to those functions)
 * ═══════════════════════════════════════════════════════════
 */
