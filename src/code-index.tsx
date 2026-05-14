import { Action, ActionPanel, Clipboard, Icon, List, Toast, showToast } from '@raycast/api';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { useMemo, useState } from 'react';
import generatedRecords from './generated/code-index.generated.json';

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const GENERATED_PATH = join(REPO_ROOT, 'src/generated/code-index.generated.json');
const GENERATOR_PATH = join(REPO_ROOT, 'scripts/generate-code-index.mjs');

type CodeIndexKind = 'function' | 'route' | 'api_call';

type CodeIndexRecord = {
  id: string;
  kind: CodeIndexKind;
  name: string;
  file: string;
  line: number;
  system: string;
  bucket: string;
  exported: boolean;
  tags: string[];
  method?: string;
  path?: string;
  snippet?: string;
  signature?: string;
};

type FilterValue = 'all' | 'function' | 'route' | 'api_call' | 'scripts' | 'tests';

const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'All',
  function: 'Functions',
  route: 'Routes',
  api_call: 'API Calls',
  scripts: 'Scripts',
  tests: 'Tests',
};

const SYSTEM_ORDER = ['Raycast', 'Domain', 'FastAPI', 'Scripts', 'Vercel'];

function absolutePath(record: CodeIndexRecord) {
  return join(REPO_ROOT, record.file);
}

function recordMatchesFilter(record: CodeIndexRecord, filter: FilterValue) {
  if (filter === 'all') return true;
  if (filter === 'scripts') return record.system === 'Scripts';
  if (filter === 'tests') return record.tags.includes('test') || record.file.includes('.test.');
  return record.kind === filter;
}

function kindLabel(record: CodeIndexRecord) {
  if (record.kind === 'api_call') return 'API';
  if (record.kind === 'route') return 'Route';
  return 'Function';
}

function kindIcon(record: CodeIndexRecord) {
  if (record.kind === 'api_call') return Icon.Globe;
  if (record.kind === 'route') return Icon.Network;
  return Icon.Code;
}

function markdownEscape(value?: string) {
  return String(value || '').replace(/`/g, '\\`');
}

function buildMarkdown(record: CodeIndexRecord) {
  const location = `${record.file}:${record.line}`;
  const tags = record.tags.length ? record.tags.join(', ') : 'none';
  const route =
    record.method && record.path ? `\n- Route: \`${record.method} ${record.path}\`` : '';
  const signature = record.signature || record.snippet || '';

  return `# ${markdownEscape(record.name)}

- Location: \`${markdownEscape(location)}\`
- System: \`${markdownEscape(record.system)}\`
- Bucket: \`${markdownEscape(record.bucket)}\`
- Kind: \`${kindLabel(record)}\`
- Exported: \`${record.exported ? 'yes' : 'no'}\`
- Tags: \`${markdownEscape(tags)}\`${route}

## Code

\`\`\`
${signature}
\`\`\`
`;
}

function markdownReference(record: CodeIndexRecord) {
  return `${record.name} - ${record.file}:${record.line}`;
}

async function copyWithToast(value: string, title: string) {
  await Clipboard.copy(value);
  await showToast({ style: Toast.Style.Success, title });
}

async function refreshIndex() {
  await execFileAsync(process.execPath, [GENERATOR_PATH], { cwd: REPO_ROOT });
  const text = await readFile(GENERATED_PATH, 'utf8');
  return JSON.parse(text) as CodeIndexRecord[];
}

export default function CodeIndexCommand() {
  const [records, setRecords] = useState<CodeIndexRecord[]>(generatedRecords as CodeIndexRecord[]);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const visibleRecords = useMemo(
    () => records.filter((record) => recordMatchesFilter(record, filter)),
    [records, filter],
  );

  const recordsBySystem = useMemo(() => {
    const grouped = new Map<string, CodeIndexRecord[]>();
    for (const record of visibleRecords) {
      const group = record.system || 'Other';
      grouped.set(group, [...(grouped.get(group) || []), record]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => {
      const aIndex = SYSTEM_ORDER.indexOf(a);
      const bIndex = SYSTEM_ORDER.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (
          (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
          (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
        );
      }
      return a.localeCompare(b);
    });
  }, [visibleRecords]);

  const runRefresh = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Refreshing' });
    setIsRefreshing(true);
    try {
      const nextRecords = await refreshIndex();
      setRecords(nextRecords);
      toast.style = Toast.Style.Success;
      toast.title = 'Refreshed';
      toast.message = `${nextRecords.length} records`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Refresh failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <List
      isLoading={isRefreshing}
      isShowingDetail
      navigationTitle="Code Index"
      searchBarPlaceholder="Search functions, routes, files, tags..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter"
          value={filter}
          onChange={(value) => setFilter(value as FilterValue)}
        >
          {(Object.keys(FILTER_LABELS) as FilterValue[]).map((value) => (
            <List.Dropdown.Item key={value} title={FILTER_LABELS[value]} value={value} />
          ))}
        </List.Dropdown>
      }
    >
      {recordsBySystem.map(([system, systemRecords]) => (
        <List.Section key={system} title={system} subtitle={`${systemRecords.length}`}>
          {systemRecords.map((record) => (
            <List.Item
              key={record.id}
              icon={kindIcon(record)}
              title={record.name}
              subtitle={`${record.bucket} - ${record.file}:${record.line}`}
              keywords={[
                record.file,
                record.bucket,
                record.system,
                record.path || '',
                ...record.tags,
              ]}
              accessories={[
                { text: kindLabel(record) },
                ...(record.exported ? [{ tag: 'exported' }] : []),
                ...(record.method ? [{ tag: record.method }] : []),
              ]}
              detail={<List.Item.Detail markdown={buildMarkdown(record)} />}
              actions={
                <ActionPanel>
                  <Action.Open title="Open File" icon={Icon.Code} target={absolutePath(record)} />
                  <Action
                    title="Copy Markdown Reference"
                    icon={Icon.Clipboard}
                    onAction={() => copyWithToast(markdownReference(record), 'Copied')}
                  />
                  <Action
                    title="Copy Path"
                    icon={Icon.Finder}
                    onAction={() => copyWithToast(`${record.file}:${record.line}`, 'Copied path')}
                  />
                  <Action
                    title="Copy Symbol"
                    icon={Icon.Text}
                    onAction={() => copyWithToast(record.name, 'Copied symbol')}
                  />
                  <Action title="Refresh Index" icon={Icon.ArrowClockwise} onAction={runRefresh} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      <List.EmptyView title="No records" />
    </List>
  );
}
