'use strict';
(() => {
  const F = StarfallSaveFormat, prefix = 'starfall-operation-v2/';
  class BrowserSaves {
    constructor() { this.pending = Promise.resolve(); }
    serial(fn) { const result = this.pending.then(fn); this.pending = result.catch(() => {}); return result; }
    key(id) { return prefix + F.assertId(id); }
    async readInternal(id) {
      const key = this.key(id), raw = localStorage.getItem(key), backup = localStorage.getItem(key + '/backup');
      let error;
      try { if (!raw) throw Error('Operation not found'); const parsed = await F.parseRecord(raw); if (parsed.record.id !== id) throw Error('Save identity mismatch'); return { ...parsed, recovered: false }; } catch (e) { error = e; }
      if (backup) { const parsed = await F.parseRecord(backup); if (parsed.record.id !== id) throw Error('Backup identity mismatch'); return { ...parsed, recovered: true }; }
      throw error;
    }
    list() { return this.serial(async () => {
      const ids = new Set();
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) { const id = k.slice(prefix.length).split('/')[0]; if (F.ID.test(id)) ids.add(id); } }
      const list = [];
      for (const id of ids) { try { const r = await this.readInternal(id); list.push({ ...r.summary, recovered: r.recovered }); } catch (error) { list.push({ id, name: 'Unreadable operation', corrupt: true, error: error.message, updatedAt: '' }); } }
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }); }
    read(id) { return this.serial(() => this.readInternal(id)); }
    write(input) { return this.serial(async () => {
      const key = this.key(input.id); let previous = null;
      if (localStorage.getItem(key) || localStorage.getItem(key + '/backup')) previous = await this.readInternal(input.id);
      const made = await F.makeRecord(input, previous?.record);
      if (previous) localStorage.setItem(key + '/backup', JSON.stringify(previous.record));
      localStorage.setItem(key, JSON.stringify(made.record)); return made.summary;
    }); }
    async rename(id, name) { const r = await this.read(id); return this.write({ id, name, snapshot: r.record.snapshot }); }
    delete(id) { return this.serial(async () => { const key = this.key(id); localStorage.removeItem(key + '/backup'); localStorage.removeItem(key); return true; }); }
    async importLegacy(raw) {
      if (raw.length > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
      const parsed = JSON.parse(raw); let name, snapshot;
      if (parsed?.format === F.FORMAT) { const r = await F.parseRecord(raw); name = r.record.name; snapshot = r.record.snapshot; }
      else { name = 'Imported operation'; snapshot = F.migrateLegacy(raw); }
      return this.write({ id: crypto.randomUUID(), name, snapshot });
    }
    async importFile() {
      const file = await new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.hidden = true;
        input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); }, { once: true });
        input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
        document.body.append(input); input.click();
      });
      if (!file) return null; if (file.size > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
      return this.importLegacy(await file.text());
    }
    async exportFile(id) {
      const r = await this.read(id), blob = new Blob([JSON.stringify(r.record, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = r.record.name.replace(/[^a-zA-Z0-9 _-]/g, '_') + '.starfall.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); return true;
    }
  }
  const desktop = globalThis.starfallDesktop;
  globalThis.StarfallSaves = desktop ? desktop.saves : new BrowserSaves();
})();
