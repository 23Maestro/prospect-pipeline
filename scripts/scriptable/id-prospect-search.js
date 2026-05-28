// Scriptable script name: ID Prospect Search
//
// Accepts:
// - Shortcut input: args.shortcutParameter
// - URL params: scriptable:///run?scriptName=ID%20Prospect%20Search&phone=...
// - URL params: scriptable:///run?scriptName=ID%20Prospect%20Search&q=...
// - Clipboard fallback when the clipboard contains a phone number.

const SEARCH_BASE_URL = 'https://prospect-web.vercel.app/prospect-mobile/contact-search';

const params = args.queryParameters || {};
const shortcutInput = typeof args.shortcutParameter === 'undefined' ? '' : String(args.shortcutParameter || '');
const clipboardPhone = readClipboardPhone();
const initialQuery = firstPresent([
  shortcutInput,
  params.phone,
  params.q,
  params.query,
  params.number,
  params.text,
  clipboardPhone,
]);

const query = initialQuery || (await promptForSearch());

if (query) {
  Safari.open(buildSearchUrl(query));
}

Script.complete();

function firstPresent(values) {
  for (const value of values) {
    const cleaned = String(value || '').trim();
    if (cleaned) return cleaned;
  }
  return '';
}

async function promptForSearch() {
  const alert = new Alert();
  alert.title = 'Prospect Search';
  alert.message = 'Enter a phone number or search text.';
  alert.addTextField('+1 (478) 258-4863');
  alert.addAction('Search');
  alert.addCancelAction('Cancel');

  const result = await alert.present();
  if (result < 0) return '';
  return String(alert.textFieldValue(0) || '').trim();
}

function buildSearchUrl(value) {
  const trimmed = String(value || '').trim();
  const paramName = looksLikePhone(trimmed) ? 'phone' : 'q';
  return `${SEARCH_BASE_URL}?${paramName}=${encodeURIComponent(trimmed)}`;
}

function readClipboardPhone() {
  try {
    const value = String(Pasteboard.pasteString() || '').trim();
    return looksLikePhone(value) ? value : '';
  } catch {
    return '';
  }
}

function looksLikePhone(value) {
  return String(value || '').replace(/\D/g, '').length >= 7;
}
