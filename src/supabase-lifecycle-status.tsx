import { Action, ActionPanel, Detail, Icon, Toast, showToast } from '@raycast/api';
import { useEffect, useState } from 'react';
import { getLifecycleHealthSnapshot, type LifecycleHealthSnapshot } from './lib/supabase-lifecycle';

function formatTimestamp(value?: string | null): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'n/a';
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toLocaleString();
}

function buildMarkdown(snapshot: LifecycleHealthSnapshot | null, error?: string | null): string {
  if (error) {
    return `# Supabase Lifecycle Status\n\n## Error\n\n${error}`;
  }

  if (!snapshot) {
    return '# Supabase Lifecycle Status\n\nLoading…';
  }

  if (!snapshot.enabled) {
    return [
      '# Supabase Lifecycle Status',
      '',
      '## Config',
      '',
      'Supabase prefs are not set in Raycast for this extension.',
      '',
      'Set:',
      '- Supabase URL',
      '- Supabase Secret Key',
      '- Supabase Schema',
    ].join('\n');
  }

  const lines: string[] = [
    '# Supabase Lifecycle Status',
    '',
    '## Config',
    '',
    `- URL: ${snapshot.config?.url || 'n/a'}`,
    `- Schema: ${snapshot.config?.schema || 'n/a'}`,
    '',
      `## Lifecycle Current Projection (${snapshot.stateRows.length})`,
    '',
  ];

  if (!snapshot.stateRows.length) {
    lines.push('No current lifecycle projection rows yet.', '');
  } else {
    for (const row of snapshot.stateRows) {
      lines.push(
        `- ${row.athlete_name || `${row.crm_stage || 'Unknown'} athlete`} | stage: ${row.crm_stage || 'n/a'} | status: ${row.task_status || 'n/a'} | appointment: ${row.current_appointment_id || 'n/a'} | updated: ${formatTimestamp(row.updated_at)}`,
      );
    }
    lines.push('');
  }

  lines.push(`## Lifecycle Events (${snapshot.eventRows.length})`, '');
  if (!snapshot.eventRows.length) {
    lines.push('No `lifecycle_events` rows yet.', '');
  } else {
    for (const row of snapshot.eventRows) {
      lines.push(
        `- ${row.event_type} | stage: ${row.crm_stage || 'n/a'} | status: ${row.task_status || 'n/a'} | athlete: ${row.athlete_id}/${row.athlete_main_id} | at: ${formatTimestamp(row.created_at)}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default function SupabaseLifecycleStatusCommand() {
  const [snapshot, setSnapshot] = useState<LifecycleHealthSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const next = await getLifecycleHealthSnapshot();
      setSnapshot(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      await showToast({
        style: Toast.Style.Failure,
        title: 'Supabase lifecycle check failed',
        message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="Supabase Lifecycle Status"
      markdown={buildMarkdown(snapshot, error)}
      actions={
        <ActionPanel>
          <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => void load()} />
        </ActionPanel>
      }
    />
  );
}
