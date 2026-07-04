import { Action, ActionPanel, Color, List } from '@raycast/api';
import { useMemo, useState } from 'react';

type DemoRowStatus = 'ready' | 'pending-send' | 'needs-review' | 'sending' | 'sent';

type DemoRow = {
  id: string;
  athleteName: string;
  gradYear: string;
  recipient: string;
  status: DemoRowStatus;
};

const INITIAL_ROWS: DemoRow[] = [
  {
    id: 'jordan-blake',
    athleteName: 'Jordan Blake',
    gradYear: '2030',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'marcus-reed',
    athleteName: 'Marcus Reed',
    gradYear: '2028',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'eli-carter',
    athleteName: 'Eli Carter',
    gradYear: '2026',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'caleb-monroe',
    athleteName: 'Caleb Monroe',
    gradYear: '2029',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'isaiah-brooks',
    athleteName: 'Isaiah Brooks',
    gradYear: '2027',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'nolan-pierce',
    athleteName: 'Nolan Pierce',
    gradYear: '2030',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'andre-hayes',
    athleteName: 'Andre Hayes',
    gradYear: '2029',
    recipient: 'Parent 2',
    status: 'ready',
  },
  {
    id: 'miles-grant',
    athleteName: 'Miles Grant',
    gradYear: '2027',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'cameron-ellis',
    athleteName: 'Cameron Ellis',
    gradYear: '2028',
    recipient: 'Parent 1',
    status: 'ready',
  },
  {
    id: 'tyler-vaughn',
    athleteName: 'Tyler Vaughn',
    gradYear: '2030',
    recipient: 'Parent 1',
    status: 'ready',
  },
];

const REVIEW_RESULT_IDS = new Set(['miles-grant', 'cameron-ellis', 'tyler-vaughn']);
const INITIAL_ROW_ORDER = new Map(INITIAL_ROWS.map((row, index) => [row.id, index]));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusLabel(status: DemoRowStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'pending-send':
      return 'Pending Send';
    case 'needs-review':
      return 'Needs Review';
    case 'sending':
      return 'Sending';
    case 'sent':
      return 'Sent';
  }
}

function statusColor(status: DemoRowStatus): Color {
  switch (status) {
    case 'sent':
      return Color.Green;
    case 'sending':
      return Color.Blue;
    case 'ready':
      return Color.Yellow;
    case 'pending-send':
      return Color.Orange;
    case 'needs-review':
      return Color.Red;
  }
}

function gradYearColor(gradYear: string): Color {
  switch (gradYear) {
    case '2026':
      return Color.Red;
    case '2027':
      return Color.Purple;
    case '2028':
      return Color.Blue;
    case '2029':
      return Color.Green;
    case '2030':
      return Color.Magenta;
    default:
      return Color.SecondaryText;
  }
}

function completedBatchSort(left: DemoRow, right: DemoRow): number {
  const statusRank = (status: DemoRowStatus) => {
    if (status === 'sent') return 0;
    if (status === 'needs-review') return 1;
    return 2;
  };
  const statusDiff = statusRank(left.status) - statusRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  return (INITIAL_ROW_ORDER.get(left.id) || 0) - (INITIAL_ROW_ORDER.get(right.id) || 0);
}

export default function BatchOutreachQueueCommand() {
  const [rows, setRows] = useState<DemoRow[]>(INITIAL_ROWS);
  const [isRunning, setIsRunning] = useState(false);

  const counts = useMemo(
    () => ({
      ready: rows.filter((row) => row.status === 'ready').length,
      sending: rows.filter((row) => row.status === 'sending').length,
      sent: rows.filter((row) => row.status === 'sent').length,
      pendingSend: rows.filter((row) => row.status === 'pending-send').length,
      needsReview: rows.filter((row) => row.status === 'needs-review').length,
    }),
    [rows],
  );

  async function runSelectedBatch() {
    if (isRunning || counts.ready === 0) return;

    setIsRunning(true);
    const selectedReadyIds = rows
      .filter((row) => row.status === 'ready')
      .map((row) => row.id);

    for (const rowId of selectedReadyIds) {
      setRows((current) =>
        current.map((row) => (row.id === rowId ? { ...row, status: 'sending' } : row)),
      );

      await wait(320);

      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                recipient: REVIEW_RESULT_IDS.has(row.id) ? 'Review' : row.recipient,
                status: REVIEW_RESULT_IDS.has(row.id) ? 'needs-review' : 'sent',
              }
            : row,
        ),
      );

      await wait(160);
    }

    await wait(450);
    setRows((current) => [...current].sort(completedBatchSort));
    setIsRunning(false);
  }

  function resetDemo() {
    if (isRunning) return;
    setRows(INITIAL_ROWS);
  }

  return (
    <List
      navigationTitle="Auto CRM Updates"
      searchBarPlaceholder="Review Auto CRM Updates"
    >
      <List.Section
        title={`${counts.ready} Ready / ${counts.sending} Sending / ${counts.sent} Sent`}
        subtitle={`${counts.pendingSend} Pending Send / ${counts.needsReview} Needs Review`}
      >
        {rows.map((row) => (
          <List.Item
            key={row.id}
            id={row.id}
            icon="⭐"
            title={row.athleteName}
            subtitle={row.recipient}
            accessories={[
              { tag: { value: row.gradYear, color: gradYearColor(row.gradYear) } },
              { tag: { value: statusLabel(row.status), color: statusColor(row.status) } },
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={`Send ${counts.ready} Pending`}
                  icon="💬"
                  onAction={() => void runSelectedBatch()}
                />
                <Action title="Refresh Scout Tasks" icon="🔄" onAction={resetDemo} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
