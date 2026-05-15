import Script from 'next/script';

export const dynamic = 'force-static';

export default function ProspectMobilePage() {
  const supabaseConfig = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };

  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#070816" />
      <link rel="icon" href="/prospect-mobile/assets/prospect-pipeline.png" />
      <link rel="stylesheet" href="/prospect-mobile/styles.css?v=20260503-dashboard" />
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <img className="brand-mark" src="/prospect-mobile/assets/prospect-pipeline.png" alt="" />
            <h1 id="page-title">Prospect Mobile</h1>
          </div>
          <button className="icon-button" id="refresh-button" type="button" aria-label="Refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8.1 8.1 0 0 0-14.2-5.3L4 7.5V3H.5l2.9 2.9A10.9 10.9 0 0 1 22.7 11h-2.7Zm-16 2a8.1 8.1 0 0 0 14.2 5.3l1.8-1.8V21h3.5l-2.9-2.9A10.9 10.9 0 0 1 1.3 13H4Z" />
            </svg>
          </button>
        </header>

        <nav className="tabbar" aria-label="Mobile workflows">
          <a href="/prospect-mobile/set-meetings" data-route="/set-meetings">
            <span className="tab-icon calendar" aria-hidden="true" />
            <span>Set Meetings</span>
          </a>
          <a href="/prospect-mobile/scout-schedules" data-route="/scout-schedules">
            <span className="tab-icon users" aria-hidden="true" />
            <span>Scout Schedules</span>
          </a>
          <a href="/prospect-mobile/contact-reminder" data-route="/contact-reminder">
            <span className="tab-icon bell" aria-hidden="true" />
            <span>Reminder</span>
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
      <Script
        id="prospect-mobile-supabase-config"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.__PROSPECT_SUPABASE__ = ${JSON.stringify(supabaseConfig)};`,
        }}
      />
      <Script type="module" src="/prospect-mobile/app.js?v=20260503-dashboard" strategy="afterInteractive" />
    </>
  );
}
