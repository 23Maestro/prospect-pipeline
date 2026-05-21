import { Clipboard, Toast, open, showToast } from '@raycast/api';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCachedDailyCallBlockTaskCounts } from './lib/scout-prep-cache';

type TimeOfDay = {
  hour: number;
  minute: number;
};

type ScheduleBlock = {
  title: string;
  start: Date;
  end: Date;
  task: string;
};

export type TaskCounts = { touch1Count: number; remainingTaskCount: number };
type DailyCallPlan = {
  touch1Count: number;
  remainingTaskCount: number;
  nonTouch1TaskCount: number;
  touch1DialTarget: number;
  firstTouch1Target: number;
  callbackTouch1Target: number;
  primeTouch1Target: number;
  followUpTarget: number;
};

const SET_GOAL = '6-7 sets';

function localDateAt(source: Date, time: TimeOfDay): Date {
  return new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate(),
    time.hour,
    time.minute,
    0,
    0,
  );
}

function addMinutes(source: Date, minutes: number): Date {
  return new Date(source.getTime() + minutes * 60 * 1000);
}

function roundUpToNextQuarterHour(source: Date): Date {
  const rounded = new Date(source);
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % 15;
  if (remainder === 0) return rounded;
  rounded.setMinutes(rounded.getMinutes() + (15 - remainder));
  return rounded;
}

function resolveStartTime(now: Date): Date | null {
  const nine = localDateAt(now, { hour: 9, minute: 0 });
  const one = localDateAt(now, { hour: 13, minute: 0 });

  if (now < nine) return nine;
  if (now <= one) return roundUpToNextQuarterHour(now);
  return null;
}

function buildBlock(title: string, task: string, start: Date, minutes: number): ScheduleBlock {
  return {
    title: `SC: ${title}`,
    start,
    end: addMinutes(start, minutes),
    task,
  };
}

export function buildDailyCallPlan(counts: TaskCounts): DailyCallPlan {
  const touch1Count = Math.max(0, Math.floor(counts.touch1Count));
  const remainingTaskCount = Math.max(0, Math.floor(counts.remainingTaskCount));
  const nonTouch1TaskCount = Math.max(0, remainingTaskCount - touch1Count);
  const touch1DialTarget =
    touch1Count >= 40
      ? Math.min(touch1Count, Math.min(32, Math.max(25, Math.round(touch1Count * 0.6))))
      : Math.min(touch1Count, Math.max(0, Math.round(touch1Count * 0.65)));
  const firstTouch1Target = Math.min(12, touch1DialTarget);
  const callbackTouch1Target = Math.min(8, Math.max(0, touch1DialTarget - firstTouch1Target));
  const primeTouch1Target = Math.max(
    0,
    touch1DialTarget - firstTouch1Target - callbackTouch1Target,
  );
  const followUpTarget =
    nonTouch1TaskCount > 0 ? Math.min(12, Math.max(6, Math.round(nonTouch1TaskCount * 0.25))) : 0;

  return {
    touch1Count,
    remainingTaskCount,
    nonTouch1TaskCount,
    touch1DialTarget,
    firstTouch1Target,
    callbackTouch1Target,
    primeTouch1Target,
    followUpTarget,
  };
}

