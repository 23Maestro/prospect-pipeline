#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

const jsonMode = args.includes('--json');
const activeOnly = args.includes('--active-only');
const requestedSurface = readArgValue('--surface');

const surfaces = {
  athletes: {
    bucket: 'Admin Data & Contacts',
    role: 'canonical_truth',
    migrationOwner: 'Admin Data & Contacts',
    currentState: 'Ready',
    replacement: 'Keep',
  },
  athlete_contact_cache: {
    bucket: 'Admin Data & Contacts / Client Communication',
    role: 'canonical_support',
    migrationOwner: 'Admin Data & Contacts',
    currentState: 'Ready',
    replacement: 'Keep as contact lookup support',
  },
  appointments: {
    bucket: 'Meetings',
    role: 'canonical_truth',
    migrationOwner: 'Meetings',
    currentState: 'Ready',
    replacement: 'Keep',
  },
  lifecycle_events: {
    bucket: 'Lifecycle & Stage Truth',
    role: 'canonical_truth',
    migrationOwner: 'Lifecycle & Stage Truth',
    currentState: 'Ready',
    replacement: 'Keep',
  },
  call_log: {
    bucket: 'Reporting / Pre-Meeting Tasks / Enrollments & Outcomes',
    role: 'canonical_target',
    migrationOwner: 'Lifecycle & Stage Truth / Reporting',
    currentState: 'Target only: future clean ledger name. No canonical table migration is complete yet.',
    replacement: 'Promote to the centralized event table only after dials, contacts, meeting sets, and post-meeting outcomes are represented by one canonical shape.',
  },
  set_meeting_confirmation_cache: {
    bucket: 'Client Communication',
    role: 'temporary_support',
    migrationOwner: 'Client Communication',
    currentState: 'Temporary support',
    replacement: 'Keep temporarily as confirmation-message support',
  },
  pending_client_watchlist: {
    bucket: 'Enrollments & Outcomes',
    role: 'temporary_support',
    migrationOwner: 'Enrollments & Outcomes',
    currentState: 'Temporary support',
    replacement: 'Keep temporarily as review queue',
  },

  athlete_lifecycle_current: {
    bucket: 'Lifecycle & Stage Truth',
    role: 'delete_target',
    migrationOwner: 'Lifecycle & Stage Truth',
    replacement: 'Latest state derived from lifecycle_events',
  },
  athlete_lifecycle_timeline: {
    bucket: 'Lifecycle & Stage Truth',
    role: 'delete_target',
    migrationOwner: 'Lifecycle & Stage Truth',
    replacement: 'Timeline derived from lifecycle_events',
  },
  active_athlete_meeting_truth: {
    bucket: 'Meetings',
    role: 'delete_target',
    migrationOwner: 'Meetings',
    replacement: 'appointments plus latest lifecycle state',
  },
  athlete_pipeline_state: {
    bucket: 'Lifecycle & Stage Truth',
    role: 'delete_target',
    migrationOwner: 'Lifecycle & Stage Truth',
    replacement: 'lifecycle_events latest state',
  },
  meeting_events: {
    bucket: 'Enrollments & Outcomes',
    role: 'delete_target',
    migrationOwner: 'Enrollments & Outcomes / Reporting',
    replacement: 'call_log post-meeting outcome facts',
  },
  call_events: {
    bucket: 'Reporting / Compatibility',
    role: 'delete_target',
    migrationOwner: 'Lifecycle & Stage Truth / Reporting',
    currentState: 'Deprecated compatibility/history name: current schema history recreates call_events as a view over meeting_events.',
    replacement: 'call_log canonical ledger; keep call_events only as a temporary alias if required during migration',
  },
  call_activity_events: {
    bucket: 'Pre-Meeting Tasks',
    role: 'delete_target',
    migrationOwner: 'Pre-Meeting Tasks / Reporting',
    replacement: 'call_log activity facts',
  },
  call_tracker_events: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'API/query over canonical call_log',
  },
  call_tracker_events_deduped: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'Canonical fact identity in call_log',
  },
  call_tracker_events_owner_context: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'API/query over canonical call_log with owner context',
  },
  call_tracker_meeting_sets: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'call_log meeting-set facts',
  },
  call_tracker_summary: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'API aggregate over canonical call_log',
  },
  weekly_operator_funnel_metrics: {
    bucket: 'Reporting',
    role: 'delete_target',
    migrationOwner: 'Reporting',
    replacement: 'API aggregate over canonical call_log',
  },
  meeting_truth_anomalies: {
    bucket: 'Meetings / Audit',
    role: 'delete_target',
    migrationOwner: 'Meetings',
    replacement: 'Code-owned audit output, not Supabase fact source',
  },
  reminders: {
    bucket: 'Client Communication',
    role: 'delete_target',
    migrationOwner: 'Client Communication',
    replacement: 'set_meeting_confirmation_cache or future single message table',
  },
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

