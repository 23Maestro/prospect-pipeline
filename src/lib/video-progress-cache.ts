import fs from 'fs';
import os from 'os';
import path from 'path';
import { environment } from '@raycast/api';
import initSqlJs, { Database as SQLDatabase } from 'sql.js';

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
}

const DB_DIR = path.join(os.homedir(), '.prospect-pipeline');
const DB_PATH = path.join(DB_DIR, 'video-progress-cache.sqlite');
const SQLPromise = initSqlJs({
  locateFile: (file) => path.join(environment.assetsPath, file),
});

let db: SQLDatabase | null = null;

async function getDb(): Promise<SQLDatabase> {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await SQLPromise;
  let fileData: Uint8Array | undefined;
  if (fs.existsSync(DB_PATH)) {
    fileData = fs.readFileSync(DB_PATH);
  }
  db = fileData ? new SQL.Database(fileData) : new SQL.Database();
  initSchema(db);
  return db;
}

function persist(database: SQLDatabase) {
  const data = database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema(database: SQLDatabase) {
  database.run(
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
      cached_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks (video_progress_status);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_cached_at ON video_tasks (cached_at);
  `,
  );
  try {
    database.run(`ALTER TABLE video_tasks ADD COLUMN athlete_main_id TEXT;`);
  } catch {
    // ignore if exists
  }
  persist(database);
}

export async function upsertTasks(tasks: Partial<CachedVideoTask>[]) {
  const database = await getDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(
    `
    INSERT INTO video_tasks (
      id, athlete_id, athlete_main_id, athletename, video_progress_status, stage, sport_name, grad_year,
      video_due_date, assignedvideoeditor, primaryposition, secondaryposition, thirdposition,
      high_school, high_school_city, high_school_state, updated_at, cached_at
    ) VALUES (
      $id, $athlete_id, $athlete_main_id, $athletename, $video_progress_status, $stage, $sport_name, $grad_year,
      $video_due_date, $assignedvideoeditor, $primaryposition, $secondaryposition, $thirdposition,
      $high_school, $high_school_city, $high_school_state, $updated_at, $cached_at
    )
    ON CONFLICT(id) DO UPDATE SET
      athlete_id=excluded.athlete_id,
      athlete_main_id=excluded.athlete_main_id,
      athletename=excluded.athletename,
      video_progress_status=excluded.video_progress_status,
      stage=excluded.stage,
      sport_name=excluded.sport_name,
      grad_year=excluded.grad_year,
      video_due_date=excluded.video_due_date,
      assignedvideoeditor=excluded.assignedvideoeditor,
      primaryposition=excluded.primaryposition,
      secondaryposition=excluded.secondaryposition,
      thirdposition=excluded.thirdposition,
      high_school=excluded.high_school,
      high_school_city=excluded.high_school_city,
      high_school_state=excluded.high_school_state,
      updated_at=excluded.updated_at,
      cached_at=excluded.cached_at
  `,
  );

  database.run('BEGIN TRANSACTION;');
  for (const task of tasks) {
    if (task.id === undefined || task.id === null) continue;
    stmt.run({
      $id: task.id,
      $athlete_id: task.athlete_id,
      $athlete_main_id: task.athlete_main_id || '',
      $athletename: task.athletename,
      $video_progress_status: task.video_progress_status,
      $stage: task.stage,
      $sport_name: task.sport_name,
      $grad_year: task.grad_year,
      $video_due_date: task.video_due_date,
      $assignedvideoeditor: task.assignedvideoeditor,
      $primaryposition: task.primaryposition,
      $secondaryposition: task.secondaryposition,
      $thirdposition: task.thirdposition,
      $high_school: task.high_school,
      $high_school_city: task.high_school_city,
      $high_school_state: task.high_school_state,
      $updated_at: task.updated_at || now,
      $cached_at: now,
    });
  }
  database.run('COMMIT;');
  stmt.free();
  persist(database);
}

export async function getCachedTasks(): Promise<CachedVideoTask[]> {
  const database = await getDb();
  const res = database.exec('SELECT * FROM video_tasks ORDER BY cached_at DESC');
  if (!res.length) return [];
  const rowset = res[0];
  return rowset.values.map((row) => {
    const obj: Record<string, any> = {};
    rowset.columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj as CachedVideoTask;
  });
}

export async function getLastCachedAt(): Promise<number | null> {
  const database = await getDb();
  const res = database.exec('SELECT MAX(cached_at) as last_cached_at FROM video_tasks');
  if (!res.length || !res[0].values.length) return null;
  const last = res[0].values[0][0] as string | null;
  if (!last) return null;
  const ts = Date.parse(last);
  return Number.isNaN(ts) ? null : ts;
}

export async function updateCachedTaskStatusStage(id: number, updates: { status?: string; stage?: string }) {
  const database = await getDb();
  const updatedAt = new Date().toISOString();
  database.run(
    `
    UPDATE video_tasks
    SET
      video_progress_status = COALESCE($status, video_progress_status),
      stage = COALESCE($stage, stage),
      updated_at = $updated_at,
      cached_at = $updated_at
    WHERE id = $id
  `,
    {
      $id: id,
      $status: updates.status,
      $stage: updates.stage,
      $updated_at: updatedAt,
    },
  );
  persist(database);
}
