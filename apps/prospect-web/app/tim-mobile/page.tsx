import Script from 'next/script';

export const dynamic = 'force-dynamic';

export default function TimMobilePage() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#070816" />
      <link rel="icon" href="/prospect-id-shield.svg" />
      <link rel="stylesheet" href="/prospect-mobile/styles.css?v=20260603-tim-lite" />
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <a className="brand-home-link" href="/" aria-label="Back to Command Center">
              <img
                src="/prospect-id-shield.svg"
                alt="Prospect ID"
                className="mobile-mark shrink-0"
              />
            </a>
            <h1 id="page-title">Tim Lite</h1>
          </div>
          <button className="icon-button" id="refresh-button" type="button" aria-label="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8.1 8.1 0 0 0-14.2-5.3L4 7.5V3H.5l2.9 2.9A10.9 10.9 0 0 1 22.7 11h-2.7Zm-16 2a8.1 8.1 0 0 0 14.2 5.3l1.8-1.8V21h3.5l-2.9-2.9A10.9 10.9 0 0 1 1.3 13H4Z" />
            </svg>
          </button>
        </header>

        <nav className="tabbar" aria-label="Tim Lite workflows">
          <a href="/tim-mobile/set-meetings" data-route="/set-meetings">
            <svg className="tab-icon calendar" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3v3M17 3v3M4.5 9.25h15M6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v9.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25v-9.5A2.75 2.75 0 0 1 6.75 5Z" />
              <path d="m8.75 14.25 2.2 2.2 4.6-5.15" />
            </svg>
            <span>Set Meetings</span>
          </a>
          <a href="/tim-mobile/search" data-route="/search">
            <svg className="tab-icon search" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m20 20-4.6-4.6" />
              <path d="M10.75 17.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5Z" />
            </svg>
            <span>Search</span>
          </a>
        </nav>

        <section className="toolbar" id="week-toolbar">
          <div className="segmented" role="group" aria-label="Week">
            <button type="button" data-week="this">
              This week
            </button>
            <button type="button" data-week="next">
              Next week
            </button>
          </div>
        </section>

        <section className="status-line" id="status-line" aria-live="polite" />
        <section className="content" id="content" />
      </main>
      <Script type="module" src="/tim-mobile/app.js?v=20260603-tim-lite" strategy="afterInteractive" />
    </>
  );
}
