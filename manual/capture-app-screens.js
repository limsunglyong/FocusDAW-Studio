'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(__dirname, 'live-screens');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(win, predicateSource, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ok = await win.webContents.executeJavaScript(`Boolean((${predicateSource})())`, true).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  throw new Error('Timed out waiting for app state: ' + predicateSource);
}

async function clickButton(win, text) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const needle = ${JSON.stringify(text)};
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().includes(needle));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error('Button not found: ' + text);
  await sleep(700);
}

async function clickMenuItem(win, text) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const needle = ${JSON.stringify(text)};
      const el = Array.from(document.querySelectorAll('.menu-item'))
        .find((node) => (node.textContent || '').trim() === needle);
      if (!el) return false;
      el.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error('Menu item not found: ' + text);
  await sleep(700);
}

async function capture(win, name) {
  await sleep(500);
  const image = await win.capturePage();
  fs.writeFileSync(path.join(outDir, name), image.toPNG());
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#1b1712',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'manual-capture-' + Date.now(),
    },
  });

  await win.loadFile(path.join(root, 'studio.html'));
  await waitFor(win, `() => document.querySelector('#root') && document.querySelector('#root').textContent.length > 30`);
  await waitFor(win, `() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes('Load demo session'))`);
  await capture(win, '01-empty-start.png');

  await clickButton(win, 'Load demo session');
  await waitFor(win, `() => document.body.textContent.includes('Drums') && document.body.textContent.includes('OUTPUT')`);
  await capture(win, '02-arrange-demo.png');

  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'L');
      if (btn) btn.click();
    })()
  `, true);
  await sleep(500);
  await capture(win, '03-track-large-automation.png');

  await clickButton(win, 'Mixer');
  await waitFor(win, `() => document.body.textContent.includes('MASTER') && document.body.textContent.includes('Graphic EQ')`);
  await capture(win, '04-mixer-master.png');

  await clickButton(win, 'Export MP3');
  await waitFor(win, `() => document.body.textContent.includes('Export mixdown') && document.body.textContent.includes('Audio info')`);
  await capture(win, '05-export-dialog.png');

  await win.webContents.executeJavaScript(`
    (() => {
      const close = Array.from(document.querySelectorAll('button')).find((b) => {
        const r = b.getBoundingClientRect();
        return (b.textContent || '').trim() === '×' && r.top > 180 && r.left > 900;
      });
      if (close) close.click();
    })()
  `, true);
  await sleep(500);
  await clickButton(win, 'Mixer');
  await sleep(500);

  await clickMenuItem(win, 'Settings');
  await waitFor(win, `() => document.body.textContent.includes('Color Theme') && document.body.textContent.includes('Modern Blue')`);
  await capture(win, '06-settings-themes.png');

  win.destroy();
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    app.quit();
    process.exitCode = 1;
  });
