export const dynamic = 'force-static';

const surfaces = [
  {
    href: '/prospect-call-tracker',
    title: 'Prospect Call Tracker',
  },
  {
    href: '/prospect-mobile',
    title: 'Prospect Mobile',
  },
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <header className="home-topbar">
        <a className="home-brand" href="/">
          <img className="home-mark" src="/prospect-id-shield.svg" alt="Prospect ID" />
          <span>Prospect Web</span>
        </a>
        <div className="home-status" aria-label="Deployment status">
          <span className="home-dot" />
          <span>Health OK</span>
        </div>
      </header>

      <section className="home-grid">
        <div className="home-copy">
          <h1>Command Center</h1>
          <div className="home-actions">
            {surfaces.map((surface) => (
              <a key={surface.href} href={surface.href}>{surface.title}</a>
            ))}
          </div>
        </div>

        <div className="home-panel">
          <div className="home-panel-head">
            <span>Dashboards</span>
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
              </span>
              <span className="home-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
