import { validateParentResponseRequest } from '../../../lib/parent-response';
import ParentResponseForm from './ParentResponseForm';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ requestId: string }> | { requestId: string };
  searchParams?: Promise<{ token?: string }> | { token?: string };
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

function formattedOriginalTime(value?: string | null) {
  const text = asText(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export default async function ParentResponsePage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestId = asText(resolvedParams.requestId);
  const token = asText(resolvedSearchParams.token);
  const validation = await validateParentResponseRequest({ requestId, token });

  if (!validation.ok) {
    return (
      <main className="parent-response-shell parent-response-shell-centered">
        <section className="parent-response-card parent-response-card-small">
          <img src="/prospect-id-shield.svg" alt="" className="parent-response-mark" />
          <h1>Link unavailable</h1>
          <p>{validation.error}</p>
        </section>
      </main>
    );
  }

  const row = validation.row;
  const originalTime = formattedOriginalTime(row.original_meeting_starts_at);
  const options = row.proposed_options.slice(0, 3);

  return (
    <main className="parent-response-shell">
      <section className="parent-response-card">
        <header className="parent-response-header">
          <img src="/prospect-id-shield.svg" alt="" className="parent-response-mark" />
          <div>
            <p className="parent-response-status-label">Prospect ID</p>
            <h1>Reschedule pending</h1>
            <p className="parent-response-athlete-name">{row.athlete_name}</p>
          </div>
        </header>

        <section className="parent-response-summary" aria-label="Meeting summary">
          <div>
            <span>Head scout</span>
            <strong>{row.original_head_scout_name || 'Scout Prep'}</strong>
          </div>
          {originalTime ? (
            <div>
              <span>Original time</span>
              <strong>{originalTime}</strong>
            </div>
          ) : null}
        </section>

        <section className="parent-response-copy">
          <h2>Choose the best new time.</h2>
          <p>
            Pick one suggested time below. If these times do not fit, send the follow-up option and
            we will coordinate the next step.
          </p>
        </section>

        <ParentResponseForm requestId={requestId} token={token} options={options} />
      </section>
    </main>
  );
}
