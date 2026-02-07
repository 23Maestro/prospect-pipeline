import fs from 'fs';
import os from 'os';
import path from 'path';
import { environment } from '@raycast/api';
import initSqlJs from 'sql.js';
import { logger } from './logger';

export interface CachedVideoTask {
  id: number;
  athlete_id: number;
  athlete_main_id: string;
  athletename: string;
  video_progress_status: string;
  stage: string;
  sport_name: string;
  grad_year: number;
  video_due_date: string;
  assignedvideoeditor: string;
  primaryposition: string;
  secondaryposition: string;
  thirdposition: string;
  high_school: string;
  high_school_city: string;
  high_school_state: string;
  updated_at: string;
  cached_at: string;
  source?: string;
  last_seen_at?: string;
  jersey_number?: string;
  date_completed?: string;
}

export interface CachedContactInfo {
  contactId: number;
  studentName: string;
  studentEmail: string | null;
  studentPhone: string | null;
  parent1Name: string | null;
  parent1Relationship: string | null;
  parent1Email: string | null;
  parent1Phone: string | null;
  parent2Name: string | null;
  parent2Relationship: string | null;
  parent2Email: string | null;
  parent2Phone: string | null;
  cachedAt: string;
  updatedAt: string;
}

const DB_DIR = path.join(os.homedir(), '.prospect-pipeline');
const LEGACY_SQLJS_PATH = path.join(DB_DIR, 'video-progress-cache.sqlite');
const SQLJS_DB_PATH = path.join(DB_DIR, 'progress.db');
const MIN_ACTIVE_GRAD_YEAR = 2026;
const SQLPromise = initSqlJs({
  locateFile: (file) => path.join(environment.assetsPath, file),
});

type StatementRunner = {
  run: (params?: Record<string, any>) => void;
  finalize: () => void;
};

type CacheBackend = {
  kind: 'sqljs' | 'native';
  path: string;
  exec: (sql: string) => void;
  run: (sql: string, params?: Record<string, any>) => void;
  prepare: (sql: string) => StatementRunner;
  all: <T = Record<string, any>>(sql: string, params?: Record<string, any>) => T[];
  get: <T = Record<string, any>>(sql: string, params?: Record<string, any>) => T | null;
  transaction: (fn: () => void) => void;
  persist: () => void;
};

let backend: CacheBackend | null = null;

async function initSqlJsBackend(): Promise<CacheBackend> {
  const SQL = await SQLPromise;
  let fileData: Uint8Array | undefined;
  if (!fs.existsSync(SQLJS_DB_PATH) && fs.existsSync(LEGACY_SQLJS_PATH)) {
    fs.copyFileSync(LEGACY_SQLJS_PATH, SQLJS_DB_PATH);
    logger.info('📦 CACHE: Migrated SQL.js cache to progress.db', {
      from: LEGACY_SQLJS_PATH,
      to: SQLJS_DB_PATH,
    });
  }

  if (fs.existsSync(SQLJS_DB_PATH)) {
    fileData = fs.readFileSync(SQLJS_DB_PATH);
  }
  const database = fileData ? new SQL.Database(fileData) : new SQL.Database();

  const sqljsBackend: CacheBackend = {
    kind: 'sqljs',
    path: SQLJS_DB_PATH,
    exec: (sql: string) => {
      database.run(sql);
    },
    run: (sql: string, params?: Record<string, any>) => {
      database.run(sql, params);
    },
    prepare: (sql: string) => {
      const stmt = database.prepare(sql);
      return {
        run: (params?: Record<string, any>) => {
          stmt.run(params);
        },
        finalize: () => stmt.free(),
      };
    },
    all: <T = Record<string, any>>(sql: string, params?: Record<string, any>) => {
      const res = database.exec(sql, params);
      if (!res.length) return [];
      const rowset = res[0];
      return rowset.values.map((row) => {
        const obj: Record<string, any> = {};
        rowset.columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj as T;
      });
    },
    get: <T = Record<string, any>>(sql: string, params?: Record<string, any>) => {
      const rows = sqljsBackend.all<T>(sql, params);
      return rows.length ? rows[0] : null;
    },
    transaction: (fn: () => void) => {
      database.run('BEGIN TRANSACTION;');
      try {
        fn();
        database.run('COMMIT;');
      } catch (error) {
        database.run('ROLLBACK;');
        throw error;
      }
    },
    persist: () => {
      const data = database.export();
      fs.writeFileSync(SQLJS_DB_PATH, Buffer.from(data));
    },
  };

  return sqljsBackend;
}

