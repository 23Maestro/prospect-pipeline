export const dynamic = 'force-static';

const surfaces = [
  {
    href: '/prospect-call-tracker',
    title: 'Prospect Call Tracker',
    description: 'Call outcomes, meeting sets, and Supabase reporting.',
  },
  {
    href: '/prospect-mobile',
    title: 'Prospect Mobile',
    description: 'Phone-facing set meetings, scout schedules, and reminder intake.',
  },
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <header className="home-topbar">
        <a className="home-brand" href="/">
          <span className="home-mark" aria-hidden="true" />
          <span>Prospect Web</span>
        </a>
        <div className="home-status" aria-label="Deployment status">
          <span className="home-dot" />
          <span>Health OK</span>
          <span className="home-divider" />
          <span>Vercel Adapter</span>
        </div>
      </header>

      <section className="home-grid">
        <div className="home-copy">
          <h1>Workflow surfaces, now on Vercel.</h1>
          <p>Thin Next.js hosting for the mobile workflow and call tracker. FastAPI, Supabase, and domain ownership stay where they belong.</p>
          <div className="home-actions">
            <a href="/prospect-call-tracker">Open Call Tracker</a>
            <a href="/prospect-mobile">Open Prospect Mobile</a>
          </div>
        </div>

        <div className="home-panel">
          <div className="home-panel-head">
            <span>Production Surfaces</span>
            <span className="home-pill">Live</span>
          </div>
          {surfaces.map((surface) => (
            <a
              key={surface.href}
              href={surface.href}
              className="home-surface"
            >
              <span>
                <strong>{surface.title}</strong>
                <small>{surface.description}</small>
              </span>
              <span className="home-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
