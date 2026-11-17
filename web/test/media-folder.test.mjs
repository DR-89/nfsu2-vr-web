// Real IndexedDB structured-clones real directory handles across page visits.
// OPFS supplies the fixture; permission results stand in for the browser's OS
// folder prompt, which headless Chrome cannot display. No media is uploaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { pickBrowser } from '../tools/browser.mjs';

test('local media folders survive visits and reconnect without choosing again', async t => {
  const code = (await esbuild.build({ stdin: {
    contents: "export * from './src/vr/media-panel';export * from './src/radio-folder';export * from './src/vr/settings';export * from './src/app/i18n';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  }, bundle: true, format: 'iife', globalName: 'V', write: false })).outputFiles[0].text;
  const requests = [], errors = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/main.css"><main id="media-library"></main>'); }
    else if (req.url === '/main.css') { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(new URL('../src/app/style.css', import.meta.url))); }
    else if (req.url === '/lang/german.json') { res.setHeader('Content-Type', 'application/json'); res.end(fs.readFileSync(new URL('../src/app/lang/german.json', import.meta.url))); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const browser = await chromium.launch({ ...pickBrowser(), headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('pageerror', e => errors.push(e.message));
  const open = async (permission = 'granted', blockedStore = false) => {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ content: code });
    await page.evaluate(async ({ permission, blockedStore }) => {
      window.qa = { permission, reply: 'granted', asks: 0, picks: 0, reads: 0, queries: 0, inClick: false, logs: [], name: 'Library' };
      const root = await navigator.storage.getDirectory();
      for (const name of ['Library', 'Replacement']) {
        const dir = await root.getDirectoryHandle(name, { create: true });
        await dir.getFileHandle('song.mp3', { create: true });
        await dir.getFileHandle('clip.webm', { create: true });
        await dir.getFileHandle('ignored.txt', { create: true });
        const sub = await dir.getDirectoryHandle('Album', { create: true });
        await sub.getFileHandle('track.ogg', { create: true });
      }
      FileSystemHandle.prototype.queryPermission = async () => {
        qa.queries++;
        if (qa.permission === 'delayed') return new Promise(resolve => { qa.resolveQuery = resolve; });
        if (qa.permission === 'missing') throw new DOMException('Folder gone', 'NotFoundError');
        return qa.permission;
      };
      FileSystemHandle.prototype.requestPermission = async () => { qa.asks++; qa.inClick = navigator.userActivation.isActive; return qa.reply; };
      const getFile = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = function () { qa.reads++; return getFile.call(this); };
      window.showDirectoryPicker = async () => { qa.picks++; return root.getDirectoryHandle(qa.name); };
      if (blockedStore) indexedDB.open = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      const radio = { setExternalPlayback() {}, turnOff() {}, setFolder() {}, enableForNextGame() {} };
      window.panel = new V.MediaPanel(document.querySelector('main'), { radio: () => radio, settings: () => V.vrSettings({}), log: s => qa.logs.push(s) });
    }, { permission, blockedStore });
  };
  const choose = () => page.getByRole('button', { name: 'Choose media folder', exact: true }).click();
  const reconnect = () => page.getByRole('button', { name: 'Allow folder access', exact: true });
  const ready = () => page.waitForFunction(() => document.querySelector('select').options.length === 3 && !document.querySelector('button').disabled);
  const stats = () => page.evaluate(() => ({ asks: qa.asks, picks: qa.picks, reads: qa.reads, inClick: qa.inClick }));

  await t.test('picking keeps only a handle and a fresh page restores both audio and video', async () => {
    await open(); await choose(); await ready();
    assert.match(await page.locator('p').first().innerText(), /remembered in this browser/);
    assert.deepEqual(await page.locator('option').allTextContents(), ['clip.webm', 'song.mp3', 'Album/track.ogg']);
    assert.equal(await page.evaluate(async () => (await V.keptFolder('media-folder')) instanceof FileSystemDirectoryHandle), true);
    assert.deepEqual(await stats(), { asks: 0, picks: 1, reads: 0, inClick: false });
    await open(); await ready();
    assert.equal(await reconnect().isVisible(), false);
    assert.deepEqual(await stats(), { asks: 0, picks: 0, reads: 0, inClick: false });
  });

  await t.test('denial keeps the saved folder; an explicit click reconnects it without a picker', async () => {
    await open('prompt'); await reconnect().waitFor();
    assert.equal(await page.locator('select').isDisabled(), true);
    assert.match(await page.getByRole('status').innerText(), /^Library:/);
    assert.deepEqual(await stats(), { asks: 0, picks: 0, reads: 0, inClick: false });
    await page.evaluate(() => { qa.reply = 'denied'; }); await reconnect().click();
    await page.waitForFunction(() => !document.querySelectorAll('button')[1].disabled);
    assert.equal(await reconnect().isVisible(), true);
    assert.equal(await page.evaluate(async () => (await V.keptFolder('media-folder')).name), 'Library');
    await page.evaluate(() => { qa.reply = 'granted'; }); await reconnect().click(); await ready();
    assert.deepEqual(await stats(), { asks: 2, picks: 0, reads: 0, inClick: true });
    assert.equal(await reconnect().isVisible(), false);
  });

  await t.test('a stale startup read cannot replace a new folder', async () => {
    await open('delayed'); await page.waitForFunction(() => !!qa.resolveQuery);
    await page.evaluate(() => { qa.name = 'Replacement'; }); await choose(); await ready();
    await page.evaluate(async () => { qa.resolveQuery('granted'); await new Promise(r => setTimeout(r, 50)); });
    assert.equal(await page.getByRole('status').innerText(), 'Replacement');
    assert.equal(await page.evaluate(async () => (await V.keptFolder('media-folder')).name), 'Replacement');
  });

  await t.test('a cancelled picker preserves reconnection; missing folders offer replacement', async () => {
    await open('prompt'); await reconnect().waitFor();
    await page.evaluate(() => { window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
    await choose(); await page.waitForFunction(() => !document.querySelector('button').disabled);
    assert.equal(await reconnect().isVisible(), true);
    await reconnect().click(); await ready();
    await open('missing'); await reconnect().waitFor();
    assert.match(await page.getByRole('status').innerText(), /Choose it again/);
    await choose(); await ready(); assert.equal(await page.getByRole('status').innerText(), 'Library');
  });

  await t.test('German reconnect controls fit on a narrow page', async () => {
    await open('prompt'); await reconnect().waitFor(); await page.evaluate(() => V.setLanguage('german'));
    const button = page.getByRole('button', { name: 'Ordnerzugriff erlauben', exact: true });
    await page.setViewportSize({ width: 375, height: 800 });
    const bounds = await button.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, JSON.stringify(bounds));
    assert.match(await page.locator('p').first().innerText(), /auf diesem Gerät/);
    if (process.env.NFSU2_MEDIA_FOLDER_SCREENSHOT) await page.screenshot({ path: process.env.NFSU2_MEDIA_FOLDER_SCREENSHOT });
    await button.click(); await ready();
  });

  await t.test('blocked storage still allows this visit and explains that the choice cannot be kept', async () => {
    await open('granted', true); await choose(); await ready();
    assert.match(await page.locator('p').first().innerText(), /cannot remember the folder/);
    assert.equal(await reconnect().isVisible(), false);
    assert.deepEqual(await stats(), { asks: 0, picks: 1, reads: 0, inClick: false });
  });

  await t.test('file-input fallback remains available without claiming persistence', async () => {
    await open('granted', true); await page.evaluate(() => { delete window.showDirectoryPicker; });
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nfsu2-media-folder-'));
    t.after(() => {
      assert.equal(path.dirname(fs.realpathSync(folder)), fs.realpathSync(os.tmpdir()));
      fs.rmSync(folder, { recursive: true, force: true });
    });
    fs.writeFileSync(`${folder}/song.mp3`, 'local fixture');
    const chooser = page.waitForEvent('filechooser'); await choose(); await (await chooser).setFiles(folder);
    await page.waitForFunction(() => document.querySelector('select').options.length === 1);
    assert.match(await page.locator('p').first().innerText(), /cannot remember the folder/);
    assert.equal(await reconnect().isVisible(), false);
  });

  assert.deepEqual(errors, []);
  assert.ok(requests.every(r => r.method === 'GET' && ['/', '/main.css', '/lang/german.json', '/favicon.ico'].includes(r.path)), JSON.stringify(requests));
});
