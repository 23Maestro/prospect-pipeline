#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultContractUrl = 'https://prospect-web.vercel.app/api/call-tracker-data';
const contractPath = resolve(repoRoot, 'apps/prospect-web/public/prospect-call-tracker/data-contract.json');
const archiveDir = resolve(repoRoot, 'apps/prospect-web/public/prospect-call-tracker/weekly-results');
const indexPath = resolve(archiveDir, 'index.json');
const TIME_ZONE = 'America/New_York';

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function localDateKey(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function eventDateKey(row) {
  return row.reporting_date_et || localDateKey(row.reporting_at || row.occurred_at);
}

function safeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readContract() {
  const source = process.env.CALL_TRACKER_ARCHIVE_SOURCE || defaultContractUrl;
  if (source === 'local-data-contract') return readJson(contractPath);
  const response = await fetch(source, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${source} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const contract = await readContract();
if (!contract?.data?.ui?.periods?.['week-total']) {
  throw new Error(`Missing materialized week-total in ${contractPath}`);
}

const periods = contract.data.ui.periods;
const weekStart = periods['week-0']?.localDateKey;
const weekEnd = periods['week-4']?.localDateKey;
if (!weekStart || !weekEnd) {
  throw new Error('Cannot archive week without week-0 and week-4 localDateKey values.');
}

const events = Array.isArray(contract.data.events)
  ? contract.data.events.filter((row) => {
      const key = eventDateKey(row);
      return key >= weekStart && key <= weekEnd;
    })
  : [];
const weekTotal = periods['week-total'];
const filename = `${weekStart}_to_${weekEnd}.json`;
const archivePath = resolve(archiveDir, filename);
const archivedAt = new Date().toISOString();
const snapshot = {
  archivedAt,
  sourceGeneratedAt: contract.data.generatedAt,
  sourceContractVersion: contract.version,
  week: {
    id: safeSlug(`${weekStart} to ${weekEnd}`),
    startDate: weekStart,
    endDate: weekEnd,
    label: weekTotal.label,
  },
  summary: {
    dials: weekTotal.dials,
    contacts: weekTotal.contacts,
    meetingsSet: weekTotal.meetingsSet,
    setRate: weekTotal.setRate,
    outcomeCounts: weekTotal.outcomeCounts,
    filterCounts: weekTotal.filterCounts,
  },
  allTimeAtArchive: {
    dials: contract.data.summary?.dials ?? null,
    contacts: contract.data.summary?.contacts ?? null,
    meetingsSet: contract.data.summary?.meetings_set ?? null,
    setRate: contract.data.summary?.contacts
      ? Math.round((Number(contract.data.summary.meetings_set || 0) / Number(contract.data.summary.contacts)) * 100)
      : 0,
  },
  events,
};

mkdirSync(archiveDir, { recursive: true });
writeFileSync(archivePath, `${JSON.stringify(snapshot, null, 2)}\n`);

const index = readJson(indexPath, { generatedAt: archivedAt, weeks: [] });
const previousWeeks = Array.isArray(index.weeks) ? index.weeks : [];
const entry = {
  archivedAt,
  file: filename,
  startDate: weekStart,
  endDate: weekEnd,
  label: weekTotal.label,
  dials: weekTotal.dials,
  contacts: weekTotal.contacts,
  meetingsSet: weekTotal.meetingsSet,
  setRate: weekTotal.setRate,
  allTimeAtArchive: snapshot.allTimeAtArchive,
};
const weeks = [entry, ...previousWeeks.filter((week) => week.file !== filename)];
writeFileSync(indexPath, `${JSON.stringify({ generatedAt: archivedAt, weeks }, null, 2)}\n`);

console.log(JSON.stringify({ archived: archivePath, index: indexPath, ...entry }, null, 2));
