'use strict';
// Small helpers used by the renderer, the Electron main process, and Node tests.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarfallShared = factory();
})(globalThis, () => {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const formatTime = (time) =>
    `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  const DIFFICULTY_NAMES = { easy: 'Cadet', normal: 'Commander', hard: 'Veteran' };
  const sanitizeFilename = (name) => String(name).replace(/[^a-zA-Z0-9 _-]/g, '_');
  // One promise-chain mutex shared by every save path: later work waits for earlier work, failures do not wedge it.
  const serialQueue = () => {
    let pending = Promise.resolve();
    return (fn) => {
      const result = pending.then(fn);
      pending = result.catch(() => {});
      return result;
    };
  };
  return { object, number, formatTime, DIFFICULTY_NAMES, sanitizeFilename, serialQueue };
});
