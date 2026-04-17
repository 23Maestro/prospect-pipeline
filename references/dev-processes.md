# Dev Processes

Use one command surface for local process management.

## Recommended Path

Install the supervisor once:

```bash
npm run dev:stack:install
```

Start the Raycast extension and FastAPI bridge together:

```bash
npm run dev:stack
```

Restart only FastAPI:

```bash
npm run dev:api:restart
```

Wait for FastAPI health explicitly:

```bash
npm run dev:api:health
```

Stop only FastAPI:

```bash
npm run dev:api:stop
```

Kill the whole local stack:

```bash
npm run dev:stack:kill
```

Check current stack status:

```bash
npm run dev:stack:status
```

## Direct Overmind Commands

If you want the native supervisor commands directly:

```bash
overmind start
overmind restart api
overmind stop api
overmind kill
overmind connect api
overmind run <command>
```

This repo ships `.overmind.env`, so plain `overmind start` resolves to `Procfile.dev` automatically.

## Fallback

If Overmind is unavailable, the repo helper falls back automatically where it can.

- `npm run dev:stack` falls back to `npm run dev:all`
- `npm run dev:api:restart` falls back to a direct `uvicorn --reload` restart on port `8000`
- `npm run dev:api:stop` falls back to killing the current listener on port `8000`
- repo `.env` and `npid-api-layer/.env` are loaded before FastAPI starts
- stale `.overmind.sock` is removed automatically when it points to a dead session

If you want the old unsupervised path explicitly:

```bash
npm run dev:all
```

## Connect

Connect is only useful when Overmind is installed:

```bash
overmind connect api
```

Detach from the nested tmux session with the normal tmux detach sequence.

## Source

Primary reference:

- [Overmind README](https://github.com/DarthSim/overmind)

The repo helper in [`scripts/dev-processes.sh`](/Users/singleton23/Raycast/prospect-pipeline/scripts/dev-processes.sh) wraps the commands above so day-to-day restart/stop flow stays consistent.
