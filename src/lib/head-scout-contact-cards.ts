import { Clipboard, environment } from '@raycast/api';
import { access, open as openFile, readdir } from 'fs/promises';
import { constants as fsConstants, type Dirent } from 'fs';

const CONTACT_CARD_ROOTS = [
  `${environment.assetsPath}/contact-cards`,
  '/Users/singleton23/Library/Messages/Attachments',
  '/Users/singleton23/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/LinkedFiles',
] as const;

export type HeadScoutContactCard = {
  path: string;
  fullName: string;
};

export type HeadScoutContactCardClipboardResult = {
  card: HeadScoutContactCard;
  copiedFile: boolean;
};

function normalizeName(value?: string | null): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function walkVcfFiles(root: string): Promise<string[]> {
  if (!(await canRead(root))) {
    return [];
  }

  const queue = [root];
  const matches: string[] = [];

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.vcf')) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

async function readCardDisplayName(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof openFile>> | null = null;
  try {
    handle = await openFile(path, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const match = header.match(/^FN:(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function findHeadScoutContactCard(
  scoutName?: string | null,
): Promise<HeadScoutContactCard | null> {
  const normalizedScoutName = normalizeName(scoutName);
  if (!normalizedScoutName) {
    return null;
  }

  for (const root of CONTACT_CARD_ROOTS) {
    const files = await walkVcfFiles(root);
    for (const file of files) {
      const fullName = await readCardDisplayName(file);
      if (!fullName) {
        continue;
      }

      const normalizedFullName = normalizeName(fullName);
      if (
        normalizedFullName === normalizedScoutName ||
        normalizedFullName.startsWith(normalizedScoutName)
      ) {
        return {
          path: file,
          fullName,
        };
      }
    }
  }

  return null;
}

async function copyCardFileWithTextFallback(card: HeadScoutContactCard): Promise<boolean> {
  try {
    await Clipboard.copy({ file: card.path });
    return true;
  } catch {
    await Clipboard.copy(`${card.fullName}\n${card.path}`);
    return false;
  }
}

export async function copyHeadScoutContactCardToClipboard(
  scoutName?: string | null,
): Promise<HeadScoutContactCardClipboardResult> {
  const card = await findHeadScoutContactCard(scoutName);
  if (!card) {
    throw new Error(`No contact card found for ${String(scoutName || 'this scout').trim()}`);
  }

  const copiedFile = await copyCardFileWithTextFallback(card);
  return {
    card,
    copiedFile,
  };
}
