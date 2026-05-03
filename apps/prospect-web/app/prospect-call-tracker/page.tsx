import Script from 'next/script';

export const dynamic = 'force-static';

export default function ProspectCallTrackerPage() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="stylesheet" href="/prospect-call-tracker/styles.css?v=20260503-donut" />
      <main className="shell">
        <header className="topbar">
          <a className="brand-row" href="/">
            <span className="vercel-mark" aria-hidden="true" />
            <strong>Prospect Web</strong>
          </a>
          <div className="topbar-actions">
            <span className="status-pill health">Health OK</span>
            <span className="status-pill">Sync Complete</span>
            <span id="payDateLabel">Next check</span>
          </div>
        </header>

        <section className="page-head">
          <div>
            <h1>Prospect Call Tracker</h1>
            <span id="rangeLabel">Loading</span>
          </div>
          <button id="refreshButton" type="button">
            Refresh Data
          </button>
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
            <article className="daily-card">
              <span>Total Calls</span>
              <strong id="todayCalls">0</strong>
            </article>
            <article className="daily-card">
              <span>Contacts Made</span>
              <strong id="todayContacts">0</strong>
            </article>
            <article className="daily-card">
              <span>Meetings Set</span>
              <strong id="todayMeetingsSet">0</strong>
            </article>
            <article className="daily-card">
              <span>Set Rate</span>
              <strong id="todaySetRate">0%</strong>
            </article>
            <article className="daily-card">
              <span>Closed Won</span>
              <strong id="closedWon">0</strong>
            </article>
          </div>
        </section>

        <section className="metrics" aria-label="Tracker totals">
          <article className="paycheck-panel" aria-label="Next paycheck pending">
            <span>Next Paycheck</span>
            <strong id="nextPaycheck">$0</strong>
            <div className="pay-lines">
              <span id="basePayLine">Base $0</span>
              <span id="commissionPayLine">Commission $0</span>
            </div>
          </article>
          <article className="metric primary">
            <span>Money</span>
            <strong id="moneyEarned">$0</strong>
          </article>
          <article className="metric">
            <span>Spoke With</span>
            <strong id="spokeWith">0</strong>
          </article>
          <article className="metric">
            <span>Dials</span>
            <strong id="totalEvents">0</strong>
          </article>
          <article className="metric">
            <span>Voicemail</span>
            <strong id="voicemailOnly">0</strong>
          </article>
          <article className="metric">
            <span>Appointments</span>
            <strong id="appointmentsTracked">0</strong>
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
      <Script src="/prospect-call-tracker/app.js?v=20260503-donut" strategy="afterInteractive" />
    </>
  );
}