async function getBackend(): Promise<CacheBackend> {
  if (backend) return backend;
  fs.mkdirSync(DB_DIR, { recursive: true });

  backend = await initSqlJsBackend();
  initSchema(backend);
  logger.info('✅ CACHE: Using SQL.js cache (progress.db)', { path: backend.path });
  return backend;
}

function initSchema(database: CacheBackend) {
  database.exec(
    `
    CREATE TABLE IF NOT EXISTS video_tasks (
      id INTEGER PRIMARY KEY,
      athlete_id INTEGER,
      athlete_main_id TEXT,
      athletename TEXT,
      video_progress_status TEXT,
      stage TEXT,
      sport_name TEXT,
      grad_year INTEGER,
      video_due_date TEXT,
      assignedvideoeditor TEXT,
      primaryposition TEXT,
      secondaryposition TEXT,
      thirdposition TEXT,
      high_school TEXT,
      high_school_city TEXT,
      high_school_state TEXT,
      updated_at TEXT,
      cached_at TEXT,
      source TEXT,
      last_seen_at TEXT,
      jersey_number TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks (video_progress_status);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_cached_at ON video_tasks (cached_at);
  `,
  );
  try {
    database.exec(`ALTER TABLE video_tasks ADD COLUMN athlete_main_id TEXT;`);
  } catch {
    // ignore if exists
  }
  try {
    database.exec(`ALTER TABLE video_tasks ADD COLUMN jersey_number TEXT;`);
  } catch {
    // ignore if exists
  }
  try {
    database.exec(`ALTER TABLE video_tasks ADD COLUMN date_completed TEXT;`);
  } catch {
    // ignore if exists
  }
  try {
    database.exec(`ALTER TABLE video_tasks ADD COLUMN source TEXT;`);
  } catch {
    // ignore if exists
  }
  try {
    database.exec(`ALTER TABLE video_tasks ADD COLUMN last_seen_at TEXT;`);
  } catch {
    // ignore if exists
  }

  // Contact info table for enriched contact data
  database.exec(
    `
    CREATE TABLE IF NOT EXISTS contact_info (
      contact_id INTEGER PRIMARY KEY,
      student_name TEXT,
      student_email TEXT,
      student_phone TEXT,
      parent1_name TEXT,
      parent1_relationship TEXT,
      parent1_email TEXT,
      parent1_phone TEXT,
      parent2_name TEXT,
      parent2_relationship TEXT,
      parent2_email TEXT,
      parent2_phone TEXT,
      cached_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contact_cached_at ON contact_info (cached_at);
  `,
  );

  database.persist();
}

