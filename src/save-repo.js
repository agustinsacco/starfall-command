'use strict';
/* One repository implementation for both persistence backends. The browser adapter and the
 * Electron save service supply raw-storage primitives; recovery order, identity checks,
 * backup rotation, list shaping, and import semantics live here exactly once. */
((root, factory) => {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./save-format.js'), require('./shared.js'));
  else root.StarfallSaveRepo = factory(root.StarfallSaveFormat, root.StarfallShared);
})(globalThis, (F, shared) => {
  /**
   * primitives:
   *  - load(id) / loadBackup(id): resolve the raw record text, null when absent, throw on damaged storage
   *  - store(id, text) / storeBackup(id, text): persist raw text
   *  - remove(id) / removeBackup(id): delete
   *  - ids(): every operation id present in storage
   *  - newId(): unique id for imports
   */
  function createRepository(primitives) {
    const serial = shared.serialQueue();
    const missing = () => Object.assign(Error('Operation not found'), { missing: true });
    async function parseSide(raw, id, side) {
      const parsed = await F.parseRecord(raw);
      if (parsed.record.id !== id) throw Error(side + ' identity mismatch');
      return parsed;
    }
    async function readInternal(id) {
      F.assertId(id);
      let primaryError;
      try {
        const raw = await primitives.load(id);
        if (raw === null) throw missing();
        return { ...(await parseSide(raw, id, 'Save')), recovered: false };
      } catch (error) {
        primaryError = error;
      }
      let backupError;
      try {
        const raw = await primitives.loadBackup(id);
        if (raw === null) throw missing();
        return { ...(await parseSide(raw, id, 'Backup')), recovered: true };
      } catch (error) {
        backupError = error;
      }
      if (primaryError.missing && backupError.missing) throw missing();
      // A missing primary with a damaged backup should report the backup's actual problem.
      throw primaryError.missing ? backupError : primaryError;
    }
    return {
      serial,
      read: (id) => serial(() => readInternal(id)),
      list: () =>
        serial(async () => {
          const rows = [];
          for (const id of await primitives.ids()) {
            try {
              const r = await readInternal(id);
              rows.push({ ...r.summary, recovered: r.recovered });
            } catch (error) {
              rows.push({ id, name: 'Unreadable operation', corrupt: true, error: error.message, updatedAt: '' });
            }
          }
          return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }),
      write: (input) =>
        serial(async () => {
          F.assertId(input.id);
          let previous = null;
          try {
            previous = await readInternal(input.id);
          } catch (error) {
            if (!error.missing)
              throw Error('Refusing to overwrite an unreadable save. Restore its backup or create a new operation.', {
                cause: error,
              });
          }
          const made = await F.makeRecord(input, previous?.record);
          const text = JSON.stringify(made.record);
          if (new TextEncoder().encode(text).length > F.MAX_BYTES) throw Error('Save exceeds the 16 MB limit');
          if (previous) await primitives.storeBackup(input.id, JSON.stringify(previous.record));
          await primitives.store(input.id, text);
          return made.summary;
        }),
      rename: (id, name) =>
        serial(async () => {
          const previous = await readInternal(id);
          const made = await F.makeRecord({ id, name, snapshot: previous.record.snapshot }, previous.record);
          await primitives.storeBackup(id, JSON.stringify(previous.record));
          await primitives.store(id, JSON.stringify(made.record));
          return made.summary;
        }),
      delete: (id) =>
        serial(async () => {
          F.assertId(id);
          // Remove recovery first, so a completed primary deletion cannot resurrect the game.
          await primitives.removeBackup(id);
          await primitives.remove(id);
          return true;
        }),
      exportRecord: async function (id) {
        const saved = await this.read(id);
        return { record: saved.record, text: JSON.stringify(saved.record, null, 2) };
      },
      import: async function (raw) {
        if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > F.MAX_BYTES)
          throw Error('Save exceeds the 16 MB limit');
        const parsed = JSON.parse(raw);
        let name, snapshot;
        if (parsed?.format === F.FORMAT) {
          const saved = await F.parseRecord(raw);
          name = saved.record.name;
          snapshot = saved.record.snapshot;
        } else {
          name = 'Imported operation';
          snapshot = F.migrateLegacy(raw);
        }
        return this.write({ id: primitives.newId(), name, snapshot });
      },
    };
  }
  return { createRepository };
});
