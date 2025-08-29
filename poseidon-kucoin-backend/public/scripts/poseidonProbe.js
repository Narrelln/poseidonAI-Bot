// /public/scripts/poseidonProbe.js
(function(){
    function exists(path) {
      try {
        return !!path.split('.').reduce((o,k)=>o && o[k], window);
      } catch { return false; }
    }
  
    window.showPoseidonStatus = async function showPoseidonStatus(){
      const fe = {
        botModule: exists('poseidonBotModule') || exists('isBotActive'),
        signalModule: exists('analyzeAndTrigger'),
        scannerPanel: !!document.querySelector('#scanner-panel'),
        qaPanel: !!document.querySelector('#signal-qa-panel'),
        auditBtn: !!document.querySelector('#open-audit-dashboard'),
        voiceToggle: !!document.querySelector('#voice-toggle'),
        qaMode: localStorage.getItem('POSEIDON_QA_MODE') || 'real',
      };
  
      // active symbols list if scanner wired
      let active = [];
      try { active = (window.getActiveSymbols && window.getActiveSymbols()) || []; } catch {}
  
      // backend snapshot
      let be = {};
      try {
        const r = await fetch('/api/strategy-health', { cache: 'no-store' });
        be = await r.json();
      } catch (e) {
        be = { ok:false, error:e?.message };
      }
  
      const report = {
        frontend: fe,
        activeSymbols: Array.isArray(active) ? active.length : 0,
        backend: be
      };
      console.table(report.frontend);
      console.log('Active symbols:', active);
      console.log('Backend:', report.backend);
      return report;
    };
  })();