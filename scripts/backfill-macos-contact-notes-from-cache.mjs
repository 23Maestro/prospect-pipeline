#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WRITE = process.argv.includes('--write');
const GROUP_INDEX = process.argv.indexOf('--group');
const GROUP_NAME = GROUP_INDEX >= 0 ? process.argv[GROUP_INDEX + 1] : 'ID Contacts';
const PAGE_SIZE = 1000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match) return acc;
      acc[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
      return acc;
    }, {});
}

function readRepoEnv() {
  return {
    ...readEnvFile(path.join(process.cwd(), '.env')),
    ...readEnvFile(path.join(process.cwd(), '.overmind.env')),
    ...readEnvFile(path.join(process.cwd(), 'npid-api-layer/.env')),
  };
}

function supabaseConfig() {
  const repoEnv = readRepoEnv();
  const url = String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  );
  const schema = String(process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || 'public');
  if (!url || !key) throw new Error('Missing Supabase URL or service key');
  return { url, key, schema };
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return '';
}

function naturalTimezoneLabel(row) {
  const legacy = String(row.timezone_label || '').trim().toUpperCase();
  const legacyLabels = {
    EST: 'Eastern',
    EDT: 'Eastern',
    CST: 'Central',
    CDT: 'Central',
    MST: 'Mountain',
    MDT: 'Mountain',
    PST: 'Pacific',
    PDT: 'Pacific',
    AKST: 'Alaska',
    AKDT: 'Alaska',
    HST: 'Hawaii',
    AST: 'Atlantic',
  };
  if (legacyLabels[legacy]) return legacyLabels[legacy];

  const zoneLabels = {
    'America/New_York': 'Eastern',
    'America/Detroit': 'Eastern',
    'America/Indiana/Indianapolis': 'Eastern',
    'America/Kentucky/Louisville': 'Eastern',
    'America/Chicago': 'Central',
    'America/Denver': 'Mountain',
    'America/Phoenix': 'Mountain',
    'America/Los_Angeles': 'Pacific',
    'America/Anchorage': 'Alaska',
    'Pacific/Honolulu': 'Hawaii',
    'America/Halifax': 'Atlantic',
  };
  return zoneLabels[String(row.timezone || '').trim()] || '';
}

function buildNote(row) {
  const athleteName = String(row.athlete_name || '').trim();
  const timezoneLabel = naturalTimezoneLabel(row);
  if (!athleteName || !timezoneLabel) return '';
  return [`Timezone: ${timezoneLabel}`, '', athleteName].join('\n');
}

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function appleScriptStringLiteral(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => `"${escapeAppleScript(line)}"`)
    .join(' & linefeed & ');
}

async function fetchCacheRows() {
  const config = supabaseConfig();
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${config.url}/rest/v1/athlete_contact_cache`);
    url.searchParams.set(
      'select',
      'athlete_key,athlete_name,admin_url,normalized_phone,timezone,timezone_label,last_seen_at',
    );
    url.searchParams.set('cache_status', 'eq.active');
    url.searchParams.set('order', 'last_seen_at.desc');
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Accept-Profile': config.schema,
      },
    });
    if (!response.ok) throw new Error(`Supabase read failed: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function inList(values) {
  return `(${values.map((value) => `"${String(value).replace(/"/g, '')}"`).join(',')})`;
}

async function fetchRowsByAthleteKeys(table, select, athleteKeys) {
  const config = supabaseConfig();
  const rows = [];
  for (let index = 0; index < athleteKeys.length; index += 80) {
    const chunk = athleteKeys.slice(index, index + 80);
    const url = new URL(`${config.url}/rest/v1/${table}`);
    url.searchParams.set('select', select);
    url.searchParams.set('athlete_key', `in.${inList(chunk)}`);
    url.searchParams.set('limit', '1000');
    const response = await fetch(url, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Accept-Profile': config.schema,
      },
    });
    if (!response.ok) throw new Error(`${table} read failed: ${response.status} ${await response.text()}`);
    rows.push(...(await response.json()));
  }
  return rows;
}

