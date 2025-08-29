import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toTaSymbol, fetchTA } from '../utils/taclient.js';
import './PositionDetailsModal.css';

const BAD = new Set(['ALL','MAJORS','MEMES','GAINERS','LOSERS','', null, undefined]);

// ---- format helpers ----
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const fmt = (v, min=2, max=6) => {
  const n = num(v);
  if (n === undefined) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max });
};
const fmt2 = (v) => fmt(v, 2, 2);
const fmt4 = (v) => fmt(v, 4, 6);
const fmt6 = (v) => {
  const n = num(v);
  if (n === undefined) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
};
const pct = (v) => {
  const n = num(v);
  if (n === undefined) return '—';
  return `${n.toFixed(2)}%`;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

export default function PositionDetailsModal({ symbol, displaySymbol, contract, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, ta: null, details: null });

  // ROI‑based TP/SL UI state
  const [slPct, setSlPct] = useState(-20);
  const [tp1Pct, setTp1Pct] = useState(100);
  const [tp1SizePct, setTp1SizePct] = useState(40);
  const [trailRemainder, setTrailRemainder] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // ATH/ATL (may be provided by TA or computed client-side)
  const [athAtl, setAthAtl] = useState({ ath: undefined, atl: undefined, loading: false, error: null });

  // Debug / header helpers
  const [normSymbol, setNormSymbol] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  // refs / portal
  const closeBtnRef = useRef(null);
  const cardRef = useRef(null);
  const modalRoot = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;

  // Load TA + (optional) current TP/SL config for this contract
  useEffect(() => {
    let alive = true;
    const label = String(displaySymbol || symbol || '').toUpperCase();
    if (BAD.has(label)) {
      setState({ loading: false, error: 'Invalid symbol (filter name passed).', ta: null, details: null });
      return;
    }

    const norm = toTaSymbol(symbol || displaySymbol || '');
    setNormSymbol(norm || '');
    if (!norm) {
      setState({ loading: false, error: 'Invalid trading symbol.', ta: null, details: null });
      return;
    }

    setState({ loading: true, error: null, ta: null, details: null });

    // position details (if your API supports it by contract)
    const qDetails = contract
      ? fetch(`/api/positions/details?contract=${encodeURIComponent(contract)}`, { headers: { Accept: 'application/json' }})
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null);

    // TA (spot‑format)
    const qTA = fetchTA(norm).catch(() => null);

    // saved TP/SL state
    const qTP = contract
      ? fetch(`/api/tp-status?contract=${encodeURIComponent(contract)}`, { headers: { Accept: 'application/json' }})
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([qDetails, qTA, qTP]).then(([details, ta, tpState]) => {
      if (!alive) return;
      setState({
        loading: false,
        error: (ta && (ta.success || ta.ok || ta.nodata === false)) ? null : (ta && ta.error) || null,
        ta: (ta && (ta.success || ta.ok || ta.nodata === false)) ? ta : null,
        details: details || null
      });

      if (tpState && (tpState.roiSL !== undefined || tpState.tp1 !== undefined)) {
        if (typeof tpState.roiSL === 'number') setSlPct(tpState.roiSL);
        if (typeof tpState.tp1 === 'number') setTp1Pct(tpState.tp1);
        if (typeof tpState.tp1SizePct === 'number') setTp1SizePct(tpState.tp1SizePct);
        if (typeof tpState.trail === 'boolean') setTrailRemainder(tpState.trail);
      }
    });

    return () => { alive = false; };
  }, [symbol, displaySymbol, contract]);

  // ESC, outside‑click, scroll‑lock, focus
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onClickOutside = (e) => {
      if (!cardRef.current) return;
      if (!cardRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const ta = state.ta || {};
  const d  = state.details || {};
  const title = (displaySymbol || symbol || contract || 'Details').toUpperCase();

  // ROI preview
  const cost = num(d.value ?? d.margin ?? d.costUsd ?? d.marginUsd);
  const pnl  = num(d.pnlValue ?? d.pnl);
  const currRoi = useMemo(() => {
    if (!Number.isFinite(cost) || !Number.isFinite(pnl)) return undefined;
    return (pnl / cost) * 100;
  }, [cost, pnl]);

  // Try to populate ATH/ATL if not present in TA
  useEffect(() => {
    const currentAth = num(ta.ath);
    const currentAtl = num(ta.atl);
    if (Number.isFinite(currentAth) && Number.isFinite(currentAtl)) {
      setAthAtl({ ath: currentAth, atl: currentAtl, loading: false, error: null });
      return;
    }

    let alive = true;
    const norm = toTaSymbol(symbol || displaySymbol || '');
    if (!norm) return;

    setAthAtl(s => ({ ...s, loading: true, error: null }));

    // Try a simple endpoint; if not available, fall back to OHLCV compute
    (async () => {
      try {
        // 1) preferred: dedicated ath/atl
        const r1 = await fetch(`/api/ath-atl?symbol=${encodeURIComponent(norm)}`);
        if (r1.ok) {
          const j = await r1.json();
          if (alive && (j?.ath || j?.atl)) {
            return setAthAtl({ ath: num(j.ath), atl: num(j.atl), loading: false, error: null });
          }
        }
      } catch { /* ignore */ }

      // 2) fallback: compute from daily OHLC (e.g., last 1000 days)
      try {
        const r2 = await fetch(`/api/ohlcv?symbol=${encodeURIComponent(norm)}&interval=1d&limit=1000`);
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const arr = await r2.json(); // expect [{open,high,low,close,...}, ...]
        const highs = arr?.map(o => Number(o.high)).filter(Number.isFinite);
        const lows  = arr?.map(o => Number(o.low)).filter(Number.isFinite);
        const ath = highs?.length ? Math.max(...highs) : undefined;
        const atl = lows?.length  ? Math.min(...lows)  : undefined;
        if (alive) setAthAtl({ ath, atl, loading: false, error: null });
      } catch (err) {
        if (alive) setAthAtl({ ath: undefined, atl: undefined, loading: false, error: 'ATH/ATL unavailable' });
      }
    })();

    return () => { alive = false; };
  }, [symbol, displaySymbol, ta.ath, ta.atl]);

  // Robust save with endpoint fallbacks + clearer error
  async function saveTPSL() {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        contract: contract || null,
        symbol: toTaSymbol(symbol || displaySymbol || ''),
        mode: 'roi',
        roiSL: clamp(slPct, -95, 0),
        tp1: clamp(tp1Pct, 5, 1000),
        tp1SizePct: clamp(tp1SizePct, 1, 100),
        trail: !!trailRemainder
      };

      const candidates = [
        { url: '/api/tpsl/config', method: 'POST' },
        { url: '/api/tpsl', method: 'POST' },
        { url: '/api/tp-sl/config', method: 'POST' },
        { url: '/tpsl/config', method: 'POST' },
        // If your backend uses contract in the path, uncomment the next line:
        ...(contract ? [{ url: `/api/positions/${encodeURIComponent(contract)}/tpsl`, method: 'POST' }] : [])
      ];

      let lastErr = null;
      for (const c of candidates) {
        try {
          const r = await fetch(`${c.url}?t=${Date.now()}`, {
            method: c.method,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
          });
          let j = null; try { j = await r.json(); } catch { /* not json */ }

          if (r.ok && (j?.success !== false)) {
            setSaveMsg('✅ TP/SL saved. Monitor will enforce it.');
            setSaving(false);
            setTimeout(() => setSaveMsg(''), 3500);
            return;
          }
          lastErr = new Error((j && (j.error || j.details?.error)) || `HTTP ${r.status}`);
        } catch (e) {
          lastErr = e;
        }
      }

      setSaveMsg('❌ Save failed: ' + (lastErr?.message || 'No matching endpoint'));
    } catch (err) {
      setSaveMsg('❌ Save error: ' + (err?.message || 'Network error'));
    } finally {
      setSaving(false);
    }
  }

  const onSlChange     = (v) => setSlPct(clamp(v, -95, 0));
  const onTp1Change    = (v) => setTp1Pct(clamp(v, 5, 1000));
  const onTpSizeChange = (v) => setTp1SizePct(clamp(v, 1, 100));
  const remainderPct   = clamp(100 - tp1SizePct, 0, 100);

  const changeClass = num(ta.priceChangePct) > 0 ? 'pos' : num(ta.priceChangePct) < 0 ? 'neg' : '';
  const signal = String(ta.signal || '').toLowerCase();
  const macdSig = String(ta.macdSignalCompat || ta.macdSignal || '').toLowerCase();
  const bbSig = String(ta.bbSignalCompat || ta.bbSignal || '').toLowerCase();
  const sigClass = signal === 'bullish' ? 'badge pos' : signal === 'bearish' ? 'badge neg' : 'badge neu';
  const macdClass = macdSig === 'bullish' ? 'chip pos' : macdSig === 'bearish' ? 'chip neg' : 'chip neu';
  const bbClass   = bbSig === 'bullish' ? 'chip pos'  : bbSig === 'bearish' ? 'chip neg'  : 'chip neu';

  // Prepare sorted fib entries for 1:1 display with payload
  const fibEntries = ta?.fib?.levels
    ? Object.entries(ta.fib.levels).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))
    : [];

  /* ----- HEADER + CONTENT ----- */
  const content = (
    <div className="pm-overlay" aria-modal="true" role="dialog" aria-label={`${title} details`}>
      <div className="pm-card" ref={cardRef}>
        <div className="pm-head">
          <div className="pm-title">
            <strong>{title}</strong>
            {normSymbol && <span style={{opacity:.6, marginLeft:8}}>({normSymbol})</span>}
            <span className={sigClass} style={{marginLeft:8}}>{ta.signal || '—'}</span>
          </div>
          <div className="pm-tools">
            <button
              className="pm-icon"
              title="Copy symbol"
              onClick={() => navigator.clipboard?.writeText(title)}
            >⧉</button>
            <button
              className="pm-icon"
              title="RAW TA"
              onClick={() => setShowRaw(v => !v)}
            >RAW</button>
            <button
              className="pm-icon"
              title="Fullscreen"
              onClick={() => document.querySelector('.pm-card')?.classList.toggle('fullscreen')}
            >⤢</button>
            <button className="pm-close" onClick={onClose} ref={closeBtnRef} aria-label="Close modal">✖</button>
          </div>
        </div>

        {state.loading && (
          <div className="pm-skeleton">
            <div className="sk-row" />
            <div className="sk-row" />
            <div className="sk-grid">
              <div className="sk-card" /><div className="sk-card" /><div className="sk-card" /><div className="sk-card" /><div className="sk-card" />
            </div>
          </div>
        )}

        {!state.loading && state.error && (
          <div className="pm-error">
            {state.error}
            <div className="pm-hint">
              If this came from a filter label, open the modal from a real position/symbol.
            </div>
          </div>
        )}

        {!state.loading && !state.error && (
          <>
            {/* KPI Row */}
            <div className="pm-kpi-row">
              <div className="pm-kpi"><div className="pm-kpi-label">Price</div><div className="pm-kpi-value">{fmt4(ta.price)}</div></div>
              <div className="pm-kpi"><div className="pm-kpi-label">Signal</div><div className="pm-kpi-value"><span className={sigClass}>{ta.signal || '—'}</span></div></div>
              <div className="pm-kpi"><div className="pm-kpi-label">Confidence</div><div className="pm-kpi-value">{ta.confidence ?? '—'}%</div></div>
              <div className="pm-kpi"><div className="pm-kpi-label">RSI</div><div className="pm-kpi-value">{fmt2(ta.rsi)}</div></div>
              <div className="pm-kpi"><div className="pm-kpi-label">24h Change</div><div className={`pm-kpi-value ${changeClass}`}>{pct(ta.priceChangePct)}</div></div>
            </div>

            {/* Indicator Chips */}
            <div className="pm-chip-row">
              <div className="pm-chip-label">MACD</div><div className={macdClass}>{ta.macdSignalCompat || ta.macdSignal || '—'}</div>
              <div className="pm-chip-label">Bollinger</div><div className={bbClass}>{ta.bbSignalCompat || ta.bbSignal || '—'}</div>
              <div className="pm-chip-label">ATR(14)</div><div className="pm-chip">{fmt4(ta.atr14)}</div>
              <div className="pm-chip-label">BB Width</div><div className="pm-chip">{fmt4(ta.bbWidth)}</div>
              <div className="pm-chip-label">Trap</div><div className={`pm-chip ${ta.trapWarning ? 'neg' : 'neu'}`}>{ta.trapWarning ? 'warning' : '—'}</div>
              <div className="pm-chip-label">Vol Spike</div><div className={`pm-chip ${ta.volumeSpike ? 'pos' : 'neu'}`}>{ta.volumeSpike ? 'yes' : '—'}</div>
            </div>

            {/* RAW TA (debug) */}
            {showRaw && (
              <pre className="pm-raw" style={{
                marginTop:10, background:'#0b1220', border:'1px solid #223148',
                borderRadius:8, padding:10, maxHeight:240, overflow:'auto', fontSize:12
              }}>
                {JSON.stringify(ta, null, 2)}
              </pre>
            )}

            {/* ===== Fib block ===== */}
            {ta.fib && fibEntries.length > 0 && (
              <div className="pm-fib">
                <div className="pm-fib-head">
                  <div className="pm-fib-title">Fibonacci ({ta.fib.direction || '—'})</div>
                  <div className="pm-fib-range">from {fmt6(ta.fib.from)} → {fmt6(ta.fib.to)}</div>
                </div>
                <div className="pm-fib-grid">
                  {fibEntries.map(([k, v]) => (
                    <div className="pm-fib-card" key={k}>
                      <div className="pm-fib-lab">{k}</div>
                      <div className="pm-fib-val">{fmt6(v)}</div>
                    </div>
                  ))}
                </div>
                {ta.fibContext && <div className="pm-hint" style={{marginTop:6}}>Context: {ta.fibContext}</div>}
              </div>
            )}

            {/* ===== Ranges & ATH/ATL ===== */}
            <div className="pm-range-wrap">
              <div className="pm-range-grid">
                <div className="pm-range-card">
                  <div className="pm-range-title">24h</div>
                  <div className="pm-range-row"><span>High</span><strong>{fmt6(ta?.range24h?.high)}</strong></div>
                  <div className="pm-range-row"><span>Low</span><strong>{fmt6(ta?.range24h?.low)}</strong></div>
                </div>
                <div className="pm-range-card">
                  <div className="pm-range-title">7D</div>
                  <div className="pm-range-row"><span>High</span><strong>{fmt6(ta?.range7D?.high)}</strong></div>
                  <div className="pm-range-row"><span>Low</span><strong>{fmt6(ta?.range7D?.low)}</strong></div>
                </div>
                <div className="pm-range-card">
                  <div className="pm-range-title">30D</div>
                  <div className="pm-range-row"><span>High</span><strong>{fmt6(ta?.range30D?.high)}</strong></div>
                  <div className="pm-range-row"><span>Low</span><strong>{fmt6(ta?.range30D?.low)}</strong></div>
                </div>

                <div className="pm-range-card emph">
                  <div className="pm-range-title">ATH / ATL</div>
                  <div className="pm-range-row">
                    <span>ATH</span>
                    <strong>
                      {athAtl.loading ? '…' : fmt6(num(ta.ath) ?? athAtl.ath)}
                    </strong>
                  </div>
                  <div className="pm-range-row">
                    <span>ATL</span>
                    <strong>
                      {athAtl.loading ? '…' : fmt6(num(ta.atl) ?? athAtl.atl)}
                    </strong>
                  </div>
                  {athAtl.error && <div className="pm-hint">{athAtl.error}</div>}
                </div>
              </div>
            </div>

            {/* === RISK CONTROLS (ROI‑based) === */}
            <div className="pm-controls">
              <div className="pm-controls-head">
                <div className="pm-controls-title">Risk Controls (ROI‑based)</div>
                {Number.isFinite(currRoi) && (
                  <div className={`pm-live-roi ${currRoi > 0 ? 'pos' : currRoi < 0 ? 'neg' : ''}`}>
                    Live ROI: {pct(currRoi)}
                  </div>
                )}
              </div>

              {/* SL */}
              <div className="pm-row">
                <div className="pm-label">Stop Loss (ROI)</div>
                <div className="pm-inputs">
                  <input type="range" min="-95" max="0" step="1" value={slPct} onChange={e => onSlChange(e.target.value)} />
                  <input type="number" className="pm-num" value={slPct} min={-95} max={0} step="1" onChange={e => onSlChange(e.target.value)} />
                  <output className="pm-bubble">{slPct}%</output>
                  <span className="pm-suffix">%</span>
                </div>
                <div className="pm-presets">
                  {[-10,-20,-30,-40].map(v => (
                    <button key={v} className="pm-chip-btn" onClick={() => setSlPct(v)}>{v}%</button>
                  ))}
                </div>
                <div className="pm-hint">Close fully if ROI ≤ SL.</div>
              </div>

              {/* TP1 */}
              <div className="pm-row">
                <div className="pm-label">Take Profit 1 (ROI)</div>
                <div className="pm-inputs">
                  <input type="range" min="5" max="1000" step="5" value={tp1Pct} onChange={e => onTp1Change(e.target.value)} />
                  <input type="number" className="pm-num" value={tp1Pct} min={5} max={1000} step="5" onChange={e => onTp1Change(e.target.value)} />
                  <output className="pm-bubble">{tp1Pct}%</output>
                  <span className="pm-suffix">%</span>
                </div>
                <div className="pm-presets">
                  {[50,100,150,200].map(v => (
                    <button key={v} className="pm-chip-btn" onClick={() => setTp1Pct(v)}>{v}%</button>
                  ))}
                </div>
                <div className="pm-hint">Trigger partial at TP1; remainder can trail.</div>
              </div>

              {/* TP1 SIZE */}
              <div className="pm-row">
                <div className="pm-label">TP1 Size</div>
                <div className="pm-inputs">
                  <input type="range" min="1" max="100" step="1" value={tp1SizePct} onChange={e => onTpSizeChange(e.target.value)} />
                  <input type="number" className="pm-num" value={tp1SizePct} min={1} max={100} step={1} onChange={e => onTpSizeChange(e.target.value)} />
                  <output className="pm-bubble">{tp1SizePct}%</output>
                  <span className="pm-suffix">%</span>
                </div>
                <div className="pm-hint">{tp1SizePct}% will be taken at TP1; <strong>{remainderPct}%</strong> keeps running.</div>
              </div>

              {/* TRAIL TOGGLE */}
              <div className="pm-row">
                <div className="pm-label">Trail Remainder</div>
                <div className="pm-toggle">
                  <label className="pm-switch">
                    <input type="checkbox" checked={trailRemainder} onChange={e => setTrailRemainder(e.target.checked)} />
                    <span className="pm-slider" />
                  </label>
                </div>
                <div className="pm-hint">After TP1, trail the remaining position using your strategy.</div>
              </div>

              {/* ACTIONS */}
              <div className="pm-actions sticky">
                <button className="pm-btn-save" disabled={saving} onClick={saveTPSL}>
                  {saving ? 'Saving…' : 'Save TP/SL'}
                </button>
                {saveMsg && <div className="pm-save-msg">{saveMsg}</div>}
              </div>
            </div>

            {/* TA extras */}
            <div className="pm-stat-grid">
              <div className="pm-stat"><div className="pm-stat-label">Base Vol</div><div className="pm-stat-value">{fmt2(ta.volumeBase)}</div></div>
              <div className="pm-stat"><div className="pm-stat-label">Quote Vol</div><div className="pm-stat-value">{fmt2(ta.quoteVolume)} USDT</div></div>
              <div className="pm-stat"><div className="pm-stat-label">Quote Vol (24h)</div><div className="pm-stat-value">{fmt2(ta.quoteVolume24h)} USDT</div></div>
              <div className="pm-stat"><div className="pm-stat-label">Valid</div><div className={`pm-stat-value ${ta.valid ? 'pos' : 'neg'}`}>{String(ta.valid)}</div></div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return modalRoot ? createPortal(content, modalRoot) : content;
}