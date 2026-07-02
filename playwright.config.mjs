// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './e2e',
  // Electron launch + store hydration + mock servers make 30s hooks flaky.
  timeout: 60000,
  retries: 0,
  // The packaged app persists recent files in ONE shared electron-store profile;
  // parallel workers clobber each other's seeded state. Run specs serially.
  workers: 1,
  use: {
    headless: true
  }
};

export default config;
