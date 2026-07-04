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

Overmind is the source of truth on this repo when it is installed.

- `npm run dev:stack` starts the Procfile under Overmind
- `npm run dev:api:restart` makes sure an Overmind session exists, then restarts only `api`
- `npm run dev:api:stop` stops only `api` inside the active Overmind session
- repo `.env` and `npid-api-layer/.env` are loaded before FastAPI starts
- stale `.overmind.sock` is removed automatically when it points to a dead session

The helper only falls back to direct process handling when Overmind is not installed at all. That avoids the split-brain case where Overmind exists but a stray direct `uvicorn` child still owns port `8000`.

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

The repo helper in [`scripts/dev-processes.sh`](../scripts/dev-processes.sh) wraps the commands above so day-to-day restart/stop flow stays consistent.
