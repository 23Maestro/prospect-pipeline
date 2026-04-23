import { Action, ActionPanel, Detail, Icon, Toast, showToast } from '@raycast/api';
import { useState } from 'react';
import {
  writeClientMessageExport,
  type ClientMessageExportPayload,
} from './lib/client-message-export';

function buildMarkdown(
  payload?: ClientMessageExportPayload | null,
  exportPath?: string | null,
): string {
  if (!payload) {
    return [
      '# Client Message Inbox Export',
      '',
      'This prepares the local JSON artifact consumed by the focused Messages sandbox.',
      '',
      '## Output',
      exportPath || 'Pending export path',
      '',
      '## Record Shape',
      '- `contactId`',
      '- `athleteMainId`',
      '- `athleteName`',
      '- `normalizedPhoneNumbers[]`',
      '- `associatedClients[]`',
      '  - `role` (`studentAthlete`, `parent1`, `parent2`)',
      '  - `name`',
      '  - `relationshipLabel`',
      '  - `displayLabel`',
      '  - `normalizedPhoneNumber`',
      '- `crmStage`',
      '- `taskStatus`',
      '- `currentTaskTitle`',
      '- `segment` (`client` or `pending`)',
    ].join('\n');
  }

  const previewRows = payload.rows.slice(0, 8);

  return [
    '# Client Message Inbox Export',
    '',
    `- Generated: ${payload.generatedAt}`,
    `- Rows: ${payload.rows.length}`,
    `- Path: ${exportPath || 'n/a'}`,
    '',
    '## Preview',
    ...previewRows.map(
      (row) =>
        `- ${row.athleteName} | ${row.segment} | ${row.taskStatus || 'n/a'} | ${row.associatedClients
          .map((client) => client.displayLabel)
          .join(' | ')}`,
    ),
  ].join('\n');
}

export default function ExportClientMessageInboxCommand() {
  const [payload, setPayload] = useState<ClientMessageExportPayload | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleExport() {
    setIsLoading(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Preparing client inbox export',
    });

    try {
      const result = await writeClientMessageExport();
      setPayload(result.payload);
      setExportPath(result.path);
      toast.style = Toast.Style.Success;
      toast.title = 'Client inbox export ready';
      toast.message = `${result.payload.rows.length} rows • ${result.path}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Client inbox export failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Detail
      navigationTitle="Export Client Message Inbox"
      markdown={buildMarkdown(payload, exportPath)}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action title="Run Export" icon={Icon.Upload} onAction={() => void handleExport()} />
        </ActionPanel>
      }
    />
  );
}
