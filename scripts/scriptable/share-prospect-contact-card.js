// Scriptable: share-prospect-contact-card
// Preset card location on iPhone:
// iCloud Drive/Scriptable/ProspectIDContactCards/
//
// URL examples:
// scriptable:///run/share-prospect-contact-card?scout=James%20Holcomb
// scriptable:///run/share-prospect-contact-card?scout=Ryan%20Lietz&mode=copyText

const CARD_FOLDER = 'ProspectIDContactCards';

const SCOUT_ALIASES = {
  'james': 'Head Scout E',
  'jamesholcomb': 'Head Scout E',
  'jeffrey': 'Head Scout B',
  'jeffreystein': 'Head Scout B',
  'jerami': 'Primary Operator',
  'jeramisingleton': 'Primary Operator',
  'logan': 'Head Scout F',
  'loganlord': 'Head Scout F',
  'luther': 'Head Scout C',
  'lutherwinfield': 'Head Scout C',
  'lutherwinfieldiii': 'Head Scout C',
  'me': 'Primary Operator',
  'ryan': 'Head Scout D',
  'ryanlietz': 'Head Scout D',
};

const params = args.queryParameters || {};
const scoutInput = params.scout || params.card || params.name || '';
const mode = normalizeMode(params.mode || 'share');

await run(scoutInput, mode);
Script.complete();

async function run(scoutInput, modeValue) {
  const fm = FileManager.iCloud();
  const folderPath = fm.joinPath(fm.documentsDirectory(), CARD_FOLDER);

  if (!fm.fileExists(folderPath)) {
    fm.createDirectory(folderPath, true);
    throw new Error(`Created missing folder. Add contact cards to ${CARD_FOLDER}.`);
  }

  const cards = await listContactCards(fm, folderPath);
  if (!cards.length) {
    throw new Error(`No contact cards found in ${CARD_FOLDER}.`);
  }

  const card = findCard(cards, scoutInput) || (await pickCard(cards));
  if (!card) return;

  await handleCard(fm, card, modeValue);
}

async function listContactCards(fm, folderPath) {
  const names = fm.listContents(folderPath).filter((name) => name.toLowerCase().endsWith('.vcf'));
  const cards = [];

  for (const fileName of names) {
    const path = fm.joinPath(folderPath, fileName);
    if (fm.isFileDownloaded && !fm.isFileDownloaded(path)) {
      await fm.downloadFileFromiCloud(path);
    }
    cards.push({
      fileName,
      path,
      displayName: readDisplayName(fm, path) || cleanFileName(fileName),
    });
  }

  return cards.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function findCard(cards, scoutInput) {
  const normalizedInput = normalizeName(scoutInput);
  if (!normalizedInput) return null;

  const aliasName = SCOUT_ALIASES[normalizedInput];
  const normalizedTarget = normalizeName(aliasName || scoutInput);

  return (
    cards.find((card) => normalizeName(card.displayName) === normalizedTarget) ||
    cards.find((card) => normalizeName(card.fileName) === normalizedTarget) ||
    cards.find((card) => normalizeName(card.displayName).includes(normalizedTarget)) ||
    cards.find((card) => normalizeName(card.fileName).includes(normalizedTarget))
  );
}

async function pickCard(cards) {
  const alert = new Alert();
  alert.title = 'Prospect Contact Card';
  alert.message = 'Choose a card to share.';

  for (const card of cards) {
    alert.addAction(card.displayName);
  }
  alert.addCancelAction('Cancel');

  const selectedIndex = await alert.presentSheet();
  return selectedIndex < 0 ? null : cards[selectedIndex];
}

async function handleCard(fm, card, modeValue) {
  if (modeValue === 'copyText') {
    Pasteboard.copyString(fm.readString(card.path));
    await showNotice('Copied vCard text', `${card.displayName} is copied as text.`);
    return;
  }

  if (modeValue === 'preview') {
    await QuickLook.present(card.path);
    return;
  }

  await ShareSheet.present([card.path]);
}

function readDisplayName(fm, path) {
  try {
    const text = fm.readString(path);
    const fullName = text.match(/^FN:(.+)$/m);
    if (fullName?.[1]) return fullName[1].trim();
    const nameParts = text.match(/^N:([^;\r\n]*);([^;\r\n]*)/m);
    if (nameParts) return `${nameParts[2]} ${nameParts[1]}`.trim();
  } catch {
    return null;
  }
  return null;
}

function cleanFileName(fileName) {
  return String(fileName || '')
    .replace(/\.vcf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'copy' || normalized === 'copytext' || normalized === 'clipboard') {
    return 'copyText';
  }
  if (normalized === 'preview' || normalized === 'open') {
    return 'preview';
  }
  return 'share';
}

async function showNotice(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction('OK');
  await alert.presentAlert();
}
