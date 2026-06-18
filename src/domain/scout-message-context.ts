import type { ScoutPrepContext, ScoutPortalTask } from '../features/scout-prep/types';
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

export type ScoutPrepMessageContactCacheRow = {
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  relationship_label?: string | null;
  phone?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
  payload_json?: Record<string, unknown> | null;
};

function athleteNameFromContext(context: ScoutPrepContext): string {
  return context.contactInfo.studentAthlete.name || context.task.athlete_name || '';
}

function senderNameFromDomain(value?: string | null): string {
  return String(value || '').trim() || getActiveOperator().senderName;
}

function text(value?: unknown): string {
  return String(value || '').trim();
}

function contactRole(row: ScoutPrepMessageContactCacheRow): string {
  const payload = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
  return text(payload.role || row.relationship_label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function contactRelationship(row: ScoutPrepMessageContactCacheRow, fallback: string): string {
  const payload = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
  return text(payload.manual_relationship_label || row.relationship_label) || fallback;
}

export function buildLightweightScoutPrepContextForMessages(args: {
  task: ScoutPortalTask;
  contactRows: ScoutPrepMessageContactCacheRow[];
}): ScoutPrepContext {
  const athleteName =
    text(args.task.athlete_name) ||
    text(args.contactRows.find((row) => text(row.athlete_name))?.athlete_name);
  const athleteId =
    text(args.task.athlete_id || args.task.contact_id) ||
    text(args.contactRows.find((row) => text(row.athlete_id))?.athlete_id);
  const athleteMainId =
    text(args.task.athlete_main_id) ||
    text(args.contactRows.find((row) => text(row.athlete_main_id))?.athlete_main_id);
  const contactId =
    text(args.contactRows.find((row) => text(row.contact_id))?.contact_id) || athleteId;
  const timezone = text(args.contactRows.find((row) => text(row.timezone))?.timezone) || null;
  const timezoneLabel =
    text(args.contactRows.find((row) => text(row.timezone_label))?.timezone_label) || null;

  const studentRow =
    args.contactRows.find((row) => contactRole(row) === 'studentathlete') ||
    args.contactRows.find((row) => contactRole(row) === 'student_athlete') ||
    null;
  const parentRows = args.contactRows.filter((row) => {
    const role = contactRole(row);
    return (
      role === 'parent1' ||
      role === 'parent_1' ||
      role === 'parent2' ||
      role === 'parent_2' ||
      role === 'manual_additional_contact'
    );
  });
  const parent1 =
    parentRows.find((row) => ['parent1', 'parent_1'].includes(contactRole(row))) ||
    parentRows[0] ||
    null;
  const parent2 =
    parentRows.find(
      (row) =>
        ['parent2', 'parent_2', 'manual_additional_contact'].includes(contactRole(row)) &&
        row !== parent1,
    ) ||
    parentRows.find((row) => row !== parent1) ||
    null;

  return {
    task: {
      ...args.task,
      contact_id: contactId || args.task.contact_id,
      athlete_id: athleteId || args.task.athlete_id,
      athlete_main_id: athleteMainId || args.task.athlete_main_id,
      athlete_name: athleteName || args.task.athlete_name,
    },
    resolved: {
      athlete_id: athleteId || args.task.athlete_id || args.task.contact_id || null,
      athlete_main_id: athleteMainId || args.task.athlete_main_id || null,
      sport: args.task.sport || null,
      high_school: args.task.high_school || null,
      city: args.task.city || null,
      state: args.task.state || null,
      timezone,
      timezone_label: timezoneLabel,
      head_scout: null,
      scouting_coordinator: null,
    },
    contactInfo: {
      contactId: contactId || args.task.contact_id,
      studentAthlete: {
        name: text(studentRow?.contact_name) || athleteName || args.task.athlete_name,
        email: null,
        phone: text(studentRow?.phone) || null,
      },
      parent1: parent1
        ? {
            name: text(parent1.contact_name),
            relationship: contactRelationship(parent1, 'Parent 1'),
            email: null,
            phone: text(parent1.phone) || null,
          }
        : null,
      parent2: parent2
        ? {
            name: text(parent2.contact_name),
            relationship: contactRelationship(parent2, 'Parent 2'),
            email: null,
            phone: text(parent2.phone) || null,
          }
        : null,
    },
    notes: [],
    tasks: [],
  };
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
