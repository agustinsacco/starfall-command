'use strict';
(() => {
  const F = StarfallSaveFormat, { Game, D } = Starfall;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const duration = time => `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  const difficulty = { easy: 'Cadet', normal: 'Commander', hard: 'Veteran' };
  class Operations {
    constructor(hooks) {
      this.h = hooks; this.repo = StarfallSaves; this.current = null; this.lastTime = -1; this.queue = Promise.resolve(); this.busy = false;
      this.autosaveInterval = setInterval(() => { if (this.current && !this.h.paused() && this.h.time() !== this.lastTime) this.save(true); }, 30000);
    }
    lock(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
    status(text, error = false) { const e = document.querySelector('#save-status'); if (e) { e.textContent = text; e.classList.toggle('save-error', error); } }
    async persist(silent = false) {
      if (!this.current) return true;
      this.status('SAVING…');
      try {
        const snapshot = this.h.capture();
        const summary = await this.repo.write({ id: this.current.id, name: this.current.name, snapshot });
        this.current = summary; this.lastTime = JSON.parse(snapshot.simulation).time;
        this.status('SAVED · ' + duration(this.lastTime));
        if (!silent) this.h.toast('Operation saved.');
        return true;
      } catch (error) { this.status('SAVE FAILED', true); this.h.toast('Save failed: ' + error.message, true); return false; }
    }
    save(silent = false) { return this.lock(() => this.persist(silent)); }
    async init() {
      const desktop = globalThis.starfallDesktop;
      if (desktop) {
        desktop.onBeforeClose(() => { this.h.pauseForSave(); return this.save(true); });
        desktop.onCommand(command => { if (command === 'save') this.save(); if (command === 'library') this.library(); if (command === 'help') this.h.help(); });
        desktop.onFullscreen(full => this.fullscreenLabel(full));
        try { const info = await desktop.info(); this.fullscreenLabel(info.fullscreen); } catch (error) { this.h.toast(error.message, true); }
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
      } catch (error) { this.h.toast('Legacy save could not be imported: ' + error.message, true); }
      this.refreshContinue();
    }
    async refreshContinue() {
      try {
        const rows = await this.repo.list(), last = rows.find(r => !r.corrupt && !r.result);
        const button = document.querySelector('#continue-btn');
        if (button) { button.hidden = !last; button.textContent = last ? 'CONTINUE · ' + last.name : ''; button.onclick = () => this.load(last.id); }
      } catch (error) { this.status('STORAGE UNAVAILABLE', true); }
    }
    fullscreenLabel(full) { const button = document.querySelector('#fullscreen-btn'); if (button) { button.textContent = full ? '⤢' : '⛶'; button.title = full ? 'Leave fullscreen (F11)' : 'Enter fullscreen (F11)'; button.setAttribute('aria-label', button.title); } }
    async toggleFullscreen() {
      try {
        if (globalThis.starfallDesktop) await starfallDesktop.toggleFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { this.h.toast('Fullscreen is unavailable in this window.', true); }
    }
    create(title, level, seed) { return this.lock(async () => {
      let name; try { name = F.name(title); } catch (error) { this.h.toast(error.message, true); return false; }
      if (this.current && !await this.persist(true)) return false;
      try {
        const game = new Game(level, seed), small = innerWidth < 760;
        const snapshot = { version: 2, simulation: game.save(), paused: false, view: { camera: { x: small ? 440 : 650, y: small ? 1280 : 1160, z: Math.max(.6, Math.min(1, innerWidth / 1150)) }, selection: [game.own(0, 'hq')[0].id], groups: {}, speed: 1, sound: this.h.capture().view.sound, mode: null, tab: 'actions', accumulator: 0 } };
        const summary = await this.repo.write({ id: crypto.randomUUID(), name, snapshot });
        this.current = summary; this.lastTime = 0; this.h.apply(snapshot, summary, true); this.status('SAVED · 00:00');
        this.h.toast('Operation created. Autosave every 30 seconds; F5 saves now.'); return true;
      } catch (error) { this.h.toast('Could not create operation: ' + error.message, true); return false; }
    }); }
    load(id) { return this.lock(async () => {
      if (this.current && this.current.id !== id && !await this.persist(true)) return false;
      try {
        const saved = await this.repo.read(id); F.validateSnapshot(saved.record.snapshot);
        this.current = saved.summary; this.lastTime = saved.summary.time;
        this.h.apply(saved.record.snapshot, saved.summary, false);
        this.status((saved.recovered ? 'BACKUP RESTORED · ' : 'SAVED · ') + duration(saved.summary.time));
        this.h.toast(saved.recovered ? 'Recovered the previous valid backup. Inspect it, then save to repair the latest slot.' : 'Operation restored. Resume when you are ready.', saved.recovered);
        return true;
      } catch (error) { this.h.toast('Load failed: ' + error.message, true); return false; }
    }); }
    async library() {
      this.h.modal('library', '<div class="modal-card library-shell"><div class="library-heading"><div><div class="eyebrow">PERSISTENT OPERATIONS</div><h2>Your frontier. Preserved.</h2><p>Create separate games and return to each exact battlefield.</p></div><button id="library-close" aria-label="Close library">×</button></div><div class="library-toolbar"><button class="primary" id="library-new">＋ New operation</button><button id="library-import">↑ Import save</button>' + (this.current ? '<button id="library-copy">◇ Save as new game</button>' : '') + '<span>' + (globalThis.starfallDesktop ? 'ON-DISK SAVES · AUTOMATIC BACKUPS' : 'BROWSER SAVES · EXPORT TO BACK UP') + '</span></div><div id="save-list" class="save-list" aria-live="polite">Reading operations…</div><p class="library-footnote">Autosaves and F5 update the current game. Save as new game creates a separate checkpoint. Loading starts paused. Delete requires confirmation.</p></div>');
      document.querySelector('#library-close').onclick = () => this.current ? this.h.pause() : this.h.briefing();
      document.querySelector('#library-new').onclick = async () => { if (await this.save(true)) this.h.briefing(); };
      document.querySelector('#library-import').onclick = async () => { try { const row = await this.repo.importFile(); if (row) { this.h.toast('Imported as a separate operation.'); this.library(); } } catch (error) { this.h.toast('Import failed: ' + error.message, true); } };
      const copy = document.querySelector('#library-copy'); if (copy) copy.onclick = () => this.nameDialog('Save as new game', this.current.name + ' copy', title => this.lock(async () => {
        try { const snapshot = this.h.capture(); const made = await this.repo.write({ id: crypto.randomUUID(), name: F.name(title), snapshot }); this.h.toast('Independent checkpoint created.'); await this.library(); return !!made; }
        catch (error) { this.h.toast(error.message, true); return false; }
      }));
      try {
        const rows = await this.repo.list(), list = document.querySelector('#save-list'); if (!list) return;
        list.replaceChildren();
        if (!rows.length) { list.innerHTML = '<div class="library-empty"><span>⌁</span><h3>A new frontier awaits.</h3><p>No saved games yet. Create an operation or import a previous save.</p></div>'; return; }
        for (const row of rows) {
          const card = document.createElement('article'); card.className = 'save-card'; card.dataset.saveId = row.id;
          const active = row.id === this.current?.id;
          card.innerHTML = '<div class="save-map"><span>' + (row.corrupt ? '!' : row.result === 'victory' ? '✧' : '⬡') + '</span><small>KESTREL BASIN</small></div><div class="save-info"><div class="eyebrow">' + (row.corrupt ? 'DAMAGED SAVE' : (active ? 'CURRENT OPERATION · ' : '') + (row.recovered ? 'BACKUP AVAILABLE' : row.result ? esc(row.result).toUpperCase() : 'IN PROGRESS')) + '</div><h3>' + esc(row.name) + '</h3><p>' + (row.corrupt ? esc(row.error) : esc(difficulty[row.difficulty]) + ' · ' + duration(row.time) + ' played · ' + row.units + ' units · ' + row.buildings + ' structures') + '</p><small>' + (row.updatedAt ? esc(new Date(row.updatedAt).toLocaleString()) + ' · revision ' + row.revision : 'Original file retained for recovery') + '</small></div><div class="save-actions"><button data-action="load" class="primary" ' + (row.corrupt ? 'disabled' : '') + '>' + (row.result ? 'Review' : 'Continue') + ' ↗</button><div><button data-action="rename" title="Rename operation" ' + (row.corrupt ? 'disabled' : '') + '>Rename</button><button data-action="export" title="Export portable save" ' + (row.corrupt ? 'disabled' : '') + '>Export</button><button data-action="delete" class="danger" ' + (active ? 'disabled title="Switch operations before deleting this game"' : '') + '>Delete</button></div></div>';
          card.querySelector('[data-action="load"]').onclick = () => this.load(row.id);
          card.querySelector('[data-action="rename"]').onclick = () => this.nameDialog('Rename operation', row.name, title => this.lock(async () => { try { const updated = await this.repo.rename(row.id, title); if (active) { this.current = updated; const label = document.querySelector('#operation-title'); if (label) label.textContent = updated.name; } await this.library(); return true; } catch (error) { this.h.toast(error.message, true); return false; } }));
          card.querySelector('[data-action="export"]').onclick = async () => { try { if (await this.repo.exportFile(row.id)) this.h.toast('Save exported.'); } catch (error) { this.h.toast('Export failed: ' + error.message, true); } };
          card.querySelector('[data-action="delete"]').onclick = () => this.confirm('Delete ' + row.name + '?', 'This removes this operation and its recovery backup. Other games are untouched.', () => this.lock(async () => { try { await this.repo.delete(row.id); this.library(); } catch (error) { this.h.toast(error.message, true); } }));
          list.append(card);
        }
      } catch (error) { const list = document.querySelector('#save-list'); if (list) list.textContent = 'Could not read saves: ' + error.message; }
    }
    nameDialog(title, initial, submit) {
      this.h.modal('name', '<form class="modal-card" id="name-form"><div class="eyebrow">OPERATION MANAGEMENT</div><h2>' + esc(title) + '</h2><label class="form-label" for="save-name">Operation name</label><input id="save-name" class="game-input" required maxlength="48" value="' + esc(initial.slice(0, 48)) + '"><div class="menu-actions"><button class="primary" type="submit">Confirm</button><button id="name-cancel" type="button">Cancel</button></div></form>');
      document.querySelector('#name-form').onsubmit = async e => { e.preventDefault(); const b = e.currentTarget.querySelector('[type="submit"]'); b.disabled = true; if (!await submit(document.querySelector('#save-name').value)) b.disabled = false; };
      document.querySelector('#name-cancel').onclick = () => this.library(); document.querySelector('#save-name').focus();
    }
    confirm(title, text, action) {
      this.h.modal('confirm', '<div class="modal-card"><div class="eyebrow">CONFIRM ACTION</div><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="menu-actions"><button class="danger" id="confirm-yes">Delete permanently</button><button id="confirm-no">Keep operation</button></div></div>');
      document.querySelector('#confirm-no').onclick = () => this.library(); document.querySelector('#confirm-yes').onclick = action;
    }
    async quit() { this.h.pauseForSave(); if (globalThis.starfallDesktop) return starfallDesktop.quit(); if (await this.save(true)) { this.h.toast('Saved. You can safely close this browser tab.'); this.h.pause(); } }
  }
  globalThis.StarfallOperations = Operations;
})();