export function buildSchedule(start: Date, counts: TaskCounts): ScheduleBlock[] {
  const primeStart = localDateAt(start, { hour: 16, minute: 30 });
  const primeEnd = localDateAt(start, { hour: 19, minute: 15 });
  const finalEnd = localDateAt(start, { hour: 19, minute: 30 });
  const latestEnd = localDateAt(start, { hour: 20, minute: 0 });
  const plan = buildDailyCallPlan(counts);

  const blocks: ScheduleBlock[] = [];
  let cursor = start;

  const followUpTask =
    plan.followUpTarget > 0
      ? `Work ${plan.followUpTarget} warm follow-ups from ${plan.nonTouch1TaskCount} non-Touch 1 tasks`
      : 'Clear callbacks and prep follow-up queue';
  const fixedBeforePrime = [
    [
      `Confirm First (${plan.remainingTaskCount} tasks)`,
      `Confirm today and tomorrow meetings before new dials. Set goal: ${SET_GOAL}`,
      15,
    ],
    [
      `Touch 1 Calls (${plan.firstTouch1Target} of ${plan.touch1Count})`,
      plan.firstTouch1Target > 0
        ? `Call ${plan.firstTouch1Target} Touch 1s from ${plan.touch1Count} active. Daily Touch 1 target: ${plan.touch1DialTarget}`
        : 'Clear callbacks and prep new Touch 1 list',
      90,
    ],
    ['Warm Rebooks', 'Rebook no-shows with 2 specific options', 30],
    [`Follow-Ups (${plan.followUpTarget})`, followUpTask, 60],
  ] as const;

  for (const [title, task, minutes] of fixedBeforePrime) {
    blocks.push(buildBlock(title, task, cursor, minutes));
    cursor = addMinutes(cursor, minutes);
  }

  const standardAdminMinutes = 30;
  const standardPushMinutes = 90;
  const standardBreakMinutes = Math.max(
    15,
    Math.round(
      (primeStart.getTime() -
        addMinutes(cursor, standardAdminMinutes + standardPushMinutes).getTime()) /
        60000,
    ),
  );
  const standardFinish = addMinutes(
    cursor,
    standardAdminMinutes + standardPushMinutes + standardBreakMinutes,
  );
  const adminMinutes = standardFinish <= primeStart ? standardAdminMinutes : 15;
  const breakMinutes = standardFinish <= primeStart ? standardBreakMinutes : 15;

  blocks.push(
    buildBlock('CRM Reset', 'Update notes and send missing confirmations', cursor, adminMinutes),
  );
  cursor = addMinutes(cursor, adminMinutes);
  blocks.push(
    buildBlock(
      `Touch 1 + Callbacks (${plan.callbackTouch1Target} Touch 1s)`,
      plan.callbackTouch1Target > 0
        ? `Call ${plan.callbackTouch1Target} more Touch 1s, then callbacks`
        : 'Work callbacks and best warm replies',
      cursor,
      standardPushMinutes,
    ),
  );
  cursor = addMinutes(cursor, standardPushMinutes);

  if (cursor < primeStart) {
    blocks.push(
      buildBlock(
        'Reply Cleanup',
        'Handle text replies and clean CRM notes',
        cursor,
        Math.round((primeStart.getTime() - cursor.getTime()) / 60000),
      ),
    );
    cursor = primeStart;
  } else {
    blocks.push(
      buildBlock('Reply Cleanup', 'Handle text replies and clean CRM notes', cursor, breakMinutes),
    );
    cursor = addMinutes(cursor, breakMinutes);
  }

  const parentWindowStart = cursor <= primeStart ? primeStart : cursor;
  const parentWindowEnd = parentWindowStart <= primeStart ? primeEnd : latestEnd;
  const finalSweepStart = parentWindowEnd <= primeEnd ? primeEnd : addMinutes(latestEnd, -15);
  const parentEnd =
    finalSweepStart > parentWindowStart ? finalSweepStart : addMinutes(parentWindowStart, 15);

  if (parentEnd <= latestEnd) {
    blocks.push({
      title: `SC: Parent Window (${plan.primeTouch1Target} Touch 1s)`,
      start: parentWindowStart,
      end: parentEnd,
      task:
        plan.primeTouch1Target > 0
          ? `Use the best parent answer window for ${plan.primeTouch1Target} final Touch 1s and live set attempts`
          : 'Use the best parent answer window for live set attempts',
    });
  }

  const finalStart = parentEnd <= primeEnd ? primeEnd : addMinutes(latestEnd, -15);
  if (finalStart < latestEnd && finalEnd <= latestEnd) {
    blocks.push({
      title: 'SC: Final Confirmations',
      start: finalStart,
      end: parentEnd <= primeEnd ? finalEnd : latestEnd,
      task: 'Send final confirmations and prep first calls for tomorrow',
    });
  }

  return blocks.filter((block) => block.end <= latestEnd && block.end > block.start);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateStamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatLocalIcsDateTime(date: Date): string {
  return `${formatDateStamp(date)}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatUtcIcsDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  chunks.push(remaining);
  return chunks.join('\r\n');
}

function buildDescription(task: string): string {
  return `Task: ${task}`;
}

function buildIcs(blocks: ScheduleBlock[], generatedAt: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prospect Pipeline//Daily Call Blocks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  blocks.forEach((block, index) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:prospect-id-call-blocks-${formatDateStamp(block.start)}-${index}@prospect-pipeline`,
      `DTSTAMP:${formatUtcIcsDateTime(generatedAt)}`,
      `DTSTART:${formatLocalIcsDateTime(block.start)}`,
      `DTEND:${formatLocalIcsDateTime(block.end)}`,
      `SUMMARY:${escapeIcsText(block.title)}`,
      `DESCRIPTION:${escapeIcsText(buildDescription(block.task))}`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function buildPlainTextPlan(
  blocks: ScheduleBlock[],
  start: Date,
  counts: TaskCounts,
): string {
  const plan = buildDailyCallPlan(counts);
  return [
    'DAILY CALL BLOCKS',
    `Start: ${formatClock(start)}`,
    `Goal: ${SET_GOAL}`,
    `Active Queue: ${plan.touch1Count} Touch 1s / ${plan.remainingTaskCount} tasks`,
    `Touch 1 Dial Target: ${plan.touch1DialTarget}`,
    '',
    'Time Blocks:',
    ...blocks.flatMap((block) => [
      `${formatClock(block.start)}-${formatClock(block.end)} ${block.title}`,
      `- Task: ${block.task}`,
    ]),
    '',
    'Scoreboard:',
    'Dials: __',
    'Sets: __',
    'Shows: __',
  ].join('\n');
}

async function loadTaskCounts(): Promise<TaskCounts> {
  const cachedCounts = await getCachedDailyCallBlockTaskCounts();
  return cachedCounts?.data || { touch1Count: 0, remainingTaskCount: 0 };
}

export async function exportDailyCallBlocks(counts: TaskCounts, now = new Date()): Promise<void> {
  const start = resolveStartTime(now);

  if (!start) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Too late. Try tomorrow.',
    });
    return;
  }

  const blocks = buildSchedule(start, counts);
  const downloadsPath = join(homedir(), 'Downloads');
  const filename = `prospect-id-call-blocks-${formatDateStamp(start).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}.ics`;
  const filePath = join(downloadsPath, filename);

  await mkdir(downloadsPath, { recursive: true });
  await writeFile(filePath, buildIcs(blocks, now), 'utf8');
  await Clipboard.copy(buildPlainTextPlan(blocks, start, counts));
  await open(filePath);
  await showToast({
    style: Toast.Style.Success,
    title: 'Call blocks exported',
  });
}

export default async function DailyCallBlocksCommand() {
  await exportDailyCallBlocks(await loadTaskCounts());
}