export async function upsertTasks(tasks: Partial<CachedVideoTask>[]) {
  const database = await getBackend();
  const now = new Date().toISOString();
  const syncAt = now;
  const stmt = database.prepare(
    `
    INSERT INTO video_tasks (
      id, athlete_id, athlete_main_id, athletename, video_progress_status, stage, sport_name, grad_year,
      video_due_date, assignedvideoeditor, primaryposition, secondaryposition, thirdposition,
      high_school, high_school_city, high_school_state, updated_at, cached_at, source, last_seen_at, jersey_number, date_completed
    ) VALUES (
      $id, $athlete_id, $athlete_main_id, $athletename, $video_progress_status, $stage, $sport_name, $grad_year,
      $video_due_date, $assignedvideoeditor, $primaryposition, $secondaryposition, $thirdposition,
      $high_school, $high_school_city, $high_school_state, $updated_at, $cached_at, $source, $last_seen_at, $jersey_number, $date_completed
    )
    ON CONFLICT(id) DO UPDATE SET
      -- STATIC FIELDS (preserve if API returns null)
      athlete_id=COALESCE(excluded.athlete_id, athlete_id),
      athlete_main_id=COALESCE(excluded.athlete_main_id, athlete_main_id),
      athletename=COALESCE(excluded.athletename, athletename),
      sport_name=COALESCE(excluded.sport_name, sport_name),
      grad_year=COALESCE(excluded.grad_year, grad_year),
      high_school=COALESCE(excluded.high_school, high_school),
      high_school_city=COALESCE(excluded.high_school_city, high_school_city),
      high_school_state=COALESCE(excluded.high_school_state, high_school_state),
      primaryposition=COALESCE(excluded.primaryposition, primaryposition),
      secondaryposition=COALESCE(excluded.secondaryposition, secondaryposition),
      thirdposition=COALESCE(excluded.thirdposition, thirdposition),
      jersey_number=COALESCE(excluded.jersey_number, jersey_number),

      -- DYNAMIC FIELDS (always update from server)
      video_progress_status=excluded.video_progress_status,
      stage=CASE
        WHEN video_tasks.date_completed IS NOT NULL THEN 'Done'
        ELSE excluded.stage
      END,
      video_due_date=excluded.video_due_date,
      assignedvideoeditor=excluded.assignedvideoeditor,
      updated_at=excluded.updated_at,
      cached_at=excluded.cached_at,
      source=excluded.source,
      last_seen_at=excluded.last_seen_at,

      -- SPECIAL: date_completed (preserve if Done)
      date_completed=CASE
        WHEN LOWER(excluded.stage) = 'done' THEN COALESCE(excluded.date_completed, date_completed)
        ELSE NULL
      END
  `,
  );

  database.transaction(() => {
    for (const task of tasks) {
      if (task.id === undefined || task.id === null) continue;
      const gradYearValue = Number(task.grad_year);
      if (Number.isFinite(gradYearValue) && gradYearValue > 0 && gradYearValue < MIN_ACTIVE_GRAD_YEAR) {
        continue;
      }
      const stageValue = (task.video_progress_stage || task.stage || '').toString().trim() || null;
      stmt.run({
        $id: task.id,
        $athlete_id: task.athlete_id,
        $athlete_main_id: task.athlete_main_id || '',
        $athletename: task.athletename || null,
        $video_progress_status: task.video_progress_status || null,
        $stage: stageValue,
        $sport_name: task.sport_name || null,
        $grad_year: task.grad_year || null,
        $video_due_date: task.video_due_date || null,
        $assignedvideoeditor: task.assignedvideoeditor || null,
        $primaryposition: task.primaryposition || null,
        $secondaryposition: task.secondaryposition || null,
        $thirdposition: task.thirdposition || null,
        $high_school: task.high_school || null,
        $high_school_city: task.high_school_city || null,
        $high_school_state: task.high_school_state || null,
        $updated_at: task.updated_at || now,
        $cached_at: now,
        $source: task.source || 'server',
        $last_seen_at: syncAt,
        $jersey_number: task.jersey_number || null,
        $date_completed: task.date_completed || null,
      });
    }
  });
  stmt.finalize();
  database.run(
    `
    DELETE FROM video_tasks
    WHERE (source IS NULL OR source = 'server')
      AND (last_seen_at IS NULL OR last_seen_at < $sync_at)
  `,
    { $sync_at: syncAt }
  );
  database.run(
    'DELETE FROM video_tasks WHERE grad_year IS NOT NULL AND grad_year != "" AND CAST(grad_year AS INTEGER) < $min_grad_year',
    { $min_grad_year: MIN_ACTIVE_GRAD_YEAR }
  );
  database.persist();
}

export async function purgeLegacyTasks(minGradYear: number = MIN_ACTIVE_GRAD_YEAR) {
  const database = await getBackend();
  database.run(
    'DELETE FROM video_tasks WHERE grad_year IS NOT NULL AND grad_year != "" AND CAST(grad_year AS INTEGER) < $min_grad_year',
    { $min_grad_year: minGradYear }
  );
  database.persist();
  logger.info('🧹 CACHE: Purged legacy tasks', { minGradYear });
}

export async function getCachedTasks(): Promise<CachedVideoTask[]> {
  const database = await getBackend();
  return database.all<CachedVideoTask>('SELECT * FROM video_tasks ORDER BY cached_at DESC');
}

export async function getLastCachedAt(): Promise<number | null> {
  const database = await getBackend();
  const row = database.get<{ last_cached_at: string | null }>(
    'SELECT MAX(cached_at) as last_cached_at FROM video_tasks'
  );
  const last = row?.last_cached_at ?? null;
  if (!last) return null;
  const ts = Date.parse(last);
  return Number.isNaN(ts) ? null : ts;
}

export async function updateCachedTaskStatusStage(id: number, updates: { status?: string; stage?: string }) {
  const database = await getBackend();
  const updatedAt = new Date().toISOString();

  // Build SET clause dynamically based on what's being updated
  const setClauses = [];
  const params: Record<string, any> = {
    $id: id,
    $updated_at: updatedAt,
  };

  if (updates.status !== undefined) {
    setClauses.push('video_progress_status = $status');
    params.$status = updates.status;
  }

  if (updates.stage !== undefined) {
    setClauses.push('stage = $stage');
    params.$stage = updates.stage;

    // Capture completion date when stage is set to "Done", clear it otherwise
    if (updates.stage.toLowerCase() === 'done') {
      setClauses.push('date_completed = $date_completed');
      params.$date_completed = updatedAt;
    } else {
      setClauses.push('date_completed = NULL');
    }
  }

  setClauses.push('updated_at = $updated_at', 'cached_at = $updated_at');

  database.run(
    `UPDATE video_tasks SET ${setClauses.join(', ')} WHERE id = $id`,
    params,
  );
  database.persist();
}

