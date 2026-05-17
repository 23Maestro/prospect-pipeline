// Scriptable: Share Prospect Contact Card
// Preset card location on iPhone:
// iCloud Drive/Scriptable/ProspectContactCards/<file>.vcf
//
// URL examples:
// https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?card=ryan
// https://open.scriptable.app/run/Share%20Prospect%20Contact%20Card?card=james&mode=copyText

const CARD_FOLDER = 'ProspectContactCards';

const CARD_FILES = {
  jeffrey: 'JeffreyStein-contact-card.vcf',
  jerami: 'JeramiSingleton-contact-card.vcf',
  luther: 'LutherWinfield-contact-card.vcf',
  me: 'JeramiSingleton-contact-card.vcf',
  ryan: 'RyanLietz-contact-card.vcf',

  // Add these files to iCloud Drive/Scriptable/ProspectContactCards when vetted.
  james: 'JamesHolcomb-contact-card.vcf',
  logan: 'Logan-contact-card.vcf',
};

const params = args.queryParameters || {};
const cardKey = normalizeCardKey(params.card || params.name || params.scout || '');
const mode = normalizeMode(params.mode || 'share');
const fileName = CARD_FILES[cardKey];

if (!fileName) {
  await showCardPicker();
} else {
  await handleCard(cardKey, fileName, mode);
}

Script.complete();

async function showCardPicker() {
  const alert = new Alert();
  alert.title = 'Prospect Contact Card';
  alert.message = 'Choose a card to share.';

  const keys = Object.keys(CARD_FILES).sort();
  for (const key of keys) {
    alert.addAction(labelForKey(key));
  }
  alert.addCancelAction('Cancel');

  const selectedIndex = await alert.presentSheet();
  if (selectedIndex < 0) return;

  const selectedKey = keys[selectedIndex];
  await handleCard(selectedKey, CARD_FILES[selectedKey], mode);
}

async function handleCard(cardKey, fileName, modeValue) {
  const fm = FileManager.iCloud();
  const folderPath = fm.joinPath(fm.documentsDirectory(), CARD_FOLDER);
  const cardPath = fm.joinPath(folderPath, fileName);

  if (!fm.fileExists(folderPath)) {
    fm.createDirectory(folderPath, true);
    throw new Error(`Created missing folder. Add .vcf files to ${CARD_FOLDER}.`);
  }

  if (!fm.fileExists(cardPath)) {
    throw new Error(`Missing ${fileName} in ${CARD_FOLDER}.`);
  }

  if (fm.isFileDownloaded && !fm.isFileDownloaded(cardPath)) {
    await fm.downloadFileFromiCloud(cardPath);
  }

  if (modeValue === 'copyText') {
    Pasteboard.copyString(fm.readString(cardPath));
    await showNotice('Copied vCard text', `${labelForKey(cardKey)} is copied as text.`);
    return;
  }

  if (modeValue === 'preview') {
    await QuickLook.present(cardPath);
    return;
  }

  await ShareSheet.present([cardPath]);
}

function normalizeCardKey(value) {
  return String(value || '')
    .trim()
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

function labelForKey(key) {
  const labels = {
    jeffrey: 'Jeffrey Stein',
    jerami: 'Jerami Singleton',
    luther: 'Luther Winfield',
    me: 'Jerami Singleton',
    ryan: 'Ryan Lietz',
    james: 'James Holcomb',
    logan: 'Logan',
  };
  return labels[key] || key;
}

async function showNotice(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction('OK');
  await alert.presentAlert();
}
