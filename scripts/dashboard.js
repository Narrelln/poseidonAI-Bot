// dashboard.js – Main loader for Poseidon AI Dashboard

// 🌐 Core System Init
import { initState } from './state.js';
import { initAPI } from '../api.js';

// 🧠 UI + Stats Rendering
import { initUI } from './ui-render.js';
import { initPerformance } from './performance_script.js';
import { initSessionStats } from './sessionStatsModule.js';
import { initMemoryPanel } from './memoryPanel.js';
import { initFuturesStats } from './futuresStatsModule.js';

// 🔁 Strategy & Trade Engines
import { initStrategyToggle } from './strategy_toggle.js';
import { initTradeEngine } from './tradeExecutionEngine.js';
import { initManualControls } from './manualControls.js';
import { initSniperTracker } from './sniperTracker.js';
import { initRecovery } from './smartRecoveryModule.js';
import { initBot } from './poseidonBotModule.js'; // ✅ Toggle logic

// ✅ Init All Modules on Page Load
document.addEventListener('DOMContentLoaded', () => {
  initState();              // Load saved state and memory
  initAPI();                // Connect to external APIs
  initUI();                 // Render base UI components
  initPerformance();        // Load trade stats and performance
  initSessionStats();       // Populate session-based metrics
  initMemoryPanel();        // Load AI bot's live memory feed
  initFuturesStats();       // Show real-time futures stats
  initStrategyToggle();     // Setup strategy mode toggles
  initTradeEngine();        // Auto trade signal engine
  initManualControls();     // Enable user interaction buttons
  initSniperTracker();      // Monitor sniper wallets
  initRecovery();           // Run smart recovery logic if needed
  initBot();                // 🧠 Avatar toggle control

  console.log("✅ Poseidon dashboard fully initialized.");
});