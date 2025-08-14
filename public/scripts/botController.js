// === botController.js — Bridge to expose bot controls globally ===
import {
    isBotActive,
    setBotActive,
    startPoseidonAutonomousLoop,
    stopPoseidonAutonomousLoop
  } from './poseidonBotModule.js';
  
  window.isBotActive = isBotActive;
  window.setBotActive = setBotActive;
  window.startPoseidonAutonomousLoop = startPoseidonAutonomousLoop;
  window.stopPoseidonAutonomousLoop = stopPoseidonAutonomousLoop;