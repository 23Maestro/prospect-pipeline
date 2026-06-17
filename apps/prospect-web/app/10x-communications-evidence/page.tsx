'use client';

import { useEffect, useMemo, useState } from 'react';

type EvidenceBundle = {
  version?: number;
  flow?: string;
  step?: string;
  generatedAt?: string;
  title?: string | null;
  proposal?: {
    action?: string;
    mutationResult?: string;
    humanApprovalRequired?: boolean;
    confidence?: string;
    reason?: string;
    suggestedMutationTargets?: string[];
    requiredPreflightChecks?: string[];
  };
  messagesSqlEvidence?: {
    admission?: {
      admittedBy?: string;
      ambiguity?: string;
      matchedPhonesCount?: number;
      associatedClientsCount?: number;
    };
    thread?: {
      serviceName?: string;
      totalMessages?: number;
      inboundCount?: number;
      outboundCount?: number;
      decodedAttributedBodyCount?: number;
      firstMessageAt?: string | null;
      lastMessageAt?: string | null;
    };
    direction?: {
      operatorSentLatestMessage?: boolean;
      clientSentLatestMessage?: boolean;
    };
    context?: {
      taskStatus?: string | null;
      currentTaskTitle?: string | null;
      crmStage?: string | null;
    };
  };
  replyClassification?: {
    direction?: {
      operatorRepliedAfterInbound?: boolean;
      operatorReplyProposedTimes?: boolean;
    };
    classifier?: {
      theme?: string;
      templateContext?: string;
      themeBucket?: string;
      clientOptedOut?: boolean;
    };
    operatorAction?: string;
    evidenceMeaning?: {
      interpretation?: string;
      requiredEvidence?: string[];
    };
  };
};

function decodePayload(hash: string): EvidenceBundle | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const payload = params.get('payload');
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as EvidenceBundle;
  } catch {
    return null;
  }
}

