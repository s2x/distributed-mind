# mind

A simple CLI and web app for tracking thoughts, ideas and tasks. Data is stored in a single JSON file (the “brain”) and organized in **spaces** with descriptions and **memories**.

## Installing dependencies

Ensure you have [Bun](https://bun.sh/) installed and run:

```bash
bun install
```

## CLI

Run the `mind` script from the project root (make it executable if needed: `chmod +x mind`):

```bash
./mind help
./mind create my-space "Short description"
./mind add my-space "A memory"
./mind list
```

See `./mind help` for all commands.

Tests:

```bash
bun test cli/test
```

## Web app

The web app lets you visualize, manage and edit the same brain (spaces and memories) with a markdown editor.

**Local (no Docker):**

```bash
cd web && bun run start
```

Then open http://localhost:3000. The app reads and writes `brain.json` at the **repository root** (same as the CLI when run from repo root).

**Docker (recommended for the web):**

From the repository root:

```bash
docker compose up -d
```

Then open http://localhost:3000. The brain is stored in a Docker volume (`mind-data`) at `/data/brain.json` inside the container. The service is configured with `restart: unless-stopped` so it will come back up if it crashes or after a reboot.

To use the same data with the CLI, you would need to point the CLI at the same file (e.g. by setting the path in `cli/src/config.ts` or via an env that the config respects) or copy the file; by default the CLI uses `brain.json` at the repo root.

## Project layout

- **`cli/`** — CLI source (`cli/src/`) and tests (`cli/test/`). Entry: `mind` script → `cli/src/mind.ts`.
- **`web/`** — Web server (`web/server.ts`) and static frontend (`web/public/`). API: `GET/PUT /api/brain`. Dockerized via `web/Dockerfile`; `docker-compose.yml` at repo root runs the web with a persistent volume and restart policy.
