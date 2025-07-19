// futuresVolumeFilter.js — Filters Out High-Volume Futures Pairs

import { fetchVolumeAndOI } from './futuresApi.js';

const VOLUME_CAP = 20_000_000; // $20M

/**
 * Checks if a symbol is allowed for analysis based on volume
 */
export async function isBelowVolumeCap(symbol) {
  try {
    const { volume, notFound, error } = await fetchVolumeAndOI(symbol);
    const vol = parseFloat(volume) || 0;

    if (notFound) {
      console.warn(`⚠️ ${symbol} not found in contract list. Skipping.`);
      return false;
    }

    if (error) {
      console.warn(`⚠️ Volume fetch error for ${symbol}: ${error}`);
      return false;
    }

    if (vol > VOLUME_CAP) {
      console.log(`⛔ ${symbol} skipped — volume too high (${vol.toLocaleString()})`);
      return false;
    }

    console.log(`✅ ${symbol} allowed — volume ${vol.toLocaleString()}`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Volume check failed for ${symbol}`, err);
    return false; // Block if we can't verify
  }
}