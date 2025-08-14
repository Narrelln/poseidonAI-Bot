/**
 * File #08: components/OpenPositionsPanel.jsx
 * Description:
 *   Renders open futures positions and lets the user close a position.
 *   - Sends ONLY { contract } to /api/close-trade (side is resolved server‑side)
 *   - Optimistic row removal + hard refresh
 *   - Live refresh on `trade-confirmed` and `trade-closed` socket events
 * Last Updated: 2025-08-11
 */

import { useEffect, useState, useRef } from 'react';
import PositionDetailsModal from './PositionDetailsModal';
import './openPositions.css';

// [1] Number helpers
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pctToNum = (v, d = 0) => {
  if (v === null || v === undefined) return d;
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  const num = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(num) ? num : d;
};
const firstNum = (...vals) => {
  for (const v of vals) {
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
};

export default function OpenPositionsPanel() {
  // [2] State
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [taDataBySymbol, setTADataBySymbol] = useState({});
  const socketRef = useRef(null);

  // [3] Initial load + polling + sockets
  useEffect(() => {
    fetchPositions();
    const id = setInterval(fetchPositions, 10_000);

    // 🔌 Live updates
    if (window.io && !socketRef.current) {
      const s = (socketRef.current = window.io());

      s.on('trade-confirmed', () => {
        fetchPositions();
      });

      s.on('trade-closed', (payload) => {
        // optimistic remove if contract provided
        if (payload?.contract) {
          setPositions((prev) =>
            prev.filter(
              (p) => String(p.contract).toUpperCase() !== String(payload.contract).toUpperCase()
            )
          );
        }
        // hard refresh to sync numbers/PNL history
        fetchPositions();
      });
    }

    return () => {
      clearInterval(id);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  // [4] Data fetchers
  async function fetchPositions() {
    try {
      const res = await fetch('/api/positions');
      const data = await res.json();
      if (data?.success && Array.isArray(data.positions)) {
        setPositions(data.positions);
        fetchTAData(data.positions);
      }
    } catch (e) {
      console.error('OpenPositions: fetch error', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTAData(list) {
    const map = {};
    await Promise.all(
      list.map(async (pos) => {
        try {
          const r = await fetch(`/api/ta/${pos.symbol}`);
          const ta = await r.json();
          if (ta?.price) map[pos.symbol] = ta;
        } catch {
          // ignore per-row TA errors
        }
      })
    );
    setTADataBySymbol(map);
  }

  // [5] Close — send only { contract }; server infers side & size
  async function closePosition(contract) {
  try {
    // Optimistic: hide row instantly
    setPositions(prev =>
      prev.filter(p => String(p.contract).toUpperCase() !== String(contract).toUpperCase())
    );

    const r = await fetch('/api/close-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract }) // ← only contract
    });

    // If backend returns non-2xx, parse the body for a helpful message
    let j;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok || !j?.success) {
      // Restore by refetching and show reason
      await fetchPositions();
      const msg = (j && (j.error || j.details?.error)) || `HTTP ${r.status}`;
      alert('❌ Close failed: ' + msg);
      return;
    }

    // Keep in sync with server-side calc
    fetchPositions();
  } catch (e) {
    await fetchPositions();
    alert('❌ Close error: ' + e.message);
  }
}
  // [6] Render
  if (loading) return <div>Loading positions...</div>;
  if (!positions.length) return <div className="op-dimmed">No open positions</div>;

  return (
    <div className="op-wrapper">
      <div className="op-table-wrap">
        <table className="op-table" role="table">
          <colgroup>
            <col className="op-col-symbol" />
            <col className="op-col-side" />
            <col className="op-col-entry" />
            <col className="op-col-value" />
            <col className="op-col-pnl" />
            <col className="op-col-roi" />
            <col className="op-col-view" />
            <col className="op-col-close" />
          </colgroup>

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
            {positions.map((pos, idx) => {
              // normalize numbers
              const entry = n(pos.entryPrice);
              const qty = n(pos.quantity ?? pos.size ?? pos.qty);

              // Cost (margin) is the value displayed; exposure only for tooltip
              const cost = firstNum(pos.value, pos.margin, pos.costUsd, pos.marginUsd);
              const exposure = firstNum(
                pos.exposure,
                pos.notionalUsd,
                pos.notional,
                entry * Math.abs(qty)
              );
              const value = cost;

              const pnl = n(pos.pnlValue);
              const roiNum = pctToNum(pos.roi ?? pos.roiPct ?? pos.pnlPercent);

              // side chip (prefer explicit buy/sell; fallback to qty sign)
              const sideStr = String(pos.side || '').toLowerCase();
              const isLong =
                sideStr.includes('buy') || sideStr.includes('long')
                  ? true
                  : sideStr.includes('sell') || sideStr.includes('short')
                  ? false
                  : qty > 0;

              const valueTitle = Number.isFinite(exposure)
                ? `Exposure: ${exposure.toFixed(2)} USDT`
                : '';

              return (
                <tr key={idx}>
                  <td className="op-td-left" title={pos.symbol}>
                    {pos.symbol}
                  </td>

                  <td>
                    <span className={`op-side ${isLong ? 'long' : 'short'}`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                  </td>

                  <td className="op-num">{Number.isFinite(entry) ? entry.toFixed(6) : '--'}</td>

                  <td className="op-num" title={valueTitle}>
                    {Number.isFinite(value) ? Number(value).toFixed(2) : '--'}
                  </td>

                  <td className={`op-num ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}`}>
                    {Number.isFinite(pnl) ? pnl.toFixed(2) : '--'}
                  </td>

                  <td className={`op-num ${roiNum > 0 ? 'pos' : roiNum < 0 ? 'neg' : ''}`}>
                    {Number.isFinite(roiNum) ? roiNum.toFixed(2) : '0.00'}%
                  </td>

                  <td>
                    <button
                      className="op-btn op-btn-view"
                      onClick={() => setSelected({ symbol: pos.symbol, contract: pos.contract })}
                    >
                      👁 View
                    </button>
                  </td>

                  <td>
                  <button
  className="op-btn op-btn-close"
  onClick={() => closePosition(pos.contract)}
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
          symbol={selected.symbol}
          contract={selected.contract}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}