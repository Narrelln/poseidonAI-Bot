import { analyzePatterns } from './pattern_analyzer.js';

console.log("Decision Engine Activated");

let currentStrategy = {
  preferEntryZone: '50K–70K',
  preferTriggers: ['SmartWallet'],
  confidenceBoost: 0.1,
  tpThreshold: 35,
  slThreshold: -40
};

function updateStrategy() {
  const analysis = analyzePatterns();
  if (!analysis) return;

  const zones = analysis.entryMCZones;
  const sortedZones = Object.entries(zones).sort((a, b) => b[1] - a[1]);
  const topZone = sortedZones[0][0];

  const triggers = Object.entries(analysis.triggerEffectiveness).sort((a, b) => b[1] - a[1]);
  const topTrigger = triggers[0]?.[0] || 'SmartWallet';

  const boost = analysis.winRate > 70 ? 0.15 : analysis.winRate < 40 ? -0.1 : 0;
  const tp = analysis.avgROI > 40 ? 45 : analysis.avgROI < 20 ? 25 : 35;

  currentStrategy = {
    preferEntryZone: topZone,
    preferTriggers: [topTrigger],
    confidenceBoost: boost,
    tpThreshold: tp,
    slThreshold: -40
  };

  console.log("🧠 Poseidon's Strategy Updated:", currentStrategy);
}

function getCurrentStrategy() {
  return currentStrategy;
}

export { updateStrategy, getCurrentStrategy };