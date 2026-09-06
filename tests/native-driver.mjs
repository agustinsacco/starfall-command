import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchNative(profile, executable = null) {
  const env = { ...process.env, STARFALL_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = executable ? [] : ['.'];
  const binary = executable || require('electron'),
    launchArgs = [...args, '--remote-debugging-port=0', `--starfall-test-data=${profile}`];
  const child = spawn(binary, launchArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let logs = '',
    ws,
    nextId = 0;
  const pending = new Map(),
    errors = [];
  child.stdout.on('data', (b) => {
    logs += b.toString();
  });
  child.stderr.on('data', (b) => {
    logs += b.toString();
  });
  const until = Date.now() + 20000;
  let endpoint;
  while (Date.now() < until && child.exitCode === null) {
    endpoint = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (endpoint) break;
    await sleep(80);
  }
  if (!endpoint) {
    child.kill();
    throw Error('Electron failed to start: ' + logs);
  }
  const port = new URL(endpoint).port;
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find((t) => t.type === 'page');
    if (target) break;
    await sleep(80);
  }
  if (!target) {
    child.kill();
    throw Error('No Electron page: ' + logs);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    } else if (msg.method === 'Runtime.exceptionThrown')
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('DevTools timeout: ' + method));
        }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const r = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function wait(expression, message, timeout = 15000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    const state = await evaluate(
      '({focused:document.hasFocus(),visibility:document.visibilityState,paused:globalThis.starfallApp?.paused,time:globalThis.starfallApp?.game?.time,operation:globalThis.starfallApp?.operation,status:document.querySelector("#save-status")?.textContent})',
    ).catch(() => null);
    throw Error('Timed out: ' + message + '\n' + JSON.stringify(state) + '\n' + logs);
  }
  async function click(selector) {
    const p = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing element');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  }
  async function key(key, modifiers = 0, hold = 0) {
    const windowsVirtualKeyCode =
      key === 'F2' ? 113 : key === 'ArrowRight' ? 39 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, windowsVirtualKeyCode });
    if (hold) await sleep(hold);
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, windowsVirtualKeyCode });
  }
  async function stop() {
    ws.close();
    for (const p of pending.values()) clearTimeout(p.timer);
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(3000)]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }
  await call('Runtime.enable');
  await call('Page.enable');
  // Keep the automation page active when the operator switches apps. Production pause-on-blur is unchanged.
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  const duplicateInstance = () =>
    new Promise((resolve, reject) => {
      const second = spawn(binary, launchArgs, { env, stdio: 'ignore' });
      const timer = setTimeout(() => {
        second.kill('SIGKILL');
        reject(Error('Duplicate instance did not exit'));
      }, 8000);
      second.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      second.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  const driver = {
    child,
    exited,
    call,
    evaluate,
    wait,
    click,
    key,
    stop,
    duplicateInstance,
    errors,
    get logs() {
      return logs;
    },
  };
  try {
    await wait(
      'typeof starfallApp !== "undefined" && typeof starfallDesktop !== "undefined"',
      'renderer and isolated preload',
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return driver;
}
