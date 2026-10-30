'use strict';
// Opens the web terminal in Chromium, types a command, and waits for a file
// inside the container to contain "DONE".
// Usage: node test/browser-test.js <url> <user> <password> <container> <command> <outfile> [screenshot]
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const [url, username, password, container, command, outfile, screenshot] = process.argv.slice(2);

function readOut() {
  try {
    return execFileSync('docker', ['exec', container, 'cat', outfile], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ httpCredentials: { username, password }, viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('.xterm', { timeout: 30000 });
  await page.waitForTimeout(2500); // let tmux start
  await page.click('.xterm');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');

  const deadline = Date.now() + 240000;
  let out = '';
  while (Date.now() < deadline) {
    out = readOut();
    if (out.includes('DONE')) break;
    await page.waitForTimeout(1000);
  }
  if (screenshot) await page.screenshot({ path: screenshot });
  await browser.close();
  process.exit(out.includes('DONE') ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
