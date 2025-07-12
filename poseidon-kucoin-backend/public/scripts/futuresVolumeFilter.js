// futuresVolumeFilter.js — Filters Out High-Volume Futures Pairs

import { fetchVolumeAndOI } from './futuresApi.js';

const VOLUME_CAP = 10_000_000; // $10M

/**
 * Checks if a symbol is allowed for analysis based on volume
 */
export async function isBelowVolumeCap(symbol) {
  try {
    const { volume } = await fetchVolumeAndOI(symbol);
    const vol = parseFloat(volume) || 0;
    return vol <= VOLUME_CAP;
  } catch (err) {
    console.warn(`⚠️ Volume check failed for ${symbol}`, err);
    return false; // Block if we can't verify
  }
}