/**
 * Update the due date for a task in the cache.
 * Used after a successful due date update API call.
 */
export async function updateCachedTaskDueDate(id: number, dueDate: string) {
  const database = await getBackend();
  const updatedAt = new Date().toISOString();

  database.run(
    `UPDATE video_tasks
     SET video_due_date = $video_due_date,
         updated_at = $updated_at,
         cached_at = $updated_at
     WHERE id = $id`,
    {
      $id: id,
      $video_due_date: dueDate,
      $updated_at: updatedAt,
    }
  );
  database.persist();
}

/**
 * Update the completion date for a task.
 * Used when manually editing the completion date for Done tasks.
 */
export async function updateCachedCompletionDate(id: number, dateCompleted: string) {
  const database = await getBackend();
  const updatedAt = new Date().toISOString();

  database.run(
    `UPDATE video_tasks
     SET date_completed = $date_completed,
         updated_at = $updated_at,
         cached_at = $updated_at
     WHERE id = $id`,
    {
      $id: id,
      $date_completed: dateCompleted,
      $updated_at: updatedAt,
    }
  );
  database.persist();
}

/**
 * Store the mapping: athlete_id → athlete_main_id
 * athlete_id and athlete_main_id are DISTINCT values.
 * This stores which athlete_main_id corresponds to a given athlete_id.
 */
export async function cacheAthleteMainId(athleteId: number, athleteMainId: string) {
  const database = await getBackend();
  const updatedAt = new Date().toISOString();
  database.run(
    `
    UPDATE video_tasks
    SET
      athlete_main_id = $athlete_main_id,
      updated_at = $updated_at,
      cached_at = $updated_at
    WHERE athlete_id = $athlete_id
  `,
    {
      $athlete_id: athleteId,
      $athlete_main_id: athleteMainId,
      $updated_at: updatedAt,
    },
  );
  database.persist();
}

/**
 * Retrieve athlete_main_id for a given athlete_id.
 * Returns the distinct athlete_main_id value associated with this athlete_id.
 */
export async function getCachedAthleteMainId(athleteId: number): Promise<string | null> {
  const database = await getBackend();
  const row = database.get<{ athlete_main_id: string }>(
    'SELECT athlete_main_id FROM video_tasks WHERE athlete_id = $athlete_id AND athlete_main_id IS NOT NULL AND athlete_main_id != "" LIMIT 1',
    { $athlete_id: athleteId }
  );
  return row?.athlete_main_id ?? null;
}

/**
 * Update cached jersey_number for a given athlete_id.
 * Stores jersey number after successful API fetch.
 */
export async function updateCachedJerseyNumber(athleteId: number, jerseyNumber: string) {
  const database = await getBackend();
  const updatedAt = new Date().toISOString();
  database.run(
    `
    UPDATE video_tasks
    SET
      jersey_number = $jersey_number,
      updated_at = $updated_at,
      cached_at = $updated_at
    WHERE athlete_id = $athlete_id
  `,
    {
      $athlete_id: athleteId,
      $jersey_number: jerseyNumber,
      $updated_at: updatedAt,
    },
  );
  database.persist();
}

/**
 * Retrieve cached jersey_number for a given athlete_id.
 * Returns null if not cached or not available.
 */
export async function getCachedJerseyNumber(athleteId: number): Promise<string | null> {
  const database = await getBackend();
  const row = database.get<{ jersey_number: string }>(
    'SELECT jersey_number FROM video_tasks WHERE athlete_id = $athlete_id AND jersey_number IS NOT NULL AND jersey_number != "" LIMIT 1',
    { $athlete_id: athleteId }
  );
  return row?.jersey_number ?? null;
}

/**
 * Resolve athlete_id and athlete_main_id from video_msg_id.
 * This is the CRITICAL fallback for inbox threads that don't have athlete IDs in the HTML.
 * 
 * How it works:
 * - video_msg_id (e.g., 13681) is the same as the "id" field in video_tasks
 * - This maps: video_msg_id → athlete_id + athlete_main_id
 * - Used by inbox when Laravel doesn't provide athlete IDs upfront
 * 
 * @param videoMsgId - The numeric video message/thread ID
 * @returns Object with athlete_id and athlete_main_id, or null if not found
 */