function classifyFileKind(relative) {
  if (relative === 'scripts/audit-supabase-truth-map.mjs') return 'audit_tool';
  if (relative === 'scripts/audit-supabase-truth-map.test.mjs') return 'test';
  if (relative.startsWith('docs/')) return 'doc';
  if (relative.endsWith('.md')) return 'doc';
  if (relative.endsWith('.test.ts') || relative.endsWith('.test.tsx') || relative.endsWith('.test.mjs')) return 'test';
  if (relative.includes('/tests/') || relative.startsWith('tests/')) return 'test';
  if (relative.includes('/generated/') || relative.endsWith('.generated.json')) return 'generated';
  if (relative.startsWith('supabase/migrations/')) return 'migration_history';
  if (relative.endsWith('.sql') || relative.startsWith('supabase/')) return 'schema_or_migration';
  if (relative.startsWith('scripts/')) return 'script';
  return 'implementation';
}

function isActiveDependency(fileKind) {
  return ['implementation', 'script', 'schema_or_migration'].includes(fileKind);
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
        fileKind: classifyFileKind(relative),
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
  const fileKindCounts = value.references.reduce(
    (acc, ref) => {
      acc[ref.fileKind] = (acc[ref.fileKind] || 0) + 1;
      return acc;
    },
    {},
  );
  const activeReferences = value.references.filter((ref) => isActiveDependency(ref.fileKind));
  return {
    surface,
    bucket: value.bucket,
    role: value.role,
    migrationOwner: value.migrationOwner,
    currentState: value.currentState || '',
    replacement: value.replacement,
    references: value.references.length,
    activeDependencies: activeReferences.length,
    accessCounts: counts,
    fileKindCounts,
  };
});

function sortReferences(references) {
  return [...references].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

function filteredReferences(surface) {
  const references = results[surface]?.references || [];
  if (!activeOnly) return sortReferences(references);
  return sortReferences(references.filter((ref) => isActiveDependency(ref.fileKind)));
}

if (requestedSurface && !results[requestedSurface]) {
  console.error(`Unknown surface: ${requestedSurface}`);
  console.error(`Known surfaces: ${Object.keys(results).join(', ')}`);
  process.exit(1);
}

if (jsonMode) {
  if (requestedSurface) {
    const row = summary.find((entry) => entry.surface === requestedSurface);
    console.log(
      JSON.stringify(
        {
          summary: row,
          references: filteredReferences(requestedSurface),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify({ summary, surfaces: results }, null, 2));
  }
} else {
  console.log('# Supabase Truth Map Audit');
  console.log('');
  const rows = requestedSurface ? summary.filter((row) => row.surface === requestedSurface) : summary;
  for (const row of rows) {
    const reads = row.accessCounts.read || 0;
    const writes = row.accessCounts.write_or_mutation || 0;
    console.log(
      `- ${row.surface}: ${row.role}, owner=${row.migrationOwner}, active=${row.activeDependencies}, refs=${row.references}, reads=${reads}, writes=${writes}`,
    );
    if (requestedSurface) {
      if (row.currentState) console.log(`  current: ${row.currentState}`);
      console.log(`  replacement: ${row.replacement}`);
      for (const ref of filteredReferences(requestedSurface)) {
        console.log(`  - ${ref.file}:${ref.line} [${ref.fileKind}/${ref.access}] ${ref.text}`);
      }
    }
  }
  console.log('');
  console.log('Run with `--json` for machine-readable output.');
  console.log('Use `--surface <name>` and `--active-only` for targeted cleanup planning.');
}