function titleCase(value?: string | null): string {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function boolLabel(value?: boolean): string {
  return value ? 'Yes' : 'No';
}

function Fact({ label, value }: { label: string; value?: string | number | boolean | null }) {
  return (
    <div className="tenx-fact">
      <span>{label}</span>
      <strong>{typeof value === 'boolean' ? boolLabel(value) : value || 'None'}</strong>
    </div>
  );
}

function ChipList({ values }: { values?: string[] }) {
  if (!values?.length) return <span className="tenx-muted">None</span>;
  return (
    <div className="tenx-chip-list">
      {values.map((value) => (
        <span key={value} className="tenx-chip">
          {titleCase(value)}
        </span>
      ))}
    </div>
  );
}

type FlowStep = {
  eyebrow: string;
  title: string;
  detail: string;
  state?: 'source' | 'meaning' | 'decision' | 'gate' | 'target';
};

function FlowStrip({ steps }: { steps: FlowStep[] }) {
  return (
    <section className="tenx-flow" aria-label="Evidence decision flow">
      {steps.map((step, index) => (
        <div className="tenx-flow-item" key={`${step.eyebrow}:${step.title}`}>
          <article className={`tenx-flow-node tenx-flow-node-${step.state || 'source'}`}>
            <span>{step.eyebrow}</span>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </article>
          {index < steps.length - 1 ? <div className="tenx-flow-arrow" aria-hidden="true" /> : null}
        </div>
      ))}
    </section>
  );
}

export default function TenXCommunicationsEvidencePage() {
  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setBundle(decodePayload(window.location.hash));
    setLoaded(true);
  }, []);

  const proposal = bundle?.proposal;
  const sql = bundle?.messagesSqlEvidence;
  const reply = bundle?.replyClassification;
  const outcome = useMemo(() => {
    if (!proposal) return 'No evidence loaded';
    if (proposal.action === 'await_client') return 'Wait for client reply';
    if (proposal.action === 'offer_reschedule_slots') return 'Offer reschedule slots';
    if (proposal.action === 'review_reschedule_reply') return 'Review client slot reply';
    if (proposal.action === 'send_first_contact_reply') return 'Reply to first contact';
    return titleCase(proposal.action);
  }, [proposal]);
  const flowSteps = useMemo<FlowStep[]>(() => {
    const admittedBy = titleCase(sql?.admission?.admittedBy);
    const ambiguity = titleCase(sql?.admission?.ambiguity);
    const decodedBodies = sql?.thread?.decodedAttributedBodyCount ?? 0;
    const totalMessages = sql?.thread?.totalMessages ?? 0;
    const theme = titleCase(reply?.classifier?.theme);
    const templateContext = titleCase(reply?.classifier?.templateContext);
    const approval = proposal?.humanApprovalRequired ? 'Approval required' : 'Read only';
    const targetCount = proposal?.suggestedMutationTargets?.length || 0;
    return [
      {
        eyebrow: 'Admission',
        title: admittedBy,
        detail:
          ambiguity === 'None'
            ? `${sql?.admission?.matchedPhonesCount || 0} matched phones, no ambiguity`
            : `${sql?.admission?.matchedPhonesCount || 0} matched phones, ${ambiguity}`,
        state: 'source',
      },
      {
        eyebrow: 'Messages SQL',
        title: `${decodedBodies}/${totalMessages} decoded`,
        detail: `${sql?.thread?.inboundCount || 0} inbound, ${sql?.thread?.outboundCount || 0} outbound`,
        state: 'source',
      },
      {
        eyebrow: 'Reply meaning',
        title: theme,
        detail: `${templateContext} -> ${titleCase(reply?.operatorAction)}`,
        state: 'meaning',
      },
      {
        eyebrow: 'Decision',
        title: outcome,
        detail: `${titleCase(proposal?.reason)} (${titleCase(proposal?.confidence)})`,
        state: 'decision',
      },
      {
        eyebrow: 'Gate',
        title: approval,
        detail: `${proposal?.requiredPreflightChecks?.length || 0} preflight checks`,
        state: 'gate',
      },
      {
        eyebrow: 'Targets',
        title: targetCount ? `${targetCount} proposed` : 'None',
        detail: targetCount
          ? (proposal?.suggestedMutationTargets || []).map(titleCase).join(', ')
          : 'No write target proposed',
        state: 'target',
      },
    ];
  }, [outcome, proposal, reply, sql]);

  if (loaded && !bundle) {
    return (
      <main className="tenx-shell">
        <section className="tenx-empty">
          <h1>10x Communications Evidence</h1>
          <p>No evidence payload was provided.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tenx-shell">
      <header className="tenx-header">
        <div>
          <p className="tenx-kicker">10x Communications</p>
          <h1>{bundle?.title || 'Evidence Review'}</h1>
        </div>
        <div className="tenx-status">
          <span>{outcome}</span>
          <strong>{proposal?.mutationResult === 'proposed' ? 'Approval Required' : 'Read Only'}</strong>
        </div>
      </header>

      <FlowStrip steps={flowSteps} />

      <section className="tenx-grid">
        <article className="tenx-panel tenx-panel-primary">
          <div className="tenx-panel-head">
            <span>Next Step</span>
            <strong>{titleCase(proposal?.confidence)}</strong>
          </div>
          <h2>{outcome}</h2>
          <p>{titleCase(proposal?.reason)}</p>
          <div className="tenx-facts">
            <Fact label="Human approval" value={proposal?.humanApprovalRequired} />
            <Fact label="Mutation result" value={titleCase(proposal?.mutationResult)} />
          </div>
          <h3>Targets</h3>
          <ChipList values={proposal?.suggestedMutationTargets} />
          <h3>Preflight</h3>
          <ChipList values={proposal?.requiredPreflightChecks} />
        </article>

        <article className="tenx-panel">
          <div className="tenx-panel-head">
            <span>Messages SQL</span>
            <strong>{sql?.thread?.serviceName || 'Messages'}</strong>
          </div>
          <div className="tenx-facts">
            <Fact label="Admitted by" value={titleCase(sql?.admission?.admittedBy)} />
            <Fact label="Ambiguity" value={titleCase(sql?.admission?.ambiguity)} />
            <Fact label="Matched phones" value={sql?.admission?.matchedPhonesCount} />
            <Fact label="Associated clients" value={sql?.admission?.associatedClientsCount} />
            <Fact label="Total messages" value={sql?.thread?.totalMessages} />
            <Fact label="Inbound" value={sql?.thread?.inboundCount} />
            <Fact label="Outbound" value={sql?.thread?.outboundCount} />
            <Fact label="Decoded bodies" value={sql?.thread?.decodedAttributedBodyCount} />
            <Fact label="Operator latest" value={sql?.direction?.operatorSentLatestMessage} />
            <Fact label="Client latest" value={sql?.direction?.clientSentLatestMessage} />
          </div>
        </article>

        <article className="tenx-panel">
          <div className="tenx-panel-head">
            <span>Reply Meaning</span>
            <strong>{titleCase(reply?.classifier?.themeBucket)}</strong>
          </div>
          <p>{reply?.evidenceMeaning?.interpretation || 'No interpretation available.'}</p>
          <div className="tenx-facts">
            <Fact label="Theme" value={titleCase(reply?.classifier?.theme)} />
            <Fact label="Template context" value={titleCase(reply?.classifier?.templateContext)} />
            <Fact label="Operator action" value={titleCase(reply?.operatorAction)} />
            <Fact label="Operator replied" value={reply?.direction?.operatorRepliedAfterInbound} />
            <Fact label="Times proposed" value={reply?.direction?.operatorReplyProposedTimes} />
            <Fact label="Client opted out" value={reply?.classifier?.clientOptedOut} />
          </div>
          <h3>Required Evidence</h3>
          <ChipList values={reply?.evidenceMeaning?.requiredEvidence} />
        </article>

        <article className="tenx-panel">
          <div className="tenx-panel-head">
            <span>Context</span>
            <strong>{bundle?.generatedAt ? new Date(bundle.generatedAt).toLocaleString() : 'Now'}</strong>
          </div>
          <div className="tenx-facts">
            <Fact label="Task status" value={sql?.context?.taskStatus} />
            <Fact label="Task title" value={sql?.context?.currentTaskTitle} />
            <Fact label="CRM stage" value={sql?.context?.crmStage} />
            <Fact label="First message" value={sql?.thread?.firstMessageAt} />
            <Fact label="Last message" value={sql?.thread?.lastMessageAt} />
          </div>
        </article>
      </section>
    </main>
  );
}
