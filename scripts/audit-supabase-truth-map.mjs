#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

const surfaces = {
  athletes: { bucket: 'Admin Data & Contacts', role: 'canonical_truth' },
  athlete_contact_cache: { bucket: 'Admin Data & Contacts / Client Communication', role: 'canonical_support' },
  appointments: { bucket: 'Meetings', role: 'canonical_truth' },
  lifecycle_events: { bucket: 'Lifecycle & Stage Truth', role: 'canonical_truth' },
  call_events: { bucket: 'Reporting / Pre-Meeting Tasks / Enrollments & Outcomes', role: 'canonical_target' },
  set_meeting_confirmation_cache: { bucket: 'Client Communication', role: 'temporary_support' },
  pending_client_watchlist: { bucket: 'Enrollments & Outcomes', role: 'temporary_support' },

  athlete_lifecycle_current: { bucket: 'Lifecycle & Stage Truth', role: 'delete_target' },
  athlete_lifecycle_timeline: { bucket: 'Lifecycle & Stage Truth', role: 'delete_target' },
  active_athlete_meeting_truth: { bucket: 'Meetings', role: 'delete_target' },
  athlete_pipeline_state: { bucket: 'Lifecycle & Stage Truth', role: 'delete_target' },
  meeting_events: { bucket: 'Enrollments & Outcomes', role: 'delete_target' },
  call_activity_events: { bucket: 'Pre-Meeting Tasks', role: 'delete_target' },
  call_tracker_events: { bucket: 'Reporting', role: 'delete_target' },
  call_tracker_events_deduped: { bucket: 'Reporting', role: 'delete_target' },
  call_tracker_events_owner_context: { bucket: 'Reporting', role: 'delete_target' },
  call_tracker_meeting_sets: { bucket: 'Reporting', role: 'delete_target' },
  call_tracker_summary: { bucket: 'Reporting', role: 'delete_target' },
  weekly_operator_funnel_metrics: { bucket: 'Reporting', role: 'delete_target' },
  meeting_truth_anomalies: { bucket: 'Meetings / Audit', role: 'delete_target' },
  reminders: { bucket: 'Client Communication', role: 'delete_target' },
};

const skipDirs = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
]);

const includeExt = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.sql']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (includeExt.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function classifyAccess(line) {
  if (/\b(writeRows|supabaseWrite|supabasePatch|supabaseDelete|request\(|supabaseRequest\(|patchRow\()/u.test(line)) {
    if (/\b(method:\s*'GET'|method:\s*"GET"|select=)/u.test(line)) return 'read';
    return 'write_or_mutation';
  }
  if (/\b(queryTable|readRows|supabaseGet|getPaged|fetchRowsByAthleteKeys)\b/u.test(line)) return 'read';
  if (/\bselect=/u.test(line)) return 'read';
  if (/\b(on_conflict|POST|PATCH|DELETE|upsert|insert|delete)\b/u.test(line)) return 'write_or_mutation';
  return 'reference';
}

const files = walk(repoRoot);
const results = Object.fromEntries(
  Object.entries(surfaces).map(([surface, meta]) => [surface, { ...meta, references: [] }]),
);

for (const file of files) {
  const relative = path.relative(repoRoot, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const surface of Object.keys(surfaces)) {
    const pattern = new RegExp(`\\b${surface.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'gu');
    for (const match of text.matchAll(pattern)) {
      const lineNo = lineNumberForIndex(text, match.index || 0);
      const line = text.split('\n')[lineNo - 1]?.trim() || '';
      results[surface].references.push({
        file: relative,
        line: lineNo,
        access: classifyAccess(line),
        text: line.slice(0, 220),
      });
    }
  }
}

const summary = Object.entries(results).map(([surface, value]) => {
  const counts = value.references.reduce(
    (acc, ref) => {
      acc[ref.access] = (acc[ref.access] || 0) + 1;
      return acc;
    },
    {},
  );
  return {
    surface,
    bucket: value.bucket,
    role: value.role,
    references: value.references.length,
    accessCounts: counts,
  };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, surfaces: results }, null, 2));
} else {
  console.log('# Supabase Truth Map Audit');
  console.log('');
  for (const row of summary) {
    console.log(`- ${row.surface}: ${row.role}, ${row.bucket}, refs=${row.references}`);
  }
  console.log('');
  console.log('Run with `--json` for file/line references.');
}
