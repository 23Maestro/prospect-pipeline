import Script from 'next/script';

export const dynamic = 'force-static';

function Icon({ name }: { name: 'refresh' | 'calendar' | 'clock' | 'check' | 'alert' | 'list' }) {
  const paths = {
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.5 9a7 7 0 0 0-11.8-2.6L4 9" />
        <path d="M5.5 15a7 7 0 0 0 11.8 2.6L20 15" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    alert: (
      <>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
  } as const;

  return (
    <svg className="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export default function ProspectMeetingsPage() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#070816" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8fbff" />
      <link rel="icon" href="/prospect-id-shield.svg" />
      <link rel="stylesheet" href="/prospect-meetings/styles.css?v=20260618-outcome-filters" />
      <main className="shell">
        <header className="topbar">
          <div className="brand-row">
            <a className="brand-home-link" href="/" aria-label="Back to Command Center">
              <img className="app-mark" src="/prospect-id-shield.svg" alt="Prospect ID" />
            </a>
            <strong>SC: Meetings</strong>
          </div>
          <a className="topbar-link" href="/prospect-call-tracker">
            Calls
          </a>
        </header>

        <section className="page-head">
          <div>
            <h1 id="trackerTitle">Enrollment Tracker</h1>
            <span id="generatedAt">Loading</span>
          </div>
          <button id="refreshButton" type="button">
            <Icon name="refresh" />
            Refresh
          </button>
        </section>

        <section className="summary-grid" aria-label="Meeting summary">
          <article className="summary-card blue-card">
            <div className="card-top"><span>Meetings Set</span><Icon name="calendar" /></div>
            <strong id="meetingsSet">0</strong>
          </article>
          <article className="summary-card green-card">
            <div className="card-top"><span>Enrollments</span><Icon name="check" /></div>
            <strong id="enrollments">0</strong>
          </article>
          <article className="summary-card purple-card">
            <div className="card-top"><span>Show Rate</span><Icon name="list" /></div>
            <strong id="showRate">0%</strong>
          </article>
        </section>

        <section className="panel table-panel">
          <div className="panel-head">
            <h2>Meetings</h2>
            <div className="meeting-panel-actions">
              <div className="filters" id="meetingFilters" aria-label="Meeting status filters" />
              <span id="rowCount">0 rows</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Athlete</th>
                  <th>Status</th>
                  <th>Head Scout</th>
                  <th className="money-cell">Money</th>
                </tr>
              </thead>
              <tbody id="meetingsBody" />
            </table>
          </div>
        </section>
      </main>
      <Script src="/prospect-meetings/app.js?v=20260618-outcome-filters" strategy="afterInteractive" />
    </>
  );
}
