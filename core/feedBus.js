// /core/feedBus.js
import { EventEmitter } from 'events';
const bus = new EventEmitter();

const MAX_ITEMS = 1000;
const buffer = [];   // ring buffer
const seen = new Set(); // dedupe by id for safety

export function publish(feed) {
  if (seen.has(feed.id)) return;
  seen.add(feed.id);
  buffer.push(feed);
  if (buffer.length > MAX_ITEMS) buffer.shift();
  bus.emit('feed', feed);
}

export function subscribe(fn) { bus.on('feed', fn); return () => bus.off('feed', fn); }
export function getBuffer({ since } = {}) {
  if (!since) return [...buffer];
  return buffer.filter(f => f.ts > since);
}