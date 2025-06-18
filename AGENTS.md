# Repository Guidelines

- Require Node.js 18 or newer.
- Use `npm ci` for installing dependencies.
- If running e2e tests first time,
  execute `npx playwright install --with-deps`.
- Before committing, run `npm test` and `npm run e2e`.
- Follow four-space indentation and end statements with semicolons.
- When updating releases, keep version numbers synchronized across `config.js`,
  `README.md`, and `help.html`.
