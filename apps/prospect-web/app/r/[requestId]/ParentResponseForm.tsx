'use client';

import { useMemo, useState } from 'react';
import type { ParentResponseOption } from '../../../lib/parent-response';

type ParentResponseFormProps = {
  requestId: string;
  token: string;
  options: ParentResponseOption[];
};

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting'; label: string }
  | { status: 'sent'; label: string }
  | { status: 'error'; message: string };

function asText(value: unknown): string {
  return String(value || '').trim();
}

function buttonLabel(option: ParentResponseOption, index: number): string {
  return asText(option.display_label) || `Option ${index + 1}`;
}

export default function ParentResponseForm({ requestId, token, options }: ParentResponseFormProps) {
  const visibleOptions = useMemo(() => options.slice(0, 3), [options]);
  const [state, setState] = useState<SubmitState>({ status: 'idle' });

  async function submitChoice(payload: Record<string, string>, label: string) {
    setState({ status: 'submitting', label });
    try {
      const response = await fetch(`/api/parent-response/${encodeURIComponent(requestId)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token, ...payload }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || `Could not save response (${response.status})`);
      }
      setState({ status: 'sent', label });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (state.status === 'sent') {
    return (
      <section className="parent-response-confirmation" aria-live="polite">
        <div className="parent-response-check" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="m5.25 12.35 4.25 4.15 9.25-9" />
          </svg>
        </div>
        <h2>Response received</h2>
        <p>
          We have your update. A coordinator will review it and follow up with the next step.
        </p>
        <p className="parent-response-confirmation-choice">{state.label}</p>
      </section>
    );
  }

  return (
    <form className="parent-response-form" onSubmit={(event) => event.preventDefault()}>
      <input type="hidden" name="token" value={token} />
      <div className="parent-response-options" role="group" aria-label="Suggested meeting times">
        {visibleOptions.map((option, index) => {
          const label = buttonLabel(option, index);
          return (
            <button
              key={option.option_id}
              className="parent-response-option"
              type="button"
              disabled={state.status === 'submitting'}
              onClick={() => submitChoice({ option_id: option.option_id }, label)}
            >
              <span className="parent-response-option-index">{index + 1}</span>
              <span>{label}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          );
        })}
      </div>

      <button
        className="parent-response-fallback"
        type="button"
        disabled={state.status === 'submitting'}
        onClick={() =>
          submitChoice(
            {
              response_kind: 'ready_later',
              parent_note: 'None of the suggested times work. Family will follow up when ready.',
            },
            'None of these work. We will follow up when ready.',
          )
        }
      >
        None of these work. We&apos;ll follow up when ready.
      </button>

      {state.status === 'submitting' ? (
        <p className="parent-response-status" aria-live="polite">
          Saving {state.label}...
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="parent-response-error" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
