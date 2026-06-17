'use client';

import { useState } from 'react';

type BucketTone = 'blue' | 'orange' | 'green' | 'red' | 'slate' | 'purple';

type VisualLink = {
  title: string;
  href?: string;
  status: 'Current' | 'Pending';
  note: string;
};

type Bucket = {
  title: string;
  label: string;
  tone: BucketTone;
  summary: string;
  visuals: VisualLink[];
};

const buckets: Bucket[] = [
  {
    title: 'Visual Grammar',
    label: 'Map rules',
    tone: 'slate',
    summary: 'Portable color, shape, and layout rules for simple visual debugging maps.',
    visuals: [
      {
        title: 'Mobile Visual Grammar Card',
        href: '/visual-maps/visual-grammar.html',
        status: 'Current',
        note: 'Scriptable-friendly static HTML reminder for colors, shapes, and layouts.',
      },
    ],
  },
  {
    title: 'Meetings',
    label: 'Meeting truth',
    tone: 'green',
    summary: 'Appointment timing, scouts, confirmations, reschedules, and booked meeting detail.',
    visuals: [
      {
        title: 'Meeting truth and reschedule chain',
        status: 'Pending',
        note: 'Map appointments, confirmation support, and live booked-event adapters.',
      },
    ],
  },
  {
    title: 'Pre-Meeting Tasks',
    label: 'Task gates',
    tone: 'orange',
    summary: 'Call attempts, reminders, confirmation tasks, voicemail tasks, and completion gates.',
    visuals: [
      {
        title: 'Call attempt task completion lane',
        status: 'Pending',
        note: 'Map task title, reminder, completion, and follow-up write boundaries.',
      },
    ],
  },
  {
    title: 'Client Communication',
    label: 'Messages',
    tone: 'blue',
    summary: 'Outbound messages, voicemail follow-ups, recipients, context, and review evidence.',
    visuals: [
      {
        title: '10x Communications Decision Receipt',
        href: '/visual-maps/client-messages-decision-receipt.html',
        status: 'Current',
        note: 'LikeC4 decision map for evidence -> classifier -> proposal.',
      },
      {
        title: 'Client Messages Review Follow-Up Flow',
        href: '/visual-maps/client-messages-review-flow.html',
        status: 'Current',
        note: 'LikeC4 flow map for the Client Messages review path.',
      },
      {
        title: 'Run-Level Evidence Receipt',
        href: '/10x-communications-evidence',
        status: 'Current',
        note: 'Prospect Web receipt for a specific encoded evidence payload.',
      },
    ],
  },
  {
    title: 'Lifecycle & Stage Truth',
    label: 'Sales stage',
    tone: 'red',
    summary: 'CRM sales stage, lifecycle writes, active state, and reporting facts.',
    visuals: [
      {
        title: 'Sales-stage source-of-truth lane',
        status: 'Pending',
        note: 'Map lifecycleSalesStage, lifecycle_events, and forbidden stale projections.',
      },
    ],
  },
  {
    title: 'Enrollments & Outcomes',
    label: 'Outcomes',
    tone: 'purple',
    summary: 'Close won/lost, no-show, follow-up results, pending-client review, and post-meeting outcomes.',
    visuals: [
      {
        title: 'Pending Clients outcome review',
        status: 'Pending',
        note: 'Map appointment outcomes, follow-up review lanes, and proposal gates.',
      },
    ],
  },
  {
    title: 'Admin Data & Contacts',
    label: 'Identity',
    tone: 'slate',
    summary: 'Athlete identity, contact cache, admin URLs, macOS Contacts, notes, and phone facts.',
    visuals: [
      {
        title: 'Contact cache admission and identity resolution',
        status: 'Pending',
        note: 'Map athlete_contact_cache, admin lookup, and unsafe identity fallbacks.',
      },
    ],
  },
];

export default function VisualMapsPage() {
  const [activeBucket, setActiveBucket] = useState<Bucket | null>(null);

  return (
    <main className="home-shell visual-shell">
      <header className="home-topbar">
        <a className="home-brand" href="/">
          <img className="home-mark" src="/prospect-id-shield.svg" alt="Prospect ID" />
          <span>Prospect Web</span>
        </a>
        <div className="home-status" aria-label="Visual maps status">
          <span className="home-dot" />
          <span>Maps Ready</span>
        </div>
      </header>

      <section className="visual-grid">
        <div className="visual-copy">
          <p>Scouting Coordinator</p>
          <h1>Visual Maps</h1>
        </div>

        <div className="visual-panel">
          <div className="home-panel-head">
            <span>Buckets</span>
            <span className="home-pill">LikeC4</span>
          </div>
          <div className="visual-buckets">
            {buckets.map((bucket) => (
              <button
                key={bucket.title}
                className={`visual-bucket visual-bucket-${bucket.tone}`}
                type="button"
                onClick={() => setActiveBucket(bucket)}
              >
                <span>
                  <strong>{bucket.title}</strong>
                  <small>{bucket.label}</small>
                </span>
                <span className="visual-count">
                  {bucket.visuals.filter((visual) => visual.status === 'Current').length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeBucket ? (
        <div
          className="visual-modal-backdrop"
          role="presentation"
          onClick={() => setActiveBucket(null)}
        >
          <section
            aria-modal="true"
            className="visual-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="visual-modal-head">
              <div>
                <p>{activeBucket.label}</p>
                <h2>{activeBucket.title}</h2>
              </div>
              <button type="button" onClick={() => setActiveBucket(null)} aria-label="Close">
                X
              </button>
            </div>
            <p className="visual-modal-summary">{activeBucket.summary}</p>
            <div className="visual-links">
              {activeBucket.visuals.map((visual) =>
                visual.href ? (
                  <a key={visual.title} href={visual.href} target="_blank" rel="noreferrer">
                    <span>
                      <strong>{visual.title}</strong>
                      <small>{visual.note}</small>
                    </span>
                    <em>{visual.status}</em>
                  </a>
                ) : (
                  <div key={visual.title} className="visual-link-pending">
                    <span>
                      <strong>{visual.title}</strong>
                      <small>{visual.note}</small>
                    </span>
                    <em>{visual.status}</em>
                  </div>
                ),
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
