console.log('[BUILD] src/app.js loaded at', new Date().toISOString());
/* ======================================================================
   Buying Analysis Portal — app.js (Full, self-contained)
   - Keeps your existing IDs and layout from the provided HTML
   - Upload CSV/XLSX → map columns → Analyze → Save per month
   - Stores snapshots in localStorage under 'ma_snaps_sidebar_v1'
   - Monthly tab: shows saved months + per-dealer detail
   - Yearly tab: YTD tiles + MoM + line chart + FI (YTD) + State Performance
   - Safe guards everywhere so missing sections never crash
   ====================================================================== */

/* ---------- Tiny DOM helpers ---------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
/* ---------- Debug status helpers (UI only; no logic changes) ---------- */
// Clear the Save Status box
function clearSaveStatus() {
  const el = $('#saveStatus');
  if (!el) return;
  el.textContent = '';
  el.classList.add('whitespace-pre-wrap'); // keep nice wrapping
}

// Append a line with a timestamp to the Save Status box
function setSaveStatus(msg) {
  const el = $('#saveStatus');
  if (!el) return;
  const t = new Date().toLocaleTimeString();
  el.textContent += (el.textContent ? '\n' : '') + `[${t}] ${msg}`;
}

/* ---------- Storage helpers ---------- */
window.LS_KEY = 'ma_snaps_sidebar_v1';
function getSnaps() {
  try { return JSON.parse(localStorage.getItem(window.LS_KEY) || '[]'); } catch { return []; }
}
function setSnaps(snaps) {
  try { localStorage.setItem(window.LS_KEY, JSON.stringify(snaps || [])); } catch (e) { console.error('setSnaps failed:', e); }
}
/* ---------- Supabase (read-only, JS-only) ---------- */
(function initSupabase() {
  try {
    var url = window.NEXT_PUBLIC_SUPABASE_URL || window.SUPABASE_URL;
    var key = window.NEXT_PUBLIC_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY;
    if (window.supabase && window.supabase.createClient && url && key) {
      window.sb = window.supabase.createClient(url, key);
      console.log('[sb] client ready');
    } else {
      window.sb = null;
      console.log('[sb] not configured — using localStorage fallback');
    }
  } catch (e) {
    window.sb = null;
  }
})();

/**
 * Fetch the last 12 month tiles from Supabase monthly_snapshots.
 * Returns: [{ id, year, month, totals:{...}, kpis:{ totalFunded } }]
 */
async function fetchMonthlySummariesSB() {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('monthly_snapshots')
    .select('year,month,total_apps,approved,counter,pending,denial,funded,funded_amount')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(5000);

  if (result.error) {
    console.error('[sb] monthly summaries error:', result.error);
    return null;
  }

  var data = result.data || [];
  var byId = new Map();
  data.forEach(function (r) {
    var id = String(r.year) + '-' + String(r.month).padStart(2, '0');
    var cur = byId.get(id) || {
      id: id,
      year: r.year,
      month: r.month,
      totals: { totalApps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 },
      kpis: { totalFunded: 0 }
    };
    cur.totals.totalApps += Number(r.total_apps) || 0;
    cur.totals.approved  += Number(r.approved)    || 0;
    cur.totals.counter   += Number(r.counter)     || 0;
    cur.totals.pending   += Number(r.pending)     || 0;
    cur.totals.denial    += Number(r.denial)      || 0;
    cur.totals.funded    += Number(r.funded)      || 0;
    cur.kpis.totalFunded += Number(r.funded_amount) || 0;
    byId.set(id, cur);
  });

  return Array.from(byId.values())
    .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
    .slice(-12);
}

/**
 * Build the full snapshot for a specific month (dealer/state rows + totals)
 * so your existing Monthly detail view can render from Supabase data.
 */
async function buildMonthlySnapSB(year, month) {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('monthly_snapshots')
    .select('dealer,state,fi,total_apps,approved,counter,pending,denial,funded,funded_amount,year,month')
    .eq('year', year)
    .eq('month', month)
    .limit(10000);

  if (result.error) {
    console.error('[sb] monthly detail error:', result.error);
    return null;
  }

  var data = result.data || [];
  var totals = { totalApps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 };
  var dealers = [];
  var stateMap = new Map();
  var totalFunded = 0;

  data.forEach(function (r) {
    var row = {
      dealer: r.dealer,
      state: r.state,
      fi: r.fi,
      total: Number(r.total_apps) || 0,
      approved: Number(r.approved) || 0,
      counter: Number(r.counter) || 0,
      pending: Number(r.pending) || 0,
      denial: Number(r.denial) || 0,
      funded: Number(r.funded) || 0
    };
    dealers.push(row);

    totals.totalApps += row.total;
    totals.approved  += row.approved;
    totals.counter   += row.counter;
    totals.pending   += row.pending;
    totals.denial    += row.denial;
    totals.funded    += row.funded;

    totalFunded += Number(r.funded_amount) || 0;

    var sKey = String(r.state || '');
    var sCur = stateMap.get(sKey) || { state: sKey, total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 };
    sCur.total   += row.total;
    sCur.approved+= row.approved;
    sCur.counter += row.counter;
    sCur.pending += row.pending;
    sCur.denial  += row.denial;
    sCur.funded  += row.funded;
    stateMap.set(sKey, sCur);
  });

  var fundedRawRows = data.map(function (r) {
    return { Dealer: r.dealer, State: r.state, FI: r.fi, 'Loan Amount': Number(r.funded_amount) || 0 };
  });
  // Build FI (Franchise / Independent) tallies for the Monthly card
  var fiMap = new Map();
  (dealers || []).forEach(function (r) {
    var key = (r.fi || 'Unknown');
    if (!fiMap.has(key)) {
      fiMap.set(key, { fi: key, total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 });
    }
    var x = fiMap.get(key);
    x.total    += r.total    || 0;
    x.approved += r.approved || 0;
    x.counter  += r.counter  || 0;
    x.pending  += r.pending  || 0;
    x.denial   += r.denial   || 0;
    x.funded   += r.funded   || 0;
  });
  var fiRows = Array.from(fiMap.values());  

// Build stateRows with robust total + LTA/LTB so Monthly renders after refresh
var stateRows = Array.from(stateMap.values()).map(function (s) {
  // some historical builds used totalApps/total_apps/apps; normalize to total
  var total = (s.total != null ? s.total : 0)
           || (s.totalApps != null ? s.totalApps : 0)
           || (s.total_apps != null ? s.total_apps : 0)
           || (s.apps != null ? s.apps : 0);

  var approvedPlusCounter = (s.approved || 0) + (s.counter || 0);
  var fundedCt            = (s.funded  || 0);

  return Object.assign({}, s, {
    total: total,
    lta: total ? (approvedPlusCounter / total) : 0,
    ltb: total ? (fundedCt / total) : 0
  });
});
// Load month-level KPI averages persisted at save time (averages for tiles)
var kpis = { totalFunded: totalFunded };
try {
  if (window.sb) {
    const { data: krow, error: kerr } = await window.sb
      .from('monthly_kpis')
      .select('avg_ltv_approved, avg_apr_funded, avg_discount_pct_funded')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (!kerr && krow) {
      kpis.avgLTVApproved        = krow.avg_ltv_approved ?? null;
      kpis.avgAPRFunded          = krow.avg_apr_funded ?? null;
      kpis.avgDiscountPctFunded  = krow.avg_discount_pct_funded ?? null;
    }
  }
} catch (e) {
  console.error('[SB monthly] monthly_kpis fetch error:', e);
}

  return {
    id: String(year) + '-' + String(month).padStart(2, '0'),
    year: year,
    month: month,
    totals: totals,
    kpis: kpis,
    dealerRows: dealers,
    fiRows: fiRows,
    stateRows: stateRows,
    approvedRawRows: [],
    fundedRawRows: fundedRawRows
  };
}
/* ---------- Supabase Yearly (read-only, JS-only) ---------- */

/**
 * Yearly Dealer Table (YTD) from yearly_dealer_totals
 * Returns rows shaped like your existing table expects.
 */
 async function fetchYearlyDealerTotalsSB(year) {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('yearly_dealer_totals')
    .select('dealer,state,fi,total_apps,approved,counter,pending,denial,funded,funded_amount,year')
    .eq('year', year)
    .limit(20000);

  if (result.error) {
    console.error('[sb] yearly dealer totals error:', result.error);
    return null;
  }

  var data = result.data || [];
  // Adapt to your table's fields (raw numbers; your UI computes LTA/LTB)
  return data.map(function (r) {
    return {
      dealer: r.dealer,
      state: r.state,
      fi: r.fi,
      total: Number(r.total_apps) || 0,
      approved: Number(r.approved) || 0,
      counter: Number(r.counter) || 0,
      pending: Number(r.pending) || 0,
      denial: Number(r.denial) || 0,
      funded: Number(r.funded) || 0,
      fundedAmount: Number(r.funded_amount) || 0
    };
  });
}

/**
 * State Performance (YTD) from state_monthly.
 * Builds per-state series over months 1..12, plus a YTD sum for each metric.
 */
async function fetchStateMonthlyYTD_SB(year) {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('state_monthly')
    .select('state,month,total_apps,approved,counter,pending,denial,funded,funded_amount,year')
    .eq('year', year)
    .order('state', { ascending: true })
    .order('month', { ascending: true })
    .limit(50000);

  if (result.error) {
    console.error('[sb] state_monthly (YTD) error:', result.error);
    return null;
  }

  var rows = result.data || [];
  var byState = new Map();

  rows.forEach(function (r) {
    var s = r.state || '';
    var entry =
      byState.get(s) ||
      {
        state: s,
        months: Array.from({ length: 12 }, function () {
          return { total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0, fundedAmount: 0 };
        }),
        ytd:   { total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0, fundedAmount: 0 }
      };
    var mIdx = Math.max(1, Math.min(12, Number(r.month) || 0)) - 1;
    var cell = entry.months[mIdx];

    cell.total        += Number(r.total_apps)    || 0;
    cell.approved     += Number(r.approved)      || 0;
    cell.counter      += Number(r.counter)       || 0;
    cell.pending      += Number(r.pending)       || 0;
    cell.denial       += Number(r.denial)        || 0;
    cell.funded       += Number(r.funded)        || 0;
    cell.fundedAmount += Number(r.funded_amount) || 0;

    entry.ytd.total        += Number(r.total_apps)    || 0;
    entry.ytd.approved     += Number(r.approved)      || 0;
    entry.ytd.counter      += Number(r.counter)       || 0;
    entry.ytd.pending      += Number(r.pending)       || 0;
    entry.ytd.denial       += Number(r.denial)        || 0;
    entry.ytd.funded       += Number(r.funded)        || 0;
    entry.ytd.fundedAmount += Number(r.funded_amount) || 0;

    byState.set(s, entry);
  });

  return Array.from(byState.values()); // [{state, months:[...12], ytd:{...}}]
}

/**
 * Funded by Month (YTD chart) from monthly_snapshots.
 * Returns two series: deals[] and amount[] indexed by month 1..12.
 */
async function fetchFundedByMonthSB(year) {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('monthly_snapshots')
    .select('month,funded,funded_amount,year')
    .eq('year', year)
    .order('month', { ascending: true })
    .limit(50000);

  if (result.error) {
    console.error('[sb] funded by month error:', result.error);
    return null;
  }

  var deals = Array(12).fill(0);
  var amount = Array(12).fill(0);

  (result.data || []).forEach(function (r) {
    var m = Math.max(1, Math.min(12, Number(r.month) || 0)) - 1;
    deals[m]  += Number(r.funded)        || 0;
    amount[m] += Number(r.funded_amount) || 0;
  });

  return { deals: deals, amount: amount };
}

/**
 * FI split (Franchise vs Independent) YTD from fi_yearly.
 */
async function fetchFIYTD_SB(year) {
  var sb = window.sb;
  if (!sb) return null;

  var result = await sb
    .from('fi_yearly')
    .select('fi,total_apps,approved,counter,pending,denial,funded,funded_amount,year')
    .eq('year', year)
    .limit(1000);

  if (result.error) {
    console.error('[sb] fi_yearly error:', result.error);
    return null;
  }
  var rows = result.data || [];
  var out = { Franchise: null, Independent: null };
  rows.forEach(function (r) {
    out[r.fi] = {
      total: Number(r.total_apps)    || 0,
      approved: Number(r.approved)   || 0,
      counter: Number(r.counter)     || 0,
      pending: Number(r.pending)     || 0,
      denial: Number(r.denial)       || 0,
      funded: Number(r.funded)       || 0,
      fundedAmount: Number(r.funded_amount) || 0
    };
  });
  return out;
}

/**
 * Convenience: fetch all Yearly data in parallel (if you prefer one call).
 * Calls the 4 helpers above and returns a single bundle.
 */
async function fetchYearlyBundleSB(year) {
  var results = await Promise.all([
    fetchYearlyDealerTotalsSB(year),
    fetchStateMonthlyYTD_SB(year),
    fetchFundedByMonthSB(year),
    fetchFIYTD_SB(year)
  ]);
  return {
    dealerRows: results[0] || [],
    stateYTD:   results[1] || [],
    fundedByMo: results[2] || { deals: [], amount: [] },
    fiYTD:      results[3] || { Franchise: null, Independent: null }
  };
}
// Find the Yearly <select> no matter what its id or placement is
function findYearSelect() {
  // Try common ids first
  let el =
    document.getElementById('yrYear') ||
    document.getElementById('yearSelect') ||
    document.getElementById('yrSelect');

  // If still not found, look inside the Yearly tab container for any <select>
  if (!el) {
    const yrTab = document.querySelector('#tab-Yearly') || document.querySelector('[data-tab-panel="Yearly"]');
    if (yrTab) el = yrTab.querySelector('select');
  }

  // Absolute last resort: the first <select> on the page (so we never return null)
  if (!el) el = document.querySelector('select');

  return el || null;
}

// === Year Select (populate from Supabase; fallback to current year) =======
async function ensureYearOptionsSB() {
  const sel = findYearSelect();
  if (!sel) { console.warn('[yearly] year <select> not found'); return; }

  let years = [];
  let used = 'none';

  if (window.sb) {
    // 1) Prefer years already present in yearly rollup tables
    let y1 = await window.sb
      .from('yearly_dealer_totals')
      .select('year')
      .order('year', { ascending: false })
      .limit(5000);

    if (!y1.error && Array.isArray(y1.data) && y1.data.length) {
      years = [...new Set(y1.data.map(r => Number(r.year) || 0))];
      used = 'yearly_dealer_totals';
    }

    // 2) If rollups are empty (first run), look at monthly_snapshots
    if (!years.length) {
      let y2 = await window.sb
        .from('monthly_snapshots')
        .select('year')
        .order('year', { ascending: false })
        .limit(5000);

      if (!y2.error && Array.isArray(y2.data) && y2.data.length) {
        years = [...new Set(y2.data.map(r => Number(r.year) || 0))];
        used = 'monthly_snapshots';
      }
    }
  }

  // 3) Absolute fallback so the UI doesn’t look dead
  if (!years.length) {
    years = [new Date().getFullYear()];
    used = 'fallback(currentYear)';
  }

  // Build options
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  // Keep selected if valid; otherwise choose the newest
  const current = Number(sel.value);
  if (!current || !years.includes(current)) sel.value = String(years[0]);

  console.log('[yearly] year select populated via:', used, '→', years);
}

