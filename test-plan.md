FlowRunner Test Plan
====================

Scope
-----
- Regression coverage for recent UI/runner changes and new utilities.

Prerequisites
-------------
- Node.js 18 or newer.
- Dependencies installed with `npm ci` if needed.
- If running E2E for the first time: `npx playwright install --with-deps`.

Automated Tests
---------------
1) Unit/Integration
   - Command: `npm test`
   - Expected: All Jest tests pass.

2) E2E
   - Command: `npm run e2e`
   - Expected: Playwright flows complete without failures.

Manual UI Tests
---------------
1) Step Mode Stop
   - Steps: Open a flow, click Step, then Stop.
   - Expected: Execution stops immediately, Stop disables, status shows “stopped”.

2) Auto Arrange (Visual View)
   - Steps: Switch to Visual View, click Auto Arrange, Save flow, reopen.
   - Expected: Nodes reflow, layout persists on reload.

3) Node Editor Context Labels
   - Steps: Open the last node editor in Visual View.
   - Expected: “Previous” chips show “Prev:” (not “Next:”), “Next” list empty.

4) Insert Variable Button Width
   - Steps: Open Request editor; check URL and header rows.
   - Expected: “{{…}}” button text fits without overflow.

5) Copy cURL Variable Resolution
   - Steps: Add flow vars; run flow to populate runtime values; click Copy cURL.
   - Expected: cURL uses static values, runtime values, and generated randoms; unresolved variables become their names.

6) Random Special Variables
   - Steps: Use `{{RANDOM_INT(1,1000)}}` and `{{RANDOM_STRING(16)}}` in URL/headers/body.
   - Expected: Values are generated once per run and reused across steps.

7) Step Search + Jump
   - Steps: Search in steps list; click List/Graph jump.
   - Expected: List scrolls to step; Graph centers on node.

8) Results Export
   - Steps: Run flow; click Export JSON and Export CSV.
   - Expected: Files are saved with correct content and metadata.