async function hydrateResolvedTimezoneFallbacks(rows) {
  const missingTimezoneKeys = Array.from(
    new Set(
      rows
        .filter((row) => !String(row.timezone || '').trim() && !String(row.timezone_label || '').trim())
        .map((row) => String(row.athlete_key || '').trim())
        .filter(Boolean),
    ),
  );
  if (!missingTimezoneKeys.length) {
    return { rows, sourceCounts: {} };
  }

  const [truthRows, lifecycleRows, appointmentRows, confirmationRows] = await Promise.all([
    fetchRowsByAthleteKeys(
      'active_athlete_meeting_truth',
      'athlete_key,current_meeting_timezone,current_meeting_timezone_label,current_calendar_timezone,previous_meeting_timezone,previous_meeting_timezone_label',
      missingTimezoneKeys,
    ).catch(() => []),
    fetchRowsByAthleteKeys('athlete_lifecycle_current', 'athlete_key,current_meeting_timezone', missingTimezoneKeys).catch(
      () => [],
    ),
    fetchRowsByAthleteKeys(
      'appointments',
      'athlete_key,meeting_timezone,meeting_timezone_label,calendar_timezone,updated_at',
      missingTimezoneKeys,
    ).catch(() => []),
    fetchRowsByAthleteKeys('set_meeting_confirmation_cache', 'athlete_key,meeting_timezone,updated_at', missingTimezoneKeys).catch(
      () => [],
    ),
  ]);

  const truthByKey = new Map(truthRows.map((row) => [row.athlete_key, row]));
  const lifecycleByKey = new Map(lifecycleRows.map((row) => [row.athlete_key, row]));
  const appointmentByKey = new Map();
  for (const row of appointmentRows) {
    if (row.meeting_timezone || row.meeting_timezone_label || row.calendar_timezone) {
      appointmentByKey.set(row.athlete_key, row);
    }
  }
  const confirmationByKey = new Map();
  for (const row of confirmationRows) {
    if (row.meeting_timezone) {
      confirmationByKey.set(row.athlete_key, row);
    }
  }

  const sourceCounts = {};
  const resolvedRows = rows.map((row) => {
    if (String(row.timezone || '').trim() || String(row.timezone_label || '').trim()) {
      sourceCounts.athlete_contact_cache = (sourceCounts.athlete_contact_cache || 0) + 1;
      return { ...row, timezone_source: 'athlete_contact_cache' };
    }

    const key = String(row.athlete_key || '').trim();
    const truth = truthByKey.get(key);
    if (truth) {
      const timezone =
        truth.current_meeting_timezone ||
        truth.current_calendar_timezone ||
        truth.previous_meeting_timezone ||
        '';
      const timezoneLabel = truth.current_meeting_timezone_label || truth.previous_meeting_timezone_label || '';
      if (timezone || timezoneLabel) {
        sourceCounts.active_athlete_meeting_truth = (sourceCounts.active_athlete_meeting_truth || 0) + 1;
        return { ...row, timezone, timezone_label: timezoneLabel, timezone_source: 'active_athlete_meeting_truth' };
      }
    }

    const lifecycle = lifecycleByKey.get(key);
    if (lifecycle?.current_meeting_timezone) {
      sourceCounts.athlete_lifecycle_current = (sourceCounts.athlete_lifecycle_current || 0) + 1;
      return { ...row, timezone: lifecycle.current_meeting_timezone, timezone_source: 'athlete_lifecycle_current' };
    }

    const appointment = appointmentByKey.get(key);
    if (appointment) {
      sourceCounts.appointments = (sourceCounts.appointments || 0) + 1;
      return {
        ...row,
        timezone: appointment.meeting_timezone || appointment.calendar_timezone || '',
        timezone_label: appointment.meeting_timezone_label || '',
        timezone_source: 'appointments',
      };
    }

    const confirmation = confirmationByKey.get(key);
    if (confirmation?.meeting_timezone) {
      sourceCounts.set_meeting_confirmation_cache = (sourceCounts.set_meeting_confirmation_cache || 0) + 1;
      return { ...row, timezone: confirmation.meeting_timezone, timezone_source: 'set_meeting_confirmation_cache' };
    }

    sourceCounts.unresolved_timezone = (sourceCounts.unresolved_timezone || 0) + 1;
    return { ...row, timezone_source: 'unresolved_timezone' };
  });

  return { rows: resolvedRows, sourceCounts };
}