// === Save a month's dealer rows to Supabase ===============================
// Writes one row per dealer into `monthly_snapshots` for (year, month).
// Idempotent: deletes any existing rows for that (year,month) first.
async function saveMonthlySnapshotSB(snap) {
    // --- DEBUG: entry to saveMonthlySnapshotsSB ---
    console.log('[DEBUG save] entered saveMonthlySnapshotsSB');

    // 1) Snapshot basics
    console.log('[DEBUG save] input snapshot keys:', Object.keys(snap || {}));
    console.log('[DEBUG save] year, month, dealerRows.len =',
      snap?.year, snap?.month,
      Array.isArray(snap?.dealerRows) ? snap.dealerRows.length : null
    );
  
    // 2) Peek at first raw dealer row (pre-mapping)
    if (Array.isArray(snap?.dealerRows) && snap.dealerRows.length) {
      console.log('[DEBUG save] first dealer row (raw):', snap.dealerRows[0]);
    } else {
      console.warn('[DEBUG save] WARN: dealerRows missing or empty');
    }
  
  try {
    window.lastSnap = snap;                // <-- add THIS line here
    if (!window.sb || !snap || !Array.isArray(snap.dealerRows)) return false;

    const y = Number(snap.year) || 0;
    const m = Number(snap.month) || 0;
    if (!y || !m) return false;
// Show what we're about to save (UI message)
setSaveStatus?.(`Preparing to save ${y}-${String(m).padStart(2,'0')}...`);

    // 1) remove any existing rows for this (year, month)
    let { error: delErr } = await window.sb
      .from('monthly_snapshots')
      .delete()
      .eq('year', y)
      .eq('month', m);
    if (delErr) { console.error('[sb] delete existing month failed:', delErr); return false; }
    setSaveStatus(`Step 1: deleted any existing rows for ${y}-${String(m).padStart(2,'0')}`);

    // 2) prepare fresh rows (one per dealer)
    const rows = (snap.dealerRows || []).map((r) => {
      const total   = Number(r.total)    || 0;
      const approved= Number(r.approved) || 0;
      const counter = Number(r.counter)  || 0;
      const pending = Number(r.pending)  || 0;
      const denial  = Number(r.denial)   || 0;
      const funded  = Number(r.funded)   || 0;

      // funded_amount: try common property names we already compute in UI
      const fundedAmount =
        Number(r.funded_amount) || Number(r.fundedAmt) || Number(r.amount) || 0;

      return {
        year: y,
        month: m,
        dealer: (r.dealer || '').trim(),
        state:  (r.state  || '').trim(),
        fi:     (r.fi     || '').trim(),
        total_apps: total,
        approved,
        counter,
        pending,
        denial,
        funded,
        funded_amount: fundedAmount
      };
    });
    window.lastRows = rows;
    console.log('[sb] prepared rows for insert:', rows.length);
    console.log('[sb] first row preview:', rows[0]);
    window.lastRows = rows;

    setSaveStatus(`Step 2: prepared ${rows.length} rows`);

    if (!rows.length) return false;

        // 3) insert rows
        const { error: insErr } = await window.sb
        .from('monthly_snapshots')
        .insert(rows);
        console.log('[sb] insert response:', insErr);
      if (insErr) {
        setSaveStatus(`Step 3: INSERT failed — ${insErr?.message || insErr?.code || 'unknown error'}`);
        console.error('[sb] insert month failed:', insErr);
        return false;
      }
  
      setSaveStatus(`Step 3: inserted ${rows.length} rows`);
      console.log('[sb] saved month to Supabase:', y, String(m).padStart(2,'0'), 'rows:', rows.length);  
    // NEW: rebuild Yearly aggregates for this year
    await rebuildYearlyAggregatesSB(y);
    setSaveStatus('Step 4: rebuilt yearly aggregates — OK');
  // === Save Monthly KPIs to Supabase (real values from snap.kpis) ===
try {
  const y = snap?.year, m = snap?.month;
  const k = snap?.kpis || {};
  if (window.sb && y && m) {
    await window.sb
      .from('monthly_kpis')
      .upsert({
        year: y,
        month: m,
        avg_ltv_approved:        k.avgLTVApproved ?? null,
        avg_apr_funded:          k.avgAPRFunded ?? null,
        avg_discount_pct_funded: k.avgDiscountPctFunded ?? null
      }, { onConflict: ['year','month'] })
      .select()
      .single();
    console.log('[sb] monthly_kpis upserted (real averages):', y, m, k);
  }
} catch (e) {
  console.error('[save] monthly_kpis upsert error:', e);
}

try {
  const y = snap?.year, m = snap?.month;
  const k = snap?.kpis || {};
  if (window.sb && y && m) {
    await window.sb
      .from('monthly_kpis')
      .upsert({
        year: y,
        month: m,
        avg_ltv_approved: k.avgLTVApproved ?? null,
        avg_apr_funded: k.avgAPRFunded ?? null,
        avg_discount_pct_funded: k.avgDiscountPctFunded ?? null
      })
      .select()
      .single();
  }
} catch (e) {
  console.error('[save] monthly_kpis upsert error:', e);
}

    return true;    
  } catch (e) {
    console.error('[sb] saveMonthlySnapshotSB error:', e);
    return false;
  }
}
// === Rebuild Yearly Aggregates from `monthly_snapshots` ===================
async function rebuildYearlyAggregatesSB(year) {
  try {
    if (!window.sb) return false;
    const y = Number(year) || 0;
    if (!y) return false;

    // 1) Pull ALL rows for the year from monthly_snapshots
    const { data, error } = await window.sb
      .from('monthly_snapshots')
      .select('dealer,state,fi,month,total_apps,approved,counter,pending,denial,funded,funded_amount')
      .eq('year', y)
      .limit(50000);

    if (error) {
      console.error('[sb] rebuildYearlyAggregatesSB: fetch monthly_snapshots failed:', error);
      return false;
    }

    const rows = Array.isArray(data) ? data : [];

    // 2) Build aggregations
    // 2a) by dealer|state|fi  (for yearly_dealer_totals)
    const byDealer = new Map();
    // 2b) by state + month    (for state_monthly)
    const byStateMonth = new Map(); // key: `${state}|${month}`
    // 2c) by FI               (for fi_yearly)
    const byFI = new Map(); // 'Franchise' or 'Independent'

    for (const r of rows) {
      const dealer = String(r.dealer || '').trim();
      const state  = String(r.state  || '').trim().toUpperCase();
      const fi     = String(r.fi     || '').trim() || 'Independent';
      const m      = Math.max(1, Math.min(12, Number(r.month) || 0));

      const total_apps    = Number(r.total_apps)    || 0;
      const approved      = Number(r.approved)      || 0;
      const counter       = Number(r.counter)       || 0;
      const pending       = Number(r.pending)       || 0;
      const denial        = Number(r.denial)        || 0;
      const funded        = Number(r.funded)        || 0;
      const funded_amount = Number(r.funded_amount) || 0;

      // --- dealer rollup
      const dKey = `${dealer}|${state}|${fi}`;
      const dCur = byDealer.get(dKey) || {
        year: y, dealer, state, fi,
        total_apps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0, funded_amount: 0
      };
      dCur.total_apps    += total_apps;
      dCur.approved      += approved;
      dCur.counter       += counter;
      dCur.pending       += pending;
      dCur.denial        += denial;
      dCur.funded        += funded;
      dCur.funded_amount += funded_amount;
      byDealer.set(dKey, dCur);

      // --- state/month rollup
      const smKey = `${state}|${m}`;
      const smCur = byStateMonth.get(smKey) || {
        year: y, state, month: m,
        total_apps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0, funded_amount: 0
      };
      smCur.total_apps    += total_apps;
      smCur.approved      += approved;
      smCur.counter       += counter;
      smCur.pending       += pending;
      smCur.denial        += denial;
      smCur.funded        += funded;
      smCur.funded_amount += funded_amount;
      byStateMonth.set(smKey, smCur);

      // --- FI rollup
      const fiKey = fi === 'Franchise' ? 'Franchise' : 'Independent';
      const fiCur = byFI.get(fiKey) || {
        year: y, fi: fiKey,
        total_apps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0, funded_amount: 0
      };
      fiCur.total_apps    += total_apps;
      fiCur.approved      += approved;
      fiCur.counter       += counter;
      fiCur.pending       += pending;
      fiCur.denial        += denial;
      fiCur.funded        += funded;
      fiCur.funded_amount += funded_amount;
      byFI.set(fiKey, fiCur);
    }

    const dealerRows = Array.from(byDealer.values());
    const stateRows  = Array.from(byStateMonth.values());
    const fiRows     = Array.from(byFI.values());

    // 3) Replace rows for this year in yearly tables
    // NOTE: RLS must allow delete/insert for anon if you’re using anon key.
    const del1 = await window.sb.from('yearly_dealer_totals').delete().eq('year', y);
    if (del1.error) { console.error('[sb] yearly_dealer_totals delete failed:', del1.error); return false; }

    const del2 = await window.sb.from('state_monthly').delete().eq('year', y);
    if (del2.error) { console.error('[sb] state_monthly delete failed:', del2.error); return false; }

    const del3 = await window.sb.from('fi_yearly').delete().eq('year', y);
    if (del3.error) { console.error('[sb] fi_yearly delete failed:', del3.error); return false; }

    // Insert in batches to be safe
    if (dealerRows.length) {
      const ins1 = await window.sb.from('yearly_dealer_totals').insert(dealerRows);
      if (ins1.error) { console.error('[sb] yearly_dealer_totals insert failed:', ins1.error); return false; }
    }
    if (stateRows.length) {
      const ins2 = await window.sb.from('state_monthly').insert(stateRows);
      if (ins2.error) { console.error('[sb] state_monthly insert failed:', ins2.error); return false; }
    }
    if (fiRows.length) {
      const ins3 = await window.sb.from('fi_yearly').insert(fiRows);
      if (ins3.error) { console.error('[sb] fi_yearly insert failed:', ins3.error); return false; }
    }

    console.log('[sb] Rebuilt yearly aggregates for', y, {
      dealers: dealerRows.length, stateMonths: stateRows.length, fi: fiRows.length
    });

    // 4) If user is on Yearly tab, refresh it
    if (document.querySelector('#tab-Yearly') && !document.querySelector('#tab-Yearly').classList.contains('hidden')) {
      try { if (typeof refreshYearly === 'function') await refreshYearly(); } catch {}
    }

    return true;
  } catch (e) {
    console.error('[sb] rebuildYearlyAggregatesSB error:', e);
    return false;
  }
}

/* ---------- Formatting helpers ---------- */
function monthName(m) {
  const arr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const i = Math.max(0, Math.min(11, (m|0)-1));
  return arr[i] || '';
}
function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits:0 });
}
function formatPct(x) {
  if (x == null || !isFinite(x)) return '-';
  return (x*100).toFixed(2) + '%';
}
function pctBar(x) {
  if (!isFinite(x)) x = 0;
  const pct = Math.max(0, Math.min(100, x*100));
  return `<div class="pbar" title="${pct.toFixed(2)}%"><i style="--w:${pct}%;"></i></div>`;
}
function stateChip(s) {
  const t = s || '??';
  return `<span class="badge badge-blue">${t}</span>`;
}
function fiChip(s) {
  const t = s || 'Unknown';
  const cls = t.toLowerCase()==='franchise' ? 'badge-amber' : 'badge-blue';
  return `<span class="badge ${cls}">${t}</span>`;
}

/* ---------- Parsing helpers ---------- */
function num(n) {
  if (n == null) return 0;
  if (typeof n === 'number') return isFinite(n) ? n : 0;
  const s = String(n).replace(/[^\d.-]/g, '');
  const v = parseFloat(s);
  return isFinite(v) ? v : 0;
}
// Alias to support helpers that expect parseNumber()
function parseNumber(x) { return num(x); }
// --- Similarity + normalization helpers (modal pre-merge) ---
function _normNameForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[@]/g, ' at ')
    .replace(/[^a-z0-9 ]+/g, ' ')     // drop punctuation
    .replace(/\s+/g, ' ')             // collapse spaces
    .trim();
}

// Lightweight Jaro-Winkler style similarity (0..1)
function _jwSim(a, b) {
  a = _normNameForMatch(a); b = _normNameForMatch(b);
  if (!a || !b) return 0;
  // very small + fast — good enough for name proximity
  const m = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const match = (s1, s2) => {
    const s2Flags = new Array(s2.length).fill(false);
    let matches = 0;
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - m), end = Math.min(i + m + 1, s2.length);
      for (let j = start; j < end; j++) {
        if (!s2Flags[j] && s1[i] === s2[j]) { s2Flags[j] = true; matches++; break; }
      }
    }
    return matches;
  };
  const matches = match(a, b);
  if (!matches) return 0;

  let t = 0, k = 0;
  const bFlags = new Array(b.length).fill(false);
  // flag matches again to read order
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - m), end = Math.min(i + m + 1, b.length);
    for (let j = start; j < end; j++) {
      if (!bFlags[j] && a[i] === b[j]) { bFlags[j] = true;
        if (j < k) t++; else k = j;
        break;
      }
    }
  }
  t = t / 2;
  const jw = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  // small Winkler prefix bonus
  let l = 0;
  while (l < 4 && a[l] && a[l] === b[l]) l++;
  return jw + 0.1 * l * (1 - jw);
}

// Flag forms that likely require human review (#, branches, store IDs)
function _looksLikeBranchOrNumbered(name) {
  const raw = String(name || '').toLowerCase();
  if (/[#]\s*\d+/.test(raw)) return true;        // "#2"
  if (/\b(801|802|north|south|east|west|store|branch|loc|location)\b/.test(raw)) return true;
  if (/-\s*\d+\b/.test(raw)) return true;        // "- 801"
  return false;
}

// Normalize dealer names for matching (strip punctuation, company suffixes, collapse whitespace)
function normalizeDealerName(s) {
  if (!s) return '';
  let t = String(s).toUpperCase();
  t = t.replace(/&/g,' AND ');
  t = t.replace(/[.,/\\\-_'`]/g,' ');
  t = t.replace(/\b(LLC|INC|CO|COMPANY|CORP|CORPORATION|LTD|THE|AUTO|AUTO GROUP|GROUP)\b/g,' ');
  t = t.replace(/\s+/g,' ').trim();
  return t;
}
function normalizeState(s) {
  return String(s || '').toUpperCase().trim();
}

// Simple Dice coefficient (bigram similarity) 0..1
function diceSimilarity(a, b) {
  a = normalizeDealerName(a); b = normalizeDealerName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = str => {
    const arr = [];
    for (let i=0;i<str.length-1;i++) arr.push(str.slice(i,i+2));
    return arr;
  };
  const aa = bigrams(a), bb = bigrams(b);
  const map = new Map();
  aa.forEach(x => map.set(x, (map.get(x)||0)+1));
  let inter = 0;
  bb.forEach(x => {
    const c = map.get(x)||0;
    if (c>0) { inter++; map.set(x, c-1); }
  });
  return (2*inter) / (aa.length + bb.length);
}

function normStatus(s) {
  if (!s) return 'other';
  const t = String(s).trim().toLowerCase();
  if (/(fund)/.test(t)) return 'funded';
  if (/(approve|booked)/.test(t)) return 'approved';
  if (/(counter|countered)/.test(t)) return 'counter';
  if (/(pend)/.test(t)) return 'pending';
  if (/(denied|decline|reject|turn|ntp)/.test(t)) return 'denial';
  return 'other';
}
function normFI(s) {
  if (!s) return 'Independent';
  const t = String(s).trim().toLowerCase();
  return /franch/.test(t) ? 'Franchise' : 'Independent';
}
function monthId(y, m) {
  return `${y}-${String(m).padStart(2,'0')}`;
}

/* ---------- Build monthly snapshot from mapped rows ---------- */
/* mapping = { dealer, state, status, loan, apr, fee, ltv, fi } */
function buildSnapshotFromRows(mapping, rows, year, month) {
  const id = monthId(year, month);

  // Per-dealer tallies
  const dealerMap = new Map(); // key dealer|state|fi

  // FI tallies (counts)
  const fiTallies = {
    Independent: { total:0, approved:0, counter:0, pending:0, denial:0, funded:0 },
    Franchise:   { total:0, approved:0, counter:0, pending:0, denial:0, funded:0 }
  };

  // State tallies (track every bucket)
  const stateMap = new Map(); // state -> {state,total,approved,counter,pending,denial,funded}

  // Raw rows we need later
  const fundedRawRows   = []; // for Avg APR(Funded), amounts, FI $ by month
  const approvedRawRows = []; // for Avg LTV(Approved)

  rows.forEach((r) => {
    const dealer = String(r[mapping.dealer] ?? '').trim() || '(Unknown Dealer)';
    const state  = String(r[mapping.state]  ?? '').trim().toUpperCase() || '??';
    const status = normStatus(r[mapping.status]);
    const loan   = num(r[mapping.loan]);
    const apr    = num(r[mapping.apr]);
    const fee    = num(r[mapping.fee]);
    const ltv    = num(r[mapping.ltv]);
    const fi     = normFI(r[mapping.fi]);

    // Dealer tallies
    const key = `${dealer}|${state}|${fi}`;
    if (!dealerMap.has(key)) {
      dealerMap.set(key, { dealer, state, fi, total:0, approved:0, counter:0, pending:0, denial:0, funded:0 });
    }
    const d = dealerMap.get(key);
    d.total += 1;
    if (status === 'approved') d.approved += 1;
    if (status === 'counter')  d.counter  += 1;
    if (status === 'pending')  d.pending  += 1;
    if (status === 'denial')   d.denial   += 1;
    if (status === 'funded')   d.funded   += 1;

    // FI tallies
    const ff = fiTallies[fi] || fiTallies.Independent;
    ff.total += 1;
    if (status === 'approved') ff.approved += 1;
    if (status === 'counter')  ff.counter  += 1;
    if (status === 'pending')  ff.pending  += 1;
    if (status === 'denial')   ff.denial   += 1;
    if (status === 'funded')   ff.funded   += 1;

    // State tallies
    if (!stateMap.has(state)) {
      stateMap.set(state, { state, total:0, approved:0, counter:0, pending:0, denial:0, funded:0 });
    }
    const st = stateMap.get(state);
    st.total += 1;
    if (status === 'approved') st.approved += 1;
    if (status === 'counter')  st.counter  += 1;
    if (status === 'pending')  st.pending  += 1;
    if (status === 'denial')   st.denial   += 1;
    if (status === 'funded')   st.funded   += 1;

    // Raw rows for later KPIs
    if (status === 'funded') {
      fundedRawRows.push({
        Dealer: dealer,
        State: state,
        Status: 'funded',
        'Loan Amount': loan,
        APR: apr,
        'Lender Fee': fee,
        LTV: ltv,
        FI: fi
      });
    }
    if (status === 'approved') {
      approvedRawRows.push({
        Dealer: dealer,
        State: state,
        Status: 'approved',
        LTV: ltv,
        FI: fi
      });
    }
  });

  // Per-dealer rows with LTA/LTB  (YOUR definitions)
  const dealerRows = Array.from(dealerMap.values()).map(d => ({
    ...d,
    lta: d.total ? (d.approved + d.counter) / d.total : 0,  // LTA = (Approved + Counter)/Total
    ltb: d.total ? d.funded / d.total : 0,                   // LTB = Funded/Total
  }));

  // FI rows array
  const fiRows = [
    { type:'Independent', ...fiTallies.Independent },
    { type:'Franchise',   ...fiTallies.Franchise   },
  ];

  // State rows array (include all buckets + robust LTA/LTB)
// NOTE: some builds used s.totalApps instead of s.total, so compute a safe total.
const stateRows = Array.from(stateMap.values()).map(s => {
  const total = (s.total ?? s.totalApps ?? s.total_apps ?? s.apps ?? 0);    // pick whichever key exists
  const approvedPlusCounter = (s.approved ?? 0) + (s.counter ?? 0);
  const funded = (s.funded ?? 0);

  return {
    ...s,
    total,                                         // normalized total so UI can rely on it
    lta: total ? approvedPlusCounter / total : 0,  // (approved + counter) / total
    ltb: total ? funded / total : 0                 // funded / total
  };
});

// --- DEBUG: check the first state row once
if (Array.isArray(stateRows) && stateRows.length) {
  console.log('[DEBUG monthly] first state row:', stateRows[0]);
}
// --- Helpers to parse numbers like "10%" or "15,390" into plain floats ---
function _num(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function _avgFrom(rows, keyCandidates) {
  const vals = (rows || []).map(r => {
    // try multiple possible column names, first one that exists wins
    const k = keyCandidates.find(k => r && r[k] != null);
    return _num(k ? r[k] : null);
  }).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

  // Totals & KPIs
  const totalApps = dealerRows.reduce((a,r)=>a+r.total,0);
  const approved  = dealerRows.reduce((a,r)=>a+r.approved,0);
  const counter   = dealerRows.reduce((a,r)=>a+r.counter,0);
  const pending   = dealerRows.reduce((a,r)=>a+r.pending,0);
  const denial    = dealerRows.reduce((a,r)=>a+r.denial,0);
  const funded    = dealerRows.reduce((a,r)=>a+r.funded,0);
  const totalFunded = fundedRawRows.reduce((a,r)=>a + num(r['Loan Amount']), 0);
// Averages for tiles
// LTV from APPROVED rows (use whichever header your sheet has)
const avgLTVApproved = _avgFrom(approvedRawRows, ['LTV', 'LTV Buying', 'ltv']);

// APR from FUNDED rows
const avgAPRFunded = _avgFrom(fundedRawRows, ['APR', 'apr']);

// Lender Fee / Discount % from FUNDED rows
const avgDiscountPctFunded = _avgFrom(fundedRawRows, ['Discount', 'Lender Fee', 'Lender Fee / Discount %', 'discount']);

  return {
    id, year, month,
    meta: { year, month },
    mapping,
    totals: { totalApps, approved, counter, pending, denial, funded },
    kpis: {
      totalFunded,          // dollars
      avgLTVApproved,       // %
      avgAPRFunded,         // %
      avgDiscountPctFunded  // %
    },    
    dealerRows,
    fiRows,
    stateRows,
    fundedRawRows,
    approvedRawRows, // used for Avg LTV(Approved)
  };
}


/* ---------- Sidebar & tab switching ---------- */
const TABS = [
  { id: 'Upload',  label: 'Upload' },
  { id: 'Monthly', label: 'Monthly' },
  { id: 'Yearly',  label: 'Yearly' },
  { id: 'ILReps',  label: 'IL Reps' },
];
function buildSidebar() {
  const nav = $('#sidebar-nav');
  if (!nav) return;
  if (nav.children.length) return; // skip if already filled
  TABS.forEach((t,i) => {
    const b = document.createElement('button');
    b.className = 'w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50';
    b.textContent = t.label;
    b.dataset.tab = t.id;
    b.addEventListener('click', () => switchTab(t.id));
    if (i===0) b.classList.add('bg-blue-50','text-blue-700','font-semibold');
    nav.appendChild(b);
  });
}
function switchTab(id) {
  $$('.tab-panel').forEach(el => el.classList.add('hidden'));
  const panel = $('#tab-' + id);
  if (panel) panel.classList.remove('hidden');
  $$('#sidebar-nav button').forEach(b => {
    if (b.dataset.tab === id) b.classList.add('bg-blue-50','text-blue-700','font-semibold');
    else                      b.classList.remove('bg-blue-50','text-blue-700','font-semibold');
  });
  if (id === 'Monthly') refreshMonthlyGrid();
  if (id === 'Yearly') {
    // Fill the year dropdown from Supabase, then render the Yearly tab
    ensureYearOptionsSB().then(async () => {
      if (typeof refreshYearly === 'function') {
        await refreshYearly();
      }
    });
  }  
}

/* ---------- Upload & Map ---------- */
let parsed = { fields: [], rows: [] };
// Funded file (optional)
let fundedParsed = { fields: [], rows: [] };
let fundedMapping = { dealer:'', state:'', loan:'', apr:'', fee:'' };
// pending merge context from the review modal
let _pendingMerge = null;
const dropArea = $('#dropArea');
const fileInput = $('#fileInput');

window.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
window.addEventListener('drop',     (e) => { e.preventDefault(); e.stopPropagation(); });

dropArea?.addEventListener('click', () => fileInput?.click());
dropArea?.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('bg-blue-50'); });
dropArea?.addEventListener('dragleave', () => dropArea.classList.remove('bg-blue-50'));
dropArea && dropArea.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  dropArea.classList.remove('bg-blue-50');

  var dt = e && e.dataTransfer;
  var files = dt && dt.files;
  var f = files && files.length ? files[0] : null;
  if (f) handleFile(f);
});

fileInput && fileInput.addEventListener('change', (e) => {
  var tgt = e && e.target;
  var files = tgt && tgt.files;
  var f = files && files.length ? files[0] : null;
  if (f) handleFile(f);
});

// Funded: elements + events
const fundedDropArea  = $('#fundedDropArea');
const fundedFileInput = $('#fundedFileInput');

fundedDropArea?.addEventListener('click', () => fundedFileInput?.click());
fundedDropArea?.addEventListener('dragover', (e) => { e.preventDefault(); fundedDropArea.classList.add('bg-blue-50'); });
fundedDropArea?.addEventListener('dragleave', () => fundedDropArea.classList.remove('bg-blue-50'));
fundedDropArea && fundedDropArea.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  fundedDropArea.classList.remove('bg-blue-50');

  var dt = e && e.dataTransfer;
  var files = dt && dt.files;
  var f = files && files.length ? files[0] : null;
  if (f) handleFundedFile(f);
});

