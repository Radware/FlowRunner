# Repository Guidelines

This project's working documentation is the "bible" — start with **[CLAUDE.md](CLAUDE.md)**, then read the focused file you need:

- **[architecture.md](architecture.md)** — components, IPC, flow-file format, execution engine, build/release, testing.
- **[gotchas.md](gotchas.md)** — traps and time-wasters; read before touching any subsystem.
- **[changelog.md](changelog.md)** — what changed and why (decision record).
- **[masterplan.md](masterplan.md)** — product vision and roadmap.

## Essentials

- Node.js 18+; install with `npm ci`. First E2E run: `npx playwright install --with-deps`.
- Before committing, run `npm test` **and** `npm run e2e`.
- Four-space indentation; semicolons; ES modules throughout.
- **Every JS module the app imports must be in `build.files`** (`package.json`), or packaged builds break silently — see [gotchas.md](gotchas.md) #1.
- A version bump must update 8 files in sync — see [architecture.md](architecture.md) §9.
