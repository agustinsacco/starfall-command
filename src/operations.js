'use strict';
(() => {
  const F = StarfallSaveFormat,
    { Game } = Starfall,
    { formatTime, DIFFICULTY_NAMES, serialQueue } = StarfallShared;
  const tpl = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
  class Operations {
    constructor(hooks) {
      this.h = hooks;
      this.repo = StarfallSaves;
      this.current = null;
      this.lastTime = -1;
      this.lock = serialQueue();
      this.autosaveInterval = setInterval(() => {
        if (this.current && !this.h.paused() && this.h.time() !== this.lastTime) this.save(true);
      }, 30000);
    }
    status(text, error = false) {
      const e = document.querySelector('#save-status');
      if (e) {
        e.textContent = text;
        e.classList.toggle('save-error', error);
      }
    }
    async persist(silent = false) {
      if (!this.current) return true;
      this.status('SAVING…');
      try {
        const snapshot = this.h.capture();
        const summary = await this.repo.write({ id: this.current.id, name: this.current.name, snapshot });
        this.current = summary;
        this.lastTime = summary.time;
        this.status('SAVED · ' + formatTime(this.lastTime));
        if (!silent) this.h.toast('Operation saved.');
        return true;
      } catch (error) {
        this.status('SAVE FAILED', true);
        this.h.toast('Save failed: ' + error.message, true);
        return false;
      }
    }
    save(silent = false) {
      return this.lock(() => this.persist(silent));
    }
    async init() {
      const desktop = globalThis.starfallDesktop;
      if (desktop) {
        desktop.onBeforeClose(() => {
          this.h.pauseForSave();
          return this.save(true);
        });
        desktop.onCommand((command) => {
          if (command === 'save') this.save();
          if (command === 'library') this.library();
          if (command === 'help') this.h.help();
        });
        desktop.onFullscreen((full) => this.fullscreenLabel(full));
        try {
          const info = await desktop.info();
          this.fullscreenLabel(info.fullscreen);
        } catch (error) {
          this.h.toast(error.message, true);
        }
        await desktop.ready();
      } else document.addEventListener('fullscreenchange', () => this.fullscreenLabel(!!document.fullscreenElement));
      // Browser v1 saves are deliberately retained after migration. Cross-browser profiles are not accessed.
      try {
        const legacy = localStorage.getItem('starfall-save-v1');
        if (legacy && !localStorage.getItem('starfall-v1-migrated')) {
          const imported = await this.repo.importLegacy(legacy);
          localStorage.setItem('starfall-v1-migrated', imported.id);
          this.h.toast('Your previous browser save is now in the game library.');
        }
      } catch (error) {
        this.h.toast('Legacy save could not be imported: ' + error.message, true);
      }
      this.refreshContinue();
    }
    async refreshContinue() {
      try {
        const rows = await this.repo.list(),
          last = rows.find((r) => !r.corrupt && !r.result);
        const button = document.querySelector('#continue-btn');
        if (button) {
          button.hidden = !last;
          button.textContent = last ? 'CONTINUE · ' + last.name : '';
          button.onclick = () => this.load(last.id);
        }
      } catch {
        this.status('STORAGE UNAVAILABLE', true);
      }
    }
    fullscreenLabel(full) {
      const button = document.querySelector('#fullscreen-btn');
      if (button) {
        button.textContent = full ? '⤢' : '⛶';
        button.title = full ? 'Leave fullscreen (F11)' : 'Enter fullscreen (F11)';
        button.setAttribute('aria-label', button.title);
      }
    }
    async toggleFullscreen() {
      try {
        if (globalThis.starfallDesktop) await starfallDesktop.toggleFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        this.h.toast('Fullscreen is unavailable in this window.', true);
      }
    }
    create(title, level, seed) {
      return this.lock(async () => {
        let name;
        try {
          name = F.name(title);
        } catch (error) {
          this.h.toast(error.message, true);
          return false;
        }
        if (this.current && !(await this.persist(true))) return false;
        try {
          const game = new Game(level, seed),
            small = innerWidth < 760;
          const snapshot = {
            version: 2,
            simulation: game.save(),
            paused: false,
            view: {
              camera: {
                x: small ? 440 : 650,
                y: small ? 1280 : 1160,
                z: Math.max(0.6, Math.min(1, innerWidth / 1150)),
              },
              selection: [game.own(0, 'hq')[0].id],
              groups: {},
              speed: 1,
              sound: this.h.capture().view.sound,
              mode: null,
              tab: 'actions',
              accumulator: 0,
            },
          };
          const summary = await this.repo.write({ id: crypto.randomUUID(), name, snapshot });
          this.current = summary;
          this.lastTime = 0;
          this.h.apply(snapshot, summary, true);
          this.status('SAVED · 00:00');
          this.h.toast('Operation created. Autosave every 30 seconds; F5 saves now.');
          return true;
        } catch (error) {
          this.h.toast('Could not create operation: ' + error.message, true);
          return false;
        }
      });
    }
    load(id) {
      return this.lock(async () => {
        if (this.current && this.current.id !== id && !(await this.persist(true))) return false;
        try {
          const saved = await this.repo.read(id);
          F.validateSnapshot(saved.record.snapshot);
          this.current = saved.summary;
          this.lastTime = saved.summary.time;
          this.h.apply(saved.record.snapshot, saved.summary, false);
          this.status((saved.recovered ? 'BACKUP RESTORED · ' : 'SAVED · ') + formatTime(saved.summary.time));
          this.h.toast(
            saved.recovered
              ? 'Recovered the previous valid backup. Inspect it, then save to repair the latest slot.'
              : 'Operation restored. Resume when you are ready.',
            saved.recovered,
          );
          return true;
        } catch (error) {
          this.h.toast('Load failed: ' + error.message, true);
          return false;
        }
      });
    }
    saveCard(row) {
      const card = tpl('tpl-save-card'),
        active = row.id === this.current?.id,
        pick = (s) => card.querySelector(s);
      card.dataset.saveId = row.id;
      pick('.save-map span').textContent = row.corrupt ? '!' : row.result === 'victory' ? '✧' : '⬡';
      pick('.save-info .eyebrow').textContent = row.corrupt
        ? 'DAMAGED SAVE'
        : (active ? 'CURRENT OPERATION · ' : '') +
          (row.recovered ? 'BACKUP AVAILABLE' : row.result ? row.result.toUpperCase() : 'IN PROGRESS');
      pick('.save-info h3').textContent = row.name;
      pick('.save-info p').textContent = row.corrupt
        ? row.error
        : DIFFICULTY_NAMES[row.difficulty] +
          ' · ' +
          formatTime(row.time) +
          ' played · ' +
          row.units +
          ' units · ' +
          row.buildings +
          ' structures';
      pick('.save-info small').textContent = row.updatedAt
        ? new Date(row.updatedAt).toLocaleString() + ' · revision ' + row.revision
        : 'Original file retained for recovery';
      const load = pick('[data-action="load"]');
      load.textContent = (row.result ? 'Review' : 'Continue') + ' ↗';
      load.disabled = row.corrupt;
      load.onclick = () => this.load(row.id);
      pick('[data-action="rename"]').disabled = row.corrupt;
      pick('[data-action="rename"]').onclick = () =>
        this.nameDialog('Rename operation', row.name, (title) =>
          this.lock(async () => {
            try {
              const updated = await this.repo.rename(row.id, title);
              if (active) {
                this.current = updated;
                const label = document.querySelector('#operation-title');
                if (label) label.textContent = updated.name;
              }
              await this.library();
              return true;
            } catch (error) {
              this.h.toast(error.message, true);
              return false;
            }
          }),
        );
      pick('[data-action="export"]').disabled = row.corrupt;
      pick('[data-action="export"]').onclick = async () => {
        try {
          if (await this.repo.exportFile(row.id)) this.h.toast('Save exported.');
        } catch (error) {
          this.h.toast('Export failed: ' + error.message, true);
        }
      };
      const remove = pick('[data-action="delete"]');
      if (active) {
        remove.disabled = true;
        remove.title = 'Switch operations before deleting this game';
      }
      remove.onclick = () =>
        this.confirm(
          'Delete ' + row.name + '?',
          'This removes this operation and its recovery backup. Other games are untouched.',
          () =>
            this.lock(async () => {
              try {
                await this.repo.delete(row.id);
                this.library();
              } catch (error) {
                this.h.toast(error.message, true);
              }
            }),
        );
      return card;
    }
    async library() {
      const shell = tpl('tpl-library');
      shell.querySelector('#library-mode').textContent = globalThis.starfallDesktop
        ? 'ON-DISK SAVES · AUTOMATIC BACKUPS'
        : 'BROWSER SAVES · EXPORT TO BACK UP';
      if (!this.current) shell.querySelector('#library-copy').remove();
      this.h.modal('library', shell);
      document.querySelector('#library-close').onclick = () => (this.current ? this.h.pause() : this.h.briefing());
      document.querySelector('#library-new').onclick = async () => {
        if (await this.save(true)) this.h.briefing();
      };
      document.querySelector('#library-import').onclick = async () => {
        try {
          const row = await this.repo.importFile();
          if (row) {
            this.h.toast('Imported as a separate operation.');
            this.library();
          }
        } catch (error) {
          this.h.toast('Import failed: ' + error.message, true);
        }
      };
      const copy = document.querySelector('#library-copy');
      if (copy)
        copy.onclick = () =>
          this.nameDialog('Save as new game', this.current.name + ' copy', (title) =>
            this.lock(async () => {
              try {
                const snapshot = this.h.capture();
                const made = await this.repo.write({ id: crypto.randomUUID(), name: F.name(title), snapshot });
                this.h.toast('Independent checkpoint created.');
                await this.library();
                return !!made;
              } catch (error) {
                this.h.toast(error.message, true);
                return false;
              }
            }),
          );
      try {
        const rows = await this.repo.list(),
          list = document.querySelector('#save-list');
        if (!list) return;
        if (!rows.length) {
          list.replaceChildren(tpl('tpl-library-empty'));
          return;
        }
        list.replaceChildren(...rows.map((row) => this.saveCard(row)));
      } catch (error) {
        const list = document.querySelector('#save-list');
        if (list) list.textContent = 'Could not read saves: ' + error.message;
      }
    }
    nameDialog(title, initial, submit) {
      const form = tpl('tpl-name');
      form.querySelector('h2').textContent = title;
      form.querySelector('#save-name').value = initial.slice(0, 48);
      this.h.modal('name', form);
      document.querySelector('#name-form').onsubmit = async (e) => {
        e.preventDefault();
        const b = e.currentTarget.querySelector('[type="submit"]');
        b.disabled = true;
        if (!(await submit(document.querySelector('#save-name').value))) b.disabled = false;
      };
      document.querySelector('#name-cancel').onclick = () => this.library();
      document.querySelector('#save-name').focus();
    }
    confirm(title, text, action) {
      const card = tpl('tpl-confirm');
      card.querySelector('h2').textContent = title;
      card.querySelector('p').textContent = text;
      this.h.modal('confirm', card);
      document.querySelector('#confirm-no').onclick = () => this.library();
      document.querySelector('#confirm-yes').onclick = action;
    }
    async quit() {
      this.h.pauseForSave();
      if (globalThis.starfallDesktop) return starfallDesktop.quit();
      if (await this.save(true)) {
        this.h.toast('Saved. You can safely close this browser tab.');
        this.h.pause();
      }
    }
  }
  globalThis.StarfallOperations = Operations;
})();
