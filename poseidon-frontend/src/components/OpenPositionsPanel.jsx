// components/OpenPositionsPanel.jsx
// Stable, accurate ROI/PnL display using backend-consistent logic.

import { useEffect, useMemo, useRef, useState } from 'react';
import PositionDetailsModal from './PositionDetailsModal';
import './openPositions.css';
import { toTaSymbol, fetchTA } from '../utils/taclient.js';

// --- helpers ---
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const pctNum = (v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : undefined;
};

// --- ROI LOGIC (reliable fallback logic) ---
function deriveRoi(pos, symbol = '') {
  const r1 = pctNum(pos?.roi);
  if (r1 !== undefined) {
    console.debug(`[ROI][${symbol}] using pos.roi =`, r1);
    return r1;
  }

  const r2 = pctNum(pos?.pnlPercent);
  if (r2 !== undefined) {
    console.debug(`[ROI][${symbol}] using pos.pnlPercent =`, r2);
    return r2;
  }

  if (pos?.unrealisedRoePcnt !== undefined) {
    const r3 = Number(pos.unrealisedRoePcnt) * 100;
    if (Number.isFinite(r3)) {
      console.debug(`[ROI][${symbol}] using unrealisedRoePcnt * 100 =`, r3);
      return r3;
    }
  }

  const pnl = num(pos?.pnlValue ?? pos?.pnl);
  const cost = num(pos?.margin ?? pos?.costUsd ?? pos?.value ?? pos?.marginUsd);
  console.debug(`[ROI][${symbol}] fallback pnl =`, pnl, 'cost =', cost);
  if (Number.isFinite(pnl) && Number.isFinite(cost) && cost !== 0) {
    const derived = (pnl / cost) * 100;
    console.debug(`[ROI][${symbol}] using fallback pnl/margin = ${pnl}/${cost} = ${derived}`);
    return derived;
  }

  console.debug(`[ROI][${symbol}] all fallback paths failed, defaulting to 0`);
  return 0;
}

// --- bad display symbols to ignore for TA load ---
const BAD_SYMBOLS = new Set(['ALL', 'MAJORS', 'MEMES', 'GAINERS', 'LOSERS', '', null, undefined]);