export async function resolveAthleteIdsByVideoMsgId(videoMsgId: number | string): Promise<{ athlete_id: number; athlete_main_id: string } | null> {
  const database = await getBackend();
  const id = typeof videoMsgId === 'string' ? parseInt(videoMsgId, 10) : videoMsgId;

  if (isNaN(id)) {
    console.warn(`⚠️ Invalid video_msg_id: ${videoMsgId}`);
    return null;
  }

  const row = database.get<{ athlete_id: number; athlete_main_id: string }>(
    `SELECT athlete_id, athlete_main_id
     FROM video_tasks 
     WHERE id = $id 
       AND athlete_id IS NOT NULL 
       AND athlete_main_id IS NOT NULL 
       AND athlete_main_id != ""
     LIMIT 1`,
    { $id: id }
  );

  if (!row) {
    console.warn(`⚠️ No athlete IDs found in cache for video_msg_id: ${videoMsgId}`);
    return null;
  }

  return {
    athlete_id: row.athlete_id,
    athlete_main_id: row.athlete_main_id,
  };
}

/**
 * Cache contact information (student + parents).
 * Upsert pattern - updates existing or inserts new.
 */
export async function upsertContactInfo(contact: Partial<CachedContactInfo>): Promise<void> {
  const database = await getBackend();
  const now = new Date().toISOString();

  logger.info(`💾 CACHE: Upserting contact info for ${contact.contactId}`, {
    studentName: contact.studentName,
    hasParent1: !!contact.parent1Name,
    hasParent2: !!contact.parent2Name,
  });

  database.run(
    `INSERT INTO contact_info (
      contact_id, student_name, student_email, student_phone,
      parent1_name, parent1_relationship, parent1_email, parent1_phone,
      parent2_name, parent2_relationship, parent2_email, parent2_phone,
      cached_at, updated_at
    ) VALUES (
      $contact_id, $student_name, $student_email, $student_phone,
      $parent1_name, $parent1_relationship, $parent1_email, $parent1_phone,
      $parent2_name, $parent2_relationship, $parent2_email, $parent2_phone,
      $cached_at, $updated_at
    )
    ON CONFLICT(contact_id) DO UPDATE SET
      student_name=COALESCE(excluded.student_name, student_name),
      student_email=COALESCE(excluded.student_email, student_email),
      student_phone=COALESCE(excluded.student_phone, student_phone),
      parent1_name=COALESCE(excluded.parent1_name, parent1_name),
      parent1_relationship=COALESCE(excluded.parent1_relationship, parent1_relationship),
      parent1_email=COALESCE(excluded.parent1_email, parent1_email),
      parent1_phone=COALESCE(excluded.parent1_phone, parent1_phone),
      parent2_name=COALESCE(excluded.parent2_name, parent2_name),
      parent2_relationship=COALESCE(excluded.parent2_relationship, parent2_relationship),
      parent2_email=COALESCE(excluded.parent2_email, parent2_email),
      parent2_phone=COALESCE(excluded.parent2_phone, parent2_phone),
      cached_at=$cached_at,
      updated_at=$updated_at`,
    {
      $contact_id: contact.contactId,
      $student_name: contact.studentName || null,
      $student_email: contact.studentEmail || null,
      $student_phone: contact.studentPhone || null,
      $parent1_name: contact.parent1Name || null,
      $parent1_relationship: contact.parent1Relationship || null,
      $parent1_email: contact.parent1Email || null,
      $parent1_phone: contact.parent1Phone || null,
      $parent2_name: contact.parent2Name || null,
      $parent2_relationship: contact.parent2Relationship || null,
      $parent2_email: contact.parent2Email || null,
      $parent2_phone: contact.parent2Phone || null,
      $cached_at: now,
      $updated_at: now,
    }
  );
  database.persist();
  logger.info(`✅ CACHE: Successfully upserted contact info for ${contact.contactId}`);
}

/**
 * Retrieve cached contact info by contact_id.
 * Returns null if not found.
 */
export async function getCachedContactInfo(contactId: number): Promise<CachedContactInfo | null> {
  const database = await getBackend();
  logger.debug(`🔍 CACHE: Checking cache for contact ${contactId}`);

  const row = database.get<CachedContactInfo>(
    'SELECT * FROM contact_info WHERE contact_id = $contact_id LIMIT 1',
    { $contact_id: contactId }
  );

  if (!row) {
    logger.debug(`❌ CACHE: Cache miss for contact ${contactId}`);
    return null;
  }

  const cached = row as CachedContactInfo;
  logger.info(`✅ CACHE: Cache hit for contact ${contactId}`, {
    studentName: cached.studentName,
    cachedAt: cached.cachedAt,
  });

  return cached;
}
