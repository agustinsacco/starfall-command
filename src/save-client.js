'use strict';
(() => {
  const F = StarfallSaveFormat,
    prefix = 'starfall-operation-v2/';
  // localStorage primitives; every policy decision lives in the shared repository.
  const key = (id) => prefix + F.assertId(id);
  const repo = StarfallSaveRepo.createRepository({
    load: async (id) => localStorage.getItem(key(id)),
    loadBackup: async (id) => localStorage.getItem(key(id) + '/backup'),
    store: async (id, text) => localStorage.setItem(key(id), text),
    storeBackup: async (id, text) => localStorage.setItem(key(id) + '/backup', text),
    remove: async (id) => localStorage.removeItem(key(id)),
    removeBackup: async (id) => localStorage.removeItem(key(id) + '/backup'),
    ids: async () => {
      const found = new Set();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          const id = k.slice(prefix.length).split('/')[0];
          if (F.ID.test(id)) found.add(id);
        }
      }
      return [...found];
    },
    newId: () => crypto.randomUUID(),
  });
  class BrowserSaves {
    list() {
      return repo.list();
    }
    read(id) {
      return repo.read(id);
    }
    write(input) {
      return repo.write(input);
    }
    rename(id, name) {
      return repo.rename(id, name);
    }
    delete(id) {
      return repo.delete(id);
    }
    importLegacy(raw) {
      return repo.import(raw);
    }
    async importFile() {
      const file = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.hidden = true;
        input.addEventListener(
          'change',
          () => {
            resolve(input.files[0] || null);
            input.remove();
          },
          { once: true },
        );
        input.addEventListener(
          'cancel',
          () => {
            resolve(null);
            input.remove();
          },
          { once: true },
        );
        document.body.append(input);
        input.click();
      });
      if (!file) return null;
      if (file.size > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
      return repo.import(await file.text());
    }
    async exportFile(id) {
      const { record, text } = await repo.exportRecord(id);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = StarfallShared.sanitizeFilename(record.name) + '.starfall.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    }
  }
  const desktop = globalThis.starfallDesktop;
  globalThis.StarfallSaves = desktop ? desktop.saves : new BrowserSaves();
})();
