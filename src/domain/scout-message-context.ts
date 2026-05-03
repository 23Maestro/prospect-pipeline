import type { ScoutPrepContext } from '../features/scout-prep/types';
import {
  getMeetingReminderPhrase,
  getRelativeMeetingDayPhrase,
  getReminderTimeLabel,
  getGreetingForLocalTime,
} from './outreach-time-wording';
import {
  getMeetingReminderRecipient,
  getVoicemailFollowUpRecipients,
  type VoicemailFollowUpRecipient,
} from './scout-contact-selection';
import { getActiveOperator } from './owners';

export type ConfirmationMessageContext = {
  greeting: string;
  recipientNames: string[];
  recipientPhones: string[];
  athleteName: string;
  sport: string | null;
  gradYear: string | null;
  headScout: string | null;
  meetingStart: Date;
  meetingTimezone: string | null;
  meetingTimePhrase: string;
  meetingReminderPhrase: string;
  senderName: string;
};

export type VoicemailFollowUpMessageContext = {
  greeting: string;
  recipients: VoicemailFollowUpRecipient[];
  athleteName: string;
  sport: string | null;
  gradYear: string | null;
  senderName: string;
};

export type MeetingReminderMessageContext = ConfirmationMessageContext;

function athleteNameFromContext(context: ScoutPrepContext): string {
  return context.contactInfo.studentAthlete.name || context.task.athlete_name || '';
}

function senderNameFromDomain(value?: string | null): string {
  return String(value || '').trim() || getActiveOperator().senderName;
}

export function buildConfirmationMessageContext(args: {
  context: ScoutPrepContext;
  meetingStart: Date;
  meetingTimezone?: string | null;
  headScoutName?: string | null;
  now?: Date;
  senderName?: string | null;
}): ConfirmationMessageContext {
  const reminderRecipient = getMeetingReminderRecipient(args.context);
  const meetingTimezone = args.meetingTimezone || null;
  return {
    greeting: getGreetingForLocalTime({ now: args.now, meetingTimezone }),
    recipientNames: reminderRecipient?.recipientNames || [],
    recipientPhones: reminderRecipient?.phones || [],
    athleteName: athleteNameFromContext(args.context),
    sport: args.context.resolved.sport || null,
    gradYear: String(args.context.task.grad_year || '').trim() || null,
    headScout: args.headScoutName || args.context.resolved.head_scout || null,
    meetingStart: args.meetingStart,
    meetingTimezone,
    meetingTimePhrase: getRelativeMeetingDayPhrase({
      meetingStart: args.meetingStart,
      meetingTimezone,
      now: args.now,
    }),
    meetingReminderPhrase: getMeetingReminderPhrase({
      meetingStart: args.meetingStart,
      meetingTimezone,
      now: args.now,
    }),
    senderName: senderNameFromDomain(args.senderName),
  };
}

export function buildMeetingReminderMessageContext(args: {
  context: ScoutPrepContext;
  meetingStart: Date;
  meetingTimezone?: string | null;
  headScoutName?: string | null;
  now?: Date;
  senderName?: string | null;
}): MeetingReminderMessageContext {
  return buildConfirmationMessageContext(args);
}

export function buildVoicemailFollowUpMessageContext(args: {
  context: ScoutPrepContext;
  now?: Date;
  meetingTimezone?: string | null;
  senderName?: string | null;
}): VoicemailFollowUpMessageContext {
  return {
    greeting: getGreetingForLocalTime({
      now: args.now,
      meetingTimezone: args.meetingTimezone,
    }),
    recipients: getVoicemailFollowUpRecipients(args.context),
    athleteName: athleteNameFromContext(args.context),
    sport: args.context.resolved.sport || null,
    gradYear: String(args.context.task.grad_year || '').trim() || null,
    senderName: senderNameFromDomain(args.senderName),
  };
}

export function buildClientMessageContext(args: {
  context: ScoutPrepContext;
  senderName?: string | null;
}): {
  athleteName: string;
  sport: string | null;
  gradYear: string | null;
  senderName: string;
} {
  return {
    athleteName: athleteNameFromContext(args.context),
    sport: args.context.resolved.sport || null,
    gradYear: String(args.context.task.grad_year || '').trim() || null,
    senderName: senderNameFromDomain(args.senderName),
  };
}

export { getReminderTimeLabel };
