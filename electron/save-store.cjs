'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const F = require('../src/save-format.js');
const { createRepository } = require('../src/save-repo.js');

/** Only validated UUIDs become filenames. No renderer-supplied paths reach the filesystem.
 * Recovery, backup rotation, and import policy live in the shared repository; this class
 * supplies durable filesystem primitives. */
class SaveStore {
  constructor(directory) {
    this.directory = directory;
    this.repo = createRepository({
      load: (id) => this.loadFile(this.file(id)),
      loadBackup: (id) => this.loadFile(this.file(id) + '.bak'),
      store: async (id, text) => {
        await this.init();
        await this.atomicWrite(this.file(id), text);
      },
      storeBackup: async (id, text) => {
        await this.init();
        await this.atomicWrite(this.file(id) + '.bak', text);
      },
      remove: (id) => fs.rm(this.file(id), { force: true }),
      removeBackup: (id) => fs.rm(this.file(id) + '.bak', { force: true }),
      ids: async () => {
        await this.init();
        const entries = await fs.readdir(this.directory);
        return [...new Set(entries.map((n) => n.replace(/\.json(?:\.bak)?$/, '')).filter((n) => F.ID.test(n)))];
      },
      newId: randomUUID,
    });
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  file(id) {
    return path.join(this.directory, F.assertId(id) + '.json');
  }
  async loadFile(file) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.size > F.MAX_BYTES) throw Error('Invalid save file size');
    return fs.readFile(file, 'utf8');
  }
  async atomicWrite(destination, text) {
    const temp = destination + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, destination);
      // Directory fsync makes the rename durable on supported filesystems.
      if (process.platform !== 'win32') {
        const dir = await fs.open(path.dirname(destination), 'r');
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }
  read(id) {
    return this.repo.read(id);
  }
  list() {
    return this.repo.list();
  }
  write(input) {
    return this.repo.write(input);
  }
  rename(id, title) {
    return this.repo.rename(id, title);
  }
  delete(id) {
    return this.repo.delete(id);
  }
  async export(id) {
    return (await this.repo.exportRecord(id)).text;
  }
  import(raw) {
    return this.repo.import(raw);
  }
}
module.exports = { SaveStore };
