// Scriptable script name: ID Command Center

const commands = [
  {
    title: "SC: Calls",
    icon: "activity",
    gradient: ["#4A0E17", "#9E182A"], // Crimson red
    type: "link",
    value: "https://prospect-web.vercel.app/prospect-call-tracker"
  },
  {
    title: "SC: Mobile",
    icon: "compass",
    gradient: ["#2E1117", "#7B2630"], // Smoked ruby
    type: "link",
    value: "https://prospect-web.vercel.app/prospect-mobile"
  },
  {
    title: "New Contact",
    icon: "user-plus",
    gradient: ["#0E2524", "#1E6A63"], // Dark oxidized teal
    type: "script",
    value: "ID New Contact"
  },
  {
    title: "iCalendar Follow-Up",
    icon: "calendar-plus",
    gradient: ["#171A24", "#3B435B"], // Gunmetal blue
    type: "script",
    value: "ID iCal Follow-Up"
  },
  {
    title: "Search Top 500",
    icon: "search",
    gradient: ["#1F1607", "#A66314"], // Smoked amber
    type: "script",
    value: "ID Prospect Search"
  }
]

const icons = {
  compass: `
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
    </svg>
  `,
  activity: `
    <svg viewBox="0 0 24 24">
      <path d="M22 12h-4l-3 8L9 4l-3 8H2"/>
    </svg>
  `,
  search: `
    <svg viewBox="0 0 24 24">
      <path d="m20 20-4.6-4.6"/>
      <circle cx="11" cy="11" r="7"/>
    </svg>
  `,
  "id-card": `
    <svg viewBox="0 0 24 24">
      <rect width="20" height="14" x="2" y="5" rx="2"/>
      <path d="M7 10h.01"/>
      <path d="M11 10h6"/>
      <path d="M11 14h4"/>
      <circle cx="7" cy="14" r="2"/>
    </svg>
  `,
  "user-plus": `
    <svg viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M19 8v6"/>
      <path d="M22 11h-6"/>
    </svg>
  `,
  "calendar-plus": `
    <svg viewBox="0 0 24 24">
      <path d="M8 2v4"/>
      <path d="M16 2v4"/>
      <rect width="18" height="18" x="3" y="4" rx="2"/>
      <path d="M3 10h18"/>
      <path d="M12 14v4"/>
      <path d="M10 16h4"/>
    </svg>
  `
}

const html = `
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  * {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  html, body {
    margin: 0;
    width: 100%;
    min-height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif;
    color: white;
    overflow-x: hidden;
  }

  body {
    padding: calc(env(safe-area-inset-top) + 18px) 16px calc(env(safe-area-inset-bottom) + 18px);
    background: radial-gradient(circle at 50% -10%, #0f172a 0%, #000000 80%);
    background-color: #000;
  }

  /* SVG Noise Ramp Overlay */
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
    opacity: 0.12;
    mix-blend-mode: overlay;
    z-index: 10;
  }

  .shell {
    max-width: 620px;
    margin: 0 auto;
    position: relative;
    z-index: 20;
  }

  .header {
    margin: 4px 2px 16px;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,.18);
    background: rgba(255,255,255,.08);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    font-size: 12px;
    font-weight: 780;
    letter-spacing: .10em;
    text-transform: uppercase;
    color: rgba(255,255,255,.8);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }

  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #ff3b56;
    box-shadow: 0 0 12px #ff3b56, 0 0 24px #ff3b56;
  }

  h1 {
    margin: 14px 0 0;
    font-size: 34px;
    line-height: .96;
    letter-spacing: -.045em;
    font-weight: 920;
    color: #ffffff;
    text-shadow:
      0 2px 4px rgba(0,0,0,.8),
      0 0 30px rgba(158, 24, 42, .4);
  }

  .grid {
    display: grid;
    gap: 14px;
  }

  .card {
    position: relative;
    width: 100%;
    overflow: hidden;
    min-height: 76px;
    padding: 14px 16px;
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.05);
    backdrop-filter: blur(22px) saturate(1.2);
    -webkit-backdrop-filter: blur(22px) saturate(1.2);
    /* Outer glow inherits colors implicitly via pseudo-element */
    box-shadow:
      0 16px 38px rgba(0,0,0,.6),
      inset 0 1px 0 rgba(255,255,255,.25),
      inset 0 -18px 34px rgba(0,0,0,.4);
    transform: translateZ(0);
    transition: transform .14s ease, filter .14s ease, box-shadow .14s ease;
  }

  .card:active {
    transform: scale(.97);
    filter: brightness(1.2);
  }

  .card::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--from), var(--to));
    opacity: 0.95;
    z-index: -2;
  }

  /* Creates the dynamic glow matching the gradient */
  .card::after {
    content: "";
    position: absolute;
    inset: -2px;
    background: linear-gradient(135deg, var(--from), var(--to));
    filter: blur(14px);
    opacity: 0.3;
    z-index: -3;
    transition: opacity .14s ease;
  }

  .card:active::after {
    opacity: 0.6;
    filter: blur(20px);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .iconWrap {
    width: 48px;
    height: 48px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border-radius: 17px;
    background: linear-gradient(135deg, rgba(255,255,255,.15), rgba(255,255,255,.02));
    border: 1px solid rgba(255,255,255,.3);
    box-shadow:
      inset 0 1px 2px rgba(255,255,255,.4),
      0 8px 18px rgba(0,0,0,.4);
  }

  .icon {
    width: 26px;
    height: 26px;
  }

  svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: #ffffff;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,.6));
  }

  .title {
    flex: 1;
    text-align: left;
    font-size: 22px;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -.02em;
    color: #ffffff;
    text-shadow:
      0 2px 4px rgba(0,0,0,.8),
      0 0 16px rgba(255,255,255,.2);
  }
</style>
</head>

<body>
  <main class="shell">
    <section class="header">
      <div class="eyebrow"><span class="pulse"></span> Prospect ID</div>
      <h1>Mobile Command Center</h1>
    </section>

    <section class="grid">
      ${commands.map((cmd, index) => `
        <button
          class="card"
          style="--from:${cmd.gradient[0]};--to:${cmd.gradient[1]}"
          onclick="runCommand(${index})"
        >
          <div class="row">
            <div class="iconWrap">
              <div class="icon">${icons[cmd.icon]}</div>
            </div>
            <div class="title">${cmd.title}</div>
          </div>
        </button>
      `).join("")}
    </section>
  </main>

<script>
  const commands = ${JSON.stringify(commands)};

  function runCommand(index) {
    const encoded = encodeURIComponent(JSON.stringify(commands[index]));
    window.location.href = "id-command://run?payload=" + encoded;
  }
</script>
</body>
</html>
`

const webView = new WebView()

webView.shouldAllowRequest = req => {
  const url = req.url

  if (!url.startsWith("id-command://run")) {
    return true
  }

  const payload = decodeURIComponent(url.split("payload=")[1] || "")
  const command = JSON.parse(payload)

  if (command.type === "link") {
    openUrl(command.value)
    return false
  }

  if (command.type === "script") {
    openUrl(buildScriptableUrl(command))
    return false
  }

  if (command.type === "shortcut") {
    openUrl("shortcuts://run-shortcut?name=" + encodeURIComponent(command.value))
    return false
  }

  return false
}

await webView.loadHTML(html)
await webView.present(false)
Script.complete()

function buildScriptableUrl(command) {
  return "scriptable:///run?scriptName=" + encodeURIComponent(command.value)
}

function openUrl(url) {
  if (/^https?:\/\//.test(String(url || "")) && Safari.openInApp) {
    Safari.openInApp(url, false)
    return
  }
  Safari.open(url)
}
