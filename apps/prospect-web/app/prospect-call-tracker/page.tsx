import Script from 'next/script';

export const dynamic = 'force-static';

function Icon({ name }: { name: 'refresh' | 'phone' | 'user' | 'calendar' | 'trend' | 'trophy' | 'check' | 'clock' | 'dollar' }) {
  const paths = {
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.5 9a7 7 0 0 0-11.8-2.6L4 9" />
        <path d="M5.5 15a7 7 0 0 0 11.8 2.6L20 15" />
      </>
    ),
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1z" />,
    user: (
      <>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-5" />
      </>
    ),
    trend: <path d="M3 17 9 11l4 4 8-8M15 7h6v6" />,
    trophy: (
      <>
        <path d="M8 21h8M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    dollar: (
      <>
        <path d="M12 2v20" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
      </>
    ),
  } as const;

  return (
    <svg className="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export default function ProspectCallTrackerPage() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" href="/prospect-call-tracker/prospect-pipeline.png" />
      <link rel="stylesheet" href="/prospect-call-tracker/styles.css?v=20260518-commander-header" />
      <main className="shell">
        <header className="topbar">
          <a className="brand-row" href="/">
            <img className="app-mark" src="/prospect-call-tracker/prospect-pipeline.png" alt="" />
            <strong>ID Commander Center: Calls</strong>
          </a>
        </header>

        <section className="page-head">
          <div>
            <h1>Prospect Call Tracker</h1>
            <span id="rangeLabel">Loading</span>
          </div>
          <div className="view-actions">
            <label className="view-select-wrap">
              <span>View</span>
              <select id="weekViewSelect" aria-label="Call tracker date view">
                <option>This week (live)</option>
              </select>
            </label>
            <button id="refreshButton" type="button">
              <Icon name="refresh" />
              Refresh Data
            </button>
          </div>
        </section>

        <section className="daily-panel" aria-label="Current day">
          <div className="daily-head">
              <div className="period-toggle" aria-label="Current work week">
                <button type="button" data-period="week-0" className="active">
                  Mon
                </button>
                <button type="button" data-period="week-1">
                  Tue
                </button>
                <button type="button" data-period="week-2">
                  Wed
                </button>
                <button type="button" data-period="week-3">
                  Thu
                </button>
                <button type="button" data-period="week-4">
                  Fri
                </button>
                <button type="button" data-period="week-total">
                  Week
                </button>
              </div>
              <h2 id="periodTitle">Current Day</h2>
              <span id="todayLabel">Local</span>
          </div>
          <div className="daily-cards">
            <article className="daily-card blue-card">
              <div className="card-top"><span>Total Calls</span><Icon name="phone" /></div>
              <strong id="todayCalls">0</strong>
            </article>
            <article className="daily-card green-card">
              <div className="card-top"><span>Contacts Made</span><Icon name="user" /></div>
              <strong id="todayContacts">0</strong>
            </article>
            <article className="daily-card red-card">
              <div className="card-top"><span>Meetings Set</span><Icon name="calendar" /></div>
              <strong id="todayMeetingsSet">0</strong>
            </article>
            <article className="daily-card purple-card">
              <div className="card-top"><span>Set Rate</span><Icon name="trend" /></div>
              <strong id="todaySetRate">0%</strong>
            </article>
            {/*
            <article className="daily-card show-card">
              <div className="card-top"><span>Show Rate</span><Icon name="check" /></div>
              <strong id="todayShowRate">0%</strong>
            </article>
            */}
            <article className="daily-card amber-card">
              <div className="card-top"><span>Closed Won</span><Icon name="trophy" /></div>
              <strong id="closedWon">0</strong>
            </article>
          </div>
        </section>

        <section className="metrics" aria-label="Tracker totals">
          <article className="paycheck-panel" aria-label="Next paycheck pending">
            <div className="card-top"><span>Next Paycheck</span><Icon name="clock" /></div>
            <strong id="nextPaycheck">$0</strong>
            <div className="pay-lines">
              <span id="basePayLine">Base $0</span>
              <span id="commissionPayLine">Commission $0</span>
            </div>
          </article>
          <article className="metric primary">
            <div className="card-top"><span>Money</span><Icon name="dollar" /></div>
            <strong id="moneyEarned">$0</strong>
          </article>
        </section>

        <section className="split">
          <div className="panel">
            <div className="panel-head">
              <h2>All-Time Tracker</h2>
              <span id="statusText">Live</span>
            </div>
            <div id="outcomeBars" className="bars" />
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Closed Won</h2>
              <span id="closeRate">0%</span>
            </div>
            <div id="closedWonList" className="closed-list" />
          </div>
        </section>

        <section className="panel table-panel">
          <div className="panel-head table-actions">
            <h2>Events</h2>
            <div className="filters" id="filters" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Name</th>
                  <th>Outcome</th>
                  <th>Stage</th>
                  <th>Event</th>
                  <th className="money-cell">Money</th>
                </tr>
              </thead>
              <tbody id="eventsBody" />
            </table>
          </div>
        </section>
      </main>
      <Script src="/prospect-call-tracker/app.js?v=20260518-live-selector" strategy="afterInteractive" />
    </>
  );
}
