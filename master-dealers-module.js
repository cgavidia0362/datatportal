/* ============================================================================
   MASTER DEALERS & UPLOAD VALIDATION MODULE
   Add this to your existing app.js file
   ============================================================================ */

// ============================================
// GLOBAL STATE
// ============================================
window.uploadReviewData = {
  mismatches: [],
  newDealers: [],
  orphanFunded: [],
  pendingSnapshot: null,
  pendingFundedRows: null
};

window.currentMasterDealers = [];

// ============================================
// MASTER DEALERS DATABASE FUNCTIONS
// ============================================

async function fetchMasterDealers() {
  if (!window.sb) return [];
  try {
    const { data, error } = await window.sb
      .from('master_dealers')
      .select('*')
      .order('dealer_name');
    
    if (error) {
      console.error('[master] fetch error:', error);
      return [];
    }
    window.currentMasterDealers = data || [];
    return window.currentMasterDealers;
  } catch (e) {
    console.error('[master] fetch exception:', e);
    return [];
  }
}

async function addMasterDealer(name, state, fi) {
  if (!window.sb) return { success: false, error: 'No database connection' };
  
  try {
    const { data, error } = await window.sb
      .from('master_dealers')
      .insert([{
        dealer_name: name.trim(),
        state: state.trim().toUpperCase(),
        fi: fi.trim()
      }])
      .select();
    
    if (error) {
      console.error('[master] add error:', error);
      return { success: false, error: error.message };
    }
    return { success: true, data: data[0] };
  } catch (e) {
    console.error('[master] add exception:', e);
    return { success: false, error: e.message };
  }
}

async function updateMasterDealer(id, name, state, fi) {
  if (!window.sb) return { success: false, error: 'No database connection' };
  
  try {
    const { data, error } = await window.sb
      .from('master_dealers')
      .update({
        dealer_name: name.trim(),
        state: state.trim().toUpperCase(),
        fi: fi.trim()
      })
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('[master] update error:', error);
      return { success: false, error: error.message };
    }
    return { success: true, data: data[0] };
  } catch (e) {
    console.error('[master] update exception:', e);
    return { success: false, error: e.message };
  }
}

async function deleteMasterDealer(id) {
  if (!window.sb) return { success: false, error: 'No database connection' };
  
  try {
    const { error } = await window.sb
      .from('master_dealers')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('[master] delete error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    console.error('[master] delete exception:', e);
    return { success: false, error: e.message };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function normalizeDealerName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function findMasterDealer(dealerName, masterList) {
  const normalized = normalizeDealerName(dealerName);
  return masterList.find(m => normalizeDealerName(m.dealer_name) === normalized);
}

// ============================================
// UPLOAD VALIDATION
// ============================================

async function validateSnapshot(snap) {
  const masterList = await fetchMasterDealers();
  const issues = {
    mismatches: [],
    newDealers: []
  };
  
  const dealerRows = snap.dealerRows || snap.dealers || [];
  const seen = new Set();
  
  dealerRows.forEach(row => {
    const dealerName = String(row.dealer || '').trim();
    const state = String(row.state || '').trim().toUpperCase();
    const fi = String(row.fi || '').trim();
    
    if (!dealerName) return;
    
    // Avoid duplicates in review
    const key = `${normalizeDealerName(dealerName)}|${state}|${fi}`;
    if (seen.has(key)) return;
    seen.add(key);
    
    const master = findMasterDealer(dealerName, masterList);
    
    if (!master) {
      issues.newDealers.push({
        name: dealerName,
        csvState: state,
        csvFI: fi,
        action: 'add-to-master'
      });
    } else if (master.state !== state || master.fi !== fi) {
      issues.mismatches.push({
        name: dealerName,
        csvState: state,
        csvFI: fi,
        masterState: master.state,
        masterFI: master.fi,
        masterId: master.id,
        action: 'use-master'
      });
    }
  });
  
  return issues;
}

async function validateFundedDeals(fundedRawRows, month, year) {
  const orphans = [];
  
  try {
    // Get all dealers that have app data for this month
    const { data: existingDealers, error } = await window.sb
      .from('monthly_snapshots')
      .select('dealer, state, fi')
      .eq('year', year)
      .eq('month', month);
    
    if (error) {
      console.error('[funded validation] error:', error);
      return orphans;
    }
    
    const dealerSet = new Set(
      (existingDealers || []).map(d => 
        `${normalizeDealerName(d.dealer)}|${d.state}|${d.fi}`
      )
    );
    
    // Group funded deals by dealer
    const fundedByDealer = new Map();
    (fundedRawRows || []).forEach(row => {
      const dealer = String(row['Dealer Name'] || row.Dealer || '').trim();
      const state = String(row.State || '').trim().toUpperCase();
      
      if (!dealer) return;
      
      const key = `${normalizeDealerName(dealer)}|${state}`;
      if (!fundedByDealer.has(key)) {
        fundedByDealer.set(key, {
          dealer,
          state,
          count: 0,
          amount: 0
        });
      }
      
      const entry = fundedByDealer.get(key);
      entry.count++;
      const amountStr = String(row['Funded Amount'] || row.Amount || '0');
      entry.amount += parseFloat(amountStr.replace(/[^0-9.-]/g, '')) || 0;
    });
    
    // Check for orphans
    const masterList = await fetchMasterDealers();
    fundedByDealer.forEach((entry, key) => {
      const master = findMasterDealer(entry.dealer, masterList);
      const fi = master ? master.fi : 'Independent';
      const checkKey = `${normalizeDealerName(entry.dealer)}|${entry.state}|${fi}`;
      
      if (!dealerSet.has(checkKey)) {
        orphans.push({
          ...entry,
          fi,
          masterId: master?.id,
          action: 'create-row'
        });
      }
    });
    
    return orphans;
  } catch (e) {
    console.error('[funded validation] exception:', e);
    return [];
  }
}

// ============================================
// UPLOAD REVIEW MODAL
// ============================================

function showUploadReviewModal(issues, orphans, snapshot, fundedRows) {
  window.uploadReviewData = {
    mismatches: issues.mismatches || [],
    newDealers: issues.newDealers || [],
    orphanFunded: orphans || [],
    pendingSnapshot: snapshot,
    pendingFundedRows: fundedRows
  };
  
  const modal = document.getElementById('uploadReviewModal');
  const content = document.getElementById('uploadReviewContent');
  
  if (!modal || !content) {
    console.error('[review] Modal elements not found');
    return false;
  }
  
  let html = '';
  
  // Mismatches section
  if (window.uploadReviewData.mismatches.length > 0) {
    html += `
      <div class="mb-6">
        <h4 class="font-semibold text-red-600 mb-2">⚠️ Data Mismatches (${window.uploadReviewData.mismatches.length})</h4>
        <p class="text-sm text-gray-600 mb-3">These dealers don't match your master list:</p>
        <div class="border rounded overflow-hidden">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left">Dealer</th>
                <th class="px-3 py-2 text-left">In CSV</th>
                <th class="px-3 py-2 text-left">In Master</th>
                <th class="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              ${window.uploadReviewData.mismatches.map((m, i) => `
                <tr class="border-t">
                  <td class="px-3 py-2 font-medium">${m.name}</td>
                  <td class="px-3 py-2">${m.csvState} | ${m.csvFI}</td>
                  <td class="px-3 py-2 bg-green-50 font-medium">${m.masterState} | ${m.masterFI}</td>
                  <td class="px-3 py-2">
                    <select class="mismatch-action text-sm border rounded px-2 py-1" data-index="${i}">
                      <option value="use-master">Use Master</option>
                      <option value="keep-separate">Keep as Separate</option>
                      <option value="update-master">Update Master</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  
  // New dealers section
  if (window.uploadReviewData.newDealers.length > 0) {
    html += `
      <div class="mb-6">
        <h4 class="font-semibold text-yellow-600 mb-2">✨ New Dealers (${window.uploadReviewData.newDealers.length})</h4>
        <p class="text-sm text-gray-600 mb-3">These dealers are not in your master list:</p>
        <div class="border rounded overflow-hidden">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left">Dealer</th>
                <th class="px-3 py-2 text-left">State</th>
                <th class="px-3 py-2 text-left">FI</th>
                <th class="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              ${window.uploadReviewData.newDealers.map((d, i) => `
                <tr class="border-t">
                  <td class="px-3 py-2 font-medium">${d.name}</td>
                  <td class="px-3 py-2">${d.csvState}</td>
                  <td class="px-3 py-2">${d.csvFI}</td>
                  <td class="px-3 py-2">
                    <select class="newdealer-action text-sm border rounded px-2 py-1" data-index="${i}">
                      <option value="add-to-master">Add to Master</option>
                      <option value="skip">Skip (Don't Save)</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  
  // Orphan funded deals section
  if (window.uploadReviewData.orphanFunded.length > 0) {
    html += `
      <div class="mb-6">
        <h4 class="font-semibold text-blue-600 mb-2">📌 Funded Deals Without Apps (${window.uploadReviewData.orphanFunded.length})</h4>
        <p class="text-sm text-gray-600 mb-3">These dealers have funded deals but no applications this month:</p>
        <div class="border rounded overflow-hidden">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left">Dealer</th>
                <th class="px-3 py-2 text-left">State</th>
                <th class="px-3 py-2 text-left">FI</th>
                <th class="px-3 py-2 text-right">Funded</th>
                <th class="px-3 py-2 text-right">Amount</th>
                <th class="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              ${window.uploadReviewData.orphanFunded.map((o, i) => `
                <tr class="border-t">
                  <td class="px-3 py-2 font-medium">${o.dealer}</td>
                  <td class="px-3 py-2">${o.state}</td>
                  <td class="px-3 py-2">${o.fi}</td>
                  <td class="px-3 py-2 text-right tabular-nums">${o.count}</td>
                  <td class="px-3 py-2 text-right tabular-nums">$${o.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td class="px-3 py-2">
                    <select class="orphan-action text-sm border rounded px-2 py-1" data-index="${i}">
                      <option value="create-row">Auto-Create Row</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  // Unmatched funded dealers section (can't auto-match, need manual mapping)
  if (window.uploadReviewData.unmatchedFunded && window.uploadReviewData.unmatchedFunded.length > 0) {
    // Get list of all dealers from snapshot for the dropdown
    const snapshotDealers = (snapshot.dealerRows || []).map(d => ({
      name: d.dealer,
      state: d.state,
      fi: d.fi,
      display: `${d.dealer} (${d.state} | ${d.fi})`
    }));
    
    html += `
      <div class="mb-6">
        <h4 class="font-semibold text-orange-600 mb-2">🔍 Unmatched Funded Dealers (${window.uploadReviewData.unmatchedFunded.length})</h4>
        <p class="text-sm text-gray-600 mb-3">These funded deals couldn't be auto-matched. Please manually select which dealer they belong to:</p>
        <div class="border rounded overflow-hidden">
          <table class="min-w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-3 py-2 text-left">Funded Dealer</th>
                <th class="px-3 py-2 text-left">State</th>
                <th class="px-3 py-2 text-right">Amount</th>
                <th class="px-3 py-2 text-left">Map To Dealer</th>
                <th class="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              ${window.uploadReviewData.unmatchedFunded.map((u, i) => `
                <tr class="border-t">
                  <td class="px-3 py-2 font-medium">${u.dealerName}</td>
                  <td class="px-3 py-2">${u.state}</td>
                  <td class="px-3 py-2 text-right tabular-nums">$${u.amount.toLocaleString()}</td>
                  <td class="px-3 py-2">
                    <select class="unmatched-dealer-select text-sm border rounded px-2 py-1 w-full" data-index="${i}">
                      <option value="">-- Select Dealer --</option>
                      ${snapshotDealers.map(d => `
                        <option value="${d.name}|${d.state}|${d.fi}">${d.display}</option>
                      `).join('')}
                    </select>
                  </td>
                  <td class="px-3 py-2">
                    <select class="unmatched-action text-sm border rounded px-2 py-1" data-index="${i}">
                      <option value="map">Map to Selected</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  if (html === '') {
    html = '<div class="p-4 bg-green-50 border border-green-200 rounded"><p class="text-green-700 font-semibold">✅ No issues found! Upload looks good.</p></div>';
    // Auto-proceed if no issues
    setTimeout(() => {
      modal.classList.add('hidden');
      if (snapshot) {
        proceedWithUpload(snapshot, fundedRows);
      }
    }, 1500);
  }
  
  content.innerHTML = html;
  modal.classList.remove('hidden');
  
  return true;
}

async function applyReviewDecisions() {
  const masterList = await fetchMasterDealers();
  
  // Collect decisions from dropdowns
  document.querySelectorAll('.mismatch-action').forEach((select, i) => {
    if (window.uploadReviewData.mismatches[i]) {
      window.uploadReviewData.mismatches[i].action = select.value;
    }
  });
  
  document.querySelectorAll('.newdealer-action').forEach((select, i) => {
    if (window.uploadReviewData.newDealers[i]) {
      window.uploadReviewData.newDealers[i].action = select.value;
    }
  });
  
  document.querySelectorAll('.orphan-action').forEach((select, i) => {
    if (window.uploadReviewData.orphanFunded[i]) {
      window.uploadReviewData.orphanFunded[i].action = select.value;
    }
  });
  // Collect unmatched funded dealer decisions
  document.querySelectorAll('.unmatched-action').forEach((select, i) => {
    if (window.uploadReviewData.unmatchedFunded && window.uploadReviewData.unmatchedFunded[i]) {
      window.uploadReviewData.unmatchedFunded[i].action = select.value;
      
      // Get the selected dealer from the dropdown
      const dealerSelect = document.querySelector(`.unmatched-dealer-select[data-index="${i}"]`);
      if (dealerSelect && dealerSelect.value) {
        const [name, state, fi] = dealerSelect.value.split('|');
        window.uploadReviewData.unmatchedFunded[i].mappedTo = { name, state, fi };
      }
    }
  });
  // IMPORTANT: Merge funded data BEFORE correcting dealers
  // This way the merge uses the original CSV state/FI values which match the funded file
  console.log('[Review] Merging funded data BEFORE applying corrections...');
  const snapshot = window.uploadReviewData.pendingSnapshot;
  const fundedRows = window.uploadReviewData.pendingFundedRows;
  
  if (fundedRows && fundedRows.length > 0) {
    // Temporarily set up fundedParsed for the merge function
    const originalFundedParsed = window.fundedParsed;
    window.fundedParsed = { fields: [], rows: fundedRows };
    // Debug: Check if Cardinal is in fundedRows
console.log('[CARDINAL DEBUG] fundedRows count:', fundedRows.length);
const hasCardinal = fundedRows.some(r => {
  const dealer = String(r['Dealer Name'] || r.Dealer || '').toLowerCase();
  return dealer.includes('cardinal');
});
console.log('[CARDINAL DEBUG] Cardinal in fundedRows?', hasCardinal);
    // Auto-approve the merge by hijacking confirm
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    
    try {
      if (typeof matchAndMergeFundedIntoSnapshot === 'function') {
        const mergeResult = matchAndMergeFundedIntoSnapshot(snapshot);
        console.log('[Review] Merge completed:', mergeResult);
        
        // Store unmatched dealers for later manual mapping
        window.uploadReviewData.unmatchedFunded = mergeResult.unmatchedDetails || [];
        console.log('[Review] Total funded after merge:', snapshot.totals?.funded);
        console.log('[Review] Total funded amount after merge:', snapshot.kpis?.totalFunded);
        // Process BOTH needsReview AND unmatched dealers as orphans
  const orphans = [
    ...(mergeResult.unmatchedDetails || []),
    ...(mergeResult.needsReviewDetails || [])
  ];
  
  console.log('[Review] Processing', orphans.length, 'orphan dealers (unmatched + needsReview) from merge');
  
  if (orphans.length > 0) {
    console.log('[Review] Found orphans:', orphans);
    for (const orphan of orphans) {
      const newRow = {
        dealer: orphan.dealerName,
        state: orphan.state,
        fi: 'Independent',
        total: 0,
        approved: 0,
        counter: 0,
        pending: 0,
        denial: 0,
        funded: orphan.count,
        funded_amount: orphan.amount
      };
      snapshot.dealerRows.push(newRow);
      console.log('[Review] Added orphan dealer:', newRow.dealer, newRow.state);
      // Update snapshot totals to include orphan funded amounts
      snapshot.totals.funded = (snapshot.totals.funded || 0) + orphan.count;
      snapshot.kpis.totalFunded = (snapshot.kpis.totalFunded || 0) + orphan.amount;
    }
  }
} 
      } catch (err) {
        console.error('[Review] Error during merge:', err);
      }
    
  // Restore the original fundedParsed
window.fundedParsed = originalFundedParsed;
}
  // NOW apply corrections AFTER the merge is done
  console.log('[Review] Applying dealer corrections AFTER merge...');
  
  // Process mismatches
  for (const mismatch of window.uploadReviewData.mismatches) {
    if (mismatch.action === 'use-master') {
      // Correct the snapshot data to use master values
      correctSnapshotDealer(snapshot, mismatch.name, mismatch.masterState, mismatch.masterFI);
    } else if (mismatch.action === 'update-master') {
      // Update master list
      await updateMasterDealer(mismatch.masterId, mismatch.name, mismatch.csvState, mismatch.csvFI);
    }
    // 'keep-separate' requires no action - just save as-is
  }
  
  // Process new dealers
  for (const newDealer of window.uploadReviewData.newDealers) {
    if (newDealer.action === 'add-to-master') {
      await addMasterDealer(newDealer.name, newDealer.csvState, newDealer.csvFI);
    } else if (newDealer.action === 'skip') {
      // Remove from snapshot
      removeSnapshotDealer(snapshot, newDealer.name);
    }
  }
  
  // Process unmatched funded dealers
  if (window.uploadReviewData.unmatchedFunded) {
    for (const unmatched of window.uploadReviewData.unmatchedFunded) {
      if (unmatched.action === 'map' && unmatched.mappedTo) {
        console.log('[Review] Manually mapping funded dealer:', unmatched.dealerName, '→', unmatched.mappedTo.name);
        
        // Find the dealer row in the snapshot
        const dealerRow = snapshot.dealerRows.find(d => 
          d.dealer === unmatched.mappedTo.name && 
          d.state === unmatched.mappedTo.state && 
          d.fi === unmatched.mappedTo.fi
        );
        
        if (dealerRow) {
          // Increment funded count and amount
          dealerRow.funded = (dealerRow.funded || 0) + 1;
          dealerRow.funded_amount = (dealerRow.funded_amount || 0) + unmatched.amount;
          
          // Add to fundedRawRows for individual deal tracking
          snapshot.fundedRawRows = snapshot.fundedRawRows || [];
          snapshot.fundedRawRows.push({
            Dealer: unmatched.mappedTo.name,
            State: unmatched.mappedTo.state,
            FI: unmatched.mappedTo.fi,
            'Loan Amount': unmatched.amount,
            Status: 'funded'
          });
          
          console.log('[Review] Mapped successfully. Dealer now has', dealerRow.funded, 'funded deals');
        }
      } else if (unmatched.action === 'skip') {
        console.log('[Review] Skipping unmatched dealer:', unmatched.dealerName);
      }
    }
    
    // Recalculate totals after manual mapping
    snapshot.totals.funded = (snapshot.dealerRows || []).reduce((sum, d) => sum + (d.funded || 0), 0);
    snapshot.kpis.totalFunded = (snapshot.fundedRawRows || []).reduce((sum, r) => sum + parseNumber(r['Loan Amount']), 0);
  }
  console.log('[Review] All corrections applied. Final snapshot totals:', snapshot.totals);
  console.log('[Review] Final snapshot KPIs:', snapshot.kpis);
  
  // Close modal and proceed with upload (funded data is already merged!)
  document.getElementById('uploadReviewModal').classList.add('hidden');
  
  // Call save directly instead of going through proceedWithUpload again
  if (typeof saveMonthlySnapshotSB === 'function') {
    await saveMonthlySnapshotSB(snapshot);
    
    // Show results
    if (snapshot) {
      const res = document.getElementById('resultsArea');
      if (res) {
        res.innerHTML = `
          <div class="text-sm">
            <div class="font-semibold mb-1">Analyzed: ${monthName(snapshot.month)} ${snapshot.year}</div>
            <ul class="list-disc ml-5 space-y-0.5">
              <li>Total apps: <b>${snapshot.totals.totalApps}</b></li>
              <li>Approved: <b>${snapshot.totals.approved}</b></li>
              <li>Funded: <b>${snapshot.totals.funded}</b></li>
              <li>Total Funded: <b>${formatMoney(snapshot.kpis.totalFunded)}</b></li>
              <li>Dealers: <b>${snapshot.dealerRows.length}</b>, States: <b>${snapshot.stateRows.length}</b></li>
            </ul>
          </div>
        `;
      }
      
      // Refresh UI
      try { buildSidebar(); } catch {}
      try { await refreshMonthlyGrid(); } catch {}
      try { switchTab('Monthly'); } catch {}
    }
  }
}
  
function correctSnapshotDealer(snapshot, dealerName, correctState, correctFI) {
  if (!snapshot) return;
  
  const normalized = normalizeDealerName(dealerName);
  
  // Update dealerRows
  (snapshot.dealerRows || []).forEach(row => {
    if (normalizeDealerName(row.dealer) === normalized) {
      row.state = correctState;
      row.fi = correctFI;
    }
  });
  
  // Update any other arrays that might have dealer info
  (snapshot.dealers || []).forEach(row => {
    if (normalizeDealerName(row.dealer) === normalized) {
      row.state = correctState;
      row.fi = correctFI;
    }
  });
}

function removeSnapshotDealer(snapshot, dealerName) {
  if (!snapshot) return;
  
  const normalized = normalizeDealerName(dealerName);
  
  if (snapshot.dealerRows) {
    snapshot.dealerRows = snapshot.dealerRows.filter(row => 
      normalizeDealerName(row.dealer) !== normalized
    );
  }
  
  if (snapshot.dealers) {
    snapshot.dealers = snapshot.dealers.filter(row => 
      normalizeDealerName(row.dealer) !== normalized
    );
  }
}

// ============================================
// SETTINGS TAB - MASTER DEALERS UI
// ============================================

async function initSettingsTab() {
  await renderMasterDealersList();
  
  // Add Dealer button
  document.getElementById('btnAddDealer')?.addEventListener('click', () => {
    showDealerModal();
  });
  
  // Dealer modal form
  document.getElementById('dealerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveDealerForm();
  });
  
  // Cancel button
  document.getElementById('btnCancelDealer')?.addEventListener('click', () => {
    hideDealerModal();
  });
  
  // Search and filters
  document.getElementById('masterDealerSearch')?.addEventListener('input', filterMasterDealers);
  document.getElementById('masterStateFilter')?.addEventListener('change', filterMasterDealers);
  document.getElementById('masterFIFilter')?.addEventListener('change', filterMasterDealers);

// Export Master Dealers to Excel button
const exportBtn = document.getElementById('btnExportDealers');
if (exportBtn && !window.exportButtonAttached) {
  exportBtn.addEventListener('click', async () => {
    console.log('[Export] Button clicked!');
    
    try {
      const sb = window.sb;
      if (!sb) {
        alert('Database connection not available');
        return;
      }

      console.log('[Export] Fetching dealers...');

      const { data: dealers, error } = await sb
        .from('master_dealers')
        .select('dealer_name, state, fi')
        .order('dealer_name', { ascending: true });

      if (error) {
        console.error('[Export] Error fetching dealers:', error);
        alert('Error fetching dealer data: ' + error.message);
        return;
      }

      console.log('[Export] Found dealers:', dealers?.length);

      if (!dealers || dealers.length === 0) {
        alert('No dealers to export');
        return;
      }

      const exportData = dealers.map(d => ({
        'Dealer Name': d.dealer_name || '',
        'State': d.state || '',
        'FI Type': d.fi || ''
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      ws['!cols'] = [
        { wch: 40 }, // Dealer Name
        { wch: 10 }, // State
        { wch: 15 }  // FI Type
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Master Dealers');

      const today = new Date().toISOString().split('T')[0];
      const filename = `Master_Dealers_${today}.xlsx`;

      XLSX.writeFile(wb, filename);
      
      console.log(`[Export] Exported ${dealers.length} dealers to ${filename}`);
      alert(`Successfully exported ${dealers.length} dealers!`);
    } catch (err) {
      console.error('[Export] Error:', err);
      alert('Error exporting dealers: ' + err.message);
    }
  });
  
  window.exportButtonAttached = true;
  console.log('[Export] Export button handler attached!');
}
}

async function renderMasterDealersList() {
  const tbody = document.getElementById('masterDealersBody');
  const loading = document.getElementById('masterDealersLoading');
  const stateFilter = document.getElementById('masterStateFilter');
  
  if (!tbody) return;
  
  if (loading) loading.style.display = 'block';
  tbody.innerHTML = '';
  
  const dealers = await fetchMasterDealers();
  
  if (loading) loading.style.display = 'none';
  
  // Populate state filter
  if (stateFilter && stateFilter.options.length === 1) {
    const states = [...new Set(dealers.map(d => d.state))].sort();
    states.forEach(state => {
      const opt = document.createElement('option');
      opt.value = state;
      opt.textContent = state;
      stateFilter.appendChild(opt);
    });
  }
  
  window.currentMasterDealers = dealers;
  filterMasterDealers();
}

function filterMasterDealers() {
  const tbody = document.getElementById('masterDealersBody');
  if (!tbody) return;
  
  const search = (document.getElementById('masterDealerSearch')?.value || '').toLowerCase();
  const stateFilter = document.getElementById('masterStateFilter')?.value || '';
  const fiFilter = document.getElementById('masterFIFilter')?.value || '';
  
  let filtered = window.currentMasterDealers;
  
  if (search) {
    filtered = filtered.filter(d => d.dealer_name.toLowerCase().includes(search));
  }
  
  if (stateFilter) {
    filtered = filtered.filter(d => d.state === stateFilter);
  }
  
  if (fiFilter) {
    filtered = filtered.filter(d => d.fi === fiFilter);
  }
  
  tbody.innerHTML = filtered.map(dealer => `
    <tr class="border-t hover:bg-gray-50">
      <td class="px-3 py-2">${dealer.dealer_name}</td>
      <td class="px-3 py-2">
        <span class="inline-block px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800">
          ${dealer.state}
        </span>
      </td>
      <td class="px-3 py-2">
        <span class="inline-block px-2 py-0.5 text-xs font-medium rounded ${
          dealer.fi === 'Franchise' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
        }">
          ${dealer.fi}
        </span>
      </td>
      <td class="px-3 py-2 text-right">
        <button class="text-sm text-blue-600 hover:underline mr-2" onclick="editDealer(${dealer.id})">Edit</button>
        <button class="text-sm text-red-600 hover:underline" onclick="confirmDeleteDealer(${dealer.id})">Delete</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="px-3 py-6 text-center text-gray-500">No dealers found</td></tr>';
}

function showDealerModal(dealer = null) {
  const modal = document.getElementById('dealerModal');
  const title = document.getElementById('dealerModalTitle');
  const form = document.getElementById('dealerForm');
  
  if (!modal || !form) return;
  
  if (dealer) {
    title.textContent = 'Edit Dealer';
    document.getElementById('dealerFormName').value = dealer.dealer_name;
    document.getElementById('dealerFormState').value = dealer.state;
    document.getElementById('dealerFormFI').value = dealer.fi;
    form.dataset.dealerId = dealer.id;
  } else {
    title.textContent = 'Add Dealer';
    form.reset();
    delete form.dataset.dealerId;
  }
  
  modal.classList.remove('hidden');
}

function hideDealerModal() {
  const modal = document.getElementById('dealerModal');
  if (modal) modal.classList.add('hidden');
}

async function saveDealerForm() {
  const form = document.getElementById('dealerForm');
  const name = document.getElementById('dealerFormName').value;
  const state = document.getElementById('dealerFormState').value;
  const fi = document.getElementById('dealerFormFI').value;
  
  if (!name || !state || !fi) {
    alert('All fields are required');
    return;
  }
  
  let result;
  if (form.dataset.dealerId) {
    result = await updateMasterDealer(form.dataset.dealerId, name, state, fi);
  } else {
    result = await addMasterDealer(name, state, fi);
  }
  
  if (result.success) {
    hideDealerModal();
    await renderMasterDealersList();
  } else {
    alert('Error: ' + result.error);
  }
}

window.editDealer = async function(id) {
  const dealer = window.currentMasterDealers.find(d => d.id === id);
  if (dealer) {
    showDealerModal(dealer);
  }
};

window.confirmDeleteDealer = async function(id) {
  const dealer = window.currentMasterDealers.find(d => d.id === id);
  if (!dealer) return;
  
  if (confirm(`Are you sure you want to delete "${dealer.dealer_name}"?`)) {
    const result = await deleteMasterDealer(id);
    if (result.success) {
      await renderMasterDealersList();
    } else {
      alert('Error deleting dealer: ' + result.error);
    }
  }
};

// ============================================
// INITIALIZATION
// ============================================

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
console.log('[Master Dealers Module] Page loaded, attaching button handlers...');

// IMPORTANT: Attach review modal buttons immediately on page load
const applyBtn = document.getElementById('btnApplyReview');
const cancelBtn = document.getElementById('btnCancelReview');

if (applyBtn) {
  applyBtn.addEventListener('click', async () => {
    console.log('[Review Modal] Apply button clicked');
    await applyReviewDecisions();
  });
  console.log('[Master Dealers Module] ✅ Apply button handler attached');
} else {
  console.error('[Master Dealers Module] ❌ Apply button not found!');
}

if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    console.log('[Review Modal] Cancel button clicked');
    document.getElementById('uploadReviewModal').classList.add('hidden');
    window.uploadReviewData = { mismatches: [], newDealers: [], orphanFunded: [], pendingSnapshot: null };
  });
  console.log('[Master Dealers Module] ✅ Cancel button handler attached');
} else {
  console.error('[Master Dealers Module] ❌ Cancel button not found!');
}

// Watch for tab changes to initialize Settings tab
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.target.id === 'tab-Settings' && !mutation.target.classList.contains('hidden')) {
      initSettingsTab();
    }
  });
});

const settingsTab = document.getElementById('tab-Settings');
if (settingsTab) {
  observer.observe(settingsTab, { attributes: true, attributeFilter: ['class'] });
}
});

console.log('[Master Dealers Module] Loaded successfully');

