#!/usr/bin/env npx ts-node
/**
 * Backfill athlete_main_id for existing cache entries.
 *
 * Usage (from project root):
 *   npx ts-node scripts/backfill-athlete-main-id.ts
 *
 * This script:
 * 1. Reads all video_tasks from SQLite cache
 * 2. Identifies entries missing athlete_main_id
 * 3. Batch-resolves via FastAPI /athlete/{id}/resolve
 * 4. Updates cache with resolved values
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import initSqlJs from 'sql.js';

const DB_DIR = path.join(os.homedir(), '.prospect-pipeline');
const DB_PATH = path.join(DB_DIR, 'progress.db');
const API_BASE = 'http://127.0.0.1:8000/api/v1';

interface Task {
    id: number;
    athlete_id: number;
    athlete_main_id: string | null;
    athletename: string;
}

async function apiFetch(endpoint: string): Promise<Response> {
    return fetch(`${API_BASE}${endpoint}`);
}

async function resolveAthleteMainId(athleteId: number): Promise<string | null> {
    try {
        const response = await apiFetch(`/athlete/${athleteId}/resolve`);
        if (!response.ok) {
            console.log(`  ⚠️ HTTP ${response.status} for athlete_id ${athleteId}`);
            return null;
        }
        const data = (await response.json()) as { athlete_main_id?: string };
        return data.athlete_main_id || null;
    } catch (error) {
        console.log(`  ❌ Error resolving ${athleteId}:`, error);
        return null;
    }
}

function chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
    );
}

async function main() {
    console.log('🔧 athlete_main_id Backfill Script');
    console.log('==================================\n');

    // Check if DB exists
    if (!fs.existsSync(DB_PATH)) {
        console.error(`❌ Database not found at ${DB_PATH}`);
        process.exit(1);
    }

    // Load SQL.js
    const SQL = await initSqlJs();
    const fileData = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(fileData);

    // Get all tasks
    const result = db.exec(`
    SELECT id, athlete_id, athlete_main_id, athletename
    FROM video_tasks
    WHERE athlete_id IS NOT NULL
  `);

    if (!result.length || !result[0].values.length) {
        console.log('No tasks found in cache.');
        db.close();
        return;
    }

    const tasks: Task[] = result[0].values.map((row) => ({
        id: row[0] as number,
        athlete_id: row[1] as number,
        athlete_main_id: row[2] as string | null,
        athletename: row[3] as string,
    }));

    const total = tasks.length;
    const populated = tasks.filter((t) => t.athlete_main_id && t.athlete_main_id !== '').length;
    const missing = tasks.filter((t) => !t.athlete_main_id || t.athlete_main_id === '');

    console.log(`📊 Cache Status:`);
    console.log(`   Total tasks: ${total}`);
    console.log(`   With athlete_main_id: ${populated} (${((populated / total) * 100).toFixed(1)}%)`);
    console.log(`   Missing athlete_main_id: ${missing.length}`);
    console.log();

    if (missing.length === 0) {
        console.log('✅ All tasks already have athlete_main_id!');
        db.close();
        return;
    }

    // Deduplicate by athlete_id
    const uniqueAthleteIds = [...new Set(missing.map((t) => t.athlete_id))];
    console.log(`🔍 Unique athlete_ids to resolve: ${uniqueAthleteIds.length}`);
    console.log();

    // Batch resolve
    const batches = chunk(uniqueAthleteIds, 5); // Limit to 50 initially
    const resolved: Map<number, string> = new Map();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`📦 Processing batch ${i + 1}/${batches.length}...`);

        const results = await Promise.all(
            batch.map(async (athleteId) => {
                const mainId = await resolveAthleteMainId(athleteId);
                return { athleteId, mainId };
            })
        );

        for (const { athleteId, mainId } of results) {
            if (mainId) {
                resolved.set(athleteId, mainId);
                successCount++;
                console.log(`  ✅ ${athleteId} → ${mainId}`);
            } else {
                failCount++;
            }
        }

        // Small delay between batches
        await new Promise((r) => setTimeout(r, 200));
    }

    console.log();
    console.log(`📝 Updating cache...`);

    // Update database
    const updateStmt = db.prepare(`
    UPDATE video_tasks
    SET athlete_main_id = ?, updated_at = ?, cached_at = ?
    WHERE athlete_id = ?
  `);

    const now = new Date().toISOString();
    let updateCount = 0;

    for (const [athleteId, mainId] of resolved) {
        updateStmt.run([mainId, now, now, athleteId]);
        updateCount++;
    }
    updateStmt.free();

    // Persist
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    db.close();

    console.log();
    console.log(`✅ Backfill Complete!`);
    console.log(`   Resolved: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Updated rows: ${updateCount}`);

    // Final stats
    console.log();
    console.log(`📊 Post-backfill check recommended:`);
    console.log(`   sqlite3 ~/.prospect-pipeline/progress.db "SELECT COUNT(*), SUM(CASE WHEN athlete_main_id != '' THEN 1 ELSE 0 END) FROM video_tasks;"`);
}

main().catch(console.error);
