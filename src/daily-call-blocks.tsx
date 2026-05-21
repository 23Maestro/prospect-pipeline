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

type TaskCounts = { touch1Count: number; remainingTaskCount: number };

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

function buildSchedule(start: Date, counts: TaskCounts): ScheduleBlock[] {
  const primeStart = localDateAt(start, { hour: 16, minute: 30 });
  const primeEnd = localDateAt(start, { hour: 19, minute: 15 });
  const finalEnd = localDateAt(start, { hour: 19, minute: 30 });
  const latestEnd = localDateAt(start, { hour: 20, minute: 0 });

  const blocks: ScheduleBlock[] = [];
  let cursor = start;

  const touch1Goal = Math.min(10, Math.max(0, counts.touch1Count));
  const followUpTask =
    counts.remainingTaskCount > 0
      ? `Complete ${Math.min(8, counts.remainingTaskCount)} remaining follow-ups`
      : 'Clear callbacks and prep follow-up queue';
  const fixedBeforePrime = [
    ['Confirmations', 'Confirm today and tomorrow meetings', 15],
    [
      'Touch 1 Focus',
      touch1Goal > 0 ? `Call ${touch1Goal} Touch 1s` : 'Clear callbacks and prep new Touch 1 list',
      90,
    ],
    ['Reschedule Sweep', 'Rebook no-shows with 2 specific options', 30],
    ['Follow-Up Push', followUpTask, 60],
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
      'Touch 1 + Callbacks',
      'Finish remaining Touch 1s, then callbacks',
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
      title: 'SC: Prime Parent Answer Window',
      start: parentWindowStart,
      end: parentEnd,
      task: 'Push live conversations and set meetings',
    });
  }

  const finalStart = parentEnd <= primeEnd ? primeEnd : addMinutes(latestEnd, -15);
  if (finalStart < latestEnd && finalEnd <= latestEnd) {
    blocks.push({
      title: 'SC: Final Confirmation Sweep',
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

function buildPlainTextPlan(blocks: ScheduleBlock[], start: Date): string {
  return [
    'DAILY CALL BLOCKS',
    `Start: ${formatClock(start)}`,
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

export default async function DailyCallBlocksCommand() {
  const now = new Date();
  const start = resolveStartTime(now);

  if (!start) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Too late. Try tomorrow.',
    });
    return;
  }

  const counts = await loadTaskCounts();
  const blocks = buildSchedule(start, counts);
  const downloadsPath = join(homedir(), 'Downloads');
  const filename = `prospect-id-call-blocks-${formatDateStamp(start).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}.ics`;
  const filePath = join(downloadsPath, filename);

  await mkdir(downloadsPath, { recursive: true });
  await writeFile(filePath, buildIcs(blocks, now), 'utf8');
  await Clipboard.copy(buildPlainTextPlan(blocks, start));
  await open(filePath);
  await showToast({
    style: Toast.Style.Success,
    title: 'Call blocks exported',
  });
}
