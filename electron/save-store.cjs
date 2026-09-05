'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const F = require('../src/save-format.js');

/** Only validated UUIDs become filenames. No renderer-supplied paths reach the filesystem. */
class SaveStore {
  constructor(directory) { this.directory = directory; this.pending = Promise.resolve(); }
  async init() { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  file(id) { return path.join(this.directory, F.assertId(id) + '.json'); }
  serialize(fn) { const result = this.pending.then(fn); this.pending = result.catch(() => {}); return result; }
  async atomicWrite(destination, text) {
    const temp = destination + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temp, destination);
      // Directory fsync makes the rename durable on supported filesystems.
      if (process.platform !== 'win32') { const dir = await fs.open(path.dirname(destination), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
    } finally { if (handle) await handle.close().catch(() => {}); await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  async readFile(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > F.MAX_BYTES) throw Error('Invalid save file size');
    return F.parseRecord(await fs.readFile(file, 'utf8'));
  }
  async readInternal(id) {
    const file = this.file(id);
    let originalError;
    try { const saved = await this.readFile(file); if (saved.record.id !== id) throw Error('Save identity mismatch'); return { ...saved, recovered: false }; }
    catch (error) { originalError = error; }
    try { const saved = await this.readFile(file + '.bak'); if (saved.record.id !== id) throw Error('Backup identity mismatch'); return { ...saved, recovered: true }; }
    catch (backupError) { throw originalError.code === 'ENOENT' && backupError.code !== 'ENOENT' ? backupError : originalError; }
  }
  read(id) { return this.serialize(() => this.readInternal(id)); }
  list() { return this.serialize(async () => {
    await this.init();
    const entries = await fs.readdir(this.directory), ids = new Set(entries.map(n => n.replace(/\.json(?:\.bak)?$/, '')).filter(n => F.ID.test(n)));
    const rows = [];
    for (const id of ids) {
      try { const r = await this.readInternal(id); rows.push({ ...r.summary, recovered: r.recovered }); }
      catch (error) { rows.push({ id, name: 'Unreadable operation', corrupt: true, error: error.message, updatedAt: '' }); }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }); }
  write(input) { return this.serialize(async () => {
    await this.init(); F.assertId(input.id);
    let previous = null;
    try { previous = await this.readInternal(input.id); }
    catch (error) { if (error.code !== 'ENOENT') throw Error('Refusing to overwrite an unreadable save. Restore its backup or create a new operation.'); }
    const made = await F.makeRecord(input, previous?.record), text = JSON.stringify(made.record);
    if (Buffer.byteLength(text) > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
    const file = this.file(input.id);
    if (previous) await this.atomicWrite(file + '.bak', JSON.stringify(previous.record));
    await this.atomicWrite(file, text);
    return made.summary;
  }); }
  rename(id, title) { return this.serialize(async () => {
    const previous = await this.readInternal(id);
    const made = await F.makeRecord({ id, name: title, snapshot: previous.record.snapshot }, previous.record);
    await this.atomicWrite(this.file(id) + '.bak', JSON.stringify(previous.record));
    await this.atomicWrite(this.file(id), JSON.stringify(made.record));
    return made.summary;
  }); }
  delete(id) { return this.serialize(async () => {
    const file = this.file(id);
    // Remove recovery first, so a completed primary deletion cannot resurrect the game.
    await fs.rm(file + '.bak', { force: true }); await fs.rm(file, { force: true }); return true;
  }); }
  async export(id) { const saved = await this.read(id); return JSON.stringify(saved.record, null, 2); }
  async import(raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
    let snapshot, title;
    const parsed = JSON.parse(raw);
    if (parsed?.format === F.FORMAT) { const saved = await F.parseRecord(raw); snapshot = saved.record.snapshot; title = saved.record.name; }
    else { snapshot = F.migrateLegacy(raw); title = 'Imported operation'; }
    return this.write({ id: randomUUID(), name: title, snapshot });
  }
}
module.exports = { SaveStore };
