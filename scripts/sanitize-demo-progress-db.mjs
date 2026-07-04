#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const archiveRoot = path.join(repoRoot, '.sensitive-archive', 'local-db-backups');
const defaultDbPaths = [
  path.join(os.homedir(), '.prospect-pipeline', 'progress.db'),
  path.join(os.homedir(), '.prospect-pipeline', 'video-progress-cache.sqlite'),
];
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const fakeStatuses = ['HUDL', 'Dropbox', 'Revisions', 'Not Approved', 'External Links'];
const failureStatusPattern = /failed|failure|error|rejected|denied/i;
const sampleAthletes = [
  { name: 'Camden Ellis', school: 'Lakeview Prep', city: 'Bradenton', state: 'FL' },
  { name: 'Malik Johnson', school: 'North Ridge High', city: 'Sarasota', state: 'FL' },
  { name: 'Brady Torres', school: 'Summit Christian', city: 'Tampa', state: 'FL' },
  { name: 'Noah Bennett', school: 'Riverbend Academy', city: 'Lakeland', state: 'FL' },
  { name: 'Jalen Price', school: 'Coastal Tech', city: 'Fort Myers', state: 'FL' },
  { name: 'Isaiah Brooks', school: 'Palm Valley High', city: 'Naples', state: 'FL' },
  { name: 'Micah Reed', school: 'East Bay Prep', city: 'Orlando', state: 'FL' },
  { name: 'Dylan Carter', school: 'Westlake Academy', city: 'Jacksonville', state: 'FL' },
  { name: 'Kai Mitchell', school: 'Oak Harbor High', city: 'Clearwater', state: 'FL' },
  { name: 'Evan Morales', school: 'Pinecrest Prep', city: 'St. Petersburg', state: 'FL' },
  { name: 'Landon Cooper', school: 'Cypress Ridge', city: 'Gainesville', state: 'FL' },
  { name: 'Tyson Ward', school: 'Harbor View High', city: 'Boca Raton', state: 'FL' },
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function fakeOrdinal(index) {
  return String(index + 1).padStart(3, '0');
}

function sampleAthlete(index) {
  return sampleAthletes[index % sampleAthletes.length];
}

function fakeAthleteName(index) {
  return sampleAthlete(index).name;
}

function fakeParentName(index, parentIndex) {
  const lastName = sampleAthlete(index).name.split(/\s+/).pop() || 'Carter';
  return `${parentIndex === 1 ? 'Dana' : 'Robin'} ${lastName}`;
}

function fakeEmail(prefix, index) {
  return `${prefix}${fakeOrdinal(index)}@recruitmail.test`;
}

function fakePhone() {
  return '5555555555';
}

function fakeStatus(row, index) {
  const current = String(row.video_progress_status || '').trim();
  if (!current || failureStatusPattern.test(current)) {
    return fakeStatuses[index % fakeStatuses.length];
  }
  return current;
}

function uniqueExistingPaths(paths) {
  const seen = new Set();
  const existing = [];
  for (const candidate of paths) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    existing.push({ requested: candidate, resolved });
  }
  return existing;
}

function tableExists(db, tableName) {
  const result = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name=$tableName`, {
    $tableName: tableName,
  });
  return result.length > 0 && result[0].values.length > 0;
}

function getRows(db, sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex]])),
  );
}

function sanitizeVideoTasks(db) {
  if (!tableExists(db, 'video_tasks')) {
    return { table: 'video_tasks', rows: 0, failureStatuses: 0 };
  }

  const rows = getRows(
    db,
    `SELECT id, video_progress_status
     FROM video_tasks
     ORDER BY COALESCE(cached_at, updated_at, ''), id`,
  );
  let failureStatuses = 0;

  rows.forEach((row, index) => {
    const nextStatus = fakeStatus(row, index);
    const athlete = sampleAthlete(index);
    if (nextStatus !== String(row.video_progress_status || '').trim()) {
      failureStatuses += 1;
    }
    db.run(
      `UPDATE video_tasks
       SET athletename = $athletename,
           video_progress_status = $video_progress_status,
           high_school = $high_school,
           high_school_city = $high_school_city,
           high_school_state = $high_school_state,
           assignedvideoeditor = COALESCE(NULLIF(assignedvideoeditor, ''), 'Jerami Singleton'),
           updated_at = COALESCE(updated_at, datetime('now')),
           cached_at = COALESCE(cached_at, datetime('now'))
       WHERE id = $id`,
      {
        $id: row.id,
        $athletename: athlete.name,
        $video_progress_status: nextStatus,
        $high_school: athlete.school,
        $high_school_city: athlete.city,
        $high_school_state: athlete.state,
      },
    );
  });

  return { table: 'video_tasks', rows: rows.length, failureStatuses };
}

function sanitizeContactInfo(db) {
  if (!tableExists(db, 'contact_info')) {
    return { table: 'contact_info', rows: 0 };
  }

  const rows = getRows(db, `SELECT contact_id FROM contact_info ORDER BY contact_id`);
  rows.forEach((row, index) => {
    db.run(
      `UPDATE contact_info
       SET student_name = $student_name,
           student_email = $student_email,
           student_phone = $student_phone,
           parent1_name = $parent1_name,
           parent1_email = $parent1_email,
           parent1_phone = $parent1_phone,
           parent2_name = $parent2_name,
           parent2_email = $parent2_email,
           parent2_phone = $parent2_phone,
           updated_at = COALESCE(updated_at, datetime('now')),
           cached_at = COALESCE(cached_at, datetime('now'))
       WHERE contact_id = $contact_id`,
      {
        $contact_id: row.contact_id,
        $student_name: fakeAthleteName(index),
        $student_email: fakeEmail('athlete', index),
        $student_phone: fakePhone(index),
        $parent1_name: fakeParentName(index, 1),
        $parent1_email: fakeEmail('parent1.', index),
        $parent1_phone: fakePhone(index, 100),
        $parent2_name: fakeParentName(index, 2),
        $parent2_email: fakeEmail('parent2.', index),
        $parent2_phone: fakePhone(index, 200),
      },
    );
  });

  return { table: 'contact_info', rows: rows.length };
}

async function main() {
  const dbPaths = uniqueExistingPaths(defaultDbPaths);
  if (dbPaths.length === 0) {
    console.log('No local progress database found.');
    return;
  }

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm')), file),
  });

  const results = [];
  for (const dbPath of dbPaths) {
    const fileData = fs.readFileSync(dbPath.resolved);
    const db = new SQL.Database(fileData);
    const videoTasks = sanitizeVideoTasks(db);
    const contactInfo = sanitizeContactInfo(db);

    let backupPath = null;
    if (!dryRun) {
      fs.mkdirSync(archiveRoot, { recursive: true });
      backupPath = path.join(archiveRoot, `${path.basename(dbPath.resolved)}.${timestamp()}.bak`);
      fs.copyFileSync(dbPath.resolved, backupPath);
      fs.writeFileSync(dbPath.resolved, Buffer.from(db.export()));
    }
    db.close();

    results.push({
      path: dbPath.requested,
      resolvedPath: dbPath.resolved,
      backupPath,
      dryRun,
      videoTasks,
      contactInfo,
    });
  }

  console.log(JSON.stringify({ dryRun, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
