import React from 'react';
import { createRoot } from 'react-dom/client';
import OpenPositionsPanel from './components/OpenPositionsPanel.jsx';

const mount = document.getElementById('open-positions-root');

if (!mount) {
  console.error('❌ Missing #open-positions-root in futures.html');
} else {
  createRoot(mount).render(<OpenPositionsPanel />);
}