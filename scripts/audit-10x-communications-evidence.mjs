#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readRows } from '../src/domain/supabase-persistence.ts';
import { normalizeCrmSalesStage } from '../src/domain/supabase-lifecycle-translator.ts';
import {
  CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS,
  CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS,
  buildClientReplyThreadDiagnostics,
  buildClientReplyThemeReviewSnapshot,
  buildClientReplyThemeRunReceipt,
  findPendingClientReplyThemeState,
  interpretClientReplyThreadDiagnostics,
} from '../src/lib/client-message-reply-themes.ts';
import { buildClientMessageThreadEvidenceReceipt } from '../src/lib/client-message-evidence-receipts.ts';
import { buildClientMessageActionProposal } from '../src/lib/client-message-action-proposals.ts';
import {
  buildClientMessageAuditPendingActions,
  buildClientMessageAuditVerificationSummary,
} from '../src/lib/client-message-audit-verification.ts';
import { buildStudentAthleteMessageResolutions } from '../src/lib/student-athlete-message-resolver.ts';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DB_PATH = path.join(os.homedir(), 'Library/Messages/chat.db');
const REPORT_PATH = path.join(REPO_ROOT, 'tmp/10x-communications-evidence-audit.json');
const DEFAULT_SCHEMA = 'public';
const PENDING_CLIENT_LIST_LIMIT = 20;
const PENDING_CLIENT_APPOINTMENT_OUTCOMES = [
  'follow_up',
  'reschedule_pending',
  'no_show',
  'canceled',
];
const ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmation_queued',
  'confirmation_sent',
  'rescheduled',
];
const ACTIVE_REPLACEMENT_POST_MEETING_RESULTS = new Set(['', 'rescheduled']);

function readEnvFile(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .reduce((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return acc;
        const [key, ...rest] = trimmed.split('=');
        acc[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
        return acc;
      }, {});
  } catch {
    return {};
  }
}

function readRepoEnv() {
  return {
    ...readEnvFile(path.join(REPO_ROOT, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.overmind.env')),
  };
}

function getSupabaseConfig() {
  const repoEnv = readRepoEnv();
  const url = String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  ).trim();
  const schema = String(process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || '').trim() || DEFAULT_SCHEMA;
  if (!url || !key) throw new Error('Missing Supabase URL/key for read-only audit.');
  return { url, key, schema };
}

function quotePostgrestInValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function postgrestInList(values) {
  return `(${values.map(quotePostgrestInValue).join(',')})`;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

function hashValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function sqliteJson(sql) {
  const output = execFileSync('sqlite3', ['-readonly', '-json', DB_PATH, sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function decodeHexString(hexString) {
  const bytes = String(hexString || '').match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];
  const startPattern = [0x01, 0x2b];
  const endPattern = [0x86, 0x84];
  let startIndex = -1;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === startPattern[0] && bytes[index + 1] === startPattern[1]) {
      startIndex = index + 2;
      break;
    }
  }
  if (startIndex === -1) return '';
  let endIndex = -1;
  for (let index = startIndex; index < bytes.length - 1; index += 1) {
    if (bytes[index] === endPattern[0] && bytes[index + 1] === endPattern[1]) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) return '';
  const relevantBytes = bytes.slice(startIndex, endIndex);
  let result;
  try {
    result = new TextDecoder().decode(new Uint8Array(relevantBytes));
  } catch {
    result = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(relevantBytes));
  }
  return result.charCodeAt(0) < 128 ? result.slice(1) : result.slice(3);
}

function payloadObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function workflowPayload(row) {
  const payload = payloadObject(row.source_payload);
  const context = payload.workflow_context;
  return context && typeof context === 'object' && !Array.isArray(context) ? context : payload;
}

function payloadText(payload, key) {
  const text = String(payload?.[key] || '').trim();
  return text || null;
}

function pendingClientAppointmentOutcome(row) {
  const postMeetingResult = String(row.post_meeting_result || '').trim();
  if (PENDING_CLIENT_APPOINTMENT_OUTCOMES.includes(postMeetingResult)) return postMeetingResult;
  const status = String(row.status || '').trim();
  return PENDING_CLIENT_APPOINTMENT_OUTCOMES.includes(status) ? status : '';
}

function hasNewerActiveReplacementAppointment(row, activeRowsByAthleteKey) {
  const athleteKey = String(row.athlete_key || '').trim();
  const startsAt = Date.parse(String(row.starts_at || '').trim());
  if (!athleteKey || !Number.isFinite(startsAt)) return false;
  return (activeRowsByAthleteKey.get(athleteKey) || []).some((candidate) => {
    if (String(candidate.id || '').trim() === String(row.id || '').trim()) return false;
    const candidateStartsAt = Date.parse(String(candidate.starts_at || '').trim());
    return Number.isFinite(candidateStartsAt) && candidateStartsAt > startsAt;
  });
}

function groupActiveReplacementAppointmentsByAthleteKey(rows) {
  const byAthleteKey = new Map();
  for (const row of rows) {
    const athleteKey = String(row.athlete_key || '').trim();
    const status = String(row.status || '').trim().toLowerCase();
    const postMeetingResult = String(row.post_meeting_result || '').trim().toLowerCase();
    if (
      !athleteKey ||
      !ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES.includes(status) ||
      !ACTIVE_REPLACEMENT_POST_MEETING_RESULTS.has(postMeetingResult)
    ) {
      continue;
    }
    byAthleteKey.set(athleteKey, [...(byAthleteKey.get(athleteKey) || []), row]);
  }
  return byAthleteKey;
}

function lifecycleStateFromEvent(row) {
  const crmStage = String(row.crm_stage || '').trim();
  const taskStatus = String(row.task_status || '').trim();
  const eventType = String(row.event_type || '').trim();
  const payload = payloadObject(row.payload_json);
  const currentTaskId =
    String(payload.current_task_id || '').trim() ||
    String(payload.task_id || '').trim() ||
    String(payload.selected_task_id || '').trim();
  const currentTaskTitle =
    String(payload.current_task_title || '').trim() ||
    String(payload.task_title || '').trim() ||
    String(payload.selected_task_title || '').trim();
  const normalizedStage = normalizeCrmSalesStage(crmStage || taskStatus || eventType);
  return {
    crm_stage: crmStage || null,
    task_status: taskStatus || null,
    current_task_id: currentTaskId || null,
    current_task_title: currentTaskTitle || null,
    next_action: currentTaskTitle || taskStatus || crmStage || eventType || null,
    is_terminal: ['closed_won', 'closed_lost', 'inactive'].includes(normalizedStage),
    normalized_stage: normalizedStage,
  };
}

async function readPendingAppointments(config) {
  const now = new Date();
  const watchStart = new Date(now);
  watchStart.setUTCDate(watchStart.getUTCDate() - 30);
  const outcomeQuery = PENDING_CLIENT_APPOINTMENT_OUTCOMES.map(quotePostgrestInValue).join(',');
  const appointmentRows = await readRows(config, 'appointments', [
    'select=id,athlete_key,athlete_id,athlete_main_id,head_scout,starts_at,status,source_event_id,meeting_timezone,meeting_timezone_label,post_meeting_result,source_payload,updated_at',
    `or=(post_meeting_result.in.(${outcomeQuery}),status.in.(${outcomeQuery}))`,
    `starts_at=gte.${encodeURIComponent(watchStart.toISOString())}`,
    'order=starts_at.desc',
    `limit=${PENDING_CLIENT_LIST_LIMIT * 2}`,
  ].join('&'));
  const athleteKeys = Array.from(new Set(appointmentRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)));
  const activeRows = athleteKeys.length
    ? await readRows(config, 'appointments', [
        'select=id,athlete_key,starts_at,status,post_meeting_result',
        `athlete_key=in.${postgrestInList(athleteKeys)}`,
        `status=in.${postgrestInList(ACTIVE_REPLACEMENT_APPOINTMENT_STATUSES)}`,
        'order=starts_at.asc',
        `limit=${PENDING_CLIENT_LIST_LIMIT * 4}`,
      ].join('&')).catch(() => [])
    : [];
  const activeByAthleteKey = groupActiveReplacementAppointmentsByAthleteKey(activeRows);
  return appointmentRows
    .filter((row) => !hasNewerActiveReplacementAppointment(row, activeByAthleteKey))
    .slice(0, PENDING_CLIENT_LIST_LIMIT);
}

async function readContactCacheResolutions(config, phones) {
  const normalizedPhones = Array.from(new Set(phones.map(normalizePhone).filter(Boolean)));
  if (!normalizedPhones.length) return [];
  const cacheRows = await readRows(config, 'athlete_contact_cache', [
    'select=athlete_key,athlete_id,athlete_main_id,athlete_name,contact_id,contact_name,relationship_label,phone,normalized_phone,timezone,timezone_label',
    'cache_status=eq.active',
    `normalized_phone=in.${postgrestInList(normalizedPhones)}`,
    'order=last_seen_at.desc',
  ].join('&'));
  const athleteKeys = Array.from(new Set(cacheRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)));
  const lifecycleRows = athleteKeys.length
    ? await readRows(config, 'lifecycle_events', [
        'select=athlete_key,crm_stage,task_status,event_type,payload_json,created_at',
        `athlete_key=in.${postgrestInList(athleteKeys)}`,
        'order=created_at.desc',
      ].join('&')).catch(() => [])
    : [];
  const lifecycleByKey = new Map();
  for (const row of lifecycleRows) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (athleteKey && !lifecycleByKey.has(athleteKey)) lifecycleByKey.set(athleteKey, lifecycleStateFromEvent(row));
  }
  const matches = cacheRows.flatMap((row) => {
    const athleteKey = String(row.athlete_key || '').trim();
    const lifecycle = lifecycleByKey.get(athleteKey);
    if (lifecycle?.is_terminal || lifecycle?.normalized_stage === 'inactive') return [];
    return [{
      athleteKey,
      athleteId: String(row.athlete_id || '').trim(),
      athleteMainId: String(row.athlete_main_id || '').trim(),
      athleteName: String(row.athlete_name || '').trim(),
      contactId: String(row.contact_id || '').trim() || null,
      contactName: String(row.contact_name || '').trim(),
      relationshipLabel: String(row.relationship_label || '').trim() || 'Contact',
      phone: String(row.phone || '').trim() || String(row.normalized_phone || '').trim(),
      normalizedPhone: String(row.normalized_phone || '').trim(),
      crmStage: lifecycle?.crm_stage || null,
      taskStatus: lifecycle?.task_status || null,
      currentTaskId: lifecycle?.current_task_id || null,
      currentTaskTitle: lifecycle?.next_action || null,
      timezone: String(row.timezone || '').trim() || null,
      timezoneLabel: String(row.timezone_label || '').trim() || null,
    }].filter((match) => match.athleteKey && match.athleteId && match.athleteMainId && match.athleteName && match.contactName && match.normalizedPhone);
  });
  return buildStudentAthleteMessageResolutions(matches);
}

function readRecentChats() {
  return sqliteJson(`
    SELECT
      chat.guid,
      chat.chat_identifier,
      MAX(handle.id) as participant_identifier,
      chat.display_name,
      chat.service_name,
      CASE
        WHEN chat.chat_identifier LIKE '%chat%' AND chat.display_name IS NOT NULL AND chat.display_name != ''
        THEN chat.display_name
        ELSE NULL
      END as group_name,
      CASE WHEN COUNT(DISTINCT handle.id) > 1 THEN 1 ELSE 0 END as is_group,
      COUNT(DISTINCT handle.id) as participant_count,
      strftime('%Y-%m-%dT%H:%M:%fZ', datetime(
        MAX(message.date) / 1000000000 + strftime('%s', '2001-01-01'),
        'unixepoch'
      )) AS last_message_date,
      CASE
        WHEN COUNT(DISTINCT handle.id) > 1 THEN GROUP_CONCAT(DISTINCT handle.id)
        ELSE handle.id
      END as group_participants
    FROM chat
    JOIN chat_message_join ON chat."ROWID" = chat_message_join.chat_id
    JOIN message ON chat_message_join.message_id = message."ROWID"
    LEFT JOIN chat_handle_join ON chat."ROWID" = chat_handle_join.chat_id
    LEFT JOIN handle ON chat_handle_join.handle_id = handle."ROWID"
    WHERE handle.id IS NOT NULL
    GROUP BY chat.guid
    ORDER BY last_message_date DESC
    LIMIT 1000;
  `);
}

function chatPhones(chat) {
  const rawParticipants = Number(chat.is_group)
    ? String(chat.group_participants || '').split(',').map((value) => value.trim()).filter(Boolean)
    : [String(chat.participant_identifier || chat.chat_identifier || '').trim()].filter(Boolean);
  return Array.from(new Set(rawParticipants.map(normalizePhone).filter(Boolean)));
}

function readThreadMessages(chatGuid) {
  const escapedGuid = String(chatGuid).replace(/'/g, "''");
  return sqliteJson(`
    SELECT
      message.guid,
      strftime('%Y-%m-%dT%H:%M:%fZ', datetime(
        message.date / 1000000000 + strftime('%s', '2001-01-01'),
        'unixepoch'
      )) AS date,
      message.is_from_me,
      chat.chat_identifier,
      message.text,
      hex(message.attributedBody) as attributed_body_hex,
      message.service
    FROM message
      JOIN chat_message_join ON message."ROWID" = chat_message_join.message_id
      JOIN chat ON chat_message_join.chat_id = chat."ROWID"
    WHERE chat.guid = '${escapedGuid}'
    ORDER BY date DESC
    LIMIT 100;
  `).map((message) => {
    const attributedBody = decodeHexString(message.attributed_body_hex);
    const textBody = String(message.text || '').trim();
    const body = attributedBody || textBody;
    return {
      guid: String(message.guid || ''),
      date: String(message.date || ''),
      isFromMe: Boolean(message.is_from_me),
      body,
      bodySource: attributedBody ? 'attributedBody' : textBody ? 'text' : 'empty',
      senderName: message.is_from_me ? 'Me' : 'Client',
      sender: String(message.chat_identifier || ''),
    };
  });
}

function resolutionToMatch(resolution) {
  return {
    source: 'contact_cache',
    segment: 'client',
    contactId: resolution.contactId,
    athleteMainId: resolution.athleteMainId,
    currentTaskId: resolution.currentTaskId,
    currentTaskTitle: resolution.currentTaskTitle,
    crmStage: resolution.crmStage,
    taskStatus: resolution.taskStatus,
    ambiguity: resolution.ambiguity,
    associatedClientsCount: resolution.associatedContacts?.length || 0,
  };
}

function countDiagnosticMeanings(pendingMatches) {
  const counts = {};
  for (const match of pendingMatches) {
    for (const diagnostic of match.threadDiagnostics || []) {
      const meaning = diagnostic.diagnosticMeaning;
      if (!meaning?.state) continue;
      const current = counts[meaning.state] || {
        count: 0,
        nextHardeningTarget: meaning.nextHardeningTarget,
        interpretation: meaning.interpretation,
      };
      counts[meaning.state] = {
        ...current,
        count: current.count + 1,
      };
    }
  }
  return counts;
}

function countUnmatchedObservations(pendingMatches) {
  const counts = {};
  for (const match of pendingMatches) {
    if (match.matchedReplyEvidence) continue;
    for (const diagnostic of match.threadDiagnostics || []) {
      for (const observationId of diagnostic.diagnostics?.observationIds || []) {
        counts[observationId] = (counts[observationId] || 0) + 1;
      }
    }
  }
  return counts;
}

function countClientLatestUnparsedSignals(pendingMatches) {
  const counts = {};
  for (const match of pendingMatches) {
    if (match.matchedReplyEvidence) continue;
    for (const diagnostic of match.threadDiagnostics || []) {
      if (!String(diagnostic.diagnosticMeaning?.state || '').startsWith('client_latest_unparsed')) {
        continue;
      }
      for (const signal of diagnostic.diagnostics?.latestClientReplySignals || []) {
        counts[signal] = (counts[signal] || 0) + 1;
      }
    }
  }
  return counts;
}

function buildManualReviewTargets(pendingMatches) {
  return pendingMatches.flatMap((match) => {
    if (match.matchedReplyEvidence) return [];
    return (match.threadDiagnostics || [])
      .filter((diagnostic) => diagnostic.diagnosticMeaning?.nextHardeningTarget === 'manual_source_review')
      .map((diagnostic) => ({
        appointmentIdHash: match.appointmentIdHash,
        athleteKeyHash: match.athleteKeyHash,
        outcome: match.outcome,
        chatGuidHash: diagnostic.chatGuidHash,
        lastMessageDate: diagnostic.lastMessageDate,
        reason: diagnostic.diagnosticMeaning.state,
        interpretation: diagnostic.diagnosticMeaning.interpretation,
        observations: diagnostic.diagnostics?.observationIds || [],
        latestClientReplySignals: diagnostic.diagnostics?.latestClientReplySignals || [],
      }));
  });
}

async function main() {
  const config = getSupabaseConfig();
  const generatedAt = new Date().toISOString();
  const pendingAppointments = await readPendingAppointments(config);
  const chats = readRecentChats();
  const phones = Array.from(new Set(chats.flatMap(chatPhones)));
  const resolutions = await readContactCacheResolutions(config, phones);
  const resolutionsByPhone = new Map(resolutions.map((resolution) => [resolution.normalizedPhone, resolution]));
  const matchedChats = chats.flatMap((chat) => {
    const matchedPhones = chatPhones(chat).filter((phone) => resolutionsByPhone.has(phone));
    if (!matchedPhones.length) return [];
    const resolution = resolutionsByPhone.get(matchedPhones[0]);
    return [{ ...chat, matchedPhones, resolution }];
  });
  const sampleChats = matchedChats.slice(0, 100);
  const messagesByChatGuid = Object.fromEntries(
    sampleChats.map((chat) => [
      chat.guid,
      readThreadMessages(chat.guid).map((message) => ({
        guid: message.guid,
        body: message.body,
        date: message.date,
        senderName: message.senderName,
        sender: message.sender,
        isFromMe: message.isFromMe,
      })),
    ]),
  );
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt,
    chats: sampleChats.map((chat) => ({
      guid: chat.guid,
      displayName: chat.resolution.displayName,
      lastMessageDate: chat.last_message_date,
      athleteName: chat.resolution.athleteName,
      contactId: chat.resolution.contactId,
      athleteMainId: chat.resolution.athleteMainId,
      timezone: chat.resolution.timezone,
      timezoneLabel: chat.resolution.timezoneLabel,
      taskTitle: chat.resolution.currentTaskTitle || chat.resolution.taskStatus,
      matchedPhones: chat.matchedPhones,
    })),
    messagesByChatGuid,
  });
  const matchedChatCountsByAthleteMainId = new Map();
  for (const chat of matchedChats) {
    const athleteMainId = String(chat.resolution.athleteMainId || '').trim();
    if (!athleteMainId) continue;
    matchedChatCountsByAthleteMainId.set(
      athleteMainId,
      (matchedChatCountsByAthleteMainId.get(athleteMainId) || 0) + 1,
    );
  }
  const replyThemeCountsByAthleteMainId = new Map();
  for (const row of snapshot.rows) {
    const athleteMainId = String(row.athleteMainId || '').trim();
    if (!athleteMainId) continue;
    replyThemeCountsByAthleteMainId.set(
      athleteMainId,
      (replyThemeCountsByAthleteMainId.get(athleteMainId) || 0) + 1,
    );
  }
  const threadDiagnosticsByAthleteMainId = new Map();
  for (const chat of matchedChats) {
    const athleteMainId = String(chat.resolution.athleteMainId || '').trim();
    if (!athleteMainId) continue;
    const messages =
      messagesByChatGuid[chat.guid] ||
      readThreadMessages(chat.guid).map((message) => ({
        guid: message.guid,
        body: message.body,
        date: message.date,
        senderName: message.senderName,
        sender: message.sender,
        isFromMe: message.isFromMe,
      }));
    const diagnostics = buildClientReplyThreadDiagnostics({
      messages,
      taskTitle: chat.resolution.currentTaskTitle || chat.resolution.taskStatus,
    });
    threadDiagnosticsByAthleteMainId.set(athleteMainId, [
      ...(threadDiagnosticsByAthleteMainId.get(athleteMainId) || []),
      {
        chatGuidHash: hashValue(chat.guid),
        lastMessageDate: String(chat.last_message_date || '').trim() || null,
        diagnostics,
        diagnosticMeaning: interpretClientReplyThreadDiagnostics(diagnostics),
      },
    ]);
  }
  const pendingMatches = pendingAppointments.map((appointment) => {
    const payload = workflowPayload(appointment);
    const athleteMainId = String(appointment.athlete_main_id || '').trim();
    const matchingChatCount = athleteMainId
      ? matchedChatCountsByAthleteMainId.get(athleteMainId) || 0
      : 0;
    const replyThemeCount = athleteMainId
      ? replyThemeCountsByAthleteMainId.get(athleteMainId) || 0
      : 0;
    const pendingInput = {
      athlete_id: appointment.athlete_id,
      athlete_main_id: appointment.athlete_main_id,
      athlete_name: payloadText(payload, 'athlete_name'),
      event_title: payloadText(payload, 'meeting_title_current') || payloadText(payload, 'meeting_title_base'),
    };
    const replyState = findPendingClientReplyThemeState(pendingInput, snapshot);
    if (!replyState) {
      return {
        appointmentIdHash: hashValue(appointment.id),
        athleteKeyHash: hashValue(appointment.athlete_key),
        outcome: pendingClientAppointmentOutcome(appointment),
        matchingChatCount,
        replyThemeCount,
        threadDiagnostics: (threadDiagnosticsByAthleteMainId.get(athleteMainId) || []).slice(0, 3),
        unmatchedReason: matchingChatCount
          ? replyThemeCount
            ? 'reply_theme_did_not_match_pending_client'
            : 'no_actionable_reply_theme'
          : 'no_contact_cache_admitted_message_thread',
        matchedReplyEvidence: false,
      };
    }
    const chat = sampleChats.find((candidate) => candidate.guid === replyState.row.chatGuid);
    const threadMessages = readThreadMessages(replyState.row.chatGuid);
    const threadReceipt = buildClientMessageThreadEvidenceReceipt({
      generatedAt,
      chat: {
        guid: replyState.row.chatGuid,
        serviceName: chat?.service_name || 'iMessage',
        isGroup: Boolean(chat?.is_group),
        participantCount: Number(chat?.participant_count || replyState.row.matchedPhones.length || 1),
        matchedPhones: replyState.row.matchedPhones,
        clientMatch: resolutionToMatch(chat?.resolution || {
          ...replyState.row,
          source: 'contact_cache',
          segment: 'client',
          ambiguity: 'none',
          associatedContacts: [],
        }),
      },
      messages: threadMessages,
    });
    const classifierReceipt = buildClientReplyThemeRunReceipt(replyState.row, { generatedAt });
    const proposal = buildClientMessageActionProposal({
      generatedAt,
      threadReceipt,
      classifierReceipt,
    });
    return {
      appointmentIdHash: hashValue(appointment.id),
      athleteKeyHash: hashValue(appointment.athlete_key),
      outcome: pendingClientAppointmentOutcome(appointment),
      matchingChatCount,
      replyThemeCount,
      matchedReplyEvidence: true,
      replyState: replyState.status,
      threadReceipt,
      classifierReceipt,
      proposal,
    };
  });
  const counts = {
    pendingAppointments: pendingAppointments.length,
    messagesChatsScanned: chats.length,
    contactCacheResolutions: resolutions.length,
    matchedChats: matchedChats.length,
    sampledMatchedChats: sampleChats.length,
    replyThemeRows: snapshot.rows.length,
    replyThemeNearMisses: snapshot.nearMisses.length,
    pendingClientReplyMatches: pendingMatches.filter((match) => match.matchedReplyEvidence).length,
    pendingClientReviewReplies: pendingMatches.filter((match) => match.replyState === 'client_replied_after_times').length,
  };
  const diagnosticMeaningCounts = countDiagnosticMeanings(pendingMatches);
  const unmatchedObservationCounts = countUnmatchedObservations(pendingMatches);
  const clientLatestUnparsedSignalCounts = countClientLatestUnparsedSignals(pendingMatches);
  const manualReviewTargets = buildManualReviewTargets(pendingMatches);
  const pendingActions = buildClientMessageAuditPendingActions(pendingMatches);
  const report = {
    version: 1,
    flow: '10x_communications',
    step: 'audit-live-evidence-read-only',
    generatedAt,
    sourceSurfaces: ['appointments', 'athlete_contact_cache', 'lifecycle_events', 'local_messages_sql'],
    counts,
    diagnosticMeaningCounts,
    unmatchedObservationCounts,
    clientLatestUnparsedSignalCounts,
    manualReviewTargets,
    pendingActions,
    verificationSummary: buildClientMessageAuditVerificationSummary({
      counts,
      pendingActions,
      manualReviewTargets,
      diagnosticMeaningCounts,
      unmatchedObservationCounts,
      clientLatestUnparsedSignalCounts,
    }),
    evidenceGlossary: {
      observations: CLIENT_REPLY_EVIDENCE_OBSERVATION_DEFINITIONS,
      latestClientSignals: CLIENT_REPLY_LATEST_CLIENT_SIGNAL_DEFINITIONS,
    },
    pendingMatches,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    reportPath: path.relative(REPO_ROOT, REPORT_PATH),
    counts: report.counts,
    diagnosticMeaningCounts: report.diagnosticMeaningCounts,
    unmatchedObservationCounts: report.unmatchedObservationCounts,
    clientLatestUnparsedSignalCounts: report.clientLatestUnparsedSignalCounts,
    manualReviewTargets: report.manualReviewTargets,
    verificationSummary: report.verificationSummary,
    pendingActions: report.pendingActions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
