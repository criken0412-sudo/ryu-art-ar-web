import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const edgeCandidates = [
  process.env.WEB_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const executablePath = edgeCandidates.find(existsSync);
if (!executablePath) throw new Error('Microsoft Edge or Chrome is required to compile the image targets.');

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], {
  stdio: 'inherit',
  windowsHide: true,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (vite.exitCode !== null) throw new Error('Vite stopped before the target compiler started.');
    try {
      const response = await fetch('http://127.0.0.1:5183/tools/compile-targets.html');
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for Vite to start. */ }
    await delay(500);
  }
  if (!ready) throw new Error('The local target compiler server did not start.');

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') console.error(`Browser: ${message.text()}`); });
  page.on('pageerror', (error) => console.error(`Browser: ${error.stack}`));
  await page.goto('http://127.0.0.1:5183/tools/compile-targets.html?run=1', { waitUntil: 'networkidle' });
  const status = page.locator('#status');
  await status.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('完了。'), null, { timeout: 10 * 60 * 1000 });
  console.log(await status.textContent());
} finally {
  if (browser) await browser.close();
  vite.kill();
}
