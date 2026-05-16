import Script from 'next/script';

export const dynamic = 'force-dynamic';

export default function ProspectMobilePage() {
  const supabaseConfig = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'public',
  };

  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#070816" />
      <link rel="icon" href="/prospect-mobile/assets/prospect-pipeline.png" />
      <link rel="stylesheet" href="/prospect-mobile/styles.css?v=20260516-james-cache" />
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
            <svg className="tab-icon calendar" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3v3M17 3v3M4.5 9.25h15M6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v9.5A2.75 2.75 0 0 1 17.25 20H6.75A2.75 2.75 0 0 1 4 17.25v-9.5A2.75 2.75 0 0 1 6.75 5Z" />
              <path d="m8.75 14.25 2.2 2.2 4.6-5.15" />
            </svg>
            <span>Set Meetings</span>
          </a>
          <a href="/prospect-mobile/scout-schedules" data-route="/scout-schedules">
            <svg className="tab-icon users" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.8 12.1a3.55 3.55 0 1 0 0-7.1 3.55 3.55 0 0 0 0 7.1Z" />
              <path d="M3.5 19.25c.7-3.4 2.55-5.1 5.3-5.1s4.6 1.7 5.3 5.1" />
              <path d="M16.2 11.55a2.95 2.95 0 1 0-.1-5.9" />
              <path d="M15.75 14.35c2.15.45 3.65 2.05 4.25 4.9" />
            </svg>
            <span>Scout Schedules</span>
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
      <Script type="module" src="/prospect-mobile/app.js?v=20260516-confirmation-prefix" strategy="afterInteractive" />
    </>
  );
}
