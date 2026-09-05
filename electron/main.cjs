'use strict';
const { app, BrowserWindow, Menu, ipcMain, protocol, net, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { SaveStore } = require('./save-store.cjs');
const { MAX_BYTES } = require('../src/save-format.js');
const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'starfall://app/index.html';
app.setName('Starfall Command');
protocol.registerSchemesAsPrivileged([{ scheme: 'starfall', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
// Tests never use a player's actual profile or save files.
if (process.env.STARFALL_TEST_MODE === '1') {
  const dir = process.argv.find(a => a.startsWith('--starfall-test-data='))?.split('=').slice(1).join('=');
  if (!dir || !path.isAbsolute(dir)) throw Error('Tests require an isolated, absolute user-data directory');
  mkdirSync(dir, { recursive: true }); app.setPath('userData', dir);
} else {
  const dir = path.join(app.getPath('appData'), 'Starfall Command');
  mkdirSync(dir, { recursive: true }); app.setPath('userData', dir);
}
let win, store, allowQuit = false, ready = false, closeRequest = null, closingDialog = false;
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
function trusted(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== APP_URL) throw Error('Untrusted IPC sender');
}
function handle(channel, fn) { ipcMain.handle(channel, (event, ...args) => { trusted(event); return fn(...args); }); }
function notify(channel, value) { if (win && !win.isDestroyed()) win.webContents.send(channel, value); }
function isFullscreen() { return win.isFullScreen() || process.platform === 'darwin' && win.isSimpleFullScreen(); }
function setFullscreen(flag) { if (process.platform === 'darwin') { win.setSimpleFullScreen(flag); notify('desktop:fullscreen', win.isSimpleFullScreen()); } else win.setFullScreen(flag); }
async function closeFailed() {
  if (closingDialog) return;
  if (closeRequest) clearTimeout(closeRequest.timer);
  closeRequest = null; closingDialog = true;
  if (!win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, { type: 'warning', title: 'Your operation was not saved', message: 'Starfall could not save the current operation.', detail: 'Keep playing to retry or export a save. Quitting now loses progress since the last successful save.', buttons: ['Keep playing', 'Quit without saving'], defaultId: 0, cancelId: 0, noLink: true });
  closingDialog = false;
  if (response === 1) { allowQuit = true; app.quit(); }
}
function requestClose() {
  if (closeRequest || closingDialog) return;
  if (ready === 'crashed') { closeFailed(); return; }
  if (!ready) { allowQuit = true; app.quit(); return; }
  const id = randomUUID(), timer = setTimeout(() => { if (closeRequest?.id === id) closeFailed(); }, 12000);
  closeRequest = { id, timer }; notify('desktop:before-close', id);
}
app.on('before-quit', event => {
  if (!allowQuit && win && !win.isDestroyed()) { event.preventDefault(); win.close(); }
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  store = new SaveStore(path.join(app.getPath('userData'), 'operations')); await store.init();
  protocol.handle('starfall', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    let route; try { route = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const file = path.resolve(ROOT, '.' + route);
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const allowed = relative === 'index.html' || /^(src|assets)\/[a-zA-Z0-9_./-]+\.(js|css|png|svg|webp)$/.test(relative);
    if (!allowed || !file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650, fullscreen: process.platform !== 'darwin', show: false,
    backgroundColor: '#0b1316', title: 'Starfall Command', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, navigateOnDragDrop: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.once('ready-to-show', () => { win.show(); setFullscreen(true); });
  win.on('enter-full-screen', () => notify('desktop:fullscreen', true));
  win.on('leave-full-screen', () => notify('desktop:fullscreen', false));
  win.on('close', event => { if (!allowQuit) { event.preventDefault(); requestClose(); } });
  win.webContents.on('render-process-gone', () => { ready = 'crashed'; if (closeRequest) { clearTimeout(closeRequest.timer); closeFailed(); } });
  handle('desktop:ready', () => { ready = true; return true; });
  handle('desktop:info', () => ({ version: app.getVersion(), fullscreen: isFullscreen(), visible: win.isVisible(), bounds: win.getBounds(), fullscreenable: win.isFullScreenable(), saveDirectory: store.directory, platform: process.platform }));
  handle('desktop:fullscreen', () => { setFullscreen(!isFullscreen()); return true; });
  handle('desktop:quit', () => { win.close(); return true; });
  handle('saves:list', () => store.list());
  handle('saves:read', id => store.read(id));
  handle('saves:write', input => store.write(input));
  handle('saves:rename', (id, title) => store.rename(id, title));
  handle('saves:delete', id => store.delete(id));
  handle('saves:import', async () => {
    const chosen = await dialog.showOpenDialog(win, { title: 'Import Starfall operation', properties: ['openFile'], filters: [{ name: 'Starfall save', extensions: ['json'] }] });
    if (chosen.canceled) return null;
    const file = chosen.filePaths[0], stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
    return store.import(await fs.readFile(file, 'utf8'));
  });
  handle('saves:export', async id => {
    const saved = await store.read(id);
    const chosen = await dialog.showSaveDialog(win, { title: 'Export Starfall operation', defaultPath: saved.record.name.replace(/[^a-zA-Z0-9 _-]/g, '_') + '.starfall.json', filters: [{ name: 'Starfall save', extensions: ['json'] }] });
    if (chosen.canceled || !chosen.filePath) return false;
    await store.atomicWrite(chosen.filePath, JSON.stringify(saved.record, null, 2)); return true;
  });
  handle('saves:import-legacy', raw => store.import(raw));
  ipcMain.on('desktop:close-result', (event, result) => {
    try { trusted(event); } catch { return; }
    if (!closeRequest || result?.id !== closeRequest.id) return;
    clearTimeout(closeRequest.timer); closeRequest = null;
    if (result.ok === true) { allowQuit = true; app.quit(); } else closeFailed();
  });
  const command = value => notify('desktop:command', value);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Starfall Command', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { label: 'Save and Quit', accelerator: 'Command+Q', click: () => app.quit() }] }] : []),
    { label: 'Operation', submenu: [{ label: 'Save', accelerator: 'F5', click: () => command('save') }, { label: 'Game library', accelerator: 'CommandOrControl+L', click: () => command('library') }, { type: 'separator' }, { label: 'Save and Quit', click: () => app.quit() }] },
    { label: 'View', submenu: [{ label: 'Toggle Fullscreen', accelerator: 'F11', click: () => setFullscreen(!isFullscreen()) }, { label: 'Field manual', click: () => command('help') }] }
  ]));
  await win.loadURL(APP_URL);
}).catch(error => { console.error(error); app.exit(1); });
