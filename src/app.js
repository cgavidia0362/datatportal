console.log('[BUILD] src/app.js loaded at', new Date().toISOString());
Chart.register(ChartDataLabels);
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
/* ---------- Dealer Key Helper (used by merge functions) ---------- */
window.dealerKey = (dealer, state, fi) => {
  const d = String(dealer ?? '').trim();
  const s = String(state ?? '').trim().toUpperCase();
  if (fi === undefined || fi === null || String(fi).trim() === '') return `${d}|${s}`;
  return `${d}|${s}|${fi}`;
};
const dealerKey = window.dealerKey;
/* ---------- Storage helpers ---------- */
window.LS_KEY = 'ma_snaps_sidebar_v1';
function getSnaps() {
  try { return JSON.parse(localStorage.getItem(window.LS_KEY) || '[]'); } catch { return []; }
}
function setSnaps(snaps) {
  try { localStorage.setItem(window.LS_KEY, JSON.stringify(snaps || [])); } catch (e) { console.error('setSnaps failed:', e); }
}
/* ---------- Supabase (read-only, JS-only) ---------- */
function initSupabase() {
  try {
    var url = window.NEXT_PUBLIC_SUPABASE_URL || window.SUPABASE_URL;
    var key = window.NEXT_PUBLIC_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY;
    if (window.supabase && window.supabase.createClient && url && key) {
      if (window.sb) { window.sb = null; } // <-- ADD THIS LINE
      window.sb = window.supabase.createClient(url, key, { auth: { persistSession: false } });
      console.log('[sb] client (RE)initialized'); // <-- EDIT THIS LINE
    } else {
      window.sb = null;
      console.log('[sb] not configured — using localStorage fallback');
    }
  } catch (e) {
    window.sb = null;
  }
}
initSupabase();

/**
 * Fetch the last 12 month tiles from Supabase monthly_snapshots.
 * Returns: [{ id, year, month, totals:{...}, kpis:{ totalFunded } }]
 */
/**
 * FIXED VERSION of fetchMonthlySummariesSB
 * 
 * This version:
 * 1. Creates a fresh client with explicit settings
 * 2. Adds detailed error logging
 * 3. Handles the 401 error gracefully
 * 4. Returns data even if there are auth issues (because RLS should be disabled or set to public)
 * 
 * REPLACE the fetchMonthlySummariesSB function (lines 63-119) in your dataportalupdatedcode.tsx
 * with this code:
 */

async function fetchMonthlySummariesSB() {
  console.log('[sb] fetchMonthlySummariesSB: START');
  
  // Create a completely fresh client every time
  var sb = null;
  try {
    var url = "https://zhquyedaxszsnswaimza.supabase.co";
    var key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocXV5ZWRheHN6c25zd2FpbXphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA4OTYxNDcsImV4cCI6MjA3NjQ3MjE0N30.-XcpPuh_dexFjI1zSVLQfkDgvCEM6qlDN3ARTJBK3_4";
    
    sb = window.supabase.createClient(url, key, {
      auth: { 
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      }
    });
    console.log('[sb] fetchMonthlySummariesSB: Fresh client created');
  } catch (e) {
    console.error('[sb] fetchMonthlySummariesSB: FAILED to create client', e);
    return null;
  }
  
  if (!sb) {
    console.error('[sb] fetchMonthlySummariesSB: sb is null after creation');
    return null;
  }

  console.log('[sb] fetchMonthlySummariesSB: About to query monthly_snapshots');
  
  try {
    var result = await sb
    .from('monthly_summary_view')
      .select('year,month,total_apps,approved,counter,pending,denial,funded,funded_amount')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(5000);

    console.log('[sb] fetchMonthlySummariesSB: Query completed');
    console.log('[sb] fetchMonthlySummariesSB: result.error =', result.error);
    console.log('[sb] fetchMonthlySummariesSB: result.data count =', result.data?.length);

    if (result.error) {
      console.error('[sb] monthly summaries error:', result.error);
      console.error('[sb] Error details:', {
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
        code: result.error.code
      });
      return null;
    }

    var data = result.data || [];
    console.log('[sb] fetchMonthlySummariesSB: Processing', data.length, 'rows');
    
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
    console.log('[sb] ALL month IDs before slice:', Array.from(byId.keys()).sort());
    var finalResult = Array.from(byId.values())
      .sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); })
      .slice(-12);
    
    console.log('[sb] fetchMonthlySummariesSB: SUCCESS - Returning', finalResult.length, 'months');
    console.log('[sb] fetchMonthlySummariesSB: Month IDs:', finalResult.map(s => s.id).join(', '));
    
    return finalResult;
  } catch (e) {
    console.error('[sb] fetchMonthlySummariesSB: Exception during query:', e);
    return null;
  }
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
      funded: Number(r.funded) || 0,
      funded_amount: Number(r.funded_amount) || 0
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

// Load individual funded deals from funded_deals table
var fundedRawRows = [];
try {
  var fundedResult = await window.sb  // ← changed const to var
    .from('funded_deals')
    .select('dealer, state, fi, loan_amount, apr, lender_fee_pct, ltv')
    .eq('year', year)
    .eq('month', month)
    .limit(10000);

  var fundedData = fundedResult.data;  // ← changed const to var
  var fundedErr = fundedResult.error;  // ← changed const to var

  if (!fundedErr && Array.isArray(fundedData)) {
    fundedRawRows = fundedData.map(function (r) {
      return {
        Dealer: r.dealer,
        State: r.state,
        FI: r.fi,
        'Loan Amount': Number(r.loan_amount) || 0,
        APR: Number(r.apr) || null,
        'Lender Fee': Number(r.lender_fee_pct) || null,
        LTV: Number(r.ltv) || null,
        Status: 'funded'
      };
    });
  }
} catch (e) {
  console.error('[sb] funded_deals fetch error:', e);
}
// Build FI (Franchise / Independent) tallies for the Monthly card
// IMPORTANT: the Monthly card expects rows with a `type` field,
// exactly "Franchise" or "Independent".
var fiMap = new Map();
(dealers || []).forEach(function (r) {
  // Normalize to the two buckets your UI expects
  var key =
    String(r.fi || '').toLowerCase() === 'franchise'
      ? 'Franchise'
      : 'Independent';

  if (!fiMap.has(key)) {
    fiMap.set(key, { type: key, total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 });
  }
  var x = fiMap.get(key);
  x.total    += Number(r.total)    || 0;
  x.approved += Number(r.approved) || 0;
  x.counter  += Number(r.counter)  || 0;
  x.pending  += Number(r.pending)  || 0;
  x.denial   += Number(r.denial)   || 0;
  x.funded   += Number(r.funded)   || 0;
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
        kpis.avgLTVApproved        = krow.avg_ltv_approved        != null ? Number(krow.avg_ltv_approved)        : null;
        kpis.avgAPRFunded          = krow.avg_apr_funded          != null ? Number(krow.avg_apr_funded)          : null;
        kpis.avgDiscountPctFunded  = krow.avg_discount_pct_funded != null ? Number(krow.avg_discount_pct_funded) : null;
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
      .limit(10000);

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

  // Preserve the currently selected year before rebuilding
  const previousSelection = Number(sel.value);

  // Build options
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  // Restore previous selection if it's still valid; otherwise choose the newest
  if (previousSelection && years.includes(previousSelection)) {
    sel.value = String(previousSelection);
  } else {
    sel.value = String(years[0]);
  }

  console.log('[yearly] year select populated via:', used, '→', years);
}

// === Save a month's dealer rows to Supabase ===============================
// Writes one row per dealer into `monthly_snapshots` for (year, month).
// Idempotent: deletes any existing rows for that (year,month) first.
async function saveMonthlySnapshotSB(snap) {
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

      if (r.dealer === 'cardinal buick gmc') console.log('[SAVE DEBUG] Cardinal row:', r);
      if (r.dealer === '2036 drive today') console.log('[SAVE DEBUG] Normal dealer row:', r);
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
 // Always delete existing funded deals for this month first
const { error: delFundedErr } = await window.sb
.from('funded_deals')
.delete()
.eq('year', y)
.eq('month', m);

if (delFundedErr) {
console.error('[sb] delete funded_deals failed:', delFundedErr);
}     
 // 4) Save individual funded deals to funded_deals table
if (snap.fundedRawRows && snap.fundedRawRows.length) {
  
  // Prepare funded deal rows
  const fundedDeals = (snap.fundedRawRows || []).map(r => ({
    year: y,
    month: m,
    dealer: String(r.Dealer || '').trim(),
    state: String(r.State || '').trim(),
    fi: String(r.FI || '').trim(),
    loan_amount: Number(r['Loan Amount']) || 0,
    apr: Number(r.APR) || null,
    lender_fee_pct: (() => {
      const fee = String(r['Lender Fee'] || '').trim();
      if (!fee) return null;
      const n = parseFloat(fee.replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    })(),
    ltv: Number(r.LTV) || null
  })).filter(d => d.loan_amount > 0); // only save deals with valid amounts

  // Insert in batches (Supabase has a limit)
  if (fundedDeals.length) {
    const { error: insFundedErr } = await window.sb
      .from('funded_deals')
      .insert(fundedDeals);
    
    if (insFundedErr) {
      console.error('[sb] insert funded_deals failed:', insFundedErr);
      setSaveStatus(`Step 4: funded_deals insert failed – ${insFundedErr.message}`);
    } else {
      setSaveStatus(`Step 4: saved ${fundedDeals.length} individual funded deals`);
    }
  }
}     
    // NEW: rebuild Yearly aggregates for this year
    await rebuildYearlyAggregatesSB(y);
    setSaveStatus('Step 4: rebuilt yearly aggregates — OK');

  // --- normalize KPI values from the built snapshot ---
const k = (snap && snap.kpis) || {};

const avgAPR =
  Number.isFinite(k.avgAPRFunded) ? k.avgAPRFunded :
  Number.isFinite(k.avgAPR)       ? k.avgAPR       :
  null;

const avgFeePct =
  Number.isFinite(k.avgDiscountPctFunded) ? k.avgDiscountPctFunded :
  Number.isFinite(k.avgDiscountPct)       ? k.avgDiscountPct       :
  null;

// now use avgAPR and avgFeePct in the monthly_kpis upsert payload
  
// === Save Monthly KPIs to Supabase (real values from snap.kpis, with fallbacks) ===
try {
  const y = snap?.year, m = snap?.month;
  if (window.sb && y && m) {
    // Parse numbers that may include %, commas, or spaces.
    const parseNum = (v) => {
      if (v == null || v === '') return null;
      const s = String(v).trim();
      // detect % and handle either "4.63" or "4.63%"
      const hasPct = s.includes('%');
      const cleaned = s.replace(/[, ]|%/g, '');
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      return hasPct ? n : n; // leave as-is; your tiles expect "4.63" style
    };

    const pickNum = (row, keys) => {
      for (const k of keys) {
        if (k in row) {
          const n = parseNum(row[k]);
          if (Number.isFinite(n)) return n;
        }
      }
      return null;
    };

    const avgFrom = (rows, keys) => {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      let sum = 0, cnt = 0;
      for (const r of rows) {
        const n = pickNum(r, keys);
        if (Number.isFinite(n)) { sum += n; cnt++; }
      }
      return cnt ? (sum / cnt) : null;
    };

    // Use your existing helper if present
    const _avg = (rows, keys) =>
      (typeof _avgFrom === 'function') ? _avgFrom(rows, keys) : avgFrom(rows, keys);

    const approvedRawRows = snap?.approvedRawRows || [];
    const fundedRawRows   = snap?.fundedRawRows   || [];

    // Wider key coverage to match real CSV headers
    const LTV_KEYS   = ['LTV','LTV Buying','ltv','LTV (Approved)','Approved LTV'];
    const APR_KEYS   = ['APR','Apr','APR %','Apr %','APR(%)','Annual % Rate','Annual Percentage Rate','annual_rate','Funded APR','APR (Funded)'];
    const DISC_KEYS  = [
      'Lender Fee %','Discount %','Lender Fee/Discount %','Lender Fee / Discount %',
      'lender_fee_pct','discount_pct','lender_discount_pct','dealer_discount_pct',
      'Avg Lender Fee (Funded)','Lender Fee','Lender Discount %'
    ];

    // Fallbacks from raw data
    const avgLTV_fallback  = _avg(approvedRawRows, LTV_KEYS);
    const avgAPR_fallback  = _avg(fundedRawRows,   APR_KEYS);
    const avgDisc_fallback = _avg(fundedRawRows,   DISC_KEYS);

    const k = snap?.kpis || {};

    // Prefer existing values; else fallbacks; else null
    const avgLTVApprovedVal        = (k.avgLTVApproved        ?? avgLTV_fallback   ?? null);
    const avgAPRFundedVal          = (k.avgAPRFunded          ?? avgAPR_fallback   ?? null);
    const avgDiscountPctFundedVal  = (k.avgDiscountPctFunded  ?? avgDisc_fallback  ?? null);

    const { data, error } = await window.sb
      .from('monthly_kpis')
      .upsert({
        year: y,
        month: m,
        avg_ltv_approved:          avgLTVApprovedVal,
        avg_apr_funded:            avgAPRFundedVal,
        avg_discount_pct_funded:   avgDiscountPctFundedVal,
      }, { onConflict: 'year,month' }) // ✅ v2 expects a string      
      .select()
      .single();

    console.log('[sb] monthly_kpis upserted (coalesced):', y, m,
      { avgLTVApprovedVal, avgAPRFundedVal, avgDiscountPctFundedVal }, { data, error });
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
window.saveMonthlySnapshotSB  = saveMonthlySnapshotSB;   // ✅ correct name (singular)
window.saveMonthlySnapshotsSB = window.saveMonthlySnapshotSB; // ✅ backup name for old code

// === Rebuild Yearly Aggregates from `monthly_snapshots` ===================
async function rebuildYearlyAggregatesSB(year) {
  try {
    if (!window.sb) return false;
    const y = Number(year) || 0;
    if (!y) return false;

    // 1) Pull ALL rows for the year from monthly_snapshots
    // Fetch month-by-month to avoid Supabase's 1000 row limit
    console.log('[sb] rebuildYearlyAggregatesSB: Fetching data for', y);
    const allRows = [];
    
    for (let month = 1; month <= 12; month++) {
      const { data, error } = await window.sb
        .from('monthly_snapshots')
        .select('dealer,state,fi,month,total_apps,approved,counter,pending,denial,funded,funded_amount')
        .eq('year', y)
        .eq('month', month);
      
      if (error) {
        console.error(`[sb] rebuildYearlyAggregatesSB: fetch month ${month} failed:`, error);
        continue; // Skip this month but continue with others
      }
      
      if (data && data.length > 0) {
        console.log(`[sb] Fetched ${data.length} rows for month ${month}`);
        allRows.push(...data);
      }
    }
    
    console.log(`[sb] Total rows fetched: ${allRows.length}`);
    const rows = allRows;

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
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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
  let t = String(s).toLowerCase();  // ← CHANGED: toLowerCase instead of toUpperCase
  console.log('[NORM] Step 1 - lowercase:', t); // ← ADD THIS LINE
  
  // FORCE remove ALL punctuation first
  t = t.replace(/[^a-z0-9\s]/g, '');  // ← CHANGED: a-z instead of A-Z
  console.log('[NORM] Step 2 - after punctuation removal:', t); // ← ADD THIS LINE
  
  // Then remove company suffixes
  t = t.replace(/\b(llc|inc|co|company|corp|corporation|ltd|the|auto|group)\b/g, '');  // ← CHANGED: lowercase patterns
  console.log('[NORM] Step 3 - after suffix removal:', t); // ← ADD THIS LINE
  
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  console.log('[NORM] Step 4 - final:', t); // ← ADD THIS LINE
  
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
  if (/(denial|denied|decline|reject|turn|ntp)/.test(t)) return 'denial';
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
let avgLTVApproved = _avgFrom(approvedRawRows, ['LTV', 'LTV Buying', 'ltv']);

// APR from FUNDED rows
let avgAPRFunded = _avgFrom(fundedRawRows, ['APR', 'apr']);

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
  { id: 'ILReps',  label: '📊 Rep Performance' },
  { id: 'BuyingDaily', label: '📊 Buying Daily' },
  { id: 'Settings',  label: '⚙️ Settings' },  // ← ADD THIS LINE
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
  if (id === 'ILReps') { if (typeof window.initRepPerformance === 'function') window.initRepPerformance(); }
  if (id === 'BuyingDaily') { if (typeof window.initBuyingDaily === 'function') window.initBuyingDaily(); }
  if (id === 'tab-Settings' || id === 'Settings') {
    // CRITICAL FIX: Ensure Settings tab is in the right place before showing
    const settingsTab = document.getElementById('tab-Settings');
    const main = document.querySelector('main');
    
    if (settingsTab && main && settingsTab.parentElement !== main) {
      console.log('[switchTab] Relocating Settings tab to correct position...');
      const settingsHTML = settingsTab.outerHTML;
      settingsTab.remove();
      main.insertAdjacentHTML('beforeend', settingsHTML);
    }
    
    // Initialize Settings tab when user clicks on it
    console.log('[switchTab] Settings tab clicked, calling initSettingsTab...');
    if (typeof initSettingsTab === 'function') {
      initSettingsTab();
    } else {
      console.error('[switchTab] initSettingsTab function not found!');
    }
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
// ====== Compute funded APR & Lender Fee (Discount %) for KPI tiles ======
function recomputeKpisFromFunded(snap) {
  if (!snap || !Array.isArray(snap.fundedRawRows)) return;

  const rows = snap.fundedRawRows || [];
  if (!rows.length) return;

  const toNum = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim().replace(/,/g, '').replace(/[^0-9.\-]/g, '');
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n > 100 ? n / 100 : n;
  };

  const aprKey = Object.keys(rows[0]).find(k => /apr/i.test(k));
  const feeKey = Object.keys(rows[0]).find(k => /(discount|lender\s*fee)/i.test(k));

  const aprVals = [];
  const feeVals = [];

  for (const r of rows) {
    const apr = toNum(r[aprKey]);
    const fee = toNum(r[feeKey]);
    if (apr != null) aprVals.push(apr);
    if (fee != null) feeVals.push(fee);
  }

  const avg = (arr) => {
    const vals = arr.filter(v => v != null);
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : null;
  };

  snap.kpis = snap.kpis || {};
  snap.kpis.avgAPRFunded = avg(aprVals);
  snap.kpis.avgDiscountPctFunded = avg(feeVals);

  // Back-compat for other parts of the UI
  snap.kpis.avgAPR = snap.kpis.avgAPRFunded;
  snap.kpis.avgDiscountPct = snap.kpis.avgDiscountPctFunded;

  // Debugging (optional)
  console.log('[KPI recompute] Avg APR:', snap.kpis.avgAPRFunded, 'Avg Fee:', snap.kpis.avgDiscountPctFunded);
}
// ====== /Compute funded APR & Lender Fee (Discount %) ======


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
    const snap = (ctx && ctx.snapshot) || window.lastBuiltSnapshot;
if (!snap || typeof snap !== 'object') {
  alert('No working snapshot found. Click Analyze first, then try Proceed & Merge again.');
  return;
}

    mergeFundedIntoSnapshot(snap, fundedParsed, fundedMapping, { accepted: acceptedCombined });

    // 6) Recompute totals & state tallies so tiles/tables update
    recomputeAggregatesFromDealers(snap);
    recomputeKpisFromFunded(snap);
// Keep legacy and "Funded" KPI keys in sync (avoid nulls either way)
snap.kpis = snap.kpis || {};
if (snap.kpis.avgAPR == null && snap.kpis.avgAPRFunded != null) snap.kpis.avgAPR = snap.kpis.avgAPRFunded;
if (snap.kpis.avgDiscountPct == null && snap.kpis.avgDiscountPctFunded != null) snap.kpis.avgDiscountPct = snap.kpis.avgDiscountPctFunded;
if (snap.kpis.avgAPRFunded == null && snap.kpis.avgAPR != null) snap.kpis.avgAPRFunded = snap.kpis.avgAPR;
if (snap.kpis.avgDiscountPctFunded == null && snap.kpis.avgDiscountPct != null) snap.kpis.avgDiscountPctFunded = snap.kpis.avgDiscountPct;

    // ----- Compute funded APR & Lender Fee (Discount %) for KPI tiles -----
(() => {
  const fundedRows = snap.fundedRawRows || [];

// Helper: turn "4.63", "4.63 %", "4,63", "1,040.97%" into a number (e.g., 4.63 or 10.4097)
const toNum = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  // Handle values like 1040.97 that are too large to be a percent
  return n > 100 ? n / 100 : n;
};


  const avg = (arr) => {
    const vals = arr.filter(v => v != null);
    return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : null;
  };

  // Use the mapped header names if present; otherwise fall back to common variants.
  const fm =
  (snap.meta && snap.meta.fundedMap) ||
  (window._analyzeCtx && window._analyzeCtx.fundedMapping) ||
  {};

// === List columns + strong normalizers (handles () , %, punctuation, multiple spaces) ===
const cols = fundedRows[0] ? Object.keys(fundedRows[0]) : [];
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const strip = s => norm(s).replace(/[^a-z%]/g, ''); // keep only letters and %

// Build lookups
const byNorm  = new Map(cols.map(k => [norm(k),  k]));
const byStrip = new Map(cols.map(k => [strip(k), k]));

// Getter helpers
const getExact = key => byNorm.get(norm(key)) ?? byStrip.get(strip(key)) ?? null;
const pick = (candidates) => {
  // 1) exact (normalized or stripped)
  for (const c of candidates) {
    const hit = getExact(c);
    if (hit) return hit;
  }
  // 2) fuzzy: candidate substring inside stripped header
  for (const c of candidates) {
    const needle = strip(c);
    for (const [sk, orig] of byStrip.entries()) {
      if (sk.includes(needle)) return orig;
    }
  }
  return null;
};

// Candidate names (include spaced + unspaced versions)
const aprCandidates = [
  'apr', 'apr%', 'annual percentage rate', 'annualpercentagerate', 'interest rate', 'rate'
];

const feeCandidates = [
  'discount percentage (lender fee %)',
  'discount percentage lender fee %',
  'lender fee %',
  'lender fee%',
  'discount %',
  'lender discount %',
  'lender discount%',
  'fee %',
  'fee'
];

// Prefer mapped names from the UI; otherwise fall back to robust picker
const aprKey =
  fm.apr && getExact(fm.apr) ||
  pick(aprCandidates);

let feeKey =
  fm.fee && getExact(fm.fee) ||
  pick(feeCandidates);

// If the chosen fee header looks like a dollar "Lender Fee" (no %), null it
if (feeKey) {
  const feeHeader   = feeKey;
  const isPercent   = /%/.test(feeHeader) || /percent/i.test(feeHeader);
  const looksLikeFee = /fee|discount/i.test(feeHeader);
  if (looksLikeFee && !isPercent) feeKey = null;
}

// --- Fallback: compute fee% from fee-dollar / funded amount when no percent column ---
if (!feeKey && Array.isArray(fundedRows) && fundedRows.length) {
  // Try to find the funded amount and fee-$ columns
  const amountKey =
    (fm && (fm.fundedAmount || fm.amount || fm.loanAmount)) ||
    cols.find(k => /fund(ed)?\s*(amount|\$)/i.test(k));

    const feeDollarKey =
    (fm && (fm.lenderFeeDollar || fm.feeDollar || fm.lenderFee)) ||
    // accept plain "Lender Fee" (no $) OR any header with $ that looks like fee/discount
    cols.find(k =>
      /^(lender\s*fee|lenderfee|fee)$/i.test(norm(k)) ||
      ( /(lender\s*fee|discount)/i.test(k) && /\$/i.test(k) )
    );  

  if (amountKey && feeDollarKey) {
    const feePctVals = fundedRows.map(r => {
      const amt = toNum(r?.[amountKey]);     // your improved toNum
      const fees = toNum(r?.[feeDollarKey]);
      if (!amt || !fees) return null;
      return (fees / amt) * 100;             // percent
    });

    // Only set if we didn’t already compute it from a % column
    snap.kpis = snap.kpis || {};
    if (snap.kpis.avgDiscountPctFunded == null) {
      snap.kpis.avgDiscountPctFunded = avg(feePctVals);
    }
  }
}

  const aprVals = fundedRows.map(r => toNum(r?.[aprKey]));
  const feeVals = fundedRows.map(r => toNum(r?.[feeKey]));

  snap.kpis = snap.kpis || {};
  snap.kpis.avgAPRFunded = avg(aprVals);
  snap.kpis.avgDiscountPctFunded = avg(feeVals);
  
  // Keep the computed values available for later save
  window._debugAprVals = aprVals;
  window._debugFeeVals = feeVals;

  // If you see nulls, uncomment these:
  // console.log('[analyze] aprKey, feeKey', aprKey, feeKey);
  // console.log('[analyze] APR avg, Fee avg', snap.kpis.avgAPRFunded, snap.kpis.avgDiscountPctFunded);
})();
// Keep legacy and "Funded" KPI keys in sync (avoid nulls either way)
snap.kpis = snap.kpis || {};
if (snap.kpis.avgAPR == null && snap.kpis.avgAPRFunded != null) snap.kpis.avgAPR = snap.kpis.avgAPRFunded;
if (snap.kpis.avgDiscountPct == null && snap.kpis.avgDiscountPctFunded != null) snap.kpis.avgDiscountPct = snap.kpis.avgDiscountPctFunded;
if (snap.kpis.avgAPRFunded == null && snap.kpis.avgAPR != null) snap.kpis.avgAPRFunded = snap.kpis.avgAPR;
if (snap.kpis.avgDiscountPctFunded == null && snap.kpis.avgDiscountPct != null) snap.kpis.avgDiscountPctFunded = snap.kpis.avgDiscountPct;

// --- DEBUG: set global snapshot after analysis + merge ---
if (snap && typeof snap === 'object') {
// Ensure KPI metrics are persisted into the global snapshot
if (snap.kpis) {
  if (snap.kpis.avgAPRFunded != null) {
    window._lastAvgAPR = snap.kpis.avgAPRFunded;
  }
  if (snap.kpis.avgDiscountPctFunded != null) {
    window._lastAvgFee = snap.kpis.avgDiscountPctFunded;
  }
  // Fallback: if this run didn't compute APR/Fee yet, reuse the last values we cached
if (snap.kpis) {
  if (snap.kpis.avgAPRFunded == null && typeof window._lastAvgAPR === 'number') {
    snap.kpis.avgAPRFunded = window._lastAvgAPR;
  }
  if (snap.kpis.avgDiscountPctFunded == null && typeof window._lastAvgFee === 'number') {
    snap.kpis.avgDiscountPctFunded = window._lastAvgFee;
  }
}
}
  window.lastBuiltSnapshot = snap;
// --- Autosave this month so KPIs persist on refresh ---
const _saveFn =
  window.saveMonthlySnapshotSB || window.saveMonthlySnapshotsSB; // accept either

if (typeof _saveFn === 'function') {
  setSaveStatus('Autosaving to Supabase…');
  _saveFn(snap)
    .then(() => {
      setSaveStatus('Autosave: OK');
      // Also persist locally so tiles reload after a refresh (no re-upload needed)
      try {
        const snaps = getSnaps();            // read existing list
        const id = snap.id;
        const idx = snaps.findIndex(s => s.id === id);
        if (idx >= 0) snaps[idx] = snap;     // replace same month
        else snaps.push(snap);               // or add
        snaps.sort((a,b) => String(a.id).localeCompare(String(b.id))); // keep ordered
        setSnaps(snaps);                     // write back to localStorage
      } catch (_) {}
    })
    .catch(e => {
      console.warn('[autosave] failed:', e);
      setSaveStatus('[autosave] Save failed — use "Save to Supabase".');
    });
}

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
            <li>Avg APR (Funded): <b>${
              Number.isFinite(s.kpis?.avgAPRFunded ?? s.kpis?.avgAPR)
                ? `${(s.kpis.avgAPRFunded ?? s.kpis.avgAPR).toFixed(2)}%`
                : '-'
            }</b></li>
            <li>Avg Lender Fee % (Funded): <b>${
              Number.isFinite(s.kpis?.avgDiscountPctFunded ?? s.kpis?.avgDiscountPct)
                ? `${(s.kpis.avgDiscountPctFunded ?? s.kpis.avgDiscountPct).toFixed(2)}%`
                : '-'
            }</b></li>            
            <li>Dealers: <b>${s.dealerRows.length}</b>, States: <b>${s.stateRows.length}</b></li>
          </ul>
        </div>
      `;
    }

    // 9) Enable buttons
    ['#btnSaveMonth','#btnExportRawAll','#btnExportFunded','#btnDeleteMonth'].forEach(sel => {
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
const dealerCorrections = snap._dealerCorrections || new Map();

appRows.forEach(r => {
  const st = normalizeState(r.state);
  const nm = normalizeDealerName(r.dealer);
  const key = `${nm}|${st}`;
  if (!byState.has(st)) byState.set(st, []);
  byState.get(st).push({ dealer:r.dealer, key, row:r });
  
  // Also index by corrected values if this dealer was corrected
  const correction = dealerCorrections.get(nm);
  if (correction) {
    const correctedState = normalizeState(correction.state);
    const correctedKey = `${nm}|${correctedState}`;
    if (!byState.has(correctedState)) byState.set(correctedState, []);
    byState.get(correctedState).push({ dealer:r.dealer, key: correctedKey, row:r, isCorrected: true });
    console.log('[Merge] Added correction mapping:', correctedKey, '→', r.dealer);
  }
});

  const accepted = [];      // funded rows we will merge
  const needsReview = [];   // low-confidence candidates
  const unmatched = [];     // no candidates

  const HIGH = 0.70;  // Lowered to catch more matches
  const LOW  = 0.60;  // Lowered threshold

  fundedParsed.rows.forEach((r) => {
    const dealer = normalizeDealerName(pickFunded(r,'dealer'));
    const state  = normalizeState(pickFunded(r,'state'));
    const amt    = parseNumber(pickFunded(r,'loan'));
    const apr    = parseNumber(pickFunded(r,'apr'));
    let fee      = pickFunded(r,'fee');
// Debug logging for Cardinal Buick GMC
if (dealer.includes('cardinal')) {
  console.log('[CARDINAL DEBUG] Processing funded row:', dealer, state);
}
    if (!dealer || !state || !isFinite(amt)) {
      unmatched.push({ r, reason:'missing fields' });
      return;
    }

    let feePct = null;
    const feeStr = String(fee||'').trim();
    if (feeStr) {
      const asNum = parseNumber(feeStr);
      if (/%/.test(feeStr)) feePct = asNum/100;
      else if (asNum<=1)    feePct = asNum;
      else if (isFinite(amt) && amt>0) feePct = asNum/amt;
    }

    const key = dealer + '|' + state;
    const candidates = byState.get(state) || [];

    const exact = candidates.find(c => c.key === key);
    if (exact) {
      accepted.push({ r, dealer: exact.row.dealer, state, amt, apr, feePct, match:'exact', row: exact.row });
     // Debug for Cardinal
  if (dealer.includes('cardinal')) {
    console.log('[CARDINAL DEBUG] EXACT MATCH found! Matched to:', exact.row.dealer);
  } 
      return;
    }

    let best = { sim: 0, cand: null };
    candidates.forEach(c => {
      const sim = diceSimilarity(dealer, c.dealer);
      if (sim > best.sim) best = { sim, cand: c };
    });

   // Extract first word from each dealer name
const dealerFirstWord = dealer.split(/\s+/)[0];
const candFirstWord = best.cand.row.dealer.toLowerCase().split(/\s+/)[0];
const firstWordMatch = dealerFirstWord === candFirstWord;

// Only accept high-confidence match if first words match OR similarity is very high (>85%)
if (best.cand && best.sim >= HIGH && (firstWordMatch || best.sim >= 0.85)) {
      accepted.push({ r, dealer: best.cand.row.dealer, state, amt, apr, feePct, match:'high', row: best.cand.row });
    // Debug for Cardinal  
  if (dealer.includes('cardinal')) {
    console.log('[CARDINAL DEBUG] HIGH CONFIDENCE MATCH! Matched to:', best.cand.row.dealer, 'Similarity:', best.sim);
  }  
    } else if (best.cand && best.sim >= LOW) {
      needsReview.push({ r, suggestion: best.cand.row.dealer, sim: best.sim, state, amt });
    } else {
      unmatched.push({ r, reason:'no good candidate' });
      // Debug for Cardinal
  if (dealer.includes('cardinal')) {
    console.log('[CARDINAL DEBUG] NO MATCH FOUND - Added to unmatched array');
  }
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

  const incByDealer = new Map();
  const amountByDealer = new Map();
  accepted.forEach(x => {
    const fi = x.row.fi || '';
    const key = dealerKey(x.dealer, x.state, fi);
    incKey(incByDealer, key, 1);
    incKey(amountByDealer, key, x.amt);  // ADD THIS LINE to sum amounts
  });

  (snap.dealerRows || []).forEach(r => {
    const k = dealerKey(r.dealer, r.state, r.fi);
    r.funded = (r.funded||0) + (incByDealer.get(k)||0);
    r.funded_amount = (r.funded_amount||0) + (amountByDealer.get(k)||0);  // ADD THIS LINE
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
  unmatched: unmatched.length,
  unmatchedDetails: unmatched.map(u => ({
    dealerName: pickFunded(u.r, 'dealer'),
    state: normalizeState(pickFunded(u.r, 'state')),
    amount: parseNumber(pickFunded(u.r, 'loan')),
    count: 1
  })),
  needsReviewDetails: needsReview.map(nr => ({
    dealerName: pickFunded(nr.r, 'dealer'),
    state: normalizeState(pickFunded(nr.r, 'state')),
    amount: parseNumber(pickFunded(nr.r, 'loan')),
    count: 1
  }))
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
// canonical (what tiles and your console expect)
snap.kpis.avgAPRFunded         = aprArr.length ? (aprArr.reduce((a,b)=>a+b,0)/aprArr.length) : null;
snap.kpis.avgDiscountPctFunded = feePctArr.length ? (feePctArr.reduce((a,b)=>a+b,0)/feePctArr.length) : null;

// legacy keys kept in sync (non-breaking)
snap.kpis.avgAPR         = snap.kpis.avgAPRFunded;
snap.kpis.avgDiscountPct = snap.kpis.avgDiscountPctFunded;


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

$('#btnAnalyze')?.addEventListener('click', async () => {
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
    const snap = buildSnapshotFromRows(mapping, parsed.rows || [], y, m);
lastBuiltSnapshot = snap;
// ===== DETECT FUNDED-ONLY DEALERS =====
// Find dealers who funded deals but had NO applications this month
let orphansForModal = [];

if (fundedParsed && fundedParsed.rows && fundedParsed.rows.length > 0) {
  console.log('[Funded-Only] Checking for dealers who funded but did not apply...');
  
  // Build a set of all dealers from the APPLICATION CSV (normalized)
  const appDealerSet = new Set();
  (snap.dealerRows || []).forEach(function(r) {
    const key = normalizeDealerName(r.dealer).trim() + '|' + normalizeState(r.state).trim();
    console.log('[Debug] Adding app dealer to set:', key);
    appDealerSet.add(key);
  });
  
  console.log('[Debug] Total app dealers in set:', appDealerSet.size);
  console.log('[Debug] First 5 app dealer keys:', Array.from(appDealerSet).slice(0, 5));
  
  console.log('[Funded-Only] Found', appDealerSet.size, 'dealers in application CSV');
  
  // Build a map of funded deals by dealer
  const fundedByDealer = new Map();
  
  fundedParsed.rows.forEach(function(row) {
    const dealerCol = fundedMapping.dealer || '';
    const stateCol = fundedMapping.state || '';
    const loanCol = fundedMapping.loan || '';
    
    if (!dealerCol || !stateCol || !loanCol) return;
    
    const dealer = normalizeDealerName(String(row[dealerCol] || '').trim());
    const state = normalizeState(String(row[stateCol] || '').trim());
    console.log('[Debug] Funded dealer BEFORE norm:', String(row[dealerCol] || '').trim(), '→ AFTER norm:', dealer);  // ADD THIS
    console.log('[Debug] CHAR CODES:', dealer.split('').map(c => c.charCodeAt(0)).join(','));
    const amount = parseFloat(String(row[loanCol] || '0').replace(/[^0-9.-]/g, '')) || 0;
    
    if (!dealer || !state || amount <= 0) return;
    
    const key = dealer.trim() + '|' + state.trim();
    
    if (!fundedByDealer.has(key)) {
      fundedByDealer.set(key, {
        dealerName: dealer,
        state: state,
        fundedCount: 0,
        fundedAmount: 0
      });
    }
    
    const entry = fundedByDealer.get(key);
    entry.fundedCount += 1;
    entry.fundedAmount += amount;
  });
  
  console.log('[Funded-Only] Found', fundedByDealer.size, 'unique dealers in funded CSV');
  
  // Find dealers who are in FUNDED but NOT in APPLICATION
  fundedByDealer.forEach(function(entry, key) {
    console.log('[Debug] Checking funded dealer:', key, 'in app set?', appDealerSet.has(key));
    if (!appDealerSet.has(key)) {
      orphansForModal.push({
        dealer: entry.dealerName,
        state: entry.state,
        fi: 'Independent',
        count: entry.fundedCount,
        amount: entry.fundedAmount,
        action: 'create-row'
      });
    }
  });
  
  console.log('[Funded-Only] Found', orphansForModal.length, 'funded-only dealers (funded but no apps)');
  
  if (orphansForModal.length > 0) {
    console.log('[Funded-Only] Examples:', orphansForModal.slice(0, 3));
  }
}
// ===== END FUNDED-ONLY DEALER DETECTION =====
// ===== MASTER DEALER VALIDATION =====
// Add this code RIGHT AFTER line 2336 (after lastBuiltSnapshot = snap;)
// and BEFORE line 2343 (before the Pre-merge funded file review comment)

// Validate the snapshot against master dealer list
try {
  const validationIssues = await validateSnapshot(lastBuiltSnapshot);
  
  // Do a preliminary merge to identify unmatched funded dealers
  let unmatchedFundedDealers = [];
  if (fundedParsed && fundedParsed.rows && fundedParsed.rows.length > 0) {
    const snapshotCopy = JSON.parse(JSON.stringify(lastBuiltSnapshot));
    const originalFundedParsed = window.fundedParsed;
    const originalConfirm = window.confirm;
    
    window.fundedParsed = fundedParsed;
    window.confirm = () => false; // Auto-reject to prevent actual merge
    
    try {
      if (typeof matchAndMergeFundedIntoSnapshot === 'function') {
        const prelimResult = matchAndMergeFundedIntoSnapshot(snapshotCopy);
        unmatchedFundedDealers = orphansForModal || [];  // Use our own detection (works better!)
        console.log('[Debug] prelimResult full object:', prelimResult);
    console.log('[Debug] unmatchedDetails:', prelimResult.unmatchedDetails);
        console.log('[Validation] Preliminary merge found', unmatchedFundedDealers.length, 'unmatched dealers');
      }
    } finally {
      window.fundedParsed = originalFundedParsed;
      window.confirm = originalConfirm;
    }
  }
  
  // Store unmatched in uploadReviewData for later
  window.uploadReviewData.unmatchedFunded = unmatchedFundedDealers;

  const hasIssues = 
    validationIssues.mismatches.length > 0 || 
    validationIssues.newDealers.length > 0 ||
    orphansForModal.length > 0;
  
  if (hasIssues) {
    console.log('[Validation] Issues found:', {
      mismatches: validationIssues.mismatches.length,
      newDealers: validationIssues.newDealers.length,
      unmatchedFunded: unmatchedFundedDealers.length
    });
    
    // Show the review modal  
    showUploadReviewModal(
      validationIssues, 
      orphansForModal, // Pass the funded-only dealers we detected
      lastBuiltSnapshot,
      fundedParsed?.rows || null
    );
    
    // STOP HERE - user will proceed after review
    return;
  }
  
  console.log('[Validation] ✅ No issues found - proceeding with upload');
  
} catch (validationError) {
  console.error('[Validation] Error during validation:', validationError);
  // Continue anyway if validation fails (don't block the user)
}
// ===== END MASTER DEALER VALIDATION =====

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

// Wire up the upload review modal buttons BEFORE showing it
console.log('[DEBUG] About to attach button listeners');

// First, remove any existing listeners by cloning and replacing the buttons
const oldApplyBtn = document.getElementById('btnApplyReview');
const oldCancelBtn = document.getElementById('btnCancelReview');

if (oldApplyBtn) {
  const newApplyBtn = oldApplyBtn.cloneNode(true);
  oldApplyBtn.parentNode.replaceChild(newApplyBtn, oldApplyBtn);
  console.log('[DEBUG] Cloned Apply button to remove old listeners');
}

if (oldCancelBtn) {
  const newCancelBtn = oldCancelBtn.cloneNode(true);
  oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
  console.log('[DEBUG] Cloned Cancel button to remove old listeners');
}

// Now attach fresh listeners to the new buttons
document.getElementById('btnApplyReview')?.addEventListener('click', async () => {
  console.log('[DEBUG] Apply button clicked!');
  
  const modal = document.getElementById('uploadReviewModal');
  if (!modal) {
    console.log('[DEBUG] Modal not found!');
    return;
  }
  
  // Get all the user's choices from the dropdowns
  const rows = modal.querySelectorAll('#uploadReviewContent tbody tr');
  const resolutions = [];
  
  rows.forEach(row => {
    const dealerName = row.cells[0]?.textContent?.trim();
    const dropdown = row.querySelector('select');
    const choice = dropdown?.value;
    
    if (dealerName && choice) {
      resolutions.push({ dealer: dealerName, action: choice });
    }
  });
  
  console.log('[Upload Review] User resolutions:', resolutions);
  
  // Hide modal
  modal.classList.add('hidden');
  console.log('[DEBUG] Modal hidden');
  
  // Continue with the normal analyze flow
  const s = window.lastBuiltSnapshot;
  if (s) {
    const res = document.getElementById('resultsArea');
    if (res) {
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
    
    // Enable save buttons
    ['#btnSaveMonth','#btnExportRawAll','#btnExportFunded','#btnDeleteMonth'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.disabled = false;
    });
    
    console.log('[DEBUG] Results shown, buttons enabled');
  }
});

document.getElementById('btnCancelReview')?.addEventListener('click', () => {
  console.log('[DEBUG] Cancel button clicked!');
  
  const modal = document.getElementById('uploadReviewModal');
  if (modal) modal.classList.add('hidden');
  window.lastBuiltSnapshot = null;
  console.log('[Upload Review] Upload cancelled by user');
});

console.log('[DEBUG] Button listeners attached');

document.getElementById('btnCancelReview')?.addEventListener('click', () => {
  const modal = document.getElementById('uploadReviewModal');
  if (modal) modal.classList.add('hidden');
  window.lastBuiltSnapshot = null;
  console.log('[Upload Review] Upload cancelled by user');
}, { once: true }); // IMPORTANT: only add listener once

// Now show modal
document.getElementById('uploadReviewModal')?.classList.remove('hidden');
// Stop here; user will proceed via button click

    } else {
      // No flags → safe to merge directly
      // NOTE: mergeFundedData already exists from the prior step you added
      mergeFundedData(lastBuiltSnapshot, /*overrides*/ null);
      recomputeAggregatesFromDealers(lastBuiltSnapshot); // already in your code nearby
recomputeKpisFromFunded(lastBuiltSnapshot);        // <— add this
lastBuiltSnapshot.kpis = lastBuiltSnapshot.kpis || {};
if (lastBuiltSnapshot.kpis.avgAPR == null && lastBuiltSnapshot.kpis.avgAPRFunded != null) lastBuiltSnapshot.kpis.avgAPR = lastBuiltSnapshot.kpis.avgAPRFunded;
if (lastBuiltSnapshot.kpis.avgDiscountPct == null && lastBuiltSnapshot.kpis.avgDiscountPctFunded != null) lastBuiltSnapshot.kpis.avgDiscountPct = lastBuiltSnapshot.kpis.avgDiscountPctFunded;
if (lastBuiltSnapshot.kpis.avgAPRFunded == null && lastBuiltSnapshot.kpis.avgAPR != null) lastBuiltSnapshot.kpis.avgAPRFunded = lastBuiltSnapshot.kpis.avgAPR;
if (lastBuiltSnapshot.kpis.avgDiscountPctFunded == null && lastBuiltSnapshot.kpis.avgDiscountPct != null) lastBuiltSnapshot.kpis.avgDiscountPctFunded = lastBuiltSnapshot.kpis.avgDiscountPct;

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

// Delete Month (removes this year-month from Supabase + local)
// Wire BOTH buttons: upload-tab and monthly-tab
['#btnDeleteMonth', '#btnDeleteMonthMonthly'].forEach((sel) => {
  const btn = document.querySelector(sel);
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const s = window.lastBuiltSnapshot;
    if (!s || !s.year || !s.month) { alert('Nothing to delete. Analyze a month first.'); return; }

    const ok = confirm(`Delete data for ${s.year}-${String(s.month).padStart(2,'0')} from cloud + local?`);
    if (!ok) return;

    try {
      clearSaveStatus();
      setSaveStatus(`Deleting ${s.year}-${String(s.month).padStart(2,'0')}…`);

      // 1) Delete from Supabase (both tables)
      if (window.sb) {
        await window.sb.from('monthly_snapshots').delete().eq('year', s.year).eq('month', s.month);
        await window.sb.from('monthly_kpis').delete().eq('year', s.year).eq('month', s.month);
      }

      // 2) Remove from localStorage “snaps”
      let snaps = getSnaps().filter(x => !(x.year === s.year && x.month === s.month));
      setSnaps(snaps);

      // 3) Clear working snapshot and refresh UI tiles
      if (window.lastBuiltSnapshot?.year === s.year && window.lastBuiltSnapshot?.month === s.month) {
        window.lastBuiltSnapshot = null;
      }
      setSaveStatus('Deleted — OK');
      try { if (typeof refreshMonthlyGrid === 'function') refreshMonthlyGrid(); } catch {}

    } catch (e) {
      console.error('[delete month] error:', e);
      setSaveStatus('Delete failed — see console.');
      alert('Delete failed. Check Console for details.');
    }
  });
});


$('#btnSaveMonth')?.addEventListener('click', async () => {
  try {
    initSupabase(); // <-- PASTE IT HERE
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

const ok = await saveMonthlySnapshotSB(window.lastBuiltSnapshot);
  
        if (ok) {
          setSaveStatus('Save to Supabase: OK');

          // 5) MOVED: Immediately refresh UI and go to Monthly *AFTER* save
          try { buildSidebar(); } catch {}
          try { await refreshMonthlyGrid(); } catch {} // Refresh the grid
          try { switchTab('Monthly'); } catch {}   // NOW switch to the tab
// Rebuild yearly aggregates so Yearly tab is up-to-date
setSaveStatus('Rebuilding yearly aggregates...');
const y = lastBuiltSnapshot.year;
await rebuildYearlyAggregatesSB(y);
setSaveStatus('Save complete! Yearly data updated.');
        } else {
          setSaveStatus('Save to Supabase: FAILED (see earlier steps)');
        }
        // --- END OF FIX ---
  
      } else {
        // If not saving to SB (e.g. local only), just refresh/switch
        setSaveStatus('Saved to local storage.');
        try { buildSidebar(); } catch {}
        try { refreshMonthlyGrid(); } catch {} 
        try { switchTab('Monthly'); } catch {}
      }
    } catch (e) {
      console.error('[save] Supabase save error:', e);
      setSaveStatus(`Save to Supabase: ERROR — ${e?.message || e}`);
    }

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
    // === Load saved KPI values (APR, Fee, LTV) from Supabase ===
try {
  if (window.sb && window.lastBuiltSnapshot?.year && window.lastBuiltSnapshot?.month) {
    const { data: kpi, error: kerr } = await window.sb
      .from('monthly_kpis')
      .select('avg_apr_funded, avg_discount_pct_funded, avg_ltv_approved')
      .eq('year', window.lastBuiltSnapshot.year)
      .eq('month', window.lastBuiltSnapshot.month)
      .maybeSingle();

    if (!kerr && kpi) {
      const avgAPR = Number(kpi.avg_apr_funded);
      const avgFee = Number(kpi.avg_discount_pct_funded);
      const avgLTV = Number(kpi.avg_ltv_approved);

// Optional one-time debug (safe to remove later)
console.log('[kpi] lastBuiltSnapshot.kpis.totalFunded =',
  window.lastBuiltSnapshot?.kpis?.totalFunded);

// Paint the three KPI tiles we already stored in SB
if (typeof updateKpiTile === 'function') {
  updateKpiTile('Avg APR (Funded)', `${Number(kpi.avg_apr_funded).toFixed(2)}%`);
  updateKpiTile('Avg Lender Fee % (Funded)', `${Number(kpi.avg_discount_pct_funded).toFixed(2)}%`);
  updateKpiTile('Avg LTV (Approved)', `${Number(kpi.avg_ltv_approved).toFixed(2)}%`);
}
}
}
} catch (e) {
console.warn('[monthly refresh] KPI reload failed:', e);
}
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
  const rows = snap.dealerRows || [];

  // Calculate Total Funded from actual database
let displayTotalFunded = snap.kpis?.totalFunded || 0;
if (window.sb && snap.year && snap.month) {
  console.log('[KPI Debug] Fetching total funded for', snap.year, snap.month);
  console.log('[KPI Debug] snap object:', snap);
  const { data: monthData, error: monthErr } = await window.sb
    .from('monthly_snapshots')
    .select('funded_amount')
    .eq('year', snap.year)
    .eq('month', snap.month);
  
    if (!monthErr && monthData) {
      console.log('[KPI Debug] Query returned', monthData.length, 'rows');
      console.log('[KPI Debug] First 5 rows:', monthData.slice(0, 5));
      displayTotalFunded = monthData.reduce((sum, row) => sum + (Number(row.funded_amount) || 0), 0);
      console.log('[KPI Debug] Calculated total:', displayTotalFunded);
    snap.kpis.totalFunded = displayTotalFunded;
  }
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
let avgAPRFunded =
aprFundedArr.length
  ? aprFundedArr.reduce((a,b)=>a+b,0) / aprFundedArr.length
  : null;

// --- Use persisted KPIs from Supabase if present (monthly_kpis) ---
if (snap && snap.kpis) {
if (snap.kpis.avgAPRFunded != null) {
  avgAPRFunded = Number(snap.kpis.avgAPRFunded);
}
// Map avgDiscountPctFunded -> avgDiscountPct so the tile can see it
if (snap.kpis.avgDiscountPctFunded != null && snap.kpis.avgDiscountPct == null) {
  snap.kpis.avgDiscountPct = Number(snap.kpis.avgDiscountPctFunded);
}
}
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
 const s = snap || window.lastBuiltSnapshot || {};
 detailResults.innerHTML = `
   <!-- KPI tiles -->
   <!-- KPI tiles (organized) -->

   <!-- KPI Tiles (Fixed Layout) -->
   <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
   
     <!-- 1) Primary highlight: Total Funded (spans 2 columns) -->
     <div class="rounded-xl border p-4 bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200 shadow-sm col-span-2">
       <div class="text-xs font-medium text-emerald-700">Total Funded (This Month)</div>
       <div class="text-3xl font-extrabold tabular-nums text-emerald-900">
         ${formatMoney(Number.isFinite(snap?.kpis?.totalFunded) ? snap.kpis.totalFunded : 0)}
       </div>
     </div>
   
     <!-- 2) Volume tiles (each takes 1 column) -->
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Total Apps</div>
       <div class="text-2xl font-semibold tabular-nums">${total}</div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Funded</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${funded} <span class="text-sm text-gray-500">(${formatPct(total ? funded / total : 0)})</span>
       </div>
     </div>
   
     <!-- 3) Rest of the tiles... -->
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Approved</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${approved} <span class="text-sm text-gray-500">(${formatPct(total ? approved / total : 0)})</span>
       </div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Counter</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${counter} <span class="text-sm text-gray-500">(${formatPct(total ? counter / total : 0)})</span>
       </div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Pending</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${pending} <span class="text-sm text-gray-500">(${formatPct(total ? pending / total : 0)})</span>
       </div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Denial</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${denial} <span class="text-sm text-gray-500">(${formatPct(total ? denial / total : 0)})</span>
       </div>
     </div>
   
     <!-- 4) Ratios & quality metrics -->
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">LTA</div>
       <div class="text-2xl font-semibold tabular-nums">${formatPct(LTA)}</div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">LTB</div>
       <div class="text-2xl font-semibold tabular-nums">${formatPct(LTB)}</div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Avg LTV (Approved)</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${avgLTVApproved == null ? '—' : (avgLTVApproved.toFixed(2) + '%')}
       </div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Avg APR (Funded)</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${(() => {
           const v = snap?.kpis?.avgAPRFunded ?? snap?.kpis?.avgAPR;
           return Number.isFinite(v) ? v.toFixed(2) + '%' : '—';
         })()}
       </div>
     </div>
   
     <div class="rounded-xl border p-3 bg-white">
       <div class="text-xs text-gray-500">Avg Lender Fee (Funded)</div>
       <div class="text-2xl font-semibold tabular-nums">
         ${(() => {
           const v = snap?.kpis?.avgDiscountPctFunded ?? snap?.kpis?.avgDiscountPct;
           return Number.isFinite(v) ? v.toFixed(2) + '%' : '—';
         })()}
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
           <th class="px-3 py-2 sortable cursor-pointer" data-key="dealer">Dealer <span class="dir">↕</span></th>
           <th class="px-3 py-2 sortable cursor-pointer" data-key="state">State <span class="dir">↕</span></th>
           <th class="px-3 py-2 sortable cursor-pointer" data-key="fi">FI <span class="dir">↕</span></th>
           <th class="px-3 py-2 text-right sortable cursor-pointer" data-key="total">Total Apps <span class="dir">↕</span></th>
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
 // Ensure FI counts exist even if the SB-loaded snapshot didn't include them
if ((!snap.fiRows || !snap.fiRows.length) && Array.isArray(snap.dealerRows)) {
  const fiMap = new Map();
  const normFI = (t) => String(t || '').trim().toLowerCase() === 'franchise' ? 'Franchise' : 'Independent';
  snap.dealerRows.forEach(r => {
    const t = normFI(r.fi);
    const cur = fiMap.get(t) || { type: t, total: 0, approved: 0, counter: 0, pending: 0, denial: 0, funded: 0 };
    cur.total    += Number(r.total)    || 0;
    cur.approved += Number(r.approved) || 0;
    cur.counter  += Number(r.counter)  || 0;
    cur.pending  += Number(r.pending)  || 0;
    cur.denial   += Number(r.denial)   || 0;
    cur.funded   += Number(r.funded)   || 0;
    fiMap.set(t, cur);
  });
  snap.fiRows = Array.from(fiMap.values());
}

paintMonthlyFI(snap);
paintMonthlyHighValues(snap);
// -- Wire Monthly tab action buttons --
const delMo = document.getElementById('btnDeleteMonthMonthly');
if (delMo) delMo.disabled = false; // enable it in Monthly tab

const expAll = document.getElementById('detailExportAll');
if (expAll) {
  expAll.addEventListener('click', () => {
    const rows = Array.isArray(snap.dealerRows) ? snap.dealerRows : [];
    if (!rows.length) { alert('No dealer rows to export.'); return; }
    downloadCSV(rows, 'monthly_dealers_all.csv');
  });
}

const expFunded = document.getElementById('detailExportFunded');
if (expFunded) {
  expFunded.addEventListener('click', () => {
    const rows = (snap.dealerRows || []).filter(r =>
      (Number(r.funded) || 0) > 0 || (Number(r.fundedAmt) || 0) > 0
    );
    if (!rows.length) { alert('No funded dealers found for this month.'); return; }
    downloadCSV(rows, 'monthly_dealers_funded.csv');
  });
}

 // ===== Dealer render/search/sort (no template nesting hazards) =====
 const body = $('#mdDealerBody');
 const head = $('#mdDealerHead');
 const searchEl = $('#mdDealerSearch');

// Build a quick 'funded dollars by dealer|state|fi' lookup
const pickStr = (obj, names) => {
  for (const n of names) {
    if (obj && obj[n] != null && String(obj[n]).trim() !== '') {
      return String(obj[n]).trim();
    }
  }
  return '';
};

const pickNum = (obj, names) => {
  for (const n of names) {
    const raw = obj?.[n];
    if (raw == null || raw === '') continue;
    const v = Number(String(raw).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) return v;
  }
  return NaN;
};

const amtByDealer = new Map();

// helper to normalize FI exactly like elsewhere
const fiNormalize = (typeof normFI === 'function')
  ? normFI
  : (t) => (String(t || '').trim().toLowerCase() === 'franchise' ? 'Franchise' : 'Independent');

(snap.fundedRawRows || []).forEach(r => {
  // read dealer / state from any header variant
  const dealer = pickStr(r, ['Dealer', 'Dealer Name', 'dealer']);
  const state  = pickStr(r, ['State', 'state']);
  const fiSafe = fiNormalize(r.FI ?? r.fi);

  // read the dollar amount from common headers
  const amount = pickNum(r, [
    'Loan Amount',
    'fundedAmount',
    'Funded $',
    'Amount Financed',
    'Amount',
    'Loan',
    'loan',
  ]);
  if (!Number.isFinite(amount) || amount <= 0) return;

  const kFull = dealerKey(dealer, state, fiSafe); // dealer|STATE|FI
  const prev = Number(amtByDealer.get(kFull) || 0);
  amtByDealer.set(kFull, prev + amount);
});

// (optional) keep the debug — confirms keys look right and count matches funded rows
console.log('[funded map] size=', amtByDealer.size,
            'sample=', Array.from(amtByDealer.entries()).slice(0, 5));

// helper — format numbers as USD currency

function renderDealerRows() {
  if (!body) { console.warn('[dealer] tbody not found'); return; }
  console.log('[dealer] start', { mdSearch });

  // 1) copy source defensively
  let arr =
    Array.isArray(snap.dealerRows) ? snap.dealerRows.slice()
  : Array.isArray(snap.dealers)    ? snap.dealers.slice()
  : [];

  // 2) normalize numbers and compute ratios (use precomputed if present)
  arr = arr.map(r => {
    const total     = Number(r.total)    || 0;
    const funded    = Number(r.funded)   || 0;
    const approved  = Number(r.approved) || 0;
    const counter   = Number(r.counter)  || 0;

    const ltb = Number.isFinite(r.ltb) ? Number(r.ltb) : (total ? funded / total : 0);
    const lta = Number.isFinite(r.lta) ? Number(r.lta) : (total ? (approved + counter) / total : 0);

  // funded $ lookup key (normalized FI to match Step 1)
const fiKey = (typeof normFI === 'function')
? normFI(r.fi)
: String(r.fi ?? '').trim();

// funded $ lookup key(s): try dealer|state|fi, then fall back to dealer|state
const kFull  = dealerKey(r.dealer, r.state, fiKey);  // dealer|STATE|fi (normalized)
const kNoFi  = dealerKey(r.dealer, r.state);         // dealer|STATE (fallback)
const fundedAmt = Number(r.funded_amount ?? amtByDealer.get(kFull) ?? amtByDealer.get(kNoFi) ?? 0);

// expose normalized fields used by table render/sort
return { ...r, ltb, lta, fundedAmt };
  });

  // 3) search by dealer
  const q = (mdSearch || '').trim().toLowerCase();
  if (q) arr = arr.filter(r => String(r.dealer||'').toLowerCase().includes(q));

  // 4) sort
  const { key, dir } = mdSort;
  arr.sort((a, b) => {
    const pick = (row) =>
      key === 'ltb'       ? (Number(row.ltb)       || 0) :
      key === 'lta'       ? (Number(row.lta)       || 0) :
      key === 'fundedAmt' ? (Number(row.fundedAmt) || 0) :
                            (row[key] ?? 0);

    const aVal = pick(a);
    const bVal = pick(b);

    if (typeof aVal === 'string' || typeof bVal === 'string') {
      return dir === 'asc' ? String(aVal).localeCompare(String(bVal))
                           : String(bVal).localeCompare(String(aVal));
    }
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // 5) mark active header
  head?.querySelectorAll('.sortable').forEach(th => {
    const k = th.getAttribute('data-key');
    const active = (k === key);
    const mark = document.createElement('span');
    mark.className = 'dir';
    mark.textContent = active ? (dir === 'asc' ? '↑' : '↓') : '↕';
    const old = th.querySelector('.dir');
    if (old) old.replaceWith(mark); else th.appendChild(mark);
  });
// Center the LTA / LTB headers so they align with the values
head?.querySelectorAll('th[data-key="lta"], th[data-key="ltb"]').forEach(th => {
  th.classList.remove('text-left', 'text-right');
  th.classList.add('text-center');
});

  // 6) rows (numeric right-aligned; show LTA/LTB as % + tiny bar)
  const pctBar = v => {
    const w = Math.max(0, Math.min(1, Number(v || 0)));
    return `<span class="inline-block h-1.5 rounded bg-slate-200 align-middle">
              <span class="inline-block h-1.5 rounded bg-blue-500" style="width:${(w*100).toFixed(0)}%"></span>
            </span>`;
  };
  const stateChip = s => s || '';
  const fiChip = s => s || '';

  body.innerHTML = arr.map(r => {
    const lta = Number(r.lta) || 0;
    const ltb = Number(r.ltb) || 0;
    const fundedAmount = Number(r.fundedAmt) || 0;

    return `
      <tr class="border-t odd:bg-gray-50/40">
        <td class="px-3 py-2">${r.dealer ?? ''}</td>
        <td class="px-3 py-2">${stateChip(r.state)}</td>
        <td class="px-3 py-2">${fiChip(r.fi)}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.total ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.approved ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.counter ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.pending ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.denial ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${r.funded ?? 0}</td>
        <td class="px-3 py-2 tabular-nums text-right">${formatMoney(fundedAmount)}</td>
        <td class="px-3 py-2 tabular-nums text-right">
          ${(lta*100).toFixed(2)}%
          <span class="inline-block w-20 align-middle">${pctBar(lta)}</span>
        </td>
        <td class="px-3 py-2 tabular-nums text-right">
          ${(ltb*100).toFixed(2)}%
          <span class="inline-block w-20 align-middle">${pctBar(ltb)}</span>
        </td>
      </tr>`;
  }).join('') || '<tr><td class="px-3 py-6 text-gray-500" colspan="12">No data.</td></tr>';
}

// Make renderDealerRows globally accessible for event handlers
window.renderDealerRows = renderDealerRows;

// events (keep as you already had)
searchEl?.addEventListener('input', (e) => {
  mdSearch = e.target.value || '';
  window.renderDealerRows();
});
document.getElementById('btnExportDealers')?.addEventListener('click', exportDealersCSV);
// Remove old listeners by cloning
const newHead = head.cloneNode(true);
head.parentNode.replaceChild(newHead, head);
const freshHead = $('#mdDealerHead');

freshHead?.querySelectorAll('.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.getAttribute('data-key');
    if (!k) return;
    // Toggle: if same column, flip direction; if new column, start with asc
    if (mdSort.key === k) {
      mdSort = { key: k, dir: (mdSort.dir === 'asc') ? 'desc' : 'asc' };
    } else {
      mdSort = { key: k, dir: 'asc' };
    }
    window.renderDealerRows();
  });
});
window.renderDealerRows();

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
}  // closes the block that begins near line 2559


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
  .from('monthly_summary_view')
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
  const totalAppsSeries = [];
  const approvedSeries = [];

  if (tbody) {
    tbody.innerHTML = '';
    list.forEach(s => {
      const approvedVal = (s.totals.approved || 0) + (s.totals.counter || 0);
const lta = s.totals.totalApps ? approvedVal / s.totals.totalApps : 0;
      const ltb = s.totals.totalApps ? s.totals.funded  / s.totals.totalApps : 0;
      labels.push(`${monthName(s.month)} ${s.year}`);
      fundedSeries.push(s.totals.funded || 0);
      amountSeries.push(s.kpis.totalFunded || 0);
      totalAppsSeries.push(s.totals.totalApps || 0);
      approvedSeries.push(approvedVal);
      tbody.insertAdjacentHTML('beforeend', `
      <tr class="border-t odd:bg-gray-50/40">
        <td class="px-3 py-2">${monthName(s.month)} ${s.year}</td>
        <td class="px-3 py-2 tabular-nums">${s.totals.totalApps}</td>
        <td class="px-3 py-2 tabular-nums">${(s.totals.approved || 0) + (s.totals.counter || 0)}</td>
        <td class="px-3 py-2 tabular-nums">${s.totals.funded}</td>
        <td class="px-3 py-2 tabular-nums">${formatMoney(s.kpis.totalFunded)}</td>
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
      </tr>
    `);
    });
  }

 // Line chart with toggle (Deals vs Amount vs Total Apps vs Approved)
const ctx = $('#yrFundedChart');
let yrChartMetric = 'deals';

function drawYrChart() {
  if (!ctx) return;
  if (yrChart) { try { yrChart.destroy(); } catch {} }
  
  const isAmount = (yrChartMetric === 'amount');
  const isTotalApps = (yrChartMetric === 'totalapps');
  const isApproved = (yrChartMetric === 'approved');
  
  let chartData, chartLabel;
  
  if (isAmount) {
    chartData = amountSeries;
    chartLabel = 'Total Funded ($)';
  } else if (isTotalApps) {
    chartData = totalAppsSeries;
    chartLabel = 'Total Apps';
  } else if (isApproved) {
    chartData = approvedSeries;
    chartLabel = 'Total Approved';
  } else {
    chartData = fundedSeries;
    chartLabel = 'Funded (count)';
  }

  yrChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: chartLabel,
        data: chartData,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      layout: {
        padding: {
          top: 25,
          right: 25,
          bottom: 10,
          left: 10
        }
      },
      plugins: { 
        legend: { display: false },
        datalabels: {
          display: true,
          align: 'top',
          anchor: 'end',
          offset: 8,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          borderRadius: 3,
          padding: 4,
          font: {
            size: 11,
            weight: 'bold'
          },
          formatter: (value) => {
            if (isAmount) {
              return '$' + Number(value).toLocaleString(undefined, {maximumFractionDigits: 0});
            }
            return value;
          }
        }
      },
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

// Dropdown to switch metric
const metricSelect = document.getElementById('yrChartMetric');

function setActive(which) {
  yrChartMetric = which;
  if (metricSelect) metricSelect.value = which;
  drawYrChart();
}

// If dropdown doesn't exist, create it programmatically
if (!metricSelect) {
  // Try to find the button container and replace with dropdown
  const btnDeals = document.getElementById('yrChartDeals');
  const btnAmount = document.getElementById('yrChartAmount');
  
  if (btnDeals && btnAmount) {
    const container = btnDeals.parentElement;
    const select = document.createElement('select');
    select.id = 'yrChartMetric';
    select.className = 'px-3 py-1.5 text-sm border rounded';
    select.innerHTML = `
      <option value="deals">Funded (count)</option>
      <option value="amount">Funded ($)</option>
      <option value="totalapps">Total Apps</option>
      <option value="approved">Total Approved</option>
    `;
    select.value = 'deals';
    select.addEventListener('change', (e) => setActive(e.target.value));
    
    // Replace buttons with dropdown
    btnDeals.replaceWith(select);
    btnAmount.remove();
  }
} else {
  // Dropdown exists, just add event listener
  metricSelect.addEventListener('change', (e) => setActive(e.target.value));
}

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
    const currentHead = document.getElementById('yrDealerHead') || document.getElementById('mdDealerHead');
    if (!currentHead) return;
    currentHead.querySelectorAll('th.sortable').forEach((th) => {
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
    // Clone and replace the header to remove all old event listeners
    const newHead = dHead.cloneNode(true);
    dHead.parentNode.replaceChild(newHead, dHead);
    const freshHead = document.getElementById(dHead.id);
    
    if (freshHead) {
      freshHead.querySelectorAll('th.sortable').forEach((th) => {
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

  // Month labels from actual data (only months that exist)
  window.spMonths = list.map(s => [`${s.year}-${String(s.month).padStart(2,'0')}`, monthName(s.month)]);

    // Sorted list of state codes
    const states = stateYTD.map(s => s.state || '??').sort();
    window.spStates = states;

// Build the series map: state -> [{ total, approved, funded, amount, ltb } per month]
const seriesMap = new Map();
stateYTD.forEach(s => {
  // Only include months that have data (use spMonths which we already filtered)
  const series = window.spMonths.map((monthInfo, idx) => {
    const monthNum = parseInt(monthInfo[0].split('-')[1], 10); // Extract month number from 'YYYY-MM'
    const mIdx = monthNum - 1; // Convert to 0-indexed
    const cell = s.months[mIdx] || {};
    const total    = Number(cell.total)        || 0;
    const approved = (Number(cell.approved)    || 0) + (Number(cell.counter) || 0);
    const funded   = Number(cell.funded)       || 0;
    const amount   = Number(cell.fundedAmount) || 0;
    const ltb      = total ? funded / total    : 0;
    return { total, approved, funded, amount, ltb };
  });
  seriesMap.set(s.state || '??', series);
});

    // Expose to the existing renderers (matrix / trends / sparklines)
    window.spData = seriesMap;
    // Re-render state performance now that data is ready
   // Re-render state performance now that data is ready
    // Call the render functions directly (they're defined below)
    setTimeout(() => {
      try {
        spRenderMatrix();
        spRenderTrends();
        spRenderSpark();
      } catch (e) {
        console.error('[yearly/state] render error:', e);
      }
    }, 200);  // Increased timeout to ensure functions are defined
  })().catch(console.error);
} else {
  // Fallback: derive from in-memory list (unchanged)
  spBuildData(list);
}


const mSel = $('#spMetric'); const nSel = $('#spTopN');

// Add "Total Apps" option if it doesn't exist
if (mSel) {
  const hasTotal = Array.from(mSel.options).some(opt => opt.value === 'total');
  if (!hasTotal) {
    const option = document.createElement('option');
    option.value = 'total';
    option.textContent = 'Total Apps';
    mSel.appendChild(option);
  }
}

if (mSel && !mSel.value) mSel.value = 'funded';
if (nSel && !nSel.value) nSel.value = '10';
spShow('matrix');


$('#spMetric')?.addEventListener('change', spRenderAll);
$('#spTopN')?.addEventListener('change', spRenderAll);
$('#spViewMatrix')?.addEventListener('click', () => spShow('matrix'));
$('#spViewTrends')?.addEventListener('click', () => spShow('trends'));
$('#spViewSpark')?.addEventListener('click', () => spShow('spark'));
// After all data loads, wait a bit then render State Performance
setTimeout(() => {
  if (window.spData && window.spData.size > 0) {
    spRenderMatrix();
    spRenderTrends();
    spRenderSpark();
  }
}, 500);
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
  ${window.spMonths.map(m=>`<th class="px-3 py-2 text-right tabular-nums">${m[1]}</th>`).join('')}
  <th class="px-3 py-2 text-right tabular-nums">YTD</th>
  </tr>`;

  // rows
  const rows = window.spStates.map(st => {
    const series = window.spData.get(st) || [];
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
  const rows = window.spStates.map(st => {
    const series = window.spData.get(st) || [];
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
  // Render the trends chart
  const canvas = $('#spTrendsCanvas');
  if (canvas && typeof Chart !== 'undefined') {
    if (window.spTrendsChart) {
      try { window.spTrendsChart.destroy(); } catch {}
    }
    
    const datasets = rows.map((r, idx) => {
      const series = window.spData.get(r.st) || [];
      const vals = series.map(p => p[metric] || 0);
      return {
        label: r.st,
        data: vals,
        tension: 0.2,
        borderWidth: 2
      };
    });
    
    window.spTrendsChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: window.spMonths.map(m => m[1]),
        datasets: datasets
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: 'bottom' } }
      }
    });
  }
}

function spRenderSpark() {
  const grid = $('#spSparkGrid');
  if (!grid) return;
  // destroy old tiny charts if any
  spSparkCharts.forEach(c => { try { c.destroy(); } catch{} });
  spSparkCharts = [];

  const metric = ($('#spMetric')?.value)||'funded';
  const topN   = parseInt(($('#spTopN')?.value)||'10',10);
  const rows = window.spStates.map(st => {
    const series = window.spData.get(st) || [];
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
      data: { labels: window.spMonths.map(m=>m[1]), datasets: [{ data: r.vals, tension: 0.2 }] },
      options: { plugins:{ legend:{display:false}, datalabels:{display:false} }, scales:{ x:{display:false}, y:{display:false} } }
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
function updateKpiTile(label, value) {
  const tiles = document.querySelectorAll('.kpi-tile');
  for (const tile of tiles) {
    const title = tile.querySelector('.kpi-title')?.textContent?.trim();
    if (title && title.includes(label)) {
      const val = tile.querySelector('.kpi-value');
      if (val) val.textContent = value;
    }
  }
}
/* ═══════════════════════════════════════════════════════════════════════════
 * BUYING DAILY MODULE  –  100 % self-contained, no Supabase dependency
 * ═══════════════════════════════════════════════════════════════════════════ */
// ═══════════════════════════════════════════════════════════════════════════
// REP PERFORMANCE MODULE
// ═══════════════════════════════════════════════════════════════════════════
(function RepPerformanceModule() {
  'use strict';

  // ── STATE ──────────────────────────────────────────────────────────────────
  let rpData = {};           // { rep: { 'YYYY-MM': { apps, funded, fundedAmt, dealers:{} } } }
  let rpMasterDealers = [];  // cached master_dealers with rep assignments
  let rpCurrentRep = 'ALL';
  let rpCurrentMonth = null;
  let rpChart = null;
  let rpInitDone = false;

  // ── PUBLIC INIT (called from switchTab) ───────────────────────────────────
  window.initRepPerformance = async function () {
    if (rpInitDone) { await render(); return; }
    rpInitDone = true;

    // Wire event listeners
    const repSelect = document.getElementById('rpRepSelect');
    const monthSelect = document.getElementById('rpMonthSelect');

    if (repSelect) {
      repSelect.addEventListener('change', async function() {
        rpCurrentRep = repSelect.value;
        await render();
      });
    }

    if (monthSelect) {
      monthSelect.addEventListener('change', async function() {
        rpCurrentMonth = monthSelect.value;
        await render();
      });
    }

    // Load data and render
    await loadData();
    console.log('[RepPerformance] Module initialized.');
  };

  // ── LOAD DATA ──────────────────────────────────────────────────────────────
  async function loadData() {
    if (!window.sb) {
      console.warn('[RepPerformance] Supabase not available');
      return;
    }

    try {
      // 1) Load master_dealers to get rep assignments
      const { data: dealers, error: dealersError } = await window.sb
        .from('master_dealers')
        .select('dealer_name, rep, state, fi');

      if (dealersError) {
        console.error('[RepPerformance] Error loading dealers:', dealersError);
        return;
      }

      rpMasterDealers = dealers || [];

      // 2) Load monthly_snapshots to calculate metrics
      const { data: snapshots, error: snapshotsError } = await window.sb
        .from('monthly_snapshots')
        .select('year, month, dealer, state, fi, total_apps, funded, funded_amount');

      if (snapshotsError) {
        console.error('[RepPerformance] Error loading snapshots:', snapshotsError);
        return;
      }

      // 3) Build rpData by matching dealers to reps
      rpData = {};
      const dealerToRep = {};

      // Map dealer -> rep
      rpMasterDealers.forEach(function(d) {
        const key = window.dealerKey(d.dealer_name, d.state, d.fi);
        if (d.rep) dealerToRep[key] = d.rep.trim();
      });

      // Aggregate snapshots by rep and month
      (snapshots || []).forEach(function(snap) {
        const dealerKeyVal = window.dealerKey(snap.dealer, snap.state, snap.fi);
        const rep = dealerToRep[dealerKeyVal];
        if (!rep) return; // Skip dealers without rep assignment

        const monthKey = String(snap.year) + '-' + String(snap.month).padStart(2, '0');

        if (!rpData[rep]) rpData[rep] = {};
        if (!rpData[rep][monthKey]) {
          rpData[rep][monthKey] = { apps: 0, funded: 0, fundedAmt: 0, dealers: {} };
        }

        rpData[rep][monthKey].apps += Number(snap.total_apps) || 0;
        rpData[rep][monthKey].funded += Number(snap.funded) || 0;
        rpData[rep][monthKey].fundedAmt += Number(snap.funded_amount) || 0;

        // Track dealer-level data for detail table
        const dealerName = snap.dealer;
        if (!rpData[rep][monthKey].dealers[dealerName]) {
          rpData[rep][monthKey].dealers[dealerName] = {
            state: snap.state,
            apps: 0,
            funded: 0,
            fundedAmt: 0
          };
        }
        rpData[rep][monthKey].dealers[dealerName].apps += Number(snap.total_apps) || 0;
        rpData[rep][monthKey].dealers[dealerName].funded += Number(snap.funded) || 0;
        rpData[rep][monthKey].dealers[dealerName].fundedAmt += Number(snap.funded_amount) || 0;
      });

      // 4) Populate rep dropdown
      populateRepDropdown();

      // 5) Populate month dropdown
      populateMonthDropdown();

    } catch (e) {
      console.error('[RepPerformance] Load data failed:', e);
    }
  }

  // ── POPULATE DROPDOWNS ─────────────────────────────────────────────────────
  function populateRepDropdown() {
    const repSelect = document.getElementById('rpRepSelect');
    if (!repSelect) return;

    const reps = Object.keys(rpData).sort();
    repSelect.innerHTML = '<option value="ALL">All Reps (Comparison)</option>';
    reps.forEach(function(rep) {
      const opt = document.createElement('option');
      opt.value = rep;
      opt.textContent = rep;
      repSelect.appendChild(opt);
    });

    if (reps.length > 0 && !rpCurrentRep) rpCurrentRep = 'ALL';
  }

  function populateMonthDropdown() {
    const monthSelect = document.getElementById('rpMonthSelect');
    if (!monthSelect) return;

    // Collect all unique month keys across all reps
    const monthSet = new Set();
    Object.values(rpData).forEach(function(repMonths) {
      Object.keys(repMonths).forEach(function(m) { monthSet.add(m); });
    });

    const months = Array.from(monthSet).sort().reverse();
    monthSelect.innerHTML = '';
    months.forEach(function(m) {
      const opt = document.createElement('option');
      opt.value = m;
      const [y, mo] = m.split('-');
      const date = new Date(y, mo - 1);
      opt.textContent = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      monthSelect.appendChild(opt);
    });

    if (months.length > 0 && !rpCurrentMonth) {
      rpCurrentMonth = months[0];
      monthSelect.value = rpCurrentMonth;
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  async function render() {
    if (rpCurrentRep === 'ALL') {
      document.getElementById('rpSingleView').classList.add('hidden');
      document.getElementById('rpAllView').classList.remove('hidden');
      renderAllReps();
    } else {
      document.getElementById('rpSingleView').classList.remove('hidden');
      document.getElementById('rpAllView').classList.add('hidden');
      renderSingleRep();
    }
  }

  // ── RENDER SINGLE REP ──────────────────────────────────────────────────────
  function renderSingleRep() {
    const repMonths = rpData[rpCurrentRep] || {};
    const monthData = repMonths[rpCurrentMonth] || { apps: 0, funded: 0, fundedAmt: 0, dealers: {} };

    // Calculate YTD
    const [currentYear] = rpCurrentMonth ? rpCurrentMonth.split('-') : [new Date().getFullYear()];
    let ytdFunded = 0;
    Object.keys(repMonths).forEach(function(m) {
      const [y] = m.split('-');
      if (y === currentYear) ytdFunded += repMonths[m].fundedAmt;
    });

    // KPIs
    document.getElementById('rpKpiFundedYTD').textContent = formatMoney(ytdFunded);
    document.getElementById('rpKpiApps').textContent = monthData.apps.toLocaleString();
    document.getElementById('rpKpiFunded').textContent = monthData.funded.toLocaleString();
    document.getElementById('rpKpiFundedMonth').textContent = formatMoney(monthData.fundedAmt);
    document.getElementById('rpKpiDealers').textContent = Object.keys(monthData.dealers).length;
    
    const approvalRate = monthData.apps ? (monthData.funded / monthData.apps * 100).toFixed(1) : '0.0';
    document.getElementById('rpKpiApproval').textContent = approvalRate + '%';

    // Update labels
    const [y, m] = rpCurrentMonth ? rpCurrentMonth.split('-') : ['', ''];
    const monthName = m ? new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
    document.getElementById('rpKpiAppsSub').textContent = monthName;
    document.getElementById('rpKpiFundedSub').textContent = monthName;

    // Dealer table
    renderDealerTable(monthData.dealers);

    // Chart
    renderChart();
  }

  function renderDealerTable(dealers) {
    const tbody = document.getElementById('rpDealerTbody');
    if (!tbody) return;

    const dealerArray = Object.entries(dealers).map(([name, data]) => ({
      name,
      ...data
    })).sort((a, b) => b.fundedAmt - a.fundedAmt); // Sort by funded amount desc

    document.getElementById('rpDealerBadge').textContent = dealerArray.length + ' dealers';

    tbody.innerHTML = dealerArray.map(function(d) {
      const approvalRate = d.apps ? (d.funded / d.apps * 100).toFixed(1) : '0.0';
      return '<tr>' +
        '<td>' + d.name + '</td>' +
        '<td><span class="rp-state-badge">' + d.state + '</span></td>' +
        '<td class="rp-right rp-apps-val">' + d.apps.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + d.funded.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + formatMoney(d.fundedAmt) + '</td>' +
        '<td class="rp-right">' + approvalRate + '%</td>' +
      '</tr>';
    }).join('');
  }

  function renderChart() {
    const canvas = document.getElementById('rpTrendChart');
    if (!canvas) return;

    const repMonths = rpData[rpCurrentRep] || {};
    const allMonths = Object.keys(repMonths).sort();
    const last6 = allMonths.slice(-6);

    const labels = last6.map(function(m) {
      const [y, mo] = m.split('-');
      return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'short' });
    });

    const apps = last6.map(function(m) { return repMonths[m].apps; });
    const funded = last6.map(function(m) { return repMonths[m].funded; });
    const fundedAmt = last6.map(function(m) { return repMonths[m].fundedAmt / 1000; }); // in K

    if (rpChart) rpChart.destroy();

    const ctx = canvas.getContext('2d');
    rpChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Applications',
            data: apps,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Funded Deals',
            data: funded,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Funded $ (K)',
            data: fundedAmt,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, padding: 12 }
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Apps / Funded' },
            grid: { color: '#f1f5f9' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Funded $ (K)' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  // ── RENDER ALL REPS ────────────────────────────────────────────────────────
  function renderAllReps() {
    const monthData = rpCurrentMonth ? rpCurrentMonth.split('-')[1] : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('rpComparisonBadge').textContent = monthData;

    // Comparison table
    renderComparisonTable();

    // YTD table
    renderYTDTable();
  }

  function renderComparisonTable() {
    const tbody = document.getElementById('rpCompareTbody');
    if (!tbody) return;

    const reps = Object.keys(rpData).sort();
    tbody.innerHTML = reps.map(function(rep) {
      const monthData = rpData[rep][rpCurrentMonth] || { apps: 0, funded: 0, fundedAmt: 0, dealers: {} };
      const approvalRate = monthData.apps ? (monthData.funded / monthData.apps * 100).toFixed(1) : '0.0';
      
      // Get states for this rep
      const repDealers = rpMasterDealers.filter(function(d) { return d.rep === rep; });
      const states = [...new Set(repDealers.map(function(d) { return d.state; }))].sort();
      const stateBadges = states.map(function(s) {
        return '<span class="rp-state-badge">' + s + '</span>';
      }).join(' ');

      return '<tr>' +
        '<td>' + rep + '</td>' +
        '<td>' + stateBadges + '</td>' +
        '<td class="rp-right rp-apps-val">' + monthData.apps.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + monthData.funded.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + formatMoney(monthData.fundedAmt) + '</td>' +
        '<td class="rp-right">' + approvalRate + '%</td>' +
        '<td class="rp-right">' + Object.keys(monthData.dealers).length + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderYTDTable() {
    const tbody = document.getElementById('rpYTDTbody');
    if (!tbody) return;

    const [currentYear] = rpCurrentMonth ? rpCurrentMonth.split('-') : [new Date().getFullYear()];
    const reps = Object.keys(rpData).sort();

    tbody.innerHTML = reps.map(function(rep) {
      const repMonths = rpData[rep] || {};
      let ytdApps = 0, ytdFunded = 0, ytdFundedAmt = 0;

      Object.keys(repMonths).forEach(function(m) {
        const [y] = m.split('-');
        if (y === currentYear) {
          ytdApps += repMonths[m].apps;
          ytdFunded += repMonths[m].funded;
          ytdFundedAmt += repMonths[m].fundedAmt;
        }
      });

      const ytdApproval = ytdApps ? (ytdFunded / ytdApps * 100).toFixed(1) : '0.0';

      return '<tr>' +
        '<td>' + rep + '</td>' +
        '<td class="rp-right rp-apps-val">' + ytdApps.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + ytdFunded.toLocaleString() + '</td>' +
        '<td class="rp-right rp-funded-val">' + formatMoney(ytdFundedAmt) + '</td>' +
        '<td class="rp-right">' + ytdApproval + '%</td>' +
      '</tr>';
    }).join('');
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function formatMoney(val) {
    return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

})(); /* end RepPerformanceModule IIFE */

(function BuyingDailyModule() {
  'use strict';

  // ── CONFIG ─────────────────────────────────────────────────────────────────
  const STATUSES = ['Accepted','Approved','Counter','Denial','Duplicate','Funded','Pending Approval'];
  const STATUS_COLORS = {
    'Accepted':'#10b981', 'Approved':'#3b82f6', 'Counter':'#f59e0b',
    'Denial':'#ef4444',   'Duplicate':'#8b5cf6', 'Funded':'#06b6d4',
    'Pending Approval':'#f97316'
  };
  const STATUS_LIGHT = {
    'Accepted':'rgba(16,185,129,.18)',  'Approved':'rgba(59,130,246,.18)',
    'Counter':'rgba(245,158,11,.18)',   'Denial':'rgba(239,68,68,.18)',
    'Duplicate':'rgba(139,92,246,.18)', 'Funded':'rgba(6,182,212,.18)',
    'Pending Approval':'rgba(249,115,22,.18)'
  };
  // KPI element id ← status key mapping
  const KPI_MAP = {
    'Accepted':'Accepted', 'Approved':'Approved', 'Counter':'Counter',
    'Denial':'Denial',     'Duplicate':'Duplicate', 'Funded':'Funded',
    'Pending Approval':'Pending'
  };

  // ── STATE ──────────────────────────────────────────────────────────────────
  let bdData = {};             // { "MM/DD/YYYY": { "ALL": {...}, "IL": {...}, ... } }
  let bdStates = [];           // ["IL", "IN", "TX", ...] populated from CSV
  let bdCurrentState = 'ALL';  // currently selected state filter
  let bdCharts = {};           // chart.js instances keyed by canvas id
  let bdInitDone = false;      // guard: only wire events once

  // ── PUBLIC INIT (called from switchTab) ───────────────────────────────────
  window.initBuyingDaily = function () {
    if (bdInitDone) { render(); return; }
    bdInitDone = true;

    // Small delay so StackBlitz DOM is fully ready before we grab elements
    setTimeout(function() {
      var dateFrom  = document.getElementById('bdDateFrom');
      var dateTo    = document.getElementById('bdDateTo');
      var csvInput  = document.getElementById('bdCsvInput');
      var strip     = document.getElementById('bdUploadStrip');

      // Safety: if any element is still missing, log which one and bail
      var missing = [];
      if (!dateFrom)  missing.push('bdDateFrom');
      if (!dateTo)    missing.push('bdDateTo');
      if (!csvInput)  missing.push('bdCsvInput');
      if (!strip)     missing.push('bdUploadStrip');
      if (missing.length) {
        console.error('[BuyingDaily] Missing elements: ' + missing.join(', ') + ' — init aborted.');
        bdInitDone = false; // allow retry on next click
        return;
      }

      // view toggle buttons
      document.querySelectorAll('[data-bd-view]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('[data-bd-view]').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          showPanel(btn.dataset.bdView);
          render();
        });
      });

      // date range inputs
      dateFrom.addEventListener('change', render);
      dateTo.addEventListener('change', render);

      // state filter dropdown
      var stateFilter = document.getElementById('bdStateFilter');
      if (stateFilter) {
        stateFilter.addEventListener('change', function() {
          bdCurrentState = stateFilter.value;
          render();
        });
      }

      // file input
      csvInput.addEventListener('change', function(e) {
        if (e.target.files[0]) parseCSV(e.target.files[0]);
      });

      // drag & drop on upload strip
      strip.addEventListener('dragover',  function(e) { e.preventDefault(); strip.classList.add('dragover'); });
      strip.addEventListener('dragleave', function()  { strip.classList.remove('dragover'); });
      strip.addEventListener('drop', function(e) {
        e.preventDefault(); strip.classList.remove('dragover');
        if (e.dataTransfer.files[0]) parseCSV(e.dataTransfer.files[0]);
      });

      // ── Load persisted data from Supabase on first init ──
      (async function loadFromSupabase() {
        try {
          if (!window.sb) { console.warn('[BuyingDaily] Supabase client not ready.'); return; }
          const { data, error } = await window.sb
            .from('buying_daily_data')
            .select('data, file_name, total_rows, states')
            .eq('id', 1)
            .single();

          if (error) { console.warn('[BuyingDaily] Supabase fetch error:', error); return; }
          if (!data || !data.data) { console.log('[BuyingDaily] No saved data in Supabase yet.'); return; }

          bdData = data.data;
          bdStates = data.states || [];

          // restore state dropdown
          var stateFilter = document.getElementById('bdStateFilter');
          if (stateFilter && bdStates.length) {
            stateFilter.innerHTML = '<option value="ALL">All States</option>';
            bdStates.forEach(function(st) {
              var opt = document.createElement('option');
              opt.value = st;
              opt.textContent = st;
              stateFilter.appendChild(opt);
            });
          }

          // restore date range
          var isoKeys = Object.keys(bdData).map(function(d) { return toISO(d); }).sort();
          if (isoKeys.length) {
            dateFrom.value = isoKeys[0];
            dateTo.value   = isoKeys[isoKeys.length - 1];
          }

          // restore status badge
          var statusEl = document.getElementById('bdUploadStatus');
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = '✅ "' + (data.file_name || 'saved file') + '" loaded (' + Object.keys(bdData).length + ' days · ' + (data.total_rows || 0).toLocaleString() + ' applications)';
          }

          render();
          console.log('[BuyingDaily] Restored data from Supabase.');
        } catch(e) { console.warn('[BuyingDaily] Supabase load failed:', e); }
      })();

      console.log('[BuyingDaily] Module initialised successfully.');
    }, 150);
  };

  // ── CSV PARSING ────────────────────────────────────────────────────────────
  function parseCSV(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const newData = {};
        const stateSet = new Set();
        let totalRows = 0;

        // First pass: build state-aware data
        results.data.forEach(row => {
          const status = (row['Status Last'] || '').trim();
          const ts     = (row['Timestamp Submit'] || '').trim();
          const state  = (row['State'] || '').trim().toUpperCase();
          
          if (!status || !ts) return;

          const datePart = ts.split(' ')[0]; // "MM/DD/YYYY"
          
          // Initialize date if needed
          if (!newData[datePart]) {
            newData[datePart] = { ALL: {} };
            STATUSES.forEach(s => newData[datePart].ALL[s] = 0);
          }

          // Initialize state for this date if needed
          if (state && !newData[datePart][state]) {
            newData[datePart][state] = {};
            STATUSES.forEach(s => newData[datePart][state][s] = 0);
          }

          // Bucket status
          const key = STATUSES.includes(status) ? status : 'Pending Approval';
          
          // Increment ALL totals
          newData[datePart].ALL[key]++;
          
          // Increment state-specific totals
          if (state) {
            newData[datePart][state][key]++;
            stateSet.add(state);
          }

          totalRows++;
        });

        bdData = newData;
        bdStates = Array.from(stateSet).sort();

        // Populate state dropdown
        const stateFilter = document.getElementById('bdStateFilter');
        if (stateFilter) {
          stateFilter.innerHTML = '<option value="ALL">All States</option>';
          bdStates.forEach(function(st) {
            const opt = document.createElement('option');
            opt.value = st;
            opt.textContent = st;
            stateFilter.appendChild(opt);
          });
        }

        // persist to Supabase
        (async function saveToSupabase() {
          try {
            if (!window.sb) { console.warn('[BuyingDaily] Supabase client not ready for save.'); return; }
            const { error } = await window.sb
              .from('buying_daily_data')
              .upsert({
                id: 1,
                file_name: file.name,
                total_rows: totalRows,
                data: bdData,
                states: bdStates
              });
            if (error) { console.warn('[BuyingDaily] Supabase save error:', error); }
            else        { console.log('[BuyingDaily] Saved to Supabase successfully.'); }
          } catch(e) { console.warn('[BuyingDaily] Supabase save failed:', e); }
        })();

        // auto-set date range
        const isoKeys = Object.keys(bdData).map(d => toISO(d)).sort();
        if (isoKeys.length) {
          document.getElementById('bdDateFrom').value = isoKeys[0];
          document.getElementById('bdDateTo').value   = isoKeys[isoKeys.length - 1];
        }

        // update status badge
        const statusEl = document.getElementById('bdUploadStatus');
        statusEl.style.display = 'block';
        statusEl.textContent = '✅ "' + file.name + '" loaded (' + Object.keys(bdData).length + ' days · ' + totalRows.toLocaleString() + ' applications)';

        render();
      },
      error(err) { alert('Error parsing CSV:\n' + err.message); }
    });
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function toISO(mmddyyyy) {
    const p = mmddyyyy.split('/');
    return p[2] + '-' + p[0].padStart(2,'0') + '-' + p[1].padStart(2,'0');
  }
  function pct(val, total) { return total ? ((val / total) * 100).toFixed(1) : '0.0'; }
  function fmt(n) { return Number(n).toLocaleString(); }
  function totalOf(obj) { return STATUSES.reduce((s, k) => s + (obj[k] || 0), 0); }

  function getFilteredDates() {
    const from = document.getElementById('bdDateFrom').value;
    const to   = document.getElementById('bdDateTo').value;
    return Object.keys(bdData)
      .filter(d => { const iso = toISO(d); return iso >= from && iso <= to; })
      .sort((a, b) => toISO(a).localeCompare(toISO(b)));
  }

  function sumByStatus(dates) {
    const out = {}; STATUSES.forEach(s => out[s] = 0);
    dates.forEach(d => {
      const dayData = bdData[d] || {};
      const stateData = dayData[bdCurrentState] || {};
      STATUSES.forEach(s => out[s] += (stateData[s] || 0));
    });
    return out;
  }

  // ISO week key  e.g. "2026-W02"
  function getWeekKey(mmddyyyy) {
    const [m, d, y] = mmddyyyy.split('/').map(Number);
    const date  = new Date(y, m - 1, d);
    const jan1  = new Date(y, 0, 1);
    const dayN  = Math.ceil((date - jan1) / 86400000);
    const weekN = Math.ceil((dayN + jan1.getDay()) / 7);
    return y + '-W' + String(weekN).padStart(2, '0');
  }

  function getMonthKey(mmddyyyy) {
    const [m, , y] = mmddyyyy.split('/');
    return y + '-' + m;
  }

  function groupBy(fn) {
    const groups = {};
    getFilteredDates().forEach(d => {
      const key = fn(d);
      (groups[key] = groups[key] || []).push(d);
    });
    return groups;
  }

  // ── MASTER RENDER ──────────────────────────────────────────────────────────
  function render() {
    if (!Object.keys(bdData).length) return; // nothing uploaded yet

    const dates  = getFilteredDates();
    const totals = sumByStatus(dates);
    const grand  = totalOf(totals);

    // ── KPI tiles ──
    document.getElementById('bdKpiTotal').textContent    = fmt(grand);
    document.getElementById('bdKpiTotalSub').textContent = dates.length + ' day' + (dates.length !== 1 ? 's' : '') + ' selected';

    STATUSES.forEach(s => {
      const short = KPI_MAP[s];
      const elVal = document.getElementById('bdKpi' + short);
      const elPct = document.getElementById('bdKpi' + short + 'Pct');
      if (elVal) elVal.textContent = fmt(totals[s]);
      if (elPct) elPct.textContent = pct(totals[s], grand) + '%';
    });

    renderDaily(dates);
    renderWeekly();
    renderMonthly();
  }

  // ── DAILY VIEW ─────────────────────────────────────────────────────────────
  function renderDaily(dates) {
    document.getElementById('bdDailyBadge').textContent = dates.length + ' days';

    document.getElementById('bdDailyTbody').innerHTML = dates.map(d => {
      const day    = (bdData[d] || {})[bdCurrentState] || {};
      const total  = totalOf(day);
      const dRate  = total ? (day['Denial'] || 0) / total : 0;
      const dateObj = new Date(toISO(d) + 'T00:00:00');
      const label   = dateObj.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

      return '<tr>' +
        '<td>' + label + '</td>' +
        '<td class="bd-total-col">' + fmt(total) + '</td>' +
        STATUSES.map(s => {
          let cls = '';
          if (s === 'Denial') cls = ' class="bd-denial-val"';
          if (s === 'Funded') cls = ' class="bd-funded-val"';
          return '<td' + cls + '>' + fmt(day[s] || 0) + '</td>';
        }).join('') +
        '<td><div class="bd-mini-bar-wrap">' +
          '<div class="bd-mini-bar"><div class="bd-fill" style="width:' + (dRate*100).toFixed(1) + '%;"></div></div>' +
          '<span style="font-size:.78rem;color:#ef4444;font-weight:600;">' + (dRate*100).toFixed(1) + '%</span>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  // ── WEEKLY VIEW ────────────────────────────────────────────────────────────
  function renderWeekly() {
    const groups = groupBy(getWeekKey);
    const keys   = Object.keys(groups).sort();
    const rows   = keys.map(k => ({ key: k, totals: sumByStatus(groups[k]) }));

    renderComparison('bdWeeklyCompare', rows, 'Week');
    buildBarChart('bdWeeklyChart', rows.map(r => r.key), rows);

    // summary table
    document.getElementById('bdWeeklyTbody').innerHTML = rows.map((r, i) => {
      const total     = totalOf(r.totals);
      const prevTotal = i > 0 ? totalOf(rows[i-1].totals) : null;
      const chg       = prevTotal ? ((total - prevTotal) / prevTotal * 100).toFixed(1) : null;

      return '<tr>' +
        '<td>' + r.key + '</td>' +
        '<td class="bd-total-col">' + fmt(total) + '</td>' +
        STATUSES.map(s => '<td>' + fmt(r.totals[s]) + '</td>').join('') +
        '<td>' + (chg !== null ? changeTag(chg) : '<span style="color:#94a3b8;font-size:.78rem;">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── MONTHLY VIEW ───────────────────────────────────────────────────────────
  function renderMonthly() {
    const groups = groupBy(getMonthKey);
    const keys   = Object.keys(groups).sort();
    const rows   = keys.map(k => ({ key: k, totals: sumByStatus(groups[k]) }));

    // pretty month labels for chart
    const monthLabels = rows.map(r => {
      const [y, m] = r.key.split('-');
      return new Date(y, m - 1).toLocaleString('en-US', { month:'long', year:'numeric' });
    });

    renderComparison('bdMonthlyCompare', rows, 'Month');
    buildBarChart('bdMonthlyChart', monthLabels, rows);

    // summary table
    document.getElementById('bdMonthlyTbody').innerHTML = rows.map((r, i) => {
      const total     = totalOf(r.totals);
      const prevTotal = i > 0 ? totalOf(rows[i-1].totals) : null;
      const chg       = prevTotal ? ((total - prevTotal) / prevTotal * 100).toFixed(1) : null;
      const [y, m]    = r.key.split('-');
      const label     = new Date(y, m - 1).toLocaleString('en-US', { month:'long', year:'numeric' });

      return '<tr>' +
        '<td>' + label + '</td>' +
        '<td class="bd-total-col">' + fmt(total) + '</td>' +
        STATUSES.map(s => '<td>' + fmt(r.totals[s]) + '</td>').join('') +
        '<td>' + (chg !== null ? changeTag(chg) : '<span style="color:#94a3b8;font-size:.78rem;">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── BAR CHART BUILDER ──────────────────────────────────────────────────────
  function buildBarChart(canvasId, labels, rows) {
    // destroy existing
    if (bdCharts[canvasId]) { bdCharts[canvasId].destroy(); delete bdCharts[canvasId]; }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    bdCharts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: STATUSES.map(s => ({
          label: s,
          data: rows.map(r => r.totals[s]),
          backgroundColor: STATUS_LIGHT[s],
          borderColor: STATUS_COLORS[s],
          borderWidth: 2,
          borderRadius: 4
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 12 } }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12 } } },
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 } } }
        }
      }
    });
  }

  // ── COMPARISON CARDS ───────────────────────────────────────────────────────
  function renderComparison(containerId, rows, label) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (rows.length < 2) { el.innerHTML = ''; return; }

    const curr = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    const cT   = totalOf(curr.totals);
    const pT   = totalOf(prev.totals);

    // Left card: raw totals with change badges
    const totalRows = [
      ['Total Apps',  cT,                          pT,                          ''],
      ['Denial',      curr.totals['Denial'],       prev.totals['Denial'],       '#ef4444'],
      ['Funded',      curr.totals['Funded'],       prev.totals['Funded'],       '#06b6d4'],
      ['Approved',    curr.totals['Approved'],     prev.totals['Approved'],     '#3b82f6']
    ];

    let leftHTML = '<div class="bd-compare-card"><h4>📊 ' + label + ' vs Previous – Totals</h4>';
    totalRows.forEach(function(item) {
      const name = item[0], c = item[1], p = item[2], color = item[3];
      const chg = p ? ((c - p) / p * 100).toFixed(1) : null;
      leftHTML +=
        '<div class="bd-comp-row">' +
          '<span class="bd-comp-label">' +
            (color ? '<span class="bd-comp-dot" style="background:' + color + '"></span>' : '') +
            name +
          '</span>' +
          '<span><span class="bd-comp-val">' + fmt(c) + '</span>' +
            (chg !== null ? changeTag(chg) : '') +
          '</span>' +
        '</div>';
    });
    leftHTML += '</div>';

    // Right card: rates
    const rateRows = [
      ['Denial Rate',    curr.totals['Denial'],           cT, prev.totals['Denial'],           pT, true],
      ['Approval Rate',  curr.totals['Approved'],         cT, prev.totals['Approved'],         pT, false],
      ['Funded Rate',    curr.totals['Funded'],           cT, prev.totals['Funded'],           pT, false],
      ['Pending Rate',   curr.totals['Pending Approval'], cT, prev.totals['Pending Approval'], pT, true]
    ];

    let rightHTML = '<div class="bd-compare-card"><h4>📈 ' + label + ' vs Previous – Rates</h4>';
    rateRows.forEach(function(item) {
      const name = item[0];
      const cRate = item[2] ? (item[1] / item[2] * 100).toFixed(1) : '0.0';
      const pRate = item[4] ? (item[3] / item[4] * 100).toFixed(1) : '0.0';
      const diff  = (parseFloat(cRate) - parseFloat(pRate)).toFixed(1);
      const isBad = item[5]; // true = higher is worse (denial, pending)
      let cls = 'neutral';
      if (parseFloat(diff) > 0)  cls = isBad ? 'down' : 'up';
      if (parseFloat(diff) < 0)  cls = isBad ? 'up'   : 'down';

      rightHTML +=
        '<div class="bd-comp-row">' +
          '<span class="bd-comp-label">' + name + '</span>' +
          '<span>' +
            '<span class="bd-comp-val">' + cRate + '%</span> ' +
            '<span class="bd-comp-change ' + cls + '">' + (parseFloat(diff) > 0 ? '+' : '') + diff + '%</span>' +
          '</span>' +
        '</div>';
    });
    rightHTML += '</div>';

    el.innerHTML = leftHTML + rightHTML;
  }

  // ── CHANGE TAG HELPER ──────────────────────────────────────────────────────
  function changeTag(chg) {
    const cls = Number(chg) > 0 ? 'up' : Number(chg) < 0 ? 'down' : 'neutral';
    return '<span class="bd-comp-change ' + cls + '">' + (Number(chg) > 0 ? '+' : '') + chg + '%</span>';
  }

  // ── VIEW SWITCHER ──────────────────────────────────────────────────────────
  function showPanel(view) {
    ['daily','weekly','monthly'].forEach(function(v) {
      const el = document.getElementById('bd-panel-' + v);
      if (el) el.classList.toggle('active', v === view);
    });
  }

})(); /* end BuyingDailyModule IIFE */