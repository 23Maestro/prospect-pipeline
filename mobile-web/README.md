# Prospect Mobile Netlify V1

Phone-facing Netlify surface for the Prospect Pipeline workflows.

## Runtime

```text
iPhone browser
  -> Netlify static page
  -> Netlify function
  -> Tailscale Funnel URL
  -> local FastAPI on 127.0.0.1:8000
```

## Netlify env

Set these in Netlify with Functions scope:

```text
PROSPECT_API_BASE=https://<your-mac-tailnet-name>.ts.net
PROSPECT_API_TOKEN=<shared-secret>
```

Set the same token locally for FastAPI:

```text
PROSPECT_API_TOKEN=<shared-secret>
ALLOWED_ORIGINS=https://<your-netlify-site>.netlify.app,http://localhost:8888,http://127.0.0.1:8888
```

## Tailscale

Start the local API first, then expose it:

```bash
scripts/mobile-funnel.sh start
```

Check or reset:

```bash
scripts/mobile-funnel.sh status
scripts/mobile-funnel.sh reset
```