export default function OpenPositionsPanel() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const pollTimerRef = useRef(null);
  const inFlightRef = useRef(null);
  const taInFlightRef = useRef(new Map());
  const lastHashRef = useRef('');
  const socketRef = useRef(null);

  useEffect(() => {
    safeFetchPositions();
    pollTimerRef.current = setInterval(safeFetchPositions, 10_000);

    if (!window.__POSEIDON_SOCKET && window.io) {
      window.__POSEIDON_SOCKET = window.io();
    }
    socketRef.current = window.__POSEIDON_SOCKET || null;

    if (socketRef.current) {
      const s = socketRef.current;
      const onConfirmed = () => safeFetchPositions();
      const onClosed = (payload) => {
        if (payload?.contract) {
          setPositions((prev) =>
            prev.filter(
              (p) => String(p.contract).toUpperCase() !== String(payload.contract).toUpperCase()
            )
          );
        }
        safeFetchPositions();
      };
      s.on('trade-confirmed', onConfirmed);
      s.on('trade-closed', onClosed);

      return () => {
        clearInterval(pollTimerRef.current);
        if (inFlightRef.current) inFlightRef.current.abort();
        try { s.off('trade-confirmed', onConfirmed); } catch {}
        try { s.off('trade-closed', onClosed); } catch {}
        for (const [, ctrl] of taInFlightRef.current) try { ctrl.abort(); } catch {}
        taInFlightRef.current.clear();
      };
    }

    return () => {
      clearInterval(pollTimerRef.current);
      if (inFlightRef.current) inFlightRef.current.abort();
      for (const [, ctrl] of taInFlightRef.current) try { ctrl.abort(); } catch {}
      taInFlightRef.current.clear();
    };
  }, []);

  async function safeFetchPositions() {
    if (inFlightRef.current) inFlightRef.current.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;

    try {
      const r = await fetch(`/api/positions?t=${Date.now()}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j || !Array.isArray(j.positions)) {
        setLoading(false);
        return;
      }

      const hash = JSON.stringify(
        j.positions.map((p) => ({
          c: p.contract,
          s: p.symbol,
          qty: p.size ?? p.quantity,
          e: p.entryPrice,
          m: p.markPrice,
          pnl: p.pnlValue,
          roi: deriveRoi(p, p.symbol || p.contract),
        }))
      );
      if (hash !== lastHashRef.current) {
        lastHashRef.current = hash;
        setPositions(j.positions);
        throttledFetchTA(j.positions);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.warn('[OpenPositions] fetch error:', e?.message || e);
      }
    } finally {
      setLoading(false);
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
    }
  }

  async function throttledFetchTA(list) {
    const items = Array.isArray(list) ? list.slice(0, 10) : [];
    for (const pos of items) {
      const display = String(pos.symbol || pos.contract || '').trim();
      if (!display || BAD_SYMBOLS.has(display.toUpperCase())) continue;

      const prev = taInFlightRef.current.get(display);
      if (prev) try { prev.abort(); } catch {}

      const ctrl = new AbortController();
      taInFlightRef.current.set(display, ctrl);
      try {
        await fetchTA(display, { signal: ctrl.signal });
      } catch {}
      finally {
        if (taInFlightRef.current.get(display) === ctrl) {
          taInFlightRef.current.delete(display);
        }
      }
    }
  }

  async function closePosition(contract) {
    setPositions((prev) =>
      prev.filter(
        (p) => String(p.contract).toUpperCase() !== String(contract).toUpperCase()
      )
    );
    try {
      const r = await fetch('/api/close-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ contract }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        await safeFetchPositions();
        alert('❌ Close failed: ' + ((j && (j.error || j.details?.error)) || `HTTP ${r.status}`));
      } else {
        await safeFetchPositions();
      }
    } catch (e) {
      await safeFetchPositions();
      alert('❌ Close error: ' + (e?.message || 'Network error'));
    }
  }

  if (loading) return <div>Loading positions...</div>;
  if (!positions.length) return <div className="op-dimmed">No open positions</div>;

  return (
    <div className="op-wrapper">
      <div className="op-table-wrap">
        <table className="op-table" role="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Value</th>
              <th>PNL</th>
              <th>ROI</th>
              <th>View</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const contract = String(pos.contract || pos.symbol || '');
              const display = String(pos.symbol || pos.contract || '');
              const sideRaw = String(pos.side || '').toLowerCase();
              const isLong = sideRaw.includes('buy') || sideRaw.includes('long')
                ? true
                : sideRaw.includes('sell') || sideRaw.includes('short')
                ? false
                : (Number(pos?.currentQty ?? pos?.size ?? 0) > 0);

              const entry = num(pos.entryPrice);
              const cost  = num(pos.margin ?? pos.value ?? pos.costUsd);
              const pnl   = num(pos.pnlValue ?? pos.pnl);
              const roi   = deriveRoi(pos, display);

              return (
                <tr key={contract}>
                  <td>{display}</td>
                  <td>
                    <span className={`op-side ${isLong ? 'long' : 'short'}`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                  </td>
                  <td className="op-num">{Number.isFinite(entry) ? entry.toFixed(6) : '—'}</td>
                  <td className="op-num">{Number.isFinite(cost) ? cost.toFixed(2) : '—'}</td>
                  <td className={`op-num ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}`}>
                    {Number.isFinite(pnl) ? pnl.toFixed(2) : '—'}
                  </td>
                  <td className={`op-num ${roi > 0 ? 'pos' : roi < 0 ? 'neg' : ''}`}>
                    {Number.isFinite(roi) ? roi.toFixed(2) : '0.00'}%
                  </td>
                  <td>
                    <button
                      className="op-btn op-btn-view"
                      onClick={() =>
                        setSelected({
                          displaySymbol: display,
                          apiSymbol: toTaSymbol(display),
                          contract,
                        })
                      }
                    >
                      👁 View
                    </button>
                  </td>
                  <td>
                    <button
                      className="op-btn op-btn-close"
                      onClick={() => closePosition(contract)}
                    >
                      🛑 Close
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <PositionDetailsModal
          symbol={selected.apiSymbol}
          displaySymbol={selected.displaySymbol}
          contract={selected.contract}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}