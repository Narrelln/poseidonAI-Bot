/**
 * File #11: routes/strategyDebugRoute.js
 * --------------------------------------
 * Purpose:
 *   Read-only debug endpoints for Poseidon’s strategy selection.
 *   Lets you see which strategy a symbol would get and the current mappings.
 *
 * Exposes:
 *   GET /api/strategy/debug?symbol=ADA-USDTM
 *   GET /api/strategy/mappings
 *
 * Dependencies (soft — handled with try/catch):
 *   - ./strategyRouter.js  (should export: chooseStrategy, getStrategyForSymbol, getStrategyMappings)
 *
 * Debugging:
 *   Logs are prefixed with [STRATEGY-DEBUG]
 */

function safeRequireStrategyRouter() {
    try {
      // Adjust the relative path if your router lives elsewhere
      // Expected (optional) exports:
      //   chooseStrategy(symbol) -> { name, reason, meta }
      //   getStrategyForSymbol(symbol) -> string|object
      //   getStrategyMappings() -> { majors:[], memes:[], whitelist:[], overrides:{}, ... }
      // All are optional; we degrade gracefully if missing.
      return require('../public/scripts/strategyRouter.js');
    } catch (e) {
      return {};
    }
  }
  
  function registerStrategyDebugRoute(app) {
    const {
      chooseStrategy,
      getStrategyForSymbol,
      getStrategyMappings
    } = safeRequireStrategyRouter();
  
    // GET /api/strategy/debug?symbol=ADA-USDTM
    app.get('/api/strategy/debug', async (req, res) => {
      const symbol = String(req.query.symbol || '').trim();
      if (!symbol) {
        return res.status(400).json({ ok: false, error: 'Missing ?symbol=' });
      }
  
      try {
        // prefer detailed chooser if available
        if (typeof chooseStrategy === 'function') {
          const result = await Promise.resolve(chooseStrategy(symbol));
          console.log('[STRATEGY-DEBUG] chooseStrategy:', symbol, result);
          return res.json({ ok: true, via: 'chooseStrategy', symbol, result });
        }
  
        // fallback: simpler getter
        if (typeof getStrategyForSymbol === 'function') {
          const name = await Promise.resolve(getStrategyForSymbol(symbol));
          console.log('[STRATEGY-DEBUG] getStrategyForSymbol:', symbol, name);
          return res.json({ ok: true, via: 'getStrategyForSymbol', symbol, result: { name } });
        }
  
        return res.status(501).json({ ok: false, error: 'strategyRouter not available' });
      } catch (err) {
        console.error('[STRATEGY-DEBUG] error:', err?.message || err);
        return res.status(500).json({ ok: false, error: err?.message || 'Unexpected error' });
      }
    });
  
    // GET /api/strategy/mappings
    app.get('/api/strategy/mappings', async (_req, res) => {
      try {
        if (typeof getStrategyMappings === 'function') {
          const mappings = await Promise.resolve(getStrategyMappings());
          return res.json({ ok: true, mappings });
        }
        return res.status(501).json({ ok: false, error: 'getStrategyMappings not available' });
      } catch (err) {
        console.error('[STRATEGY-DEBUG] mappings error:', err?.message || err);
        return res.status(500).json({ ok: false, error: err?.message || 'Unexpected error' });
      }
    });
  }
  
  module.exports = { registerStrategyDebugRoute };