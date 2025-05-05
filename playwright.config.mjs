// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true
  }
};

export default config;