function runContactsPlan(items) {
  const script = `
on digitsOnly(rawValue)
  set allowedCharacters to "0123456789"
  set outputValue to ""
  repeat with i from 1 to length of rawValue
    set currentCharacter to character i of rawValue
    if allowedCharacters contains currentCharacter then set outputValue to outputValue & currentCharacter
  end repeat
  if length of outputValue is 11 and outputValue starts with "1" then return text 2 thru -1 of outputValue
  return outputValue
end digitsOnly

on replaceText(rawValue, searchValue, replacementValue)
  set oldDelimiters to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchValue
  set valueParts to text items of rawValue
  set AppleScript's text item delimiters to replacementValue
  set outputValue to valueParts as text
  set AppleScript's text item delimiters to oldDelimiters
  return outputValue
end replaceText

set contactsScanned to 0
set outputRows to {}

with timeout of 600 seconds
  tell application "Contacts"
    set targetGroup to missing value
    repeat with candidateGroup in groups
      if (name of candidateGroup as text) is ${appleScriptStringLiteral(GROUP_NAME)} then
        set targetGroup to candidateGroup
        exit repeat
      end if
    end repeat
    if targetGroup is missing value then error "No matching Contacts group: " & ${appleScriptStringLiteral(GROUP_NAME)}

    set contactsScanned to count of people of targetGroup
    repeat with contactPerson in people of targetGroup
      set contactName to name of contactPerson as text
      set existingNote to note of contactPerson
      if existingNote is missing value then set existingNote to ""
      set escapedNote to my replaceText(existingNote, linefeed, "\\\\n")
      set existingUrl to ""
      if (count of urls of contactPerson) > 0 then
        set existingUrl to value of item 1 of urls of contactPerson as text
      end if
      repeat with contactPhone in phones of contactPerson
        set normalizedPhone to my digitsOnly(value of contactPhone as text)
        if normalizedPhone is not "" then set end of outputRows to normalizedPhone & tab & contactName & tab & escapedNote & tab & existingUrl
      end repeat
    end repeat
  end tell
end timeout

set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
set outputText to outputRows as text
set AppleScript's text item delimiters to oldDelimiters
return "contacts_scanned=" & contactsScanned & linefeed & outputText
`;

  const result = spawnSync('osascript', ['-'], { input: script, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'osascript failed');
  const lines = result.stdout.trim().split(/\r?\n/);
  const contactsScanned = lines.shift() || 'contacts_scanned=0';
  const contactsByPhone = new Map();
  for (const line of lines) {
    const [phone, name, escapedNote = '', existingUrl = ''] = line.split('\t');
    if (!phone || contactsByPhone.has(phone)) continue;
    contactsByPhone.set(phone, { name, note: escapedNote.replace(/\\n/g, '\n'), url: existingUrl });
  }

  const updates = [];
  let alreadyCurrent = 0;
  let unresolved = 0;
  for (const item of items) {
    const contact = contactsByPhone.get(item.phone);
    if (!contact) {
      unresolved += 1;
    } else if (contact.note.includes(item.note) && contact.url === item.url) {
      alreadyCurrent += 1;
    } else {
      updates.push({ ...item, name: contact.name });
    }
  }

  if (WRITE && updates.length) {
    writeContactNotes(updates);
  }

  return [
    contactsScanned,
    `${WRITE ? 'updated' : 'would_update'}=${updates.length}`,
    `already_current=${alreadyCurrent}`,
    `unresolved=${unresolved}`,
    ...updates.slice(0, 20).map((item) => `${item.name}: ${item.note.replace(/\n/g, ' | ')}`),
  ].join('\n');
}

function writeContactNotes(updates) {
  const batchSize = 25;
  for (let index = 0; index < updates.length; index += batchSize) {
    writeContactNotesBatch(updates.slice(index, index + batchSize));
  }
}

function writeContactNotesBatch(updates) {
  const phoneList = updates.map((item) => appleScriptStringLiteral(item.phone)).join(', ');
  const urlList = updates.map((item) => appleScriptStringLiteral(item.url)).join(', ');
  const noteList = updates.map((item) => appleScriptStringLiteral(item.note)).join(', ');
  const script = `
on digitsOnly(rawValue)
  set allowedCharacters to "0123456789"
  set outputValue to ""
  repeat with i from 1 to length of rawValue
    set currentCharacter to character i of rawValue
    if allowedCharacters contains currentCharacter then set outputValue to outputValue & currentCharacter
  end repeat
  if length of outputValue is 11 and outputValue starts with "1" then return text 2 thru -1 of outputValue
  return outputValue
end digitsOnly

set targetPhones to {${phoneList}}
set targetUrls to {${urlList}}
set targetNotes to {${noteList}}

with timeout of 600 seconds
  tell application "Contacts"
    set targetGroup to group ${appleScriptStringLiteral(GROUP_NAME)}
    repeat with contactPerson in people of targetGroup
      repeat with contactPhone in phones of contactPerson
        set normalizedPhone to my digitsOnly(value of contactPhone as text)
        repeat with targetIndex from 1 to count of targetPhones
          if normalizedPhone is item targetIndex of targetPhones then
            set targetUrl to item targetIndex of targetUrls
            set targetNote to item targetIndex of targetNotes
            set home page of contactPerson to targetUrl
            set visibleUrlUpdated to false
            repeat with contactUrl in urls of contactPerson
              if (label of contactUrl as text) is "home" then
                set value of contactUrl to targetUrl
                set visibleUrlUpdated to true
                exit repeat
              end if
              if (value of contactUrl as text) is targetUrl then
                set visibleUrlUpdated to true
                exit repeat
              end if
            end repeat
            if visibleUrlUpdated is false then make new url at end of urls of contactPerson with properties {label:"home", value:targetUrl}
            set existingNote to note of contactPerson
            if existingNote is missing value then set existingNote to ""
            if existingNote contains targetUrl then set existingNote to ""
            if existingNote does not contain targetNote then set note of contactPerson to targetNote
          end if
        end repeat
      end repeat
    end repeat
    save
  end tell
end timeout
`;
  const result = spawnSync('osascript', ['-'], { input: script, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'osascript write failed');
}

const { rows, sourceCounts } = await hydrateResolvedTimezoneFallbacks(await fetchCacheRows());
const seen = new Set();
const items = [];
let skippedMissingNote = 0;
const candidatesByPhone = new Map();
for (const row of rows) {
  const phone = normalizePhone(row.normalized_phone);
  const note = buildNote(row);
  const url = String(row.admin_url || '').trim();
  const key = `${phone}|${url}|${note}`;
  if (!phone || !url || !note) {
    skippedMissingNote += 1;
    continue;
  }
  if (seen.has(key)) continue;
  seen.add(key);
  const candidates = candidatesByPhone.get(phone) || [];
  candidates.push({ phone, url, note });
  candidatesByPhone.set(phone, candidates);
}

let skippedAmbiguousPhone = 0;
for (const candidates of candidatesByPhone.values()) {
  const uniqueTargets = new Set(candidates.map((candidate) => `${candidate.url}|${candidate.note}`));
  if (uniqueTargets.size > 1) {
    skippedAmbiguousPhone += candidates.length;
    continue;
  }
  items.push(candidates[0]);
}

console.log(`Contact note backfill ${WRITE ? 'write' : 'dry-run'}`);
console.log(`- Group: ${GROUP_NAME}`);
console.log(`- Active cache rows scanned: ${rows.length}`);
console.log(`- Candidate notes: ${items.length}`);
console.log(`- Skipped missing note source: ${skippedMissingNote}`);
console.log(`- Skipped ambiguous duplicate phone: ${skippedAmbiguousPhone}`);
console.log(`- Timezone sources: ${JSON.stringify(sourceCounts)}`);
console.log(runContactsPlan(items));
