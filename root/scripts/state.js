// state.js – Global state for Poseidon AI

export const state = {
  learningMemory: [],
  sniperMemory: [],
  futuresMemory: [],
  sessionPNL: 0,
  totalTrades: 0,
  walletsTracked: 0,
  activeTokens: [],
};

export function initState() {
  console.log("📦 Poseidon state initialized.");
}