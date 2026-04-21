import {
  upsertScoutFollowUpTrackerEntry,
  type LightweightFollowUpTrackerEntry,
} from './scout-follow-up-tracker';
import { resolveSalesLifecycle } from './sales-lifecycle';

type SyncScoutOutcomeArgs = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  stage: string;
  currentTask?: string | null;
  dueDate?: string | null;
  adminUrl: string;
  taskId?: string | null;
};

type SyncScoutOutcomeResult = {
  trackerPageId: string;
  trackerPageUrl: string;
  callLogPageId?: string | null;
  callLogPageUrl?: string | null;
  loggedCallOutcome: boolean;
  trackerStage: string;
  callResult?: string | null;
};

function normalizeStage(value?: string | null): string {
  return String(value || '').trim();
}

function normalizeTrackerStage(stage: string): string {
  const normalized = normalizeStage(stage);
  if (!normalized) return 'Pending follow-up';
  const lifecycle = resolveSalesLifecycle(normalized);

  if (/^left voice mail 1$/i.test(normalized)) return 'Call Attempt 1';
  if (/^left voice mail 2$/i.test(normalized)) return 'Call Attempt 2';
  if (/called\s*-\s*unable to leave vm/i.test(normalized)) return 'Unable to leave VM';
  if (/confirmation call/i.test(normalized)) return 'Confirmation Call';
  if (lifecycle.normalizedStage === 'meeting_set') return 'Meeting Set';
  if (lifecycle.normalizedStage === 'meeting_follow_up') return 'Spoke To - Follow Up';
  if (lifecycle.normalizedStage === 'closed_lost') return 'Not Interested';
  return normalized;
}

export async function syncScoutOutcomeToNotion(
  args: SyncScoutOutcomeArgs,
): Promise<SyncScoutOutcomeResult> {
  const trackerStage = normalizeTrackerStage(args.stage);

  const trackerEntry: LightweightFollowUpTrackerEntry = {
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    parent1Name: args.parent1Name,
    parent2Name: args.parent2Name,
    stage: trackerStage,
    currentTask: args.currentTask,
    dueDate: args.dueDate,
    adminUrl: args.adminUrl,
  };

  const trackerResult = await upsertScoutFollowUpTrackerEntry(trackerEntry);

  return {
    trackerPageId: trackerResult.pageId,
    trackerPageUrl: trackerResult.pageUrl,
    callLogPageId: null,
    callLogPageUrl: null,
    loggedCallOutcome: false,
    trackerStage,
    callResult: null,
  };
}
