import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
let chromePath;
for (const candidate of candidates) { try { await access(candidate); chromePath = candidate; break; } catch {} }
if (!chromePath) throw Error('Chrome not found. Set CHROME_PATH to an installed Chrome/Chromium executable.');
const temp = await mkdtemp(path.join(tmpdir(), 'starfall-browser-'));
const shots = process.env.SCREENSHOT_DIR || path.join(temp, 'screenshots');
await mkdir(shots, { recursive: true });
const server = createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = route === '/' ? 'index.html' : route.slice(1);
  if (!(file === 'index.html' || /^src\/[a-z-]+\.(js|css)$/.test(file))) { res.writeHead(404); res.end(); return; }
  try { const body = await readFile(new URL('../' + file, import.meta.url)); res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const child = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws, id = 0, errors = [], stderr = '';
const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timeout: ' + stderr)), 20000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.stderr.on('data', b => { stderr += b.toString(); const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Chrome exited: ' + code)); });
  });
  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout: ' + method)); }, 10000); pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const wait = async (expression, message, ms = 5000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(80); } throw Error('Timed out: ' + message); };
  const mouse = async (x, y, button = 'left', modifiers = 0) => { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, modifiers }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1, modifiers }); };
  const click = async selector => { const r = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`); await mouse(r.x, r.y); };
  const key = async (key, modifiers = 0, hold = 0) => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, windowsVirtualKeyCode: key === 'F2' ? 113 : key === 'ArrowRight' ? 39 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 }); if (hold) await sleep(hold); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers }); };
  const worldClick = async (x, y, button = 'left') => { const p = await evaluate(`(()=>{const p=starfallApp.worldToScreen(${x},${y}),r=document.querySelector('#field').getBoundingClientRect();return{x:p.x+r.x,y:p.y+r.y};})()`); await mouse(p.x, p.y, button); };
  const capture = async name => { const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64')); };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await call('Page.navigate', { url: origin + '/?windowed=1' });
  await wait('typeof starfallApp !== "undefined" && document.querySelector("#deploy-btn")', 'game boot');
  await sleep(300); await capture('01-briefing');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate('document.querySelector("#operation-name").value="Browser Expedition"');
  await click('[data-diff="normal"]'); await click('#deploy-btn');
  await wait('!starfallApp.paused && starfallApp.game.time > 0', 'deployment');
  assert.equal(await evaluate('starfallApp.game.difficulty'), 'normal');
  console.log('PASS deployment and difficulty');

  const bay = await evaluate('starfallApp.game.own(0,"barracks")[0]');
  await worldClick(bay.x, bay.y);
  assert.equal(await evaluate('starfallApp.selection[0]'), bay.id);
  await click('[data-command="Ranger"]');
  assert.equal(await evaluate(`starfallApp.game.entity(${bay.id}).queue.length`), 1);
  console.log('PASS real-pointer selection and production queue');

  await key('F2');
  assert.equal(await evaluate('starfallApp.selection.length'), 2);
  await key('1', 2);
  await key('a'); await worldClick(1040, 1110);
  assert.equal(await evaluate('starfallApp.selection.every(id => starfallApp.game.entity(id).order.type === "attackmove")'), true);
  assert.equal(await evaluate('starfallApp.marks.at(-1)?.kind'), 'attackmove', 'attack-move click leaves an acknowledgement marker');
  await key('s');
  await key('1');
  assert.equal(await evaluate('starfallApp.selection.length'), 2);
  await worldClick(1100, 1130, 'right');
  assert.equal(await evaluate('starfallApp.selection.every(id => starfallApp.game.entity(id).order.type === "move")'), true);
  assert.equal(await evaluate('starfallApp.marks.at(-1)?.kind'), 'move');
  const originalCamera = await evaluate('starfallApp.camera.x'); await key('ArrowRight', 0, 220);
  assert.ok(await evaluate('starfallApp.camera.x') > originalCamera);
  const wheel = init => evaluate(`document.querySelector('#field').dispatchEvent(new WheelEvent('wheel',Object.assign({bubbles:true,cancelable:true,clientX:800,clientY:350},${JSON.stringify(init)})))`);
  const beforePan = await evaluate('starfallApp.camera');
  await wheel({ deltaX: -120, deltaY: 87.5 });
  const afterPan = await evaluate('starfallApp.camera');
  assert.ok(afterPan.x < beforePan.x && afterPan.y > beforePan.y, 'two-finger trackpad scroll pans the battlefield');
  assert.equal(afterPan.z, beforePan.z, 'trackpad scroll pans without zooming');
  await wheel({ deltaY: 6, ctrlKey: true });
  const afterPinch = await evaluate('starfallApp.camera.z');
  assert.ok(afterPinch < afterPan.z, 'pinch gestures zoom');
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 350, deltaX: 0, deltaY: -100 });
  await sleep(100);
  assert.ok(await evaluate('starfallApp.camera.z') > afterPinch, 'discrete mouse-wheel notches still zoom');
  console.log('PASS army, groups, order feedback markers, trackpad pan, pinch zoom, and wheel zoom');

  await click('#home-btn');
  const worker = await evaluate('starfallApp.game.own(0,"drone")[0]');
  await worldClick(worker.x, worker.y);
  const patch = await evaluate(`starfallApp.game.nearestResource(starfallApp.game.entity(${worker.id}), 'mineral')`);
  await worldClick(patch.x, patch.y, 'right');
  assert.equal(await evaluate(`starfallApp.game.entity(${worker.id}).order.type`), 'gather');
  const gatherMark = await evaluate('starfallApp.marks.at(-1)');
  assert.equal(gatherMark?.kind, 'gather');
  assert.equal(gatherMark?.target, patch.id, 'the gather marker links the drone to its assigned patch');
  assert.deepEqual(gatherMark?.units, [worker.id]);
  await key('b');
  await wait(`!!document.querySelector('[data-command="Supply Relay"]')`, 'construction palette');
  await click('[data-command="Supply Relay"]');
  const site = await evaluate('(()=>{const g=starfallApp.game;for(let y=1110;y<1490;y+=25)for(let x=300;x<800;x+=25)if(g.placement("relay",x,y,0).ok)return{x,y};})()');
  assert.ok(site);
  const priorRelays = await evaluate('starfallApp.game.own(0,"relay").length');
  await worldClick(site.x, site.y);
  assert.equal(await evaluate('starfallApp.game.own(0,"relay").length'), priorRelays + 1);
  assert.equal(await evaluate('starfallApp.mode'), null);
  assert.equal(await evaluate('starfallApp.marks.at(-1)?.kind'), 'build', 'placing a structure acknowledges the construction order');
  console.log('PASS real construction palette, battlefield placement, and build feedback');

  await key('p'); assert.equal(await evaluate('starfallApp.paused'), true);
  const frozen = await evaluate('starfallApp.game.time'); await sleep(250);
  assert.equal(await evaluate('starfallApp.game.time'), frozen);
  const operationId = await evaluate('starfallApp.operation.id');
  const revision = await evaluate('starfallApp.operation.revision');
  await click('#save-btn');
  await wait(`starfallApp.operation.revision > ${revision}`, 'asynchronous save commit');
  const savedSimulation = await evaluate(`JSON.parse(localStorage.getItem('starfall-operation-v2/${operationId}')).snapshot.simulation`);
  assert.ok(savedSimulation);
  await click('#resume-btn'); await sleep(350); await key('p'); await click('#load-btn');
  await wait(`!!document.querySelector('[data-save-id="${operationId}"]')`, 'saved game library');
  await capture('03-library');
  await click(`[data-save-id="${operationId}"] [data-action="load"]`);
  await wait('!!document.querySelector("#resume-btn")', 'restored game starts paused');
  assert.equal(await evaluate('starfallApp.paused'), true);
  assert.equal(await evaluate('starfallApp.game.save()'), savedSimulation);
  assert.equal(await evaluate('starfallApp.game.time'), frozen);
  await click('#resume-btn');
  console.log('PASS named library and exact asynchronous save/load restoration');

  await click('#sound-btn');
  assert.equal(await evaluate('document.querySelector("#sound-btn").getAttribute("aria-label")'), 'Disable sound');
  await click('#help-btn');
  assert.ok(await evaluate('document.querySelector("#modal").textContent.includes("Your first five minutes.")'));
  await click('#close-help');
  console.log('PASS sound toggle and field manual');
  await wait('starfallApp.game.teams[0].stats.trained >= 1', 'real-time production completion', 16000);
  assert.ok(await evaluate('starfallApp.game.own(0,"ranger").length') >= 3);
  console.log('PASS queued unit actually finishes in the live browser');
  await key('F2'); await click('#home-btn'); await capture('02-battlefield');

  // Explicit light must win over the emulated dark OS preference.
  await evaluate('document.documentElement.dataset.theme="light"');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(232, 238, 233)');
  await sleep(250);
  assert.ok((await evaluate('getComputedStyle(document.querySelector(".cmd")).backgroundImage')).includes('rgb(232, 238, 233)'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".cmd")).color'), 'rgb(24, 53, 44)');
  await capture('03-light-theme');
  await evaluate('document.documentElement.dataset.theme="dark"');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  assert.equal(await evaluate('innerWidth'), 390, 'Viewport must use device width, not a scaled desktop layout');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await evaluate('document.querySelector("#field").getBoundingClientRect().height') >= 340);
  await capture('04-narrow');
  console.log('PASS theme override and 390px layout without horizontal overflow');

  // Corrupt/denied storage must return failure rather than claiming a successful save.
  assert.equal(await evaluate('(async()=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error("denied")};try{return await starfallApp.saveGame();}finally{Storage.prototype.setItem=old;}})()'), false);
  assert.equal(await evaluate(`(async()=>{const id=starfallApp.operation.id;localStorage.setItem('starfall-operation-v2/'+id,'broken');localStorage.removeItem('starfall-operation-v2/'+id+'/backup');return await starfallApp.loadGame(id);})()`), false);
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  console.log('PASS storage failure paths and zero runtime exceptions');
  console.log(`Browser checks passed. Screenshots: ${shots}`);
} finally {
  if (ws) ws.close();
  for (const p of pending.values()) clearTimeout(p.timer);
  child.kill('SIGTERM');
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000).unref(); } });
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
