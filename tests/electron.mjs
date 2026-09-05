import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchNative, sleep } from './native-driver.mjs';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'starfall-electron-test-'));
const profile = path.join(temp, 'profile');
const shots = process.env.SCREENSHOT_DIR || path.join(temp, 'screenshots');
await fs.mkdir(shots, { recursive: true });
let driver;
async function capture(name) { const shot = await driver.call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(shot.data, 'base64')); }
async function quitThroughUI() {
  await driver.click('#quit-btn');
  const result = await Promise.race([driver.exited, sleep(18000).then(() => { throw Error('App did not finish save-on-quit: ' + driver.logs); })]);
  assert.equal(result.code, 0); assert.deepEqual(driver.errors, []); await driver.stop(); driver = null;
}
try {
  driver = await launchNative(profile, process.env.STARFALL_EXECUTABLE);
  await driver.wait('(async()=> (await starfallDesktop.info()).fullscreen)()', 'native fullscreen transition');
  const info = await driver.evaluate('starfallDesktop.info()');
  assert.equal(info.saveDirectory, path.join(profile, 'operations'));
  assert.equal(info.visible, true);
  const viewport = await driver.evaluate('({w:innerWidth,h:innerHeight,sw:screen.width,sh:screen.height})');
  assert.ok(Math.abs(viewport.w - viewport.sw) <= 2 && Math.abs(viewport.h - viewport.sh) <= 2, 'Fullscreen content must fill the physical display in CSS pixels');
  assert.equal(await driver.evaluate('document.characterSet'), 'UTF-8');
  assert.equal(await driver.evaluate('document.querySelector(".minerals .symbol").textContent'), '◆');
  assert.equal(await driver.evaluate('Starfall.D.drone.role'), 'Worker · construction & harvesting');
  assert.equal(await driver.evaluate('typeof require'), 'undefined');
  assert.equal(await driver.evaluate('typeof process'), 'undefined');
  assert.equal(await driver.evaluate('typeof starfallDesktop.ipcRenderer'), 'undefined');
  assert.equal(await driver.evaluate('fetch("starfall://app/electron/main.cjs").then(r=>r.status)'), 403);
  assert.equal(await driver.evaluate('fetch("starfall://app/src/..%2fnode_modules%2felectron%2findex.js").then(r=>r.status)'), 403, 'Encoded traversal must not escape the public asset directories');
  assert.equal(await driver.evaluate('starfallDesktop.saves.read("../../escape").then(()=>false,()=>true)'), true);
  await capture('native-01-fullscreen');
  await driver.click('#fullscreen-btn');
  await driver.wait('(async()=> !(await starfallDesktop.info()).fullscreen)()', 'leaving fullscreen');
  await driver.click('#fullscreen-btn');
  await driver.wait('(async()=> (await starfallDesktop.info()).fullscreen && Math.abs(innerWidth-screen.width)<=2 && Math.abs(innerHeight-screen.height)<=2)()', 'returning to display-filling fullscreen');
  assert.equal(await driver.duplicateInstance(), 0, 'A second app instance must exit without competing for save files');
  assert.equal(driver.child.exitCode, null);
  console.log('PASS actual fullscreen Electron window, single-instance ownership, isolated preload, restricted protocol and IPC');

  await driver.evaluate('document.querySelector("#operation-name").value="Native Expedition Alpha"');
  await driver.click('#deploy-btn');
  await driver.wait('starfallApp.operation?.name === "Native Expedition Alpha" && !starfallApp.paused', 'native game creation');
  const alpha = await driver.evaluate('starfallApp.operation.id');
  // Deliberately exercise queued production, an unfinished building, navigation, cargo, and control groups.
  await driver.evaluate(`(()=>{const g=starfallApp.game;g.teams[0].minerals+=500;g.train(g.own(0,'barracks')[0].id,'ranger');g.order(g.own(0,'ranger').map(e=>e.id),'attackmove',1120,1120);g.build(g.own(0,'drone')[0].id,'relay',420,1090);})()`);
  await driver.wait('starfallApp.game.time >= 6', 'real-time simulation with in-flight orders');
  await driver.key('F2'); await driver.key('1', 2);
  await driver.key('ArrowRight', 0, 150); await driver.click('#speed-btn'); await driver.key('a');
  await driver.click('#pause-btn');
  assert.equal(await driver.evaluate('starfallApp.paused'), true);
  await driver.evaluate('document.querySelector("#sound-btn").click()');
  const expected = await driver.evaluate('starfallApp.captureState()');
  assert.ok(JSON.parse(expected.simulation).entities.some(e => e.queue.length));
  assert.ok(JSON.parse(expected.simulation).entities.some(e => !e.complete));
  assert.ok(JSON.parse(expected.simulation).entities.some(e => e.path.length));
  assert.ok(expected.view.groups['1'].length >= 2);
  assert.ok(expected.view.selection.length >= 2);
  assert.notEqual(expected.view.camera.x, 650);
  assert.equal(expected.view.speed, 1.5);
  assert.deepEqual(expected.view.mode, { type: 'attackmove' });
  await quitThroughUI();
  const persisted = JSON.parse(await fs.readFile(path.join(profile, 'operations', alpha + '.json'), 'utf8'));
  assert.deepEqual(persisted.snapshot, expected, 'Graceful quit must await the exact final snapshot on disk');
  console.log('PASS save-on-quit writes the complete live state before the process exits');

  driver = await launchNative(profile, process.env.STARFALL_EXECUTABLE);
  await driver.wait('!!document.querySelector("#continue-btn") && !document.querySelector("#continue-btn").hidden', 'continue after a new process launch');
  await driver.click('#continue-btn');
  await driver.wait('starfallApp.operation?.id === ' + JSON.stringify(alpha), 'restoring original operation');
  assert.equal(await driver.evaluate('starfallApp.paused'), true);
  assert.deepEqual(await driver.evaluate('starfallApp.captureState()'), expected);
  console.log('PASS a fresh Electron process restores exact simulation and view state from disk');

  await driver.click('#load-btn');
  await driver.wait('!!document.querySelector("#library-new")', 'native game library');
  await driver.click('#library-new');
  await driver.wait('!!document.querySelector("#operation-name")', 'new game form');
  await driver.evaluate('document.querySelector("#operation-name").value="Native Expedition Beta";document.querySelector("#operation-seed").value="104729"');
  await driver.click('[data-diff="hard"]'); await driver.click('#deploy-btn');
  await driver.wait('starfallApp.operation?.name === "Native Expedition Beta" && !starfallApp.paused', 'independent second game');
  const beta = await driver.evaluate('starfallApp.operation.id'); assert.notEqual(beta, alpha);
  const beforeAuto = await driver.evaluate('starfallApp.operation.revision');
  await driver.wait(`starfallApp.operation.revision > ${beforeAuto} && starfallApp.operation.time > 10`, 'automatic on-disk save without clicking Save', 40000);
  const rows = await driver.evaluate('starfallDesktop.saves.list()'); assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.id === beta).difficulty, 'hard');
  assert.equal(rows.find(r => r.id === beta).mapSeed, 104729);
  await driver.click('#pause-btn'); await driver.click('#load-btn');
  await driver.wait(`!!document.querySelector('[data-save-id="${alpha}"]')`, 'both operations in the native library');
  await capture('native-02-library');
  console.log('PASS independent games, mission seed, difficulty and real 30-second autosave');

  await driver.click(`[data-save-id="${alpha}"] [data-action="rename"]`);
  await driver.wait('!!document.querySelector("#save-name")', 'rename form');
  await driver.evaluate('document.querySelector("#save-name").value="Alpha <Vanguard>"');
  await driver.click('#name-form [type="submit"]');
  await driver.wait(`document.querySelector('[data-save-id="${alpha}"] h3')?.textContent === 'Alpha <Vanguard>'`, 'safe operation rename');
  assert.equal(await driver.evaluate('document.querySelector("Vanguard") === null'), true);
  await driver.click(`[data-save-id="${alpha}"] [data-action="load"]`);
  await driver.wait(`starfallApp.operation?.id === '${alpha}'`, 'switch back to first game');
  assert.equal(await driver.evaluate('starfallApp.game.save()'), expected.simulation);
  await driver.click('#load-btn');
  await driver.wait('document.querySelectorAll(".save-card").length === 2', 'library fully loaded before checkpoint action');
  await driver.click('#library-copy');
  await driver.wait('!!document.querySelector("#save-name")', 'checkpoint name');
  await driver.evaluate('document.querySelector("#save-name").value="Independent checkpoint"');
  await driver.click('#name-form [type="submit"]');
  await driver.wait('(async()=> (await starfallDesktop.saves.list()).length === 3)()', 'independent checkpoint');
  const checkpoint = (await driver.evaluate('starfallDesktop.saves.list()')).find(r => r.name === 'Independent checkpoint');
  await driver.wait(`!!document.querySelector('[data-save-id="${checkpoint.id}"]')`, 'new checkpoint card');
  await driver.click(`[data-save-id="${checkpoint.id}"] [data-action="delete"]`);
  await driver.click('#confirm-no');
  assert.equal((await driver.evaluate('starfallDesktop.saves.list()')).length, 3);
  await driver.wait(`!!document.querySelector('[data-save-id="${checkpoint.id}"]')`, 'cancelled deletion');
  await driver.click(`[data-save-id="${checkpoint.id}"] [data-action="delete"]`); await driver.click('#confirm-yes');
  await driver.wait('(async()=> (await starfallDesktop.saves.list()).length === 2)()', 'confirmed deletion');
  console.log('PASS UI rename escaping, save-as-new checkpoint, cancellation and isolated deletion');

  await driver.click('#library-close');
  await capture('native-03-restored');
  await quitThroughUI();
  // A real process restart can also recover a damaged primary, not just an in-memory SaveStore.
  await fs.writeFile(path.join(profile, 'operations', alpha + '.json'), '{truncated');
  driver = await launchNative(profile, process.env.STARFALL_EXECUTABLE);
  await driver.click('#brief-load');
  await driver.wait(`!!document.querySelector('[data-save-id="${alpha}"]')`, 'backup recovery card');
  await driver.click(`[data-save-id="${alpha}"] [data-action="load"]`);
  await driver.wait(`starfallApp.operation?.id === '${alpha}'`, 'recovery from last-known-good backup');
  assert.equal(await driver.evaluate('starfallApp.game.save()'), expected.simulation);
  assert.ok(await driver.evaluate('document.querySelector("#save-status").textContent.includes("BACKUP RESTORED")'));
  await quitThroughUI();
  console.log('PASS native backup recovery and subsequent save repairs the primary');
  console.log('Electron checks passed. Screenshots: ' + shots);
} finally {
  if (driver) await driver.stop();
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
}
