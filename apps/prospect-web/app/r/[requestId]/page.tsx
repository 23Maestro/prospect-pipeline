import { validateParentResponseRequest } from '../../../lib/parent-response';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ requestId: string }> | { requestId: string };
  searchParams?: Promise<{ token?: string }> | { token?: string };
};

function asText(value: unknown): string {
  return String(value || '').trim();
}

export default async function ParentResponsePage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestId = asText(resolvedParams.requestId);
  const token = asText(resolvedSearchParams.token);
  const validation = await validateParentResponseRequest({ requestId, token });

  if (!validation.ok) {
    return (
      <main>
        <h1>Link unavailable</h1>
        <p>{validation.error}</p>
      </main>
    );
  }

  const row = validation.row;

  return (
    <main>
      <h1>Pick a new meeting time</h1>
      <p>{row.athlete_name}</p>
      <form method="post" action={`/api/parent-response/${encodeURIComponent(requestId)}/submit`}>
        <input type="hidden" name="token" value={token} />
        {row.proposed_options.map((option) => (
          <button key={option.option_id} type="submit" name="option_id" value={option.option_id}>
            {option.display_label}
          </button>
        ))}
        <button type="submit" name="response_kind" value="none_work">
          None of these work
        </button>
        <button type="submit" name="response_kind" value="ready_later">
          We will follow up when ready
        </button>
      </form>
    </main>
  );
}