fundedFileInput && fundedFileInput.addEventListener('change', (e) => {
  var tgt = e && e.target;
  var files = tgt && tgt.files;
  var f = files && files.length ? files[0] : null;
  if (f) handleFundedFile(f);
});

// Collect rows the user has reviewed/edited in the merge modal
// - Always include manual overrides (typed into .rv-input)
// - If includeReviewed is true, also include rows with .rv-approve checked
// Returns: [{ fundedName, targetName, match:'manual'|'exact'|'high'|'low' }]
function collectReviewedAccepted(includeReviewed = false) {
  const tbody = document.getElementById('mergeModalBody');
  if (!tbody) return [];

  const accepted = [];

  Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
    const fundedName = tr.querySelector('td.rv-funded')?.textContent?.trim() || '';
    const suggested  = tr.querySelector('td:nth-child(2)')?.textContent?.trim() || ''; // the suggested dealer
    const simText    = tr.querySelector('td:nth-child(3)')?.textContent?.trim() || ''; // e.g. "93.0%"
    const inputEl    = tr.querySelector('input.rv-input');
    const approveEl  = tr.querySelector('input.rv-approve');

    // parse "95.7%" → 0.957
    let score = NaN;
    if (simText) {
      const n = parseFloat(simText.replace('%',''));
      if (!Number.isNaN(n)) score = n / 100;
    }

    const override = (inputEl?.value || '').trim();
    const approved = approveEl ? !!approveEl.checked : false;

    // manual override always included
    // if header toggle is ON, also include approved rows (checked)
    const shouldInclude = !!override || (includeReviewed && approved);

    if (!shouldInclude) return;

    const targetName = override || suggested || '';
    if (!fundedName || !targetName) return;

    const match = override
      ? 'manual'
      : (score >= 0.92 ? 'exact' : score >= 0.85 ? 'high' : 'low');

    accepted.push({ fundedName, targetName, match });
  });

  return accepted;
}

// ===== Merge modal buttons =====
document.getElementById('mergeCancelBtn')?.addEventListener('click', () => {
  document.getElementById('mergeModal')?.classList.add('hidden');
  _pendingMerge = null; // user canceled
});

document.getElementById('mergeProceedBtn')?.addEventListener('click', () => {
  try {
    const ctx = _pendingMerge;
    if (!ctx?.snapshot) { document.getElementById('mergeModal')?.classList.add('hidden'); return; }

    // 1) Read the header toggle
    const includeReviewed = document.getElementById('mergeIncludeReviewed')?.checked ?? false;

    // 2) Start with exact + high we saved earlier (from Step 1)
    const engineAccepted = Array.isArray(ctx.accepted) ? ctx.accepted.slice() : [];

    // 3) Add manual overrides + approved rows (if toggle ON)
    const reviewedAccepted = collectReviewedAccepted(includeReviewed);

    // 4) Combine and dedupe by fundedName (manual overrides win)
    const byFunded = new Map();
    engineAccepted.forEach(x => { if (!byFunded.has(x.fundedName)) byFunded.set(x.fundedName, x); });
    reviewedAccepted.forEach(x => byFunded.set(x.fundedName, x)); // overrides overwrite

    const acceptedCombined = Array.from(byFunded.values());

    // Debug
    console.log('[Funded Merge] includeReviewed =', includeReviewed);
    console.log('[Funded Merge] engineAccepted =', engineAccepted.length);
    console.log('[Funded Merge] reviewedAccepted =', reviewedAccepted.length);
    console.log('[Funded Merge] total acceptedCombined =', acceptedCombined.length);
    if (includeReviewed) console.log('Merging reviewed rows:', reviewedAccepted);

    if (!acceptedCombined.length) {
      alert('Nothing to merge yet. Type an override or enable "Include reviewed rows" and check rows.');
      return;
    }

    // 5) Merge using the accepted-list merger
    const snap = ctx.snapshot;
    mergeFundedIntoSnapshot(snap, fundedParsed, fundedMapping, { accepted: acceptedCombined });

    // 6) Recompute totals & state tallies so tiles/tables update
    recomputeAggregatesFromDealers(snap);
// --- DEBUG: set global snapshot after analysis + merge ---
if (snap && typeof snap === 'object') {
  window.lastBuiltSnapshot = snap;
  console.log('[DEBUG] set window.lastBuiltSnapshot', {
    year: snap.year,
    month: snap.month,
    dealerRowsLen: Array.isArray(snap.dealerRows) ? snap.dealerRows.length : null
  });
}

    // 7) Close modal
    document.getElementById('mergeModal')?.classList.add('hidden');

    // 8) Refresh the Upload summary
    const res = document.getElementById('resultsArea');
    if (res) {
      const s = snap;
      res.innerHTML = `
        <div class="text-sm">
          <div class="font-semibold mb-1">Analyzed: ${monthName(s.month)} ${s.year}</div>
          <ul class="list-disc ml-5 space-y-0.5">
            <li>Total apps: <b>${s.totals.totalApps}</b></li>
            <li>Approved: <b>${s.totals.approved}</b></li>
            <li>Funded: <b>${s.totals.funded}</b></li>
            <li>Total Funded: <b>${formatMoney(s.kpis.totalFunded)}</b></li>
            ${s.kpis.avgFundedAmount ? `<li>Avg Loan (Funded): <b>${formatMoney(s.kpis.avgFundedAmount)}</b></li>`:''}
            ${Number.isFinite(s.kpis.avgDiscountPct) ? `<li>Avg Lender Fee % (Funded): <b>${(s.kpis.avgDiscountPct*100).toFixed(2)}%</b></li>`:''}
            <li>Dealers: <b>${s.dealerRows.length}</b>, States: <b>${s.stateRows.length}</b></li>
          </ul>
        </div>
      `;
    }

    // 9) Enable buttons
    ['#btnSaveMonth','#btnExportRawAll','#btnExportFunded'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.disabled = false;
    });

  } catch (e) {
    console.error('Proceed & Merge failed:', e);
    alert('Merge failed. Open Console for details.');
  } finally {
    _pendingMerge = null;
  }
});

function handleFile(file) {
  const name = (file?.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    // Use SheetJS for Excel (xlsx)
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        parsed = { fields: rows.length ? Object.keys(rows[0]) : [], rows };
        setupMappingUI();
      } catch (err) {
        console.error('XLSX parse error:', err);
        alert('Could not read Excel file. Try CSV or check the console.');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // Use PapaParse for CSV
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => {
        parsed.fields = res.meta.fields || [];
        parsed.rows   = res.data || [];
        setupMappingUI();
      }
    });
  }
}

// ⬇️ Paste the funded-file handler right here
function handleFundedFile(file) {
  const name = (file?.name || '').toLowerCase();
  console.log('[funded] handleFundedFile start:', name);

  // tiny helper to finish: populate selects + tip
  const finish = () => {
    console.log('[funded] parsed:', (fundedParsed.fields||[]).length, 'fields,', (fundedParsed.rows||[]).length, 'rows');
    setupFundedMappingUI();  // <-- builds the 5 funded selects
    const tip = document.getElementById('fundedMapTip');
    if (tip) tip.textContent = (fundedParsed.fields?.length)
      ? `Detected ${fundedParsed.fields.length} columns. Auto-mapped what I could—please confirm below.`
      : 'No columns detected—please check the file.';
  };

  // Excel path
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        fundedParsed.fields = rows.length ? Object.keys(rows[0]) : [];
        fundedParsed.rows   = rows || [];
        finish();
      } catch (err) {
        console.error('[funded] XLSX parse error:', err);
        alert('Could not read funded Excel file. Try CSV or check the console.');
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  // CSV path (PapaParse)
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (res) => {
      fundedParsed.fields = res.meta?.fields || [];
      fundedParsed.rows   = res.data || [];
      finish();
    },
    error: (err) => {
      console.error('[funded] CSV parse error:', err);
      alert('Could not read funded CSV file. See console for details.');
    }
  });
}

// === Auto-mapping: guess spreadsheet columns by header words ===
function guessMapping(fields) {
  // normalize header to compare
  const norm = (s) => String(s || '').trim().toLowerCase();

  // helper: find first field whose name matches ANY regex in list
  const pick = (regexList) => {
    for (const f of fields) {
      const n = norm(f);
      if (regexList.some(rx => rx.test(n))) return f;
    }
    return '';
  };

  // patterns for each logical column
  const g = {
    dealer: pick([/dealer|store|merchant|seller|partner|client|account/]),
    state:  pick([/state\b|^st\b|state code|region code/]),
    status: pick([/status|decision|result|outcome|fund(ed|ing)|approve|den(y|ied)|pending|counter/]),
    loan:   pick([/loan amount|amount financed|financed amount|principal|funded amount|approval amount|gross amount|amt\b/]),
    apr:    pick([/apr|rate\b|interest/]),
    fee:    pick([/lender fee|origination|doc(ument)? fee|bank fee|fee\b/]),
    ltv:    pick([/\bltv\b|loan[- ]?to[- ]?value/]),
    fi:     pick([/franchise|independent|fi\b|store type|channel|dealer type/]),
  };

  // confidence: how many did we fill?
  const filled = Object.values(g).filter(Boolean).length;
  return { mapping: g, filled };
}
function autoMapFunded(fields=[]) {
  const norm = (s) => String(s||'').toLowerCase();
  const pick = (...rxs) => {
    for (const f of fields) {
      const n = norm(f);
      if (rxs.some(rx => rx.test(n))) return f;
    }
    return '';
  };
  return {
    dealer: pick(/dealer|store|merchant|client|account/),
    state:  pick(/state\b|^st\b|state code|region/),
    loan:   pick(/loan amount|amount financed|funded|principal|af\b|amt\b/),
    apr:    pick(/\bapr\b|rate|interest/),
    fee:    pick(/lender fee|discount|disc%|origination|doc fee|fee\b/),
  };
}
function guessFundedMapping(fields = []) {
  return autoMapFunded(fields);
}

function setupFundedMappingUI() {
  const fields = fundedParsed.fields || [];

  const dealerSel = document.getElementById('fMapDealer');
  const stateSel  = document.getElementById('fMapState');
  const loanSel   = document.getElementById('fMapLoan');
  const aprSel    = document.getElementById('fMapApr');
  const feeSel    = document.getElementById('fMapFee');

  const sels = [dealerSel, stateSel, loanSel, aprSel, feeSel].filter(Boolean);
  if (!sels.length) return; // HTML not on this tab yet

  // rebuild options in all 5 selects
  sels.forEach((el) => {
    el.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = ''; o0.textContent = '(Select)';
    el.appendChild(o0);
    fields.forEach((f) => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      el.appendChild(o);
    });
  });

  // try auto-map
  const g = guessFundedMapping(fields) || {};
  fundedMapping = { ...fundedMapping, ...g };

  if (dealerSel) dealerSel.value = fundedMapping.dealer || '';
  if (stateSel)  stateSel.value  = fundedMapping.state  || '';
  if (loanSel)   loanSel.value   = fundedMapping.loan   || '';
  if (aprSel)    aprSel.value    = fundedMapping.apr    || '';
  if (feeSel)    feeSel.value    = fundedMapping.fee    || '';

  // keep mapping in sync if user changes dropdowns
  dealerSel?.addEventListener('change', e => fundedMapping.dealer = e.target.value);
  stateSel ?.addEventListener('change', e => fundedMapping.state  = e.target.value);
  loanSel  ?.addEventListener('change', e => fundedMapping.loan   = e.target.value);
  aprSel   ?.addEventListener('change', e => fundedMapping.apr    = e.target.value);
  feeSel   ?.addEventListener('change', e => fundedMapping.fee    = e.target.value);
}

function setupMappingUI() {
  const wrap = $('#mappingArea'); 
  if (!wrap) return;
  wrap.classList.remove('hidden');

  // 1) build the dropdowns from parsed.fields
  const targets = ['#mapDealer','#mapState','#mapStatus','#mapLoan','#mapApr','#mapFee','#mapLtv','#mapFI'];
  targets.forEach(sel => {
    const el = $(sel); if (!el) return;
    el.innerHTML = '';
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(Select)';
    el.appendChild(o);
    (parsed.fields || []).forEach(f => {
      const x = document.createElement('option');
      x.value = f; x.textContent = f;
      el.appendChild(x);
    });
  });

  // 2) try to auto-map from headers
  const { mapping: g, filled } = guessMapping(parsed.fields || []);

  // apply guesses to selects (only if we found a match)
  const setIf = (id, val) => { const el = $(id); if (el && val) el.value = val; };
  setIf('#mapDealer', g.dealer);
  setIf('#mapState',  g.state);
  setIf('#mapStatus', g.status);
  setIf('#mapLoan',   g.loan);
  setIf('#mapApr',    g.apr);
  setIf('#mapFee',    g.fee);
  setIf('#mapLtv',    g.ltv);
  setIf('#mapFI',     g.fi);

  // 3) friendly tip so you know it worked
  let tip = wrap.querySelector('#mapTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'mapTip';
    tip.className = 'mt-2 text-xs';
    wrap.insertBefore(tip, wrap.children[0]); // show above the grid
  }
  const reqOK = g.dealer && g.state && g.status;
  tip.innerHTML = reqOK
    ? `<span class="text-green-700">✅ Auto-mapped ${filled}/8 columns. You can click <b>Analyze</b> now, or adjust any dropdown.</span>`
    : `<span class="text-amber-700">⚠️ I filled ${filled}/8 columns. Please set the missing <b>Dealer</b>, <b>State</b>, or <b>Status</b>, then click <b>Analyze</b>.</span>`;
}

/* ---------- Analyze & Save (Upload tab) ---------- */
let lastBuiltSnapshot = null;
function pickFunded(r, key) {
  const f = fundedMapping[key] || '';
  return f ? r[f] : '';
}
function matchAndMergeFundedIntoSnapshot(snap) {
  if (!fundedParsed.rows?.length) return { merged: 0, exact:0, high:0, review:0, unmatched:0 };

  // Build an index of dealers from the snapshot
  const appRows = snap.dealerRows || [];
  const byState = new Map(); // state -> [{dealer, key, row}]
  appRows.forEach(r => {
    const st = normalizeState(r.state);
    const nm = normalizeDealerName(r.dealer);
    const key = `${nm}|${st}`;
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push({ dealer:r.dealer, key, row:r });
  });

  const accepted = [];      // funded rows we will merge
  const needsReview = [];   // low-confidence candidates
  const unmatched = [];     // no candidates

  const HIGH = 0.92;
  const LOW  = 0.80;

  fundedParsed.rows.forEach((r) => {
    const dealer = normalizeDealerName(pickFunded(r,'dealer'));
    const state  = normalizeState(pickFunded(r,'state'));
    const amt    = parseNumber(pickFunded(r,'loan'));
    const apr    = parseNumber(pickFunded(r,'apr'));
    let fee      = pickFunded(r,'fee');

    if (!dealer || !state || !isFinite(amt)) {
      unmatched.push({ r, reason:'missing fields' });
      return;
    }

    // normalize fee to percent if possible
    let feePct = null;
    const feeStr = String(fee||'').trim();
    if (feeStr) {
      const asNum = parseNumber(feeStr);
      if (/%/.test(feeStr)) feePct = asNum/100;
      else if (asNum<=1)    feePct = asNum;
      else if (isFinite(amt) && amt>0) feePct = asNum/amt;
    }

    const key = `${dealer}|${state}`;
    const candidates = byState.get(state) || [];

    // exact
    const exact = candidates.find(c => c.key === key);
    if (exact) {
      accepted.push({ r, dealer: exact.row.dealer, state, amt, apr, feePct, match:'exact', row: exact.row });
      return;
    }

    // fuzzy within state
    let best = { sim: 0, cand: null };
    candidates.forEach(c => {
      const sim = diceSimilarity(dealer, c.dealer);
      if (sim > best.sim) best = { sim, cand: c };
    });

    if (best.cand && best.sim >= HIGH) {
      accepted.push({ r, dealer: best.cand.row.dealer, state, amt, apr, feePct, match:'high', row: best.cand.row });
    } else if (best.cand && best.sim >= LOW) {
      needsReview.push({ r, suggestion: best.cand.row.dealer, sim: best.sim, state, amt });
    } else {
      unmatched.push({ r, reason:'no good candidate' });
    }
  });

  // Warn the user before merging anything
  const msg = [
    `Funded rows: ${fundedParsed.rows.length}`,
    `  Exact matches: ${accepted.filter(x=>x.match==='exact').length}`,
    `  High-confidence: ${accepted.filter(x=>x.match==='high').length}`,
    `  Needs review: ${needsReview.length}`,
    `  Unmatched: ${unmatched.length}`,
    ``,
    `Proceed to merge only Exact + High-confidence matches?`,
  ].join('\n');

  const proceed = window.confirm(msg);
  if (!proceed) return { merged: 0, exact:0, high:0, review:needsReview.length, unmatched:unmatched.length };

  // Merge accepted rows into snapshot
  snap.fundedRawRows = (snap.fundedRawRows || []).concat(
    accepted.map(x => ({
      Dealer: x.dealer,
      State: x.state,
      Status: 'funded',
      'Loan Amount': x.amt,
      APR: isFinite(x.apr) ? x.apr : null,
      'Lender Fee': isFinite(x.feePct) ? (x.feePct*100).toFixed(3)+'%' : '',
      LTV: '', // if your funded sheet has it, map it too later
      FI: x.row.fi || '' // reuse FI from the matched app dealer row if available
    }))
  );

  // Update per-dealer funded counts
  const incKey = (m, k, v=1) => m.set(k, (m.get(k)||0)+v);
  const dealerKey = (d,st,fi) => `${d}|${st}|${fi||''}`;

  const incByDealer = new Map();
  accepted.forEach(x => {
    const fi = x.row.fi || '';
    incKey(incByDealer, dealerKey(x.dealer, x.state, fi), 1);
  });

  (snap.dealerRows || []).forEach(r => {
    const k = dealerKey(r.dealer, r.state, r.fi);
    r.funded = (r.funded||0) + (incByDealer.get(k)||0);
    r.ltb = r.total ? r.funded / r.total : 0;
  });

  // Update state and FI tallies
  const incByState = new Map();
  accepted.forEach(x => incKey(incByState, x.state, 1));
  (snap.stateRows || []).forEach(s => { s.funded = (s.funded||0) + (incByState.get(s.state)||0); s.ltb = s.total ? s.funded/s.total : 0; });

  const fiT = { Independent:{}, Franchise:{} };
  accepted.forEach(x => {
    const fi = (x.row.fi||'Independent');
    fiT[fi] = fiT[fi] || { total:0, approved:0, counter:0, pending:0, denial:0, funded:0 };
    fiT[fi].funded = (fiT[fi].funded||0) + 1;
  });
  (snap.fiRows || []).forEach(r => {
    r.funded = (r.funded||0) + ((fiT[r.type]?.funded)||0);
  });

  // KPIs (totals + averages)
  const fundedArr = snap.fundedRawRows || [];
  snap.totals.funded = fundedArr.length;
  snap.kpis.totalFunded = fundedArr.reduce((a,r)=> a + parseNumber(r['Loan Amount']), 0);

  const aprArr = fundedArr.map(r=>parseNumber(r.APR)).filter(v=>isFinite(v));
  const feePctArr = fundedArr.map(r=>{
    const s = String(r['Lender Fee']||''); // could be "x%" string
    if (/%/.test(s)) return parseNumber(s)/100;
    const n = parseNumber(s); const amt = parseNumber(r['Loan Amount']);
    return (isFinite(n) && isFinite(amt) && amt>0) ? n/amt : null;
  }).filter(v=>v!=null && isFinite(v));

  snap.kpis.avgFundedAmount = fundedArr.length ? (snap.kpis.totalFunded / fundedArr.length) : null;
  snap.kpis.avgAPR = aprArr.length ? (aprArr.reduce((a,b)=>a+b,0)/aprArr.length) : null;
  snap.kpis.avgDiscountPct = feePctArr.length ? (feePctArr.reduce((a,b)=>a+b,0)/feePctArr.length) : null;

  return {
    merged: accepted.length,
    exact: accepted.filter(x=>x.match==='exact').length,
    high:  accepted.filter(x=>x.match==='high').length,
    review: needsReview.length,
    unmatched: unmatched.length
  };
}
function mergeFundedIntoSnapshot(snap, fundedParsed, fundedMapping, opts) {
  // opts: { accepted: [{fundedName, targetName, match:'exact'|'high'|'manual'}], … }

  const get = (row, key) => {
    const col = (fundedMapping?.[key] || '').trim();
    return col ? row[col] : '';
  };
  const parseMoney = (x) => {
    const n = parseFloat(String(x).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // 1) Build a quick lookup of dealerRows by normalized name
  const norm = (s) => String(s||'').toLowerCase().replace(/[\s'".,&-]+/g,' ').replace(/\s+/g,' ').trim();
  const byDealer = new Map();
  (snap.dealerRows || []).forEach(r => byDealer.set(norm(r.dealer), r));

  // 2) Walk funded rows → accumulate per matched dealer
  let fundedAmounts = [];
  let aprArr = [];
  let feePctArr = [];
  snap.fundedRawRows = snap.fundedRawRows || [];

  (opts?.accepted || []).forEach(m => {
    const tName = m.targetName || '';
    const target = byDealer.get(norm(tName));
    if (!target) return;

    // find all rows that matched this fundedName (we expect 1:1 name per row; ok if multiple)
    const rows = (fundedParsed.rows || []).filter(r => norm(get(r,'dealer')) === norm(m.fundedName));
    rows.forEach(r => {
      // bump funded count (deal-level)
      target.funded = (target.funded || 0) + 1;

      // collect amounts + apr + fee%
      const amt = parseMoney(get(r,'loan'));
      if (Number.isFinite(amt) && amt > 0) fundedAmounts.push(amt);
      target.funded_amount = (target.funded_amount || 0) + amt;
      
      const aprV = parseFloat(String(get(r,'apr')).replace(/[^\d.-]/g,''));
      if (Number.isFinite(aprV)) aprArr.push(aprV);

      // fee % can be like "x%" or just a number
      const s = String(get(r,'fee')||'');
      let feePct = null;
      if (/%/.test(s)) feePct = parseFloat(s.replace('%',''));
      else {
        // if a dollar fee column is mapped, treat as $ and convert to percent of loan if possible
        const feeDollars = parseMoney(s);
        if (feeDollars && amt) feePct = (feeDollars/amt)*100;
      }
      if (Number.isFinite(feePct)) feePctArr.push(feePct);
      // also add a raw funded row so downstream sections (like High-Value Funded Deals) can see it
snap.fundedRawRows.push({
  Dealer: target.dealer,
  State: target.state,
  Status: 'funded',
  'Loan Amount': amt,
  APR: Number.isFinite(aprV) ? aprV : '',
  'Lender Fee': (feePct != null && Number.isFinite(feePct)) ? (feePct * 100).toFixed(3) + '%' : '',
  LTV: '',                 // (fill if your funded sheet has it)
  FI: target.fi || ''      // reuse FI from the matched dealer
});
    });
  });

  // 3) Update FI totals (counts) from the adjusted dealer rows
  const fiT = { Independent:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0},
                Franchise:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0} };
  (snap.dealerRows || []).forEach(r => {
    const bucket = fiT[r.fi] || fiT.Independent;
    bucket.total   += (r.total   || 0);
    bucket.approved+= (r.approved|| 0);
    bucket.counter += (r.counter || 0);
    bucket.pending += (r.pending || 0);
    bucket.denial  += (r.denial  || 0);
    bucket.funded  += (r.funded  || 0);
  });
  snap.fiRows = [
    { type:'Independent', ...fiT.Independent },
    { type:'Franchise',   ...fiT.Franchise   },
  ];

  // 4) Monthly KPIs (funded-only)
  snap.kpis = snap.kpis || {};
  const totalFunded = fundedAmounts.reduce((a,b)=>a+b,0);
  snap.kpis.totalFunded      = (snap.kpis.totalFunded || 0) + totalFunded;
  snap.kpis.avgFundedAmount  = fundedAmounts.length ? (totalFunded / fundedAmounts.length) : null;
  snap.kpis.avgAPR           = aprArr.length ? (aprArr.reduce((a,b)=>a+b,0)/aprArr.length) : null;
  snap.kpis.avgDiscountPct   = feePctArr.length ? (feePctArr.reduce((a,b)=>a+b,0)/feePctArr.length) : null;

  return {
    merged: (opts?.accepted||[]).length
  };
}
// Recompute snapshot.totals and snapshot.stateRows from dealerRows after a merge
function recomputeAggregatesFromDealers(snap) {
  if (!snap) return;
  const dealers = Array.isArray(snap.dealerRows) ? snap.dealerRows : [];

  // Totals
  const totals = {
    totalApps: dealers.reduce((a,r)=>a+(r.total||0),0),
    approved : dealers.reduce((a,r)=>a+(r.approved||0),0),
    counter  : dealers.reduce((a,r)=>a+(r.counter||0),0),
    pending  : dealers.reduce((a,r)=>a+(r.pending||0),0),
    denial   : dealers.reduce((a,r)=>a+(r.denial||0),0),
    funded   : dealers.reduce((a,r)=>a+(r.funded||0),0),
  };
  snap.totals = totals;

  // State tallies
  const smap = new Map();
  dealers.forEach(r => {
    const st = r.state || '??';
    if (!smap.has(st)) smap.set(st, { state: st, total:0, approved:0, counter:0, pending:0, denial:0, funded:0 });
    const x = smap.get(st);
    x.total   += r.total   || 0;
    x.approved+= r.approved|| 0;
    x.counter += r.counter || 0;
    x.pending += r.pending || 0;
    x.denial  += r.denial  || 0;
    x.funded  += r.funded  || 0;
  });
  snap.stateRows = Array.from(smap.values()).map(s => ({
    ...s,
    lta: s.total ? (s.approved + s.counter) / s.total : 0,
    ltb: s.total ? s.funded / s.total : 0
  }));
}

const mergeFundedData = matchAndMergeFundedIntoSnapshot;

$('#btnAnalyze')?.addEventListener('click', () => {
  const y = num($('#inpYear')?.value);
  const m = num($('#inpMonth')?.value);
  if (!y || !m || m < 1 || m > 12) {
    alert('Please enter a valid Year and Month (1–12).');
    return;
  }
  const mapping = {
    dealer: $('#mapDealer')?.value || '',
    state:  $('#mapState')?.value  || '',
    status: $('#mapStatus')?.value || '',
    loan:   $('#mapLoan')?.value   || '',
    apr:    $('#mapApr')?.value    || '',
    fee:    $('#mapFee')?.value    || '',
    ltv:    $('#mapLtv')?.value    || '',
    fi:     $('#mapFI')?.value     || '',
  };
  if (!mapping.dealer || !mapping.state || !mapping.status) {
    alert('Please map at least Dealer, State, and Status.');
    return;
  }

  try {
    lastBuiltSnapshot = buildSnapshotFromRows(mapping, parsed.rows || [], y, m);

  } catch (e) {
    console.error('buildSnapshot error:', e);
    alert('Could not analyze. See console.');
    return;
  }
// ===== Pre-merge funded file review =====
try {
  // If there's no funded sheet, skip preflight
  if ((fundedParsed?.rows || []).length) {
    const snap = lastBuiltSnapshot;
    const dealerList = (snap.dealerRows || []).map(d => ({
      raw: d.dealer,
      norm: _normNameForMatch(d.dealer)
    }));

    // Build candidate matches for each funded row (unique funded dealer names)
    const fundedDealers = Array.from(
      new Set((fundedParsed.rows || []).map(r => String(r[fundedMapping.dealer] || '').trim()).filter(Boolean))
    );

    const flagged = [];
    const reviewRows = [];

    fundedDealers.forEach(fdName => {
      const fdNorm = _normNameForMatch(fdName);

      // score all existing dealers
      let best = { name: '', norm: '', score: 0 };
      for (const d of dealerList) {
        const s = _jwSim(fdNorm, d.norm);
        if (s > best.score) best = { name: d.raw, norm: d.norm, score: s };
      }

      const isBranchy = _looksLikeBranchOrNumbered(fdName);
      const needsReview = isBranchy || best.score < 0.85;

      reviewRows.push({
        fundedName: fdName,
        suggested: best.name,
        score: best.score,
        branchy: isBranchy,
      });

      if (needsReview) flagged.push(fdName);
    });

    if (flagged.length) {
      // Fill modal table
      const tbody = document.getElementById('mergeModalBody');
      if (tbody) {
        tbody.innerHTML = reviewRows.map(r => `
          <tr class="border-t ${r.branchy ? 'bg-red-50' : (r.score < 0.85 ? 'bg-yellow-50' : '')}"
              data-fd="${r.fundedName.replace(/"/g, '&quot;')}">
            <td class="px-3 py-2 font-medium rv-funded">${r.fundedName}</td>
            <td class="px-3 py-2">${r.suggested || '-'}</td>
            <td class="px-3 py-2 tabular-nums">${(r.score*100).toFixed(1)}%</td>
            <td class="px-3 py-2">
              <input class="w-full rounded-md border px-2 py-1 text-sm rv-input"
                     placeholder="Type dealer name to override"
                     value="${r.score >= 0.85 ? r.suggested : ''}">
            </td>
            <td class="px-3 py-2 text-center">
              <input type="checkbox" class="rv-approve">
            </td>
          </tr>
        `).join('');
      }
// Build a compact "accepted" list for exact/high suggestions (auto-ready to merge)
const engineAccepted = reviewRows
  .filter(r => r && r.suggested && !r.branchy && r.score >= 0.85)
  .map(r => ({
    fundedName: r.fundedName,          // the name from the funded file
    targetName: r.suggested,           // the suggested snapshot dealer name
    match: (r.score >= 0.92 ? 'exact' : 'high')
  }));

// Stash everything we need for the Proceed step
_pendingMerge = {
  snapshot: lastBuiltSnapshot,
  reviewRows,
  accepted: engineAccepted
};

      // show modal
      document.getElementById('mergeModal')?.classList.remove('hidden');
      // Stop here; the merge will be done in the Proceed handler
      return;
    } else {
      // No flags → safe to merge directly
      // NOTE: mergeFundedData already exists from the prior step you added
      mergeFundedData(lastBuiltSnapshot, /*overrides*/ null);
    }
  }
} catch (e) {
  console.error('pre-merge review failed:', e);
}

  const res = $('#resultsArea');
  if (res) {
    const s = lastBuiltSnapshot;
    res.innerHTML = `
      <div class="text-sm">
        <div class="font-semibold mb-1">Analyzed: ${monthName(s.month)} ${s.year}</div>
        <ul class="list-disc ml-5 space-y-0.5">
          <li>Total apps: <b>${s.totals.totalApps}</b></li>
          <li>Approved: <b>${s.totals.approved}</b></li>
          <li>Funded: <b>${s.totals.funded}</b></li>
          <li>Total Funded: <b>${formatMoney(s.kpis.totalFunded)}</b></li>
          <li>Dealers: <b>${s.dealerRows.length}</b>, States: <b>${s.stateRows.length}</b></li>
        </ul>
      </div>
    `;
  }

  // enable buttons
  $('#btnSaveMonth') && ($('#btnSaveMonth').disabled = false);
  $('#btnExportRawAll') && ($('#btnExportRawAll').disabled = false);
  $('#btnExportFunded') && ($('#btnExportFunded').disabled = false);
});

$('#btnSaveMonth')?.addEventListener('click', async () => {
  try {
    if (!lastBuiltSnapshot) {
      alert('Click Analyze first.');
      return;
    }
    // --- show on-screen status (no DevTools needed)
    clearSaveStatus();
    setSaveStatus(`Saving ${lastBuiltSnapshot.year}-${String(lastBuiltSnapshot.month).padStart(2,'0')} with ${lastBuiltSnapshot.dealerRows?.length || 0} dealer rows...`);

    // 1) Read current list (same key used everywhere else)
    const snaps = getSnaps();
    const id = lastBuiltSnapshot.id;

    // 2) Upsert (replace if same month already exists)
    const idx = snaps.findIndex(s => s.id === id);
    if (idx >= 0) {
      snaps[idx] = lastBuiltSnapshot;
    } else {
      snaps.push(lastBuiltSnapshot);
    }

   // 3) Keep them sorted by id (YYYY-MM)
snaps.sort((a, b) => String(a.id).localeCompare(String(b.id)));

// 4) persist
setSnaps(snaps);

/* 4.5) Save to Supabase (cloud) if available */
try {
  if (window.sb && window.lastBuiltSnapshot && Array.isArray(window.lastBuiltSnapshot.dealerRows)) {
    // --- DEBUG: inspect the analyzed snapshot before saving to Supabase ---
(function () {
  const s = window.lastBuiltSnapshot;          // the object we're about to save
  const len = Array.isArray(s?.dealerRows) ? s.dealerRows.length : null;
  const sample = Array.isArray(s?.dealerRows) && s.dealerRows.length ? s.dealerRows[0] : null;

  console.log('[DEBUG save] snapshot preview →', {
    year: s?.year,          // should be a number like 2025
    month: s?.month,        // should be 1..12
    dealerRowsLen: len,     // how many dealer rows we built
    firstDealerRow: sample  // peek at one row's shape/fields
  });
})();

    saveMonthlySnapshotSB(window.lastBuiltSnapshot)
    .then(function (ok) {
      if (ok) {
        setSaveStatus('Save to Supabase: OK');
      } else {
        setSaveStatus('Save to Supabase: FAILED (see earlier steps)');
      }
    })
    .catch(function (e) {
      setSaveStatus(`Save to Supabase: ERROR — ${e?.message || e}`);
      console.error('[save] Supabase save error:', e);
    });  
  }
} catch (e) {
  console.error('[save] Supabase save error:', e);
}


// 5) Immediately refresh UI and go to Monthly
try { buildSidebar(); } catch {}
try { refreshMonthlyGrid(); } catch {}
try { switchTab('Monthly'); } catch {}


    // 6) Friendly confirmation
    const m = lastBuiltSnapshot.month, y = lastBuiltSnapshot.year;
    console.log('Saved month:', lastBuiltSnapshot.id);
// ⬇️ NEW: rebuild Yearly tables so the Yearly tab populates
await rebuildYearlyAggregatesSB(y);
  } catch (err) {
    console.error('Save month failed:', err);
    alert('Oops — could not save this month. Open the Console for details.');
  }
});

$('#btnExportRawAll')?.addEventListener('click', () => {
  if (!parsed.rows?.length) { alert('Upload and analyze first.'); return; }
  downloadCSV(parsed.rows, 'raw_all.csv');
});
$('#btnExportFunded')?.addEventListener('click', () => {
  if (!lastBuiltSnapshot?.fundedRawRows?.length) { alert('Analyze first (needs funded rows).'); return; }
  downloadCSV(lastBuiltSnapshot.fundedRawRows, 'raw_funded.csv');
});
function downloadCSV(rows, filename) {
  if (!rows?.length) return;
  const fields = Object.keys(rows[0]);
  const csv = [fields.join(',')]
    .concat(rows.map(r => fields.map(f => `"${String(r[f]??'').replace(/"/g,'""')}"`).join(',')))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Monthly tab ---------- */
async function refreshMonthlyGrid() {
  var grid = $('#monthlyGrid');
  if (!grid) return;

  var sb = window.sb;
  if (sb) {
    grid.innerHTML = '<div class="text-sm text-slate-500">Loading from Supabase…</div>';
    var snaps = await fetchMonthlySummariesSB();
    if (!snaps || !snaps.length) {
      // ⤵️ Fallback to localStorage if SB is empty/locked (dev/RLS)
      const snapsLocal = getSnaps().slice(-12);
      if (snapsLocal.length) {
        renderCards(snapsLocal);
      } else {
        grid.innerHTML = '<div class="text-sm text-gray-500">No months yet.</div>';
      }
      return;
    }
    renderCards(snaps.map(function (s) { return Object.assign({}, s, { __fromSB: true }); }));
  } else {
    const snapsLocal = getSnaps().slice(-12);
    renderCards(snapsLocal);
  }

  function renderCards(snaps) {
    var cards = snaps.map(function (s) {
      return (
        '<button class="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:shadow transition-colors hover:bg-indigo-50/30" data-id="'+s.id+'">' +
          '<div class="text-sm text-slate-500">'+monthName(s.month)+' '+s.year+'</div>' +
          '<div class="mt-1 grid grid-cols-3 gap-3 text-xs">' +
            '<div><div class="text-slate-500">Apps</div><div class="font-semibold tabular-nums">'+s.totals.totalApps+'</div></div>' +
            '<div><div class="text-slate-500">Funded</div><div class="font-semibold tabular-nums">'+s.totals.funded+'</div></div>' +
            '<div><div class="text-slate-500">Funded $</div><div class="font-semibold tabular-nums">'+formatMoney(s.kpis.totalFunded)+'</div></div>' +
          '</div>' +
        '</button>'
      );
    }).join('');
    grid.innerHTML = cards || '<div class="text-sm text-gray-500">No months yet.</div>';

    var snapsById = new Map(snaps.map(function (s) { return [s.id, s]; }));
    grid.querySelectorAll('button[data-id]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = String(btn.getAttribute('data-id') || '');
        var snap = snapsById.get(id);
        if (!snap) return;
        if (snap.__fromSB) {
          var y = Number(id.slice(0, 4));
          var m = Number(id.slice(5, 7));
          var built = await buildMonthlySnapSB(y, m);
          if (built) { renderMonthlyDetail(built); }
        } else {
          renderMonthlyDetail(snap);
        }
      });
    });
    var detail = $('#monthlyDetail');
    if (detail && detail.classList) detail.classList.add('hidden');
  }
}

// ===== Monthly detail (dealer table) UI state =====
let mdSort = { key: 'funded', dir: 'desc' }; // default sort
let mdSearch = '';                            // current search text

async function renderMonthlyDetail(snap) {
  var detail = $('#monthlyDetail');
  var detailResults = $('#detailResults');
  var title = $('#detailTitle');
  var idSpan = $('#detailId');
  if (!detail || !detailResults || !title || !idSpan) return;

  // If this came from the Supabase tiles (totals only), fetch full rows now
  if ((!snap || !snap.dealerRows || !snap.dealerRows.length) && window.sb && snap && snap.year && snap.month) {
    var built = await buildMonthlySnapSB(Number(snap.year), Number(snap.month));
    if (built) snap = built;
  }

  title.textContent = monthName(snap.month) + ' ' + snap.year;
  idSpan.textContent = '#' + (snap.id || (String(snap.year) + '-' + String(snap.month).padStart(2, '0')));
  if (detail.classList) detail.classList.remove('hidden');
  console.log('[detail]', snap.id, {
    dealerRows: snap.dealerRows?.length ?? 0,
    stateRows : snap.stateRows?.length ?? 0,
    fundedRaw : snap.fundedRawRows?.length ?? 0
  });
  
  const rows = snap.dealerRows || [];
// --- DEBUG: monthly detail rows peek (post-analysis) ---
console.log('[DEBUG monthly card] dealerRows length:',
  Array.isArray(rows) ? rows.length : null
);
if (Array.isArray(rows) && rows.length) {
  console.log('[DEBUG monthly card] first dealer row keys:', Object.keys(rows[0]));
  console.log('[DEBUG monthly card] first dealer row sample:', rows[0]);
} else {
  console.warn('[DEBUG monthly card] dealerRows missing or empty at monthly view');
}

  // ===== KPIs (your definitions) =====
  const T = snap.totals || {};
  const total = T.totalApps || 0;
  const approved = T.approved || 0;
  const counter  = T.counter  || 0;
  const pending  = T.pending  || 0;
  const denial   = T.denial   || 0;
  const funded   = T.funded   || 0;

  const LTA = total ? (approved + counter) / total : 0; // your definition
  const LTB = total ? funded / total : 0;

  // Avg LTV (Approved)
  const ltvApprovedArr = (snap.approvedRawRows || [])
    .map(r => Number(r.LTV))
    .filter(v => Number.isFinite(v));
    let avgLTVApproved = ltvApprovedArr.length
    ? ltvApprovedArr.reduce((a,b)=>a+b,0) / ltvApprovedArr.length
    : null;

  // Avg APR (Funded)
  const aprFundedArr = (snap.fundedRawRows || [])
    .map(r => Number(r.APR))
    .filter(v => Number.isFinite(v));
    let avgAPRFunded = aprFundedArr.length
    ? aprFundedArr.reduce((a,b)=>a+b,0) / aprFundedArr.length
    : null;
// --- Use persisted KPIs from Supabase if present (monthly_kpis) ---
if (snap && snap.kpis) {
  if (snap.kpis.avgLTVApproved != null) {
    avgLTVApproved = Number(snap.kpis.avgLTVApproved);
  }
  if (snap.kpis.avgAPRFunded != null) {
    avgAPRFunded = Number(snap.kpis.avgAPRFunded);
  }
  // Map saved avg_discount_pct_funded into the field your tile reads (avgDiscountPct)
  if (snap.kpis.avgDiscountPctFunded != null) {
    const v = Number(snap.kpis.avgDiscountPctFunded);
    if (snap.kpis.avgDiscountPct == null) {
      snap.kpis.avgDiscountPct = v;
    }
  }
}
// --- end persisted KPIs override ---

  // ===== State table source =====
  const states = (snap.stateRows || []).slice().sort((a,b)=> b.total - a.total);

  // ===== Render =====
   // Build state rows HTML once
   const statesRowsHtml = (states || []).map(s => `
   <tr class="border-t">
     <td class="px-3 py-2">${stateChip(s.state)}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.total||0}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.approved||0}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.counter||0}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.pending||0}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.denial||0}</td>
     <td class="px-3 py-2 tabular-nums text-right">${s.funded||0}</td>
     <td class="px-3 py-2">
     <div class="inline-flex items-center gap-2">
       <span class="tabular-nums">${formatPct(s.lta||0)}</span>
       <span class="inline-block w-20 align-middle">${pctBar(s.lta||0)}</span>
     </div>
   </td>
   <td class="px-3 py-2">
     <div class="inline-flex items-center gap-2">
       <span class="tabular-nums">${formatPct(s.ltb||0)}</span>
       <span class="inline-block w-20 align-middle">${pctBar(s.ltb||0)}</span>
     </div>
   </td>   
   </tr>
 `).join('') || `<tr><td class="px-3 py-6 text-gray-500" colspan="9">No state data.</td></tr>`;

 // ONE clean template for the entire section
 detailResults.innerHTML = `
   <!-- KPI tiles -->
   <!-- KPI tiles (organized) -->
<div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">

  <!-- 1) Primary highlight first: Total Funded -->
  <div class="rounded-2xl border p-4 bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200 shadow-sm md:col-span-2 xl:col-span-2">
    <div class="text-xs font-medium text-emerald-700">Total Funded (This Month)</div>
    <div class="text-3xl font-extrabold tabular-nums text-emerald-900">
      ${formatMoney((snap.kpis && snap.kpis.totalFunded) ? snap.kpis.totalFunded : 0)}
    </div>
  </div>

  <!-- 2) Volume tiles -->
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Total Apps</div><div class="text-2xl font-semibold tabular-nums">${total}</div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Funded</div><div class="text-2xl font-semibold tabular-nums">${funded} <span class="text-sm text-gray-500">(${formatPct(total?funded/total:0)})</span></div></div>

  <!-- 3) Decision mix -->
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Approved</div><div class="text-2xl font-semibold tabular-nums">${approved} <span class="text-sm text-gray-500">(${formatPct(total?approved/total:0)})</span></div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Counter</div><div class="text-2xl font-semibold tabular-nums">${counter} <span class="text-sm text-gray-500">(${formatPct(total?counter/total:0)})</span></div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Pending</div><div class="text-2xl font-semibold tabular-nums">${pending} <span class="text-sm text-gray-500">(${formatPct(total?pending/total:0)})</span></div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Denial</div><div class="text-2xl font-semibold tabular-nums">${denial} <span class="text-sm text-gray-500">(${formatPct(total?denial/total:0)})</span></div></div>

  <!-- 4) Ratios & quality -->
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">LTA</div><div class="text-2xl font-semibold tabular-nums">${formatPct(LTA)}</div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">LTB</div><div class="text-2xl font-semibold tabular-nums">${formatPct(LTB)}</div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Avg LTV (Approved)</div><div class="text-2xl font-semibold tabular-nums">${avgLTVApproved==null?'-':(avgLTVApproved.toFixed(2)+'%')}</div></div>
  <div class="rounded-xl border p-3 bg-white"><div class="text-xs text-gray-500">Avg APR (Funded)</div><div class="text-2xl font-semibold tabular-nums">${avgAPRFunded==null?'-':(avgAPRFunded.toFixed(2)+'%')}</div></div>
  <div class="rounded-xl border p-3 bg-white">
  <div class="text-xs text-gray-500">Avg Lender Fee (Funded)</div>
  <div class="text-xl font-semibold tabular-nums">
    ${snap.kpis && snap.kpis.avgDiscountPct == null
      ? '—'
      : (snap.kpis.avgDiscountPct).toFixed(2) + '%'}
  </div>
</div>

</div>


   <!-- State Performance (this month) -->
   <div class="bg-white rounded-2xl border p-3 mb-4">
     <h3 class="font-semibold mb-2">State Performance (This Month)</h3>
     <div class="overflow-x-auto scroll-shadow-x">
       <table class="min-w-full text-sm">
         <thead class="bg-gray-50 text-left">
           <tr>
             <th class="px-3 py-2">State</th>
             <th class="px-3 py-2 text-right">Total Apps</th>
             <th class="px-3 py-2 text-right">Approved</th>
             <th class="px-3 py-2 text-right">Counter</th>
             <th class="px-3 py-2 text-right">Pending</th>
             <th class="px-3 py-2 text-right">Denial</th>
             <th class="px-3 py-2 text-right">Funded</th>
             <th class="px-3 py-2">LTA</th>
             <th class="px-3 py-2">LTB</th>
           </tr>
         </thead>
         <tbody id="mdStateBody">
           ${statesRowsHtml}
         </tbody>
       </table>
     </div>
   </div>

   <!-- Franchise vs Independent (This Month) -->
   <div class="bg-white rounded-2xl border p-3 mb-4">
     <h3 class="font-semibold mb-2">Franchise vs Independent (This Month)</h3>
     <div class="overflow-x-auto scroll-shadow-x">
       <table class="min-w-full text-sm">
         <thead class="bg-gray-50 text-left">
           <tr>
             <th class="px-3 py-2">Type</th>
             <th class="px-3 py-2 text-right">Total Apps</th>
             <th class="px-3 py-2 text-right">Approved</th>
             <th class="px-3 py-2 text-right">Counter</th>
             <th class="px-3 py-2 text-right">Pending</th>
             <th class="px-3 py-2 text-right">Denial</th>
             <th class="px-3 py-2 text-right">Funded</th>
             <th class="px-3 py-2 text-right">Total Funded</th>
             <th class="px-3 py-2 text-right">LTA</th>
             <th class="px-3 py-2 text-right">LTB</th>
           </tr>
         </thead>
         <tbody id="mFiBody"></tbody>
       </table>
     </div>
   </div>
   
   <!-- High-Value Funded Deals (This Month) -->
   <div class="bg-white rounded-2xl border p-3 mb-4">
     <div class="flex items-center justify-between">
       <h3 class="font-semibold">High-Value Funded Deals (This Month)</h3>
       <span class="text-xs text-gray-500">Thresholds: $18k+, $25k+, $30k+</span>
     </div>
     <div class="overflow-x-auto scroll-shadow-x mt-2">
       <table class="min-w-full text-sm">
         <thead class="bg-gray-50 text-left">
           <tr>
             <th class="px-3 py-2">Threshold</th>
             <th class="px-3 py-2 text-right"># Funded</th>
             <th class="px-3 py-2 text-right">Total Funded</th>
           </tr>
         </thead>
         <tbody id="mHiBody"></tbody>
       </table>
     </div>
   </div>
   
   <!-- Dealer list toolbar -->
   <div class="flex items-center justify-between mb-3">
     <div class="flex-1">
       <input id="mdDealerSearch" type="search"
              placeholder="Search dealer…"
              class="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm
                     placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value="${mdSearch}">
     </div>
   
     <div class="flex items-center gap-3">
       <div class="hidden md:block text-xs text-slate-500">
         Tip: click a column header to sort ↑/↓
       </div>
       <button id="btnExportDealers"
               class="px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm shadow-sm
                      focus:outline-none focus:ring-2 focus:ring-indigo-200">
         Export CSV
       </button>
     </div>
   </div>   

   <!-- Dealer list -->
   <div class="overflow-x-auto scroll-shadow-x rounded-xl border border-slate-200">
     <table class="min-w-full text-sm">
       <thead class="bg-slate-50 text-left" id="mdDealerHead">   
         <tr>
           <th class="px-3 py-2">Dealer</th>
           <th class="px-3 py-2">State</th>
           <th class="px-3 py-2">FI</th>
           <th class="px-3 py-2 text-right sortable" data-key="total">Total Apps <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="approved">Approved <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="counter">Counter <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="pending">Pending <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="denial">Denial <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="funded">Funded <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable" data-key="fundedAmt">Funded $ <span class="dir">↕</span></th>         
           <th class="px-3 py-2 sortable" data-key="lta">LTA <span class="dir"></span></th>
           <th class="px-3 py-2 sortable" data-key="ltb">LTB <span class="dir"></span></th>
         </tr>
       </thead>
       <tbody id="mdDealerBody"></tbody>
     </table>
   </div>
 `;
paintMonthlyFI(snap);
paintMonthlyHighValues(snap);

 // ===== Dealer render/search/sort (no template nesting hazards) =====
 const body = $('#mdDealerBody');
 const head = $('#mdDealerHead');
 const searchEl = $('#mdDealerSearch');
// Build a quick "funded dollars by dealer|state|fi" lookup
const amtByDealer = new Map();
(snap.fundedRawRows || []).forEach(r => {
  const key = `${String(r.Dealer||'').trim()}|${String(r.State||'').trim()}|${normFI(r.FI)}`;
  const amt = parseNumber(r['Loan Amount']);
  if (Number.isFinite(amt)) {
    amtByDealer.set(key, (amtByDealer.get(key) || 0) + amt);
  }
});
 function renderDealerRows() {
  if (!body) { console.warn('[dealer] tbody not found'); return; }
  console.log('[dealer] start', { mdSearch, sort: mdSort });

   // 1) copy source
   let arr = (snap.dealerRows ?? snap.dealers ?? []).slice();
   // Make sure LTB is always correct, even if a saved row is missing it
arr = arr.map(r => {
  const total = Number(r.total) || 0;
  const funded = Number(r.funded) || 0;
  const ltbSafe = Number.isFinite(r.ltb) ? r.ltb : (total ? funded / total : 0);
  const key = `${String(r.dealer).trim()}|${String(r.state).trim()}|${String(r.fi).trim()}`;
  const fundedAmt = Number(amtByDealer.get(key)) || 0;
  return { ...r, ltbSafe, fundedAmt };
});
   console.log('Dealer rows in snapshot:', {
    hasDealerRows: Array.isArray(snap.dealerRows),
    dealerRowsLen: snap.dealerRows?.length ?? 0,
    hasDealers: Array.isArray(snap.dealers),
    dealersLen: snap.dealers?.length ?? 0,
    sample: (snap.dealerRows ?? snap.dealers)?.[0]
  });
  
   // 2) search by dealer
   const q = (mdSearch || '').trim().toLowerCase();
   if (q) arr = arr.filter(r => String(r.dealer||'').toLowerCase().includes(q));

   // 3) sort
   const { key, dir } = mdSort;
   arr.sort((a, b) => {
     // if sorting by LTB, use the safe value
     const aVal =
    key === 'ltb'       ? (a.ltbSafe ?? 0) :
    key === 'fundedAmt' ? (Number(a.fundedAmt) || 0) :
                          (a[key] ?? 0);

  const bVal =
    key === 'ltb'       ? (b.ltbSafe ?? 0) :
    key === 'fundedAmt' ? (Number(b.fundedAmt) || 0) :
                          (b[key] ?? 0);
   
     if (typeof aVal === 'string' || typeof bVal === 'string') {
       return dir === 'asc' ? String(aVal).localeCompare(String(bVal))
                            : String(bVal).localeCompare(String(aVal));
     }
     return dir === 'asc' ? aVal - bVal : bVal - aVal;
   });
   
  
   // 4) mark active header
   head?.querySelectorAll('.sortable').forEach(th => {
     const k = th.getAttribute('data-key');
     const active = (k === key);
     const mark = document.createElement('span');
     mark.className = 'dir';
     mark.textContent = active ? (dir === 'asc' ? '↑' : '↓') : '↕';
     const old = th.querySelector('.dir');
     if (old) old.replaceWith(mark); else th.appendChild(mark);
   });

   // 5) rows (all numeric right-aligned; LTA/LTB = % + tiny bar)
   console.log('[dealer] length after filter/sort:', arr.length, 'sample:', arr[0]);
   // LTB = funded / total (computed live so it stays correct even after merges)
const getLTB = (r) => {
  const total = Number(r?.total) || 0;
  const funded = Number(r?.funded) || 0;
  return total ? funded / total : 0;   // returns a 0..1 fraction
};
body.innerHTML = arr.map(r => {
  // figure out the exact key for this dealer row
  const rowKey = `${r.dealer}|${r.state}|${r.fi}`;
  const fundedAmount = amtByDealer.get(rowKey) || 0;

  return `
     <tr class="border-t odd:bg-gray-50/40">
       <td class="px-3 py-2">${r.dealer}</td>
       <td class="px-3 py-2">${stateChip(r.state)}</td>
       <td class="px-3 py-2">${fiChip(r.fi)}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.total ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.approved ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.counter ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.pending ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.denial ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${r.funded ?? 0}</td>
       <td class="px-3 py-2 tabular-nums text-right">${formatMoney(fundedAmount)}</td>
       <td class="px-3 py-2">
       <div class="inline-flex items-center gap-2">
         <span class="tabular-nums">${formatPct(r.lta||0)}</span>
         <span class="inline-block w-20 align-middle">${pctBar(r.lta||0)}</span>
       </div>
     </td>
     <td class="px-3 py-2">
  <div class="inline-flex items-center gap-2">
    <span class="tabular-nums">${formatPct(r.total ? (r.funded / r.total) : 0)}</span>
    <span class="inline-block w-20 align-middle">${pctBar(r.total ? (r.funded / r.total) : 0)}</span>
  </div>
</td>
     </tr>
     `;
    }).join('') || '<tr><td class="px-3 py-6 text-gray-500" colspan="12">No data.</td></tr>';    
 }
 function exportDealersCSV() {
  // rebuild the same list you’re showing (respect search & sort)
  let arr = (snap.dealerRows || []).slice();

  // search (same as render)
  const q = (mdSearch || '').trim().toLowerCase();
  if (q) arr = arr.filter(r => String(r.dealer||'').toLowerCase().includes(q));

  // sort (same as render)
  const { key, dir } = mdSort;
  arr.sort((a, b) => {
    const aVal = key === 'ltb' ? ((Number(a.total)||0) ? (Number(a.funded)||0)/(Number(a.total)||1) : 0) : (a[key] ?? 0);
    const bVal = key === 'ltb' ? ((Number(b.total)||0) ? (Number(b.funded)||0)/(Number(b.total)||1) : 0) : (b[key] ?? 0);
    if (typeof aVal === 'string' || typeof bVal === 'string') {
      return dir === 'asc' ? String(aVal).localeCompare(String(bVal))
                           : String(bVal).localeCompare(String(aVal));
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // use the same “funded $ by dealer|state|fi” piggy bank we built earlier
  // (amtByDealer is defined above in renderMonthlyDetail, outside renderDealerRows)
  const header = ['Dealer','State','FI','Total','Approved','Counter','Pending','Denial','Funded','Funded $','LTA','LTB'];
  const rows = [header];

  arr.forEach(r => {
    const rowKey = `${r.dealer}|${r.state}|${r.fi}`;
    const fundedAmt = amtByDealer.get(rowKey) || 0;
    const lta = (Number(r.total)||0) ? ( (Number(r.approved)||0) + (Number(r.counter)||0) ) / Number(r.total) : 0;
    const ltb = (Number(r.total)||0) ? ( Number(r.funded)||0 ) / Number(r.total) : 0;

    rows.push([
      r.dealer || '',
      r.state || '',
      r.fi || '',
      r.total || 0,
      r.approved || 0,
      r.counter || 0,
      r.pending || 0,
      r.denial || 0,
      r.funded || 0,
      fundedAmt.toFixed(2),
      (lta*100).toFixed(2) + '%',
      (ltb*100).toFixed(2) + '%',
    ]);
  });

  // download as CSV
  const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const y = snap.year, m = String(snap.month).padStart(2,'0');
  a.download = `dealers_${y}-${m}.csv`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

 // events
 searchEl?.addEventListener('input', (e) => {
   mdSearch = e.target.value || '';
   renderDealerRows();
 });
 document.getElementById('btnExportDealers')?.addEventListener('click', exportDealersCSV);

 head?.querySelectorAll('.sortable').forEach(th => {
   th.addEventListener('click', () => {
     const k = th.getAttribute('data-key');
     if (!k) return;
     mdSort = { key: k, dir: (mdSort.key === k && mdSort.dir === 'desc') ? 'asc' : 'desc' };
     renderDealerRows();
   });
 });

 renderDealerRows();


  $('#backToGrid')?.addEventListener('click', () => {
    detail.classList.add('hidden');
  }, { once:true });
}
// Paint: Franchise vs Independent (This Month) — FULL METRICS
function paintMonthlyFI(snap) {
  const body = document.getElementById('mFiBody');
  if (!body || !snap) return;

  const types = ['Franchise', 'Independent'];
  const fiRows = snap.fiRows || [];
  const fundedRaw = snap.fundedRawRows || [];

  const getRowByType = (t) =>
    fiRows.find(x => String(x.type).toLowerCase() === t.toLowerCase()) || {};

  const rowsHtml = types.map((t) => {
    const r = getRowByType(t);

    const total    = Number(r.total)    || 0;
    const approved = Number(r.approved) || 0;
    const counter  = Number(r.counter)  || 0;
    const pending  = Number(r.pending)  || 0;
    const denial   = Number(r.denial)   || 0;
    const fundedN  = Number(r.funded)   || 0;

    const totalFundedAmt = (fundedRaw || [])
      .filter(x => normFI(x.FI) === t)
      .reduce((a, x) => a + (parseNumber(x['Loan Amount']) || 0), 0);

    const lta = total ? ((approved + counter) / total) : 0;
    const ltb = total ? (fundedN  / total) : 0;

    return `
      <tr class="border-t">
        <td class="px-3 py-2">${t}</td>
        <td class="px-3 py-2 tabular-nums text-right">${total}</td>
        <td class="px-3 py-2 tabular-nums text-right">${approved}</td>
        <td class="px-3 py-2 tabular-nums text-right">${counter}</td>
        <td class="px-3 py-2 tabular-nums text-right">${pending}</td>
        <td class="px-3 py-2 tabular-nums text-right">${denial}</td>
        <td class="px-3 py-2 tabular-nums text-right">${fundedN}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatMoney(totalFundedAmt)}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatPct(lta)}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatPct(ltb)}</td>
      </tr>`;
  }).join('');

  body.innerHTML = rowsHtml || `<tr><td class="px-3 py-6 text-gray-500" colspan="10">No FI data.</td></tr>`;
}
// Paint: High-Value Funded Deals (This Month)
function paintMonthlyHighValues(snap) {
  const body = document.getElementById('mHiBody');
  if (!body || !snap) return;

  const fundedRaw = snap.fundedRawRows || [];
  const thresholds = [18000, 25000, 30000];

  const rowsHtml = thresholds.map((th) => {
    const list = fundedRaw.filter(r => (parseNumber(r['Loan Amount']) || 0) >= th);
    const count = list.length;
    const totalAmt = list.reduce((a, r) => a + (parseNumber(r['Loan Amount']) || 0), 0);
    return `
      <tr class="border-t">
        <td class="px-3 py-2">≥ ${formatMoney(th)}</td>
        <td class="px-3 py-2 tabular-nums text-right">${count}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatMoney(totalAmt)}</td>
      </tr>`;
  }).join('');

  body.innerHTML = rowsHtml || `<tr><td class="px-3 py-6 text-gray-500" colspan="3">No funded rows.</td></tr>`;
}

/* ---------- Yearly tab ---------- */
let yrChart = null;              // Chart.js instance
let spMonths = [];               // [['2025-01','Jan'], ...]
let spStates = [];               // ['IL','WI',...]
let spData = new Map();          // state -> [{total, approved, funded, amount, ltb}]
let spSparkCharts = [];          // list of tiny Chart.js instances

async function refreshYearly() {

  const yearSel = document.getElementById('yrYear');
  if (!yearSel) return;
  
  // Fill the dropdown from Supabase (fallbacks if empty)
  await ensureYearOptionsSB();
  
  // Re-render when the user changes the year
  yearSel.onchange = () => renderYearly();
  
  // Draw once for the currently selected year
  await renderYearly();
  
}
/* Build Yearly month list from Supabase (same shape your UI uses) */
async function fetchMonthlyYearListSB(year) {
  var sb = window.sb;
  if (!sb) return null;

  // Get all rows for the selected year, then aggregate in the browser
  var result = await sb
    .from('monthly_snapshots')
    .select('year,month,total_apps,approved,counter,pending,denial,funded,funded_amount')
    .eq('year', year)
    .limit(50000);

  if (result.error) {
    console.error('[sb] fetchMonthlyYearListSB error:', result.error);
    return null;
  }

  var rows = result.data || [];
  // reduce → month objects like your existing "snaps" items
  var byMonth = new Map(); // key = 'YYYY-MM'
  rows.forEach(function (r) {
    var id = String(r.year) + '-' + String(r.month).padStart(2, '0');
    var cur = byMonth.get(id) || {
      id: id,
      year: r.year,
      month: r.month,
      totals: { totalApps: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 },
      kpis: { totalFunded: 0 }
    };
    cur.totals.totalApps += Number(r.total_apps)    || 0;
    cur.totals.approved  += Number(r.approved)      || 0;
    cur.totals.counter   += Number(r.counter)       || 0;
    cur.totals.pending   += Number(r.pending)       || 0;
    cur.totals.denial    += Number(r.denial)        || 0;
    cur.totals.funded    += Number(r.funded)        || 0;
    cur.kpis.totalFunded += Number(r.funded_amount) || 0;
    byMonth.set(id, cur);
  });

  // return months in order for that year
  return Array.from(byMonth.values()).sort(function (a, b) {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

async function renderYearly() {
  const yearSel = findYearSelect();
if (!yearSel) { console.warn('[yearly] no year <select>'); return; }
  const year = Number(yearSel.value) || new Date().getFullYear();

  // Build the month list: use Supabase if configured; else use your local snaps
  let list;
  if (window.sb) {
    list = await fetchMonthlyYearListSB(year);
    if (!list) list = [];
  } else {
    const snaps = getSnaps();
    list = snaps.filter(s => s.year === year).sort((a,b)=>a.month-b.month);
  }

  // YTD tiles
  const sum = (arr, sel) => arr.reduce((a,b)=>a+(sel(b)||0), 0);
  const totalApps   = sum(list, s => s.totals.totalApps);
  const totalApproved = sum(list, s => (s.totals.approved + s.totals.counter));
  const funded      = sum(list, s => s.totals.funded);
  const totalFunded = sum(list, s => s.kpis.totalFunded);

  const yrSummary = $('#yrSummary');
  if (yrSummary) {
    yrSummary.innerHTML = '';
    [
      ['Total Funded (YTD)', formatMoney(totalFunded), true],   // big green
      ['Total Apps (YTD)',  totalApps],
      ['Total Approved (YTD)', totalApproved],
      ['Funded (YTD)', funded],
      ['LTA (YTD)', totalApps ? formatPct(totalApproved/totalApps) : '–'],
      ['LTB (YTD)', totalApps ? formatPct(funded/totalApps) : '–'],
    ]    
    .forEach(([L, V, isBig]) => {
      const d = document.createElement('div');
      if (isBig) {
        // Big green tile (wider highlight)
        d.className = 'rounded-2xl border p-4 bg-emerald-50 border-emerald-200 xl:col-span-2';
        d.innerHTML =
          `<div class="text-xs font-medium text-emerald-700">${L}</div>
           <div class="text-3xl font-bold text-emerald-900">${V}</div>`;
      } else {
        // Regular white tiles
        d.className = 'rounded-xl border p-3 bg-white';
        d.innerHTML =
          `<div class="text-xs text-gray-500">${L}</div>
           <div class="text-xl font-semibold">${V}</div>`;
      }      
      yrSummary.appendChild(d);
    });    
  }

  // MoM table + line chart series
  const tbody = $('#yrMoM');
  const labels = [];
  const fundedSeries = [];
  const amountSeries = [];

  if (tbody) {
    tbody.innerHTML = '';
    list.forEach(s => {
      const approvedVal = (s.totals.approved || 0) + (s.totals.counter || 0);
const lta = s.totals.totalApps ? approvedVal / s.totals.totalApps : 0;
      const ltb = s.totals.totalApps ? s.totals.funded  / s.totals.totalApps : 0;
      labels.push(`${monthName(s.month)} ${s.year}`);
      fundedSeries.push(s.totals.funded || 0);
      amountSeries.push(s.kpis.totalFunded || 0);
      tbody.insertAdjacentHTML('beforeend', `
        <tr class="border-t odd:bg-gray-50/40">
          <td class="px-3 py-2">${monthName(s.month)} ${s.year}</td>
          <td class="px-3 py-2 tabular-nums">${s.totals.totalApps}</td>
          <td class="px-3 py-2 tabular-nums">${(s.totals.approved || 0) + (s.totals.counter || 0)}</td>
          <td class="px-3 py-2 tabular-nums">${s.totals.funded}</td>
          <td class="px-3 py-2">
          <div class="inline-flex items-center gap-2">
            <span class="tabular-nums">${formatPct(lta)}</span>
            <span class="inline-block w-20 align-middle">${pctBar(lta)}</span>
          </div>
        </td>
        <td class="px-3 py-2">
          <div class="inline-flex items-center gap-2">
            <span class="tabular-nums">${formatPct(ltb)}</span>
            <span class="inline-block w-20 align-middle">${pctBar(ltb)}</span>
          </div>
        </td>        
          <td class="px-3 py-2 tabular-nums">${formatMoney(s.kpis.totalFunded)}</td>
        </tr>
      `);
    });
  }

 // Line chart with toggle (Deals vs Amount)
const ctx = $('#yrFundedChart');
let yrChartMetric = 'deals';

function drawYrChart() {
  if (!ctx) return;
  if (yrChart) { try { yrChart.destroy(); } catch {} }
  const isAmount = (yrChartMetric === 'amount');

  yrChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: isAmount ? 'Total Funded ($)' : 'Funded (count)',
        data:  isAmount ? amountSeries       : fundedSeries,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      // If showing dollars, format the Y axis as money; otherwise leave as plain numbers
      scales: isAmount ? {
        y: {
          ticks: {
            callback: (v) => '$' + Number(v).toLocaleString()
          }          
        }
      } : {}
    }
  });
}

// first draw (default = Deals)
drawYrChart();

// Buttons to switch metric
const btnDeals  = document.getElementById('yrChartDeals');
const btnAmount = document.getElementById('yrChartAmount');

function setActive(which) {
  yrChartMetric = which;

  // flip button styles so the active one is blue
  if (btnDeals && btnAmount) {
    if (which === 'deals') {
      btnDeals.className  = 'px-3 py-1.5 text-sm bg-blue-600 text-white';
      btnAmount.className = 'px-3 py-1.5 text-sm hover:bg-gray-50';
    } else {
      btnDeals.className  = 'px-3 py-1.5 text-sm hover:bg-gray-50';
      btnAmount.className = 'px-3 py-1.5 text-sm bg-blue-600 text-white';
    }
  }

  drawYrChart();
}

btnDeals?.addEventListener('click',  () => setActive('deals'));
btnAmount?.addEventListener('click', () => setActive('amount'));

// ==== Yearly Dealer aggregation (Dealer|State|FI) ====
// support Yearly IDs (yr*) or existing md* IDs
const dHead   = document.getElementById('yrDealerHead')  || document.getElementById('mdDealerHead');
const dBody   = document.getElementById('yrDealerYTD')   || document.getElementById('mdDealerBody');
const dSearch = document.getElementById('yrSearchDealer')|| document.getElementById('mdDealerSearch');
const selState= document.getElementById('yrFilterState') || document.getElementById('mdDealerState');
const selFI   = document.getElementById('yrFilterFI')    || document.getElementById('mdDealerFI');

if (dBody) {
  // If Supabase is configured, read pre-aggregated YTD rows directly.
  // Otherwise, fall back to your existing month-aggregation path.
  let rows;

  if (window.sb) {
    const raw = await fetchYearlyDealerTotalsSB(year) || [];
    rows = raw.map((r) => {
      const total = Number(r.total) || 0;
      const apc   = (Number(r.approved) || 0) + (Number(r.counter) || 0);
      const lta   = total ? (apc / total) : 0;                     // (Approved + Counter) / Total
      const ltb   = total ? ((Number(r.funded) || 0) / total) : 0; // Funded / Total
      return {
        dealer: r.dealer || '',
        state:  r.state  || '',
        fi:     r.fi     || '',
        total:  Number(r.total)    || 0,
        approved: Number(r.approved) || 0,
        counter:  Number(r.counter)  || 0,
        pending:  Number(r.pending)  || 0,
        denial:   Number(r.denial)   || 0,
        funded:   Number(r.funded)   || 0,
        // yearly_dealer_totals has funded_amount → map to fundedAmt for your UI
        fundedAmt: Number(r.fundedAmount) || 0,
        lta, ltb
      };
    });
  } else {
    // === Fallback: your original month-aggregation path ===
    const dealerMap = new Map();

    list.forEach((snap) => {
      const rows0 = (snap.dealerRows || snap.dealers || []);
      rows0.forEach((r) => {
        const key = `${String(r.dealer || '').trim()}|${String(r.state || '').trim()}|${String(r.fi || '').trim()}`;
        const cur = dealerMap.get(key) || {
          dealer: r.dealer || '',
          state:  r.state  || '',
          fi:     r.fi     || '',
          total:  0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0,
        };
        cur.total    += Number(r.total)    || 0;
        cur.approved += Number(r.approved) || 0;
        cur.counter  += Number(r.counter)  || 0;
        cur.pending  += Number(r.pending)  || 0;
        cur.denial   += Number(r.denial)   || 0;
        cur.funded   += Number(r.funded)   || 0;
        dealerMap.set(key, cur);
      });
    });

    // Sum Funded $ from fundedRawRows using the same key
    const fundedAmtByKey = new Map();
    list.forEach((snap) => {
      (snap.fundedRawRows || []).forEach((fr) => {
        const key = `${String(fr.Dealer || '').trim()}|${String(fr.State || '').trim()}|${String(fr.FI || '').trim()}`;
        const amt = Number(String(fr['Loan Amount'] ?? '').toString().replace(/[^\d.-]/g, '')) || 0;
        fundedAmtByKey.set(key, (fundedAmtByKey.get(key) || 0) + amt);
      });
    });

    // Materialize rows with LTA/LTB + fundedAmt
    rows = Array.from(dealerMap.values()).map((r) => {
      const total = Number(r.total) || 0;
      const apc   = (Number(r.approved) || 0) + (Number(r.counter) || 0);
      const lta   = total ? (apc / total) : 0;
      const ltb   = total ? ((Number(r.funded) || 0) / total) : 0;
      const key   = `${String(r.dealer || '').trim()}|${String(r.state || '').trim()}|${String(r.fi || '').trim()}`;
      const fundedAmt = Number(fundedAmtByKey.get(key) || 0);
      return { ...r, lta, ltb, fundedAmt };
    });
  }

  // 4) Filters (search + dropdowns)
  function applyFilters(inputRows) {
    let out = inputRows.slice();
    const q = (dSearch && dSearch.value || '').trim().toLowerCase();
    if (q) out = out.filter((r) => String(r.dealer || '').toLowerCase().includes(q));
    const st = selState && selState.value || '';
    if (st) out = out.filter((r) => r.state === st);
    const fi = selFI && selFI.value || '';
    if (fi) out = out.filter((r) => r.fi === fi);
    return out;
  }

  // populate dropdowns
  if (selState) {
    const states = Array.from(new Set(rows.map((r) => r.state))).filter(Boolean).sort();
    selState.innerHTML = ['<option value="">All</option>', ...states.map((s) => `<option>${s}</option>`)].join('');
  }
  if (selFI) {
    const fis = Array.from(new Set(rows.map((r) => r.fi))).filter(Boolean).sort();
    selFI.innerHTML = ['<option value="">All</option>', ...fis.map((s) => `<option>${s}</option>`)].join('');
  }

  // 5) Sorting on header clicks
  let sortKey = 'dealer';
  let sortDir = 'asc';
  function sortRows(input) {
    const sign = sortDir === 'asc' ? 1 : -1;
    return input.slice().sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string' || typeof bv === 'string') return sign * String(av).localeCompare(String(bv));
      return sign * ((Number(av) || 0) - (Number(bv) || 0));
    });
  }
  function updateSortIcons() {
    if (!dHead) return;
    dHead.querySelectorAll('th.sortable').forEach((th) => {
      const span = th.querySelector('.dir');
      if (!span) return;
      const k = th.getAttribute('data-key') || '';
      if (k === sortKey) {
        span.textContent = (sortDir === 'asc' ? '↑' : '↓');
      } else {
        span.textContent = '↕';
      }
    });
  }
  
  if (dHead) {
    dHead.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-key') || 'dealer';
        if (k === sortKey) {
          sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
        } else {
          sortKey = k;
          sortDir = 'asc';
        }
        updateSortIcons();
        paint();
      });
    });
  }  

  if (dSearch) dSearch.addEventListener('input', () => paint());
  if (selState) selState.addEventListener('change', () => paint());
  if (selFI)    selFI.addEventListener('change', () => paint());

  // 6) Paint table body (includes Funded $ after Funded)
  function paint() {
    const view = sortRows(applyFilters(rows));
    dBody.innerHTML = view.map((r) => `
      <tr class="border-t odd:bg-gray-50/40">
        <td class="px-3 py-2">${r.dealer}</td>
        <td class="px-3 py-2">${stateChip(r.state)}</td>
        <td class="px-3 py-2">${fiChip(r.fi)}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.total ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.approved ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.counter ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.pending ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.denial ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.funded ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatMoney(r.fundedAmt || 0)}</td>
        <td class="px-3 py-2 text-right">
          <div class="inline-flex items-center gap-2">
            <span class="tabular-nums">${formatPct(r.lta || 0)}</span>
            <span class="inline-block w-20 align-middle">${pctBar(r.lta || 0)}</span>
          </div>
        </td>
        <td class="px-3 py-2 text-right">
          <div class="inline-flex items-center gap-2">
            <span class="tabular-nums">${formatPct(r.ltb || 0)}</span>
            <span class="inline-block w-20 align-middle">${pctBar(r.ltb || 0)}</span>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td class="px-3 py-6 text-gray-500" colspan="12">No data.</td></tr>';
  }
  function exportYrDealersCSV() {
    // use the current view (sorted + filtered)
    const view = sortRows(applyFilters(rows));
  
    const header = [
      'Dealer','State','FI',
      'Total Apps','Approved','Counter','Pending','Denial','Funded','Funded $','LTA','LTB'
    ];
    const lines = [header.join(',')];
  
    view.forEach((r) => {
      const row = [
        `"${String(r.dealer||'').replace(/"/g,'""')}"`,
        `"${String(r.state||'').replace(/"/g,'""')}"`,
        `"${String(r.fi||'').replace(/"/g,'""')}"`,
        Number(r.total)||0,
        Number(r.approved)||0,
        Number(r.counter)||0,
        Number(r.pending)||0,
        Number(r.denial)||0,
        Number(r.funded)||0,
        (Number(r.fundedAmt)||0),
        ((r.lta||0)*100).toFixed(2)+'%',
        ((r.ltb||0)*100).toFixed(2)+'%',
      ];
      lines.push(row.join(','));
    });
  
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yearly-dealers.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  const btnExport = document.getElementById('btnExportYrDealers');
  if (btnExport) btnExport.addEventListener('click', exportYrDealersCSV);
  
  // initial paint
  updateSortIcons(); 
  paint();
}

// --- Franchise vs Independent (YTD) — build + paint rows
// Uses your existing helpers: formatMoney(), formatPct()
// Read from Supabase if available; otherwise keep existing local aggregation.

let fiRows = [];

if (window.sb) {
  // ✔ SB path: read YTD from fi_yearly
  const fi = await fetchFIYTD_SB(year); // returns { Franchise: {...}, Independent: {...} } or null
  if (fi) {
    const parts = [];
    if (fi.Independent) {
      parts.push({
        type: 'Independent',
        total:        Number(fi.Independent.total)        || 0,
        approved:     Number(fi.Independent.approved)     || 0,
        counter:      Number(fi.Independent.counter)      || 0,
        pending:      Number(fi.Independent.pending)      || 0,
        denial:       Number(fi.Independent.denial)       || 0,
        funded:       Number(fi.Independent.funded)       || 0,
        amount:       Number(fi.Independent.fundedAmount) || 0
      });
    }
    if (fi.Franchise) {
      parts.push({
        type: 'Franchise',
        total:        Number(fi.Franchise.total)        || 0,
        approved:     Number(fi.Franchise.approved)     || 0,
        counter:      Number(fi.Franchise.counter)      || 0,
        pending:      Number(fi.Franchise.pending)      || 0,
        denial:       Number(fi.Franchise.denial)       || 0,
        funded:       Number(fi.Franchise.funded)       || 0,
        amount:       Number(fi.Franchise.fundedAmount) || 0
      });
    }

    fiRows = parts.map((x) => ({
      ...x,
      lta: x.total ? x.approved / x.total : 0,
      ltb: x.total ? x.funded   / x.total : 0,
    }));

    // Add "All Types" summary at the top
    const all = fiRows.reduce(
      (a, r) => ({
        type: 'All Types',
        total:    a.total    + r.total,
        approved: a.approved + r.approved,
        counter:  a.counter  + r.counter,
        pending:  a.pending  + r.pending,
        denial:   a.denial   + r.denial,
        funded:   a.funded   + r.funded,
        amount:   a.amount   + r.amount,
      }),
      { type:'All Types', total:0, approved:0, counter:0, pending:0, denial:0, funded:0, amount:0 }
    );
    all.lta = all.total ? all.approved / all.total : 0;
    all.ltb = all.total ? all.funded  / all.total : 0;

    const desiredOrder = ['All Types', 'Independent', 'Franchise'];
    fiRows = [all].concat(
      desiredOrder.slice(1).map((t) => fiRows.find((r) => r.type === t)).filter(Boolean)
    );
  }
} else {
  // 🔁 Fallback: keep your original local aggregation
  const fiAgg = new Map(); // keys: 'Independent' | 'Franchise' | 'Unknown'
  function ensureFI(k) {
    if (!fiAgg.has(k)) {
      fiAgg.set(k, {
        type: k,
        total: 0,
        approved: 0,
        counter: 0,
        pending: 0,
        denial: 0,
        funded: 0,
        amount: 0, // total funded dollars
      });
    }
    return fiAgg.get(k);
  }

  // 1) Sum monthly FI tallies from snapshot summaries
  list.forEach((snap) => {
    (snap.fiRows || []).forEach((r) => {
      const k = r.type || 'Unknown';
      const x = ensureFI(k);
      x.total    += r.total   || 0;
      x.approved += r.approved|| 0;
      x.counter  += r.counter || 0;
      x.pending  += r.pending || 0;
      x.denial   += r.denial  || 0;
      x.funded   += r.funded  || 0;
    });
  });

  // 2) Sum funded dollars by FI from fundedRawRows
  list.forEach((snap) => {
    (snap.fundedRawRows || []).forEach((r) => {
      const k = r.FI || 'Unknown';
      const x = ensureFI(k);
      x.amount += parseNumber(r['Loan Amount']);
    });
  });

  // 3) Compute LTA/LTB
  fiRows = Array.from(fiAgg.values()).map((x) => ({
    ...x,
    lta: x.total ? x.approved / x.total : 0,
    ltb: x.total ? x.funded   / x.total : 0,
  }));

  // 4) Prepend "All Types"
  const all = fiRows.reduce(
    (a, r) => ({
      type: 'All Types',
      total:    a.total    + r.total,
      approved: a.approved + r.approved,
      counter:  a.counter  + r.counter,
      pending:  a.pending  + r.pending,
      denial:   a.denial   + r.denial,
      funded:   a.funded   + r.funded,
      amount:   a.amount   + r.amount,
    }),
    { type:'All Types', total:0, approved:0, counter:0, pending:0, denial:0, funded:0, amount:0 }
  );
  all.lta = all.total ? all.approved / all.total : 0;
  all.ltb = all.total ? all.funded  / all.total : 0;

  const desiredOrder = ['All Types', 'Independent', 'Franchise'];
  fiRows = [all].concat(
    desiredOrder.slice(1).map((t) => fiRows.find((r) => r.type === t)).filter(Boolean)
  );
}


// 6) Paint table
const fiEl = document.getElementById('yrFiDetailBody');
if (fiEl) {
  fiEl.innerHTML =
    fiRows
      .map(
        (r) => `
      <tr class="border-t">
        <td class="px-3 py-2">${r.type}</td>
        <td class="px-3 py-2 tabular-nums">${r.total}</td>
        <td class="px-3 py-2 tabular-nums">${r.approved}</td>
        <td class="px-3 py-2 tabular-nums">${r.counter}</td>
        <td class="px-3 py-2 tabular-nums">${r.pending}</td>
        <td class="px-3 py-2 tabular-nums">${r.denial}</td>
        <td class="px-3 py-2 tabular-nums">${r.funded}</td>
        <td class="px-3 py-2 tabular-nums">${formatPct(r.lta)}</td>
        <td class="px-3 py-2 tabular-nums">${formatPct(r.ltb)}</td>
        <td class="px-3 py-2 tabular-nums">${formatMoney(r.amount)}</td>
      </tr>`
      )
      .join('') ||
    `<tr><td class="px-3 py-2 text-gray-500" colspan="10">No data.</td></tr>`;
}

 // State Performance (YTD from state_monthly; adapter for fetchStateMonthlyYTD_SB shape)
if (window.sb) {
  (async () => {
    // -> [{ state, months:[{ total, approved, counter, pending, denial, funded, fundedAmount }×12], ytd:{...} }]
    const stateYTD = (await fetchStateMonthlyYTD_SB(year)) || [];

    // 12 month labels for the selected year
    window.spMonths = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return [`${year}-${String(m).padStart(2, '0')}`, monthName(m)];
    });

    // Sorted list of state codes
    const states = stateYTD.map(s => s.state || '??').sort();
    window.spStates = states;

    // Build the series map: state -> [{ total, approved, funded, amount, ltb } per month]
    const seriesMap = new Map();
    stateYTD.forEach(s => {
      const series = (s.months || []).map(cell => {
        const total    = Number(cell.total)        || 0;
        const approved = (Number(cell.approved)    || 0) + (Number(cell.counter) || 0);
        const funded   = Number(cell.funded)       || 0;
        const amount   = Number(cell.fundedAmount) || 0;  // used by “Funded (amount)”
        const ltb      = total ? funded / total    : 0;   // LTB%
        return { total, approved, funded, amount, ltb };
      });
      seriesMap.set(s.state || '??', series);
    });

    // Expose to the existing renderers (matrix / trends / sparklines)
    window.spData = seriesMap;
    // Re-render state performance now that data is ready
try {
  if (typeof spBuildMatrix === 'function') spBuildMatrix();        // matrix tab
  if (typeof spBuildTrends === 'function') spBuildTrends();        // trends tab
  if (typeof spBuildSparklines === 'function') spBuildSparklines();// sparklines tab
} catch (e) {
  console.error('[yearly/state] render after data error:', e);
}

  })().catch(console.error);
} else {
  // Fallback: derive from in-memory list (unchanged)
  spBuildData(list);
}


const mSel = $('#spMetric'); const nSel = $('#spTopN');
if (mSel && !mSel.value) mSel.value = 'funded';
if (nSel && !nSel.value) nSel.value = '10';
spShow('matrix');
spRenderAll();

$('#spMetric')?.addEventListener('change', spRenderAll);
$('#spTopN')?.addEventListener('change', spRenderAll);
$('#spViewMatrix')?.addEventListener('click', () => spShow('matrix'));
$('#spViewTrends')?.addEventListener('click', () => spShow('trends'));
$('#spViewSpark')?.addEventListener('click', () => spShow('spark'));
}

/* ---------- State Performance ---------- */
function spShow(which) {
  const cards = { matrix: 'spMatrixCard', trends: 'spTrendsCard', spark: 'spSparkCard' };
  const btns  = { matrix: 'spViewMatrix', trends: 'spViewTrends', spark: 'spViewSpark' };
  ['matrix','trends','spark'].forEach(k => {
    const card = document.getElementById(cards[k]);
    const btn  = document.getElementById(btns[k]);
    if (card) card.classList.toggle('hidden', k !== which);
    if (btn) {
      btn.classList.toggle('bg-blue-600', k === which);
      btn.classList.toggle('text-white',  k === which);
      btn.classList.toggle('hover:bg-gray-50', k !== which);
    }
  });
}

function spBuildData(list) {
  // months labels
  spMonths = list.map(s => [`${s.year}-${String(s.month).padStart(2,'0')}`, monthName(s.month)]);
  // state set from dealer rows
  const stateSet = new Set();
  (list || []).forEach(s => (s.dealerRows||[]).forEach(r => stateSet.add(r.state || '??')));
  spStates = Array.from(stateSet).sort();
  // series per state
  spData = new Map();
  spStates.forEach(st => {
    const series = list.map(s => {
      const rows = (s.dealerRows || []).filter(r => r.state === st);
      const total = rows.reduce((a,r)=>a+(r.total||0),0);
      const approved = rows.reduce((a,r)=>a+(r.approved||0),0);
      const funded = rows.reduce((a,r)=>a+(r.funded||0),0);
      const amount = (s.fundedRawRows||[]).filter(r => r.State===st).reduce((a,r)=>a+(Number(r['Loan Amount'])||0),0);
      const ltb = total ? funded/total : 0;
      return { total, approved, funded, amount, ltb };
    });
    spData.set(st, series);
  });
}

function spRenderAll() {
  spRenderMatrix();
  spRenderTrends();
  spRenderSpark();
}

function spRenderMatrix() {
  const head = $('#spMatrixHead');
  const body = $('#spMatrixBody');
  if (!head || !body) return;
  const metric = ($('#spMetric')?.value)||'funded';
  const topN   = parseInt(($('#spTopN')?.value)||'10',10);

  // header
  head.innerHTML = `<tr>
  <th class="px-3 py-2">State</th>
  ${spMonths.map(m=>`<th class="px-3 py-2 text-right tabular-nums">${m[1]}</th>`).join('')}
  <th class="px-3 py-2 text-right tabular-nums">YTD</th>
  </tr>`;

  // rows
  const rows = spStates.map(st => {
    const series = spData.get(st) || [];
    const vals   = series.map(p => p[metric] || 0);
    const ytd    = vals.reduce((a,b)=>a+(b||0),0);
    return { st, vals, ytd };
  }).sort((a,b)=> b.ytd - a.ytd).slice(0, topN);

  body.innerHTML = rows.map(r => `
    <tr class="border-t">
      <td class="px-3 py-2">${stateChip(r.st)}</td>
      ${r.vals.map(v => `<td class="px-3 py-2 tabular-nums text-right">${metric==='ltb'?formatPct(v):(metric==='amount'?formatMoney(v):v||0)}</td>`).join('')}
      <td class="px-3 py-2 tabular-nums text-right">${metric==='ltb'?formatPct(r.ytd):(metric==='amount'?formatMoney(r.ytd):r.ytd||0)}</td>
    </tr>
  `).join('') || `<tr><td class="px-3 py-2 text-gray-500" colspan="${spMonths.length+2}">No data.</td></tr>`;
}

function spRenderTrends() {
  const tbody = $('#spTrendSummary');
  if (!tbody) return;
  const metric = ($('#spMetric')?.value)||'funded';
  const topN   = parseInt(($('#spTopN')?.value)||'10',10);
  const rows = spStates.map(st => {
    const series = spData.get(st) || [];
    const vals   = series.map(p => p[metric] || 0);
    const first  = vals.find(v=>Number.isFinite(v)) ?? 0;
    const last   = [...vals].reverse().find(v=>Number.isFinite(v)) ?? 0;
    const ytd    = vals.reduce((a,b)=>a+(b||0),0);
    const growth = last - first;
    return { st, first, last, growth, ytd };
  }).sort((a,b)=> b.ytd - a.ytd).slice(0, topN);

  tbody.innerHTML = rows.map(r => `
    <tr class="border-t">
      <td class="px-3 py-2">${stateChip(r.st)}</td>
      <td class="px-3 py-2 tabular-nums text-right">${metric==='amount'?formatMoney(r.first):(metric==='ltb'?formatPct(r.first):r.first)}</td>
      <td class="px-3 py-2 tabular-nums text-right">${metric==='amount'?formatMoney(r.last):(metric==='ltb'?formatPct(r.last):r.last)}</td>
      <td class="px-3 py-2 tabular-nums text-right">${metric==='amount'?formatMoney(r.growth):(metric==='ltb'?formatPct(r.growth):r.growth)}</td>
      <td class="px-3 py-2 tabular-nums text-right">${metric==='amount'?formatMoney(r.ytd):(metric==='ltb'?formatPct(r.ytd):r.ytd)}</td>
    </tr>
  `).join('') || `<tr><td class="px-3 py-2 text-gray-500" colspan="5">No data.</td></tr>`;
}

function spRenderSpark() {
  const grid = $('#spSparkGrid');
  if (!grid) return;
  // destroy old tiny charts if any
  spSparkCharts.forEach(c => { try { c.destroy(); } catch{} });
  spSparkCharts = [];

  const metric = ($('#spMetric')?.value)||'funded';
  const topN   = parseInt(($('#spTopN')?.value)||'10',10);
  const rows = spStates.map(st => {
    const series = spData.get(st) || [];
    const vals   = series.map(p => p[metric] || 0);
    const ytd    = vals.reduce((a,b)=>a+(b||0),0);
    return { st, vals, ytd };
  }).sort((a,b)=> b.ytd - a.ytd).slice(0, topN);

  grid.innerHTML = rows.map((r,i) => `
    <div class="bg-white rounded-xl border p-3">
      <div class="flex items-center justify-between mb-2">
        <div>${stateChip(r.st)}</div>
        <div class="text-xs tabular-nums">${metric==='amount'?formatMoney(r.ytd):(metric==='ltb'?formatPct(r.ytd):r.ytd)}</div>
      </div>
      <canvas id="spk_${i}" height="60"></canvas>
    </div>
  `).join('') || `<div class="text-sm text-gray-500">No data.</div>`;

  // build mini line charts
  rows.forEach((r, i) => {
    const ctx = document.getElementById(`spk_${i}`);
    if (!ctx || typeof Chart === 'undefined') return;
    const ch = new Chart(ctx, {
      type: 'line',
      data: { labels: spMonths.map(m=>m[1]), datasets: [{ data: r.vals, tension: 0.2 }] },
      options: { plugins:{ legend:{display:false} }, scales:{ x:{display:false}, y:{display:false} } }
    });
    spSparkCharts.push(ch);
  });
}

/* ---------- Header buttons ---------- */
document.getElementById('seedDummyBtn')?.addEventListener('click', () => {
  const y = new Date().getFullYear();
  const endM = new Date().getMonth() + 1;
  const snaps = getSnaps();
  const ids = new Set(snaps.map(s => s.id));
  for (let m=1; m<=endM; m++) {
    const id = monthId(y, m);
    const demo = makeDemoMonth(y, m);
    if (ids.has(id)) {
      const idx = snaps.findIndex(s => s.id === id);
      snaps[idx] = demo;
    } else {
      snaps.push(demo);
    }
  }
  snaps.sort((a,b)=> String(a.id).localeCompare(String(b.id)));
  setSnaps(snaps);
  try { refreshMonthlyGrid(); } catch {}
  try { refreshYearly(); } catch {}
  try { switchTab('Monthly'); } catch {}
});

document.getElementById('clearStorageBtn')?.addEventListener('click', () => {
  setSnaps([]);
  try { switchTab('Upload'); } catch {}
});

document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
  const sidebar = document.querySelector('aside.sidebar');
  if (!sidebar) return;
  if (sidebar.classList.contains('hidden')) {
    sidebar.classList.remove('hidden');
    sidebar.classList.add('fixed','inset-y-0','z-40');
  } else {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('fixed','inset-y-0','z-40');
  }
});

/* ---------- Demo generator (used by seed button) ---------- */
function makeDemoMonth(year, month) {
  // totals
  const totalApps = Math.floor(120 + Math.random()*120);    // 120–240
  const approved  = Math.floor(totalApps * (0.45 + Math.random()*0.15)); // ~45–60%
  const funded    = Math.floor(totalApps * (0.25 + Math.random()*0.10)); // ~25–35%
  const totalFunded = funded * (10000 + Math.random()*25000);

  const states = ['IL','FL','TX','WI','IN','AZ','MI','GA','TN','NC'];
  const dealers = Array.from({length: 24}, (_,i)=>`Sample Dealer ${i+1}`);

  const dealerRows = dealers.map((name) => {
    const s   = states[Math.floor(Math.random()*states.length)];
    const fi  = Math.random() < 0.35 ? 'Franchise' : 'Independent';
    const t   = Math.floor(4 + Math.random()*14);
    const a   = Math.floor(t * (0.5 + Math.random()*0.3));
    const f   = Math.min(Math.floor(t * (0.3 + Math.random()*0.25)), a);
    const c   = Math.max(0, Math.floor(t*0.05) - 1);
    const p   = Math.max(0, Math.floor(t*0.08) - 1);
    const d   = Math.max(0, t-a-c-p);
    return { dealer:name, state:s, fi, total:t, approved:a, funded:f, counter:c, pending:p, denial:d, lta: t? a/t:0, ltb:t? f/t:0 };
  });

  const fiT = { Independent:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0},
                Franchise:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0} };
  dealerRows.forEach(r => {
    const b = fiT[r.fi] || fiT.Independent;
    b.total+=r.total; b.approved+=r.approved; b.counter+=r.counter; b.pending+=r.pending; b.denial+=r.denial; b.funded+=r.funded;
  });
  const fiRows = [
    { type:'Independent', ...fiT.Independent },
    { type:'Franchise',   ...fiT.Franchise   },
  ];

  const fundedRawRows = Array.from({length: Math.max(30, funded)}, (_,i) => {
    const s = states[Math.floor(Math.random()*states.length)];
    const fi = Math.random()<0.35 ? 'Franchise' : 'Independent';
    const amt = Math.round(10000 + Math.random()*35000);
    return {
      'Dealer': `Funded Dealer ${1+ (i%20)}`,
      'State': s,
      'Status': 'funded',
      'Loan Amount': amt,
      'APR': (7 + Math.random()*8).toFixed(2),
      'Lender Fee': (200 + Math.random()*600).toFixed(2),
      'LTV': (80 + Math.random()*25).toFixed(1),
      'FI': fi
    };
  });

  return {
    id: monthId(year, month),
    meta: { year, month }, year, month,
    mapping: { dealer:'Dealer', state:'State', status:'Status', loan:'Loan Amount', apr:'APR', fee:'Lender Fee', ltv:'LTV', fi:'FI' },
    totals: { totalApps, approved, funded },
    kpis:   { totalFunded },
    dealerRows,
    fiRows,
    stateRows: [],
    fundedRawRows
  };
}
/* ---------- One-time migration for legacy snapshots ---------- */
function migrateSnapshots() {
  let snaps = getSnaps();
  if (!Array.isArray(snaps) || !snaps.length) return;

  let changed = false;

  snaps = snaps.map((s) => {
    // If dealerRows already exists with data, skip
    if (Array.isArray(s.dealerRows) && s.dealerRows.length) return s;

    const funded = Array.isArray(s.fundedRawRows) ? s.fundedRawRows : [];

    // If we don't even have fundedRawRows, we can't reconstruct anything meaningful
    if (!funded.length) return s;

    // --- Build dealerRows from funded deals only (best-effort) ---
    const dmap = new Map(); // dealer|state|fi -> row
    funded.forEach((r) => {
      const dealer = String(r.Dealer ?? '(Unknown Dealer)');
      const state  = (String(r.State ?? '').toUpperCase() || '??');
      const fi     = normFI(r.FI);
      const key = `${dealer}|${state}|${fi}`;
      if (!dmap.has(key)) {
        dmap.set(key, { dealer, state, fi, total:0, approved:0, counter:0, pending:0, denial:0, funded:0 });
      }
      const d = dmap.get(key);
      d.funded += 1;
      d.total  += 1;       // best-effort: when we only know funded, set total == funded
    });

    const dealerRows = Array.from(dmap.values()).map(d => ({
      ...d,
      lta: d.total ? (d.approved + d.counter) / d.total : 0,
      ltb: d.total ? d.funded / d.total : 0,
    }));

    // --- Build stateRows from the reconstructed dealerRows if missing ---
    let stateRows = s.stateRows;
    if (!Array.isArray(stateRows) || !stateRows.length) {
      const smap = new Map(); // state -> tallies
      dealerRows.forEach(r => {
        if (!smap.has(r.state)) smap.set(r.state, { state:r.state, total:0, approved:0, counter:0, pending:0, denial:0, funded:0 });
        const st = smap.get(r.state);
        st.total   += r.total;
        st.approved+= r.approved;
        st.counter += r.counter;
        st.pending += r.pending;
        st.denial  += r.denial;
        st.funded  += r.funded;
      });
      stateRows = Array.from(smap.values()).map(x => ({
        ...x,
        lta: x.total ? (x.approved + x.counter) / x.total : 0,
        ltb: x.total ? x.funded / x.total : 0,
      }));
    }

    // --- Build fiRows from reconstructed dealerRows if missing ---
    let fiRows = s.fiRows;
    if (!Array.isArray(fiRows) || !fiRows.length) {
      const fiT = { Independent:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0},
                    Franchise:{total:0,approved:0,counter:0,pending:0,denial:0,funded:0} };
      dealerRows.forEach(r => {
        const b = fiT[r.fi] || fiT.Independent;
        b.total   += r.total;
        b.approved+= r.approved;
        b.counter += r.counter;
        b.pending += r.pending;
        b.denial  += r.denial;
        b.funded  += r.funded;
      });
      fiRows = [
        { type:'Independent', ...fiT.Independent },
        { type:'Franchise',   ...fiT.Franchise   },
      ];
    }

    // --- Totals (if missing) ---
    let totals = s.totals;
    if (!totals || typeof totals !== 'object') {
      totals = {
        totalApps: dealerRows.reduce((a,r)=>a+r.total,0),
        approved : dealerRows.reduce((a,r)=>a+r.approved,0),
        counter  : dealerRows.reduce((a,r)=>a+r.counter,0),
        pending  : dealerRows.reduce((a,r)=>a+r.pending,0),
        denial   : dealerRows.reduce((a,r)=>a+r.denial,0),
        funded   : dealerRows.reduce((a,r)=>a+r.funded,0),
      };
    }

    // --- KPIs (keep existing, fill totalFunded if missing) ---
    const kpis = s.kpis || {};
    if (kpis.totalFunded == null) {
      kpis.totalFunded = funded.reduce((a,r)=> a + num(r['Loan Amount']), 0);
    }

    changed = true;
    return {
      ...s,
      dealerRows: dealerRows,
      stateRows : (Array.isArray(s.stateRows) && s.stateRows.length) ? s.stateRows : stateRows,
      fiRows    : (Array.isArray(s.fiRows)    && s.fiRows.length)    ? s.fiRows    : fiRows,
      totals,
      kpis
    };
  });

  if (changed) {
    setSnaps(snaps);
    console.log('✅ Migration: updated snapshots to include dealerRows where possible.');
  } else {
    console.log('ℹ️ Migration: no changes needed.');
  }
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  try {
    try { migrateSnapshots(); } catch {}
    buildSidebar();
    // If no snapshots yet, leave it empty; user can seed or upload.
    switchTab('Upload');
  } catch (e) {
    console.error('Boot error:', e);
  }
});
// --- Minimal Yearly refresh wrapper (safe, no breaking) ---
async function refreshYearly() {
  // Always find the real <select> used in the Yearly header
  const yearSel = findYearSelect();
  if (!yearSel) { console.warn('[yearly] cannot refresh: no year <select>'); return; }

  // Fill the dropdown from Supabase (with safe fallbacks)
  await ensureYearOptionsSB();

  // Decide which year to render (newest if empty)
  let year = Number(yearSel.value);
  if (!year) {
    const opts = Array.from(yearSel.options)
      .map(o => Number(o.value))
      .filter(Boolean)
      .sort((a, b) => b - a);
    year = opts[0] || new Date().getFullYear();
    yearSel.value = String(year);
  }

  // Re-render whenever the user changes the dropdown
  yearSel.onchange = () => { renderYearly(); };

  // Draw the Yearly view for the selected year
  await renderYearly();
}
// Re-render Yearly when the user changes the year

(function wireYearSelectChange(){
  const sel =
    document.getElementById('yrYear') ||
    document.getElementById('yearSelect') ||
    document.getElementById('yrSelect') ||
    document.querySelector('[data-role="year-select"]');
  if (!sel) return;
  sel.addEventListener('change', async () => {
    if (typeof refreshYearly === 'function') await refreshYearly();
  });
})();
/* ---- Fallback wiring for the pre-filled sidebar in the HTML ---- */
(function wireYearlyFallback() {
  // 1) If the Yearly panel is (or becomes) visible, render it
  try { refreshYearly(); } catch {}

  // 2) If the HTML’s own nav is present, also hook its Yearly button
  const yearlyBtn =
    document.querySelector('#sidebar-nav button[data-tab="tab-Yearly"]') ||
    document.querySelector('#sidebar-nav button[data-tab="Yearly"]');

  if (yearlyBtn && !yearlyBtn.__yr_wired) {
    yearlyBtn.addEventListener('click', () => {
      try { refreshYearly(); } catch {}
    });
    yearlyBtn.__yr_wired = true;
  }

  // 3) If the Monthly button is clicked, keep Monthly fresh too
  const monthlyBtn =
    document.querySelector('#sidebar-nav button[data-tab="tab-Monthly"]') ||
    document.querySelector('#sidebar-nav button[data-tab="Monthly"]');
  if (monthlyBtn && !monthlyBtn.__mo_wired) {
    monthlyBtn.addEventListener('click', () => {
      try { refreshMonthlyGrid(); } catch {}
    });
    monthlyBtn.__mo_wired = true;
  }
})();

