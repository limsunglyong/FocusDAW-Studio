'use strict';

// Captures the Audio In / recording screenshots used by the in-app manual
// (section 4 "오디오 녹음 / Recording"). Run with:  npx electron manual/capture-recording-screens.js
// Mirrors the driving style of capture-app-screens.js.

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

async function clickButtonText(win, text) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const needle = ${JSON.stringify(text)};
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim() === needle
          || (el.textContent || '').replace(/\\s+/g, ' ').trim().includes(needle));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error('Button not found: ' + text);
  await sleep(700);
}

async function clickByTitle(win, titleNeedle) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const needle = ${JSON.stringify(titleNeedle)};
      const btn = Array.from(document.querySelectorAll('button'))
        .find((el) => (el.getAttribute('title') || '').includes(needle));
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error('Button (by title) not found: ' + titleNeedle);
  await sleep(500);
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

async function capture(win, name, rect) {
  await sleep(400);
  const image = rect ? await win.capturePage(rect) : await win.capturePage();
  fs.writeFileSync(path.join(outDir, name), image.toPNG());
  console.log('captured', name, rect ? JSON.stringify(rect) : '(full)');
}

// Scroll the Audio In track header into view and return its bounding rect (padded).
async function audioInHeaderRect(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const mon = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'MON');
      if (mon) mon.scrollIntoView({ block: 'center' });
    })()
  `, true);
  await sleep(500);
  return await win.webContents.executeJavaScript(`
    (() => {
      const mon = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'MON');
      if (!mon) return null;
      let el = mon;
      while (el && el.offsetWidth < 260) el = el.parentElement;   // walk up to the 274px TrackHeader
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.left) - 8),
        y: Math.max(0, Math.floor(r.top) - 12),
        width: Math.min(340, Math.ceil(r.width) + 16),
        height: Math.ceil(r.height) + 24,
      };
    })()
  `, true);
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
      partition: 'manual-capture-rec-' + Date.now(),
    },
  });

  await win.loadFile(path.join(root, 'studio.html'));
  await waitFor(win, `() => document.querySelector('#root') && document.querySelector('#root').textContent.length > 30`);
  await waitFor(win, `() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.includes('Load demo session'))`);

  // Demo session for realistic context (file stems the Audio In track overdubs onto).
  await clickButtonText(win, 'Load demo session');
  await waitFor(win, `() => document.body.textContent.includes('Drums') && document.body.textContent.includes('OUTPUT')`);

  // Track size L so the full Audio In control layout (ARM · port · MON · LIM · gain) is visible.
  await clickButtonText(win, 'L');
  await sleep(400);

  // Add an Audio In track.
  await clickButtonText(win, '+ Audio In');
  await waitFor(win, `() => Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'MON')`);
  await sleep(600);

  // 47 — Audio In track header controls (un-armed close-up).
  let rect = await audioInHeaderRect(win);
  await capture(win, '47-audio-in-track.png', rect);

  // Arm the track, then capture the same close-up (red ARM).
  await clickButtonText(win, 'ARM');
  await sleep(500);
  rect = await audioInHeaderRect(win);
  await capture(win, '48-audio-in-armed.png', rect);

  // 49 — 3-2-1 count-in overlay (full window). The overlay renders immediately on Record,
  // before any device is touched, so it captures cleanly.
  await clickByTitle(win, 'Record armed Audio In track');
  await sleep(900);
  await capture(win, '49-record-countin.png');
  // Cancel the count-in so no real device-recording attempt runs.
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find((el) => (el.getAttribute('title') || '').includes('Stop recording') || (el.getAttribute('title') || '').includes('Record'));
      if (btn) btn.click();
    })()
  `, true).catch(() => {});
  await sleep(600);

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
