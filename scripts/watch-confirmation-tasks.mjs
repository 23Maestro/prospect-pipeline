#!/usr/bin/env node

import fetch from 'node-fetch';
import {
  buildConfirmationTaskMorningDue,
  findIncompleteConfirmationTask,
  readConfirmationTaskWatchQueue,
  upsertConfirmationTaskWatchItem,
  writeConfirmationTaskWatchQueue,
} from '../src/lib/confirmation-task-watch.ts';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api/v1';
const DEFAULT_SCOUT = 'Jerami Singleton';

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    only: [],
    skip: [],
    dryRun: false,
    seedCurrent: false,
    maxItems: 100,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--seed-current') {
      args.seedCurrent = true;
    } else if (arg === '--only') {
      args.only = parseList(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--only=')) {
      args.only = parseList(arg.slice('--only='.length));
    } else if (arg === '--skip') {
      args.skip = parseList(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--skip=')) {
      args.skip = parseList(arg.slice('--skip='.length));
    } else if (arg === '--max-items') {
      args.maxItems = Number.parseInt(argv[index + 1] || '', 10) || args.maxItems;
      index += 1;
    }
  }
  return args;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldIncludeName(name, args) {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (args.skip.some((skipName) => normalized === normalizeName(skipName))) return false;
  if (args.only.length) {
    return args.only.some((onlyName) => normalized === normalizeName(onlyName));
  }
  return true;
}

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${pathname} -> HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTasks(athleteId, athleteMainId) {
  const payload = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
    }),
  });
  return Array.isArray(payload.tasks) ? payload.tasks : [];
}

async function updateTaskDueDate(item, task, due) {
  return apiFetch('/tasks/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task_id: String(task.task_id || '').trim(),
      contact_task: item.athleteId,
      athlete_main_id: item.athleteMainId,
      due_date: due.dueDate,
      due_time: due.dueTime,
    }),
  });
}

function pickCurrentMeeting(events) {
  const now = Date.now();
  const sorted = [...events]
    .filter((event) => String(event?.start || '').trim())
    .sort((left, right) => String(left.start).localeCompare(String(right.start)));
  return (
    sorted.find((event) => {
      const parsed = Date.parse(String(event.start || ''));
      return !Number.isNaN(parsed) && parsed >= now;
    }) ||
    sorted[sorted.length - 1] ||
    null
  );
}

async function seedCurrentWatchItems(args) {
  if (!args.seedCurrent && !args.only.length) return [];

  const payload = await apiFetch(`/scout/tasks?range=all&start=0&length=${args.maxItems}`);
  const scoutTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const seeded = [];
  const seenAthletes = new Set();
  for (const task of scoutTasks) {
    if (!shouldIncludeName(task.athlete_name, args)) continue;

    const athleteId = String(task.contact_id || task.athlete_id || '').trim();
    const athleteMainId = String(task.athlete_main_id || '').trim();
    const athleteKey = `${athleteId}:${athleteMainId}`;
    if (seenAthletes.has(athleteKey)) continue;
    seenAthletes.add(athleteKey);
    if (!athleteId || !athleteMainId) {
      seeded.push({
        athleteName: task.athlete_name,
        status: 'seed_skipped',
        reason: 'missing athlete ids',
      });
      continue;
    }

    const meetingsPayload = await apiFetch(
      `/calendar/athlete-booked-meetings?athlete_id=${encodeURIComponent(athleteId)}&athlete_main_id=${encodeURIComponent(athleteMainId)}`,
    ).catch((error) => ({ events: [], error }));
    const meeting = pickCurrentMeeting(Array.isArray(meetingsPayload.events) ? meetingsPayload.events : []);
    if (!meeting) {
      seeded.push({
        athleteName: task.athlete_name,
        status: 'seed_skipped',
        reason: 'no booked meeting found',
      });
      continue;
    }

    const item = upsertConfirmationTaskWatchItem({
      athleteId,
      athleteMainId,
      athleteName: task.athlete_name,
      appointmentId: String(meeting.event_id || '').trim(),
      meetingStartsAt: String(meeting.start || '').trim(),
      meetingTimezone: null,
      headScout: String(meeting.assigned_owner || task.assigned_owner || DEFAULT_SCOUT).trim(),
      source: 'watcher_seed_current',
    });
    seeded.push({ athleteName: task.athlete_name, status: 'seeded', id: item.id });
  }
  return seeded;
}

function taskAlreadyMatchesDue(task, due) {
  const raw = String(task.due_date || '').trim();
  return raw.includes(due.dueDate) && raw.includes('09:00');
}

async function processQueue(args) {
  const queue = readConfirmationTaskWatchQueue();
  const now = new Date();
  const results = [];

  for (const item of queue.items) {
    if (item.status !== 'watching') continue;
    if (!shouldIncludeName(item.athleteName, args)) continue;

    item.attempts = (item.attempts || 0) + 1;
    item.lastCheckedAt = now.toISOString();

    if (Date.parse(item.expiresAt) < now.getTime()) {
      item.status = 'expired';
      item.lastError = 'watch window expired before confirmation task appeared';
      results.push({ athleteName: item.athleteName, status: 'expired' });
      continue;
    }

    try {
      const tasks = await fetchTasks(item.athleteId, item.athleteMainId);
      const confirmationTask = findIncompleteConfirmationTask(tasks);
      if (!confirmationTask?.task_id) {
        results.push({
          athleteName: item.athleteName,
          status: 'waiting',
          attempts: item.attempts,
        });
        continue;
      }

      const due = buildConfirmationTaskMorningDue(item.meetingStartsAt);
      item.confirmationTaskId = String(confirmationTask.task_id || '').trim();
      item.updatedDueDate = due.dueDate;
      item.updatedDueTime = due.dueTime;

      if (taskAlreadyMatchesDue(confirmationTask, due)) {
        item.status = 'updated';
        results.push({
          athleteName: item.athleteName,
          status: 'already_updated',
          taskId: item.confirmationTaskId,
          dueDate: due.dueDate,
          dueTime: due.dueTime,
        });
        continue;
      }

      if (!args.dryRun) {
        await updateTaskDueDate(item, confirmationTask, due);
        item.status = 'updated';
      }

      results.push({
        athleteName: item.athleteName,
        status: args.dryRun ? 'would_update' : 'updated',
        taskId: item.confirmationTaskId,
        dueDate: due.dueDate,
        dueTime: due.dueTime,
      });
    } catch (error) {
      item.lastError = error instanceof Error ? error.message : String(error);
      results.push({
        athleteName: item.athleteName,
        status: 'failed',
        error: item.lastError,
      });
    }
  }

  writeConfirmationTaskWatchQueue(queue);
  return results;
}

const args = parseArgs(process.argv.slice(2));
const seeded = await seedCurrentWatchItems(args);
const results = await processQueue(args);
console.log(JSON.stringify({ dryRun: args.dryRun, seeded, results }, null, 2));
