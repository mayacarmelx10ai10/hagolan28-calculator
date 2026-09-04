// --- Tariff (Israel's uniform household electricity rate) ---------------
// The Electricity Authority updates this twice a year (January and July).
// Source: https://www.iec.co.il/content/tariffs/contentpages/homeelectricitytariff
// Add a new entry here each time the official rate changes.
const VAT_RATE = 0.18;
const RATE_TABLE = [
  { effectiveFrom: '2026-07-01', baseRate: 0.5383 },
];

function getCurrentRate() {
  const today = new Date();
  const applicable = [...RATE_TABLE]
    .filter((r) => new Date(r.effectiveFrom) <= today)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0]
    || RATE_TABLE[0];

  const baseRate = applicable.baseRate;
  const rateWithVat = baseRate * (1 + VAT_RATE);
  return { baseRate, rateWithVat, vatRate: VAT_RATE, effectiveFrom: applicable.effectiveFrom };
}

// --- Local storage -------------------------------------------------------
const STORAGE_KEYS = {
  settings: 'hagolan28_settings',
  tenant: 'hagolan28_tenant',
  history: 'hagolan28_history',
};

const DEFAULTS = {
  settings: { discountPercent: 6, fixedExpenses: 25, water: 100 },
  tenant: { name: '', prev: null, curr: null },
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error('Failed to read', key, err);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Failed to save', key, err);
  }
}

let state = {
  settings: { ...DEFAULTS.settings },
  tenant: { ...DEFAULTS.tenant },
  rate: null,
};

let historyCache = [];
let periodEndManuallySet = false;

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function loadState() {
  state.settings = { ...DEFAULTS.settings, ...loadJSON(STORAGE_KEYS.settings, {}) };
  state.tenant = { ...DEFAULTS.tenant, ...loadJSON(STORAGE_KEYS.tenant, {}) };
  state.rate = getCurrentRate();
  applyStateToForm();
  refreshHistoryCache();
}

function saveState() {
  saveJSON(STORAGE_KEYS.settings, state.settings);
  saveJSON(STORAGE_KEYS.tenant, state.tenant);
}

function refreshHistoryCache() {
  historyCache = loadJSON(STORAGE_KEYS.history, []);
  populateTenantNamesList();
}

function saveHistoryCache() {
  saveJSON(STORAGE_KEYS.history, historyCache);
}

function populateTenantNamesList() {
  const names = [...new Set(historyCache.map((h) => (h.name || '').trim()).filter(Boolean))];
  const list = document.getElementById('tenantNamesList');
  list.innerHTML = names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}"></option>`).join('');
}

function findLastReadingForName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const matches = historyCache.filter((h) => (h.name || '').trim() === trimmed);
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  return matches[0].curr;
}

function applyStateToForm() {
  document.getElementById('tenantName').value = state.tenant.name || '';
  document.getElementById('prevReading').value = state.tenant.prev ?? '';
  document.getElementById('currReading').value = state.tenant.curr ?? '';
  document.getElementById('discountPercent').value = state.settings.discountPercent || '';
  document.getElementById('fixedExpenses').value = state.settings.fixedExpenses || '';
  document.getElementById('water').value = state.settings.water || '';
  if (state.rate) {
    document.getElementById('rateReadout').textContent = `₪${state.rate.rateWithVat.toFixed(4)}`;
    const badge = document.getElementById('rateBadge');
    badge.textContent = `מתעדכן אוטומטית · ${formatDateShort(state.rate.effectiveFrom)}`;
    badge.title = `לפני מע"מ: ₪${state.rate.baseRate.toFixed(4)}`;
  }
  updateKwhReadout();
}

function currentKwh() {
  const prev = numOrNull(document.getElementById('prevReading').value);
  const curr = numOrNull(document.getElementById('currReading').value);
  if (prev === null || curr === null) return 0;
  return Math.max(0, curr - prev);
}

function updateKwhReadout() {
  document.getElementById('kwhReadout').textContent = currentKwh().toFixed(2);
}

function monthsBetween(startStr, endStr) {
  if (!startStr || !endStr) return 1;
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffDays = (end - start) / 86400000;
  if (diffDays <= 0) return 1;
  return Math.max(1, Math.round(diffDays / 30.44));
}

function addTwoMonthsMinusDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1 + 2, d);
  date.setDate(date.getDate() - 1);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('he-IL', { year: '2-digit', month: 'numeric', day: 'numeric' });
}

function hideResults() {
  document.getElementById('resultsCard').hidden = true;
}

let lastCalculation = null;

function calculate() {
  const name = document.getElementById('tenantName').value.trim();
  const prev = numOrNull(document.getElementById('prevReading').value);
  const curr = numOrNull(document.getElementById('currReading').value);
  const periodStart = document.getElementById('periodStart').value;
  const periodEnd = document.getElementById('periodEnd').value;
  const discountPercent = numOrNull(document.getElementById('discountPercent').value) || 0;
  const fixedExpenses = numOrNull(document.getElementById('fixedExpenses').value) || 0;
  const water = numOrNull(document.getElementById('water').value) || 0;

  if (prev === null || curr === null) {
    alert('נא להזין מספר התחלתי ומספר סופי');
    return;
  }

  const kwh = Math.max(0, curr - prev);
  const months = monthsBetween(periodStart, periodEnd);
  const pricePerKwh = state.rate.rateWithVat;
  const electric = kwh * pricePerKwh;
  const discountAmount = electric * (discountPercent / 100);
  const fixedExpensesTotal = fixedExpenses * months;
  const waterTotal = water * months;
  const finalTotal = electric - discountAmount + fixedExpensesTotal + waterTotal;

  const summaryEl = document.getElementById('summaryText');
  let html = '';

  if (periodStart && periodEnd) {
    html += `<div class="summary-row"><span>תקופה</span><span>${formatDate(periodStart)} — ${formatDate(periodEnd)}</span></div>`;
    html += `<div class="summary-row"><span>מספר חודשים</span><span>${months}</span></div>`;
  }
  html += `<div class="summary-row"><span>צריכה</span><span>${kwh.toFixed(2)} קוט"ש</span></div>`;
  html += `<div class="summary-row"><span>מחיר לקוט"ש (כולל מע"מ)</span><span>₪${pricePerKwh.toFixed(4)}</span></div>`;
  html += `<div class="summary-row"><span>עלות חשמל</span><span>₪${electric.toFixed(2)}</span></div>`;
  if (discountAmount) html += `<div class="summary-row"><span>הנחה (${discountPercent}%)</span><span>-₪${discountAmount.toFixed(2)}</span></div>`;
  if (fixedExpensesTotal) html += `<div class="summary-row"><span>חיוב קבוע (₪${fixedExpenses.toFixed(2)} × ${months})</span><span>+₪${fixedExpensesTotal.toFixed(2)}</span></div>`;
  if (waterTotal) html += `<div class="summary-row"><span>חיוב מים (₪${water.toFixed(2)} × ${months})</span><span>+₪${waterTotal.toFixed(2)}</span></div>`;
  html += `<div class="summary-row"><span>סה"כ לתשלום</span><span>₪${finalTotal.toFixed(2)}</span></div>`;

  summaryEl.innerHTML = html;
  document.getElementById('resultsCard').hidden = false;

  lastCalculation = {
    name, prev, curr, kwh, periodStart, periodEnd, months,
    pricePerKwh, rateBaseRate: state.rate.baseRate, rateEffectiveFrom: state.rate.effectiveFrom,
    discountPercent, fixedExpenses, water, discountAmount, fixedExpensesTotal, waterTotal,
    electric, finalTotal,
  };
}

function saveToHistory() {
  if (!lastCalculation) return;

  state.tenant.name = lastCalculation.name;
  state.settings.discountPercent = lastCalculation.discountPercent;
  state.settings.fixedExpenses = lastCalculation.fixedExpenses;
  state.settings.water = lastCalculation.water;

  const entry = {
    ...lastCalculation,
    id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    paid: false,
  };
  historyCache.push(entry);
  saveHistoryCache();
  populateTenantNamesList();

  state.tenant.prev = state.tenant.curr !== null && state.tenant.curr !== undefined ? state.tenant.curr : state.tenant.prev;
  state.tenant.curr = null;
  saveState();

  document.getElementById('periodStart').value = '';
  document.getElementById('periodEnd').value = '';
  periodEndManuallySet = false;
  hideResults();
  lastCalculation = null;
  applyStateToForm();
}

function renderHistoryTable() {
  const wrap = document.getElementById('historyList');

  if (historyCache.length === 0) {
    wrap.innerHTML = '<div class="history-empty">אין עדיין חיובים שמורים</div>';
    return;
  }

  const sorted = [...historyCache].sort((a, b) => new Date(b.date) - new Date(a.date));

  const rows = sorted.map((h) => {
    const dateStr = formatDateShort(h.date);
    const period = h.periodStart && h.periodEnd
      ? `${formatDateShort(h.periodStart)}–${formatDateShort(h.periodEnd)}`
      : '—';
    return `
      <tr>
        <td class="paid-cell">
          <input type="checkbox" class="paid-checkbox" data-id="${h.id}" ${h.paid ? 'checked' : ''}>
        </td>
        <td>${dateStr}</td>
        <td>${h.name || 'דייר'}</td>
        <td>${period}</td>
        <td>${h.kwh.toFixed(2)}</td>
        <td>₪${h.electric.toFixed(2)}</td>
        <td>${h.discountAmount ? '-₪' + h.discountAmount.toFixed(2) : '—'}</td>
        <td>${h.fixedExpensesTotal ? '+₪' + h.fixedExpensesTotal.toFixed(2) : '—'}</td>
        <td>${h.waterTotal ? '+₪' + h.waterTotal.toFixed(2) : '—'}</td>
        <td class="total-cell">₪${h.finalTotal.toFixed(2)}</td>
        <td><button type="button" class="history-delete" data-id="${h.id}">מחק</button></td>
      </tr>
    `;
  }).join('');

  const cards = sorted.map((h) => {
    const dateStr = formatDateShort(h.date);
    const period = h.periodStart && h.periodEnd
      ? `${formatDateShort(h.periodStart)} – ${formatDateShort(h.periodEnd)}`
      : '';
    return `
      <div class="history-card">
        <div class="history-card-top">
          <label class="paid-toggle">
            <input type="checkbox" class="paid-checkbox" data-id="${h.id}" ${h.paid ? 'checked' : ''}>
            שולם
          </label>
          <span class="history-card-date">${dateStr}</span>
        </div>
        <div class="history-card-name">${h.name || 'דייר'}</div>
        ${period ? `<div class="history-card-period">${period}</div>` : ''}
        <div class="history-card-grid">
          <div><span>צריכה</span><span>${h.kwh.toFixed(2)} קוט"ש</span></div>
          <div><span>חשמל</span><span>₪${h.electric.toFixed(2)}</span></div>
          ${h.discountAmount ? `<div><span>הנחה</span><span>-₪${h.discountAmount.toFixed(2)}</span></div>` : ''}
          ${h.fixedExpensesTotal ? `<div><span>קבוע</span><span>+₪${h.fixedExpensesTotal.toFixed(2)}</span></div>` : ''}
          ${h.waterTotal ? `<div><span>מים</span><span>+₪${h.waterTotal.toFixed(2)}</span></div>` : ''}
        </div>
        <div class="history-card-footer">
          <button type="button" class="history-delete" data-id="${h.id}">מחק</button>
          <span class="history-card-total">₪${h.finalTotal.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>שולם</th>
            <th>תאריך</th>
            <th>דייר</th>
            <th>תקופה</th>
            <th>קוט"ש</th>
            <th>חשמל</th>
            <th>הנחה</th>
            <th>קבוע</th>
            <th>מים</th>
            <th>סה"כ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="history-cards">${cards}</div>
  `;

  wrap.querySelectorAll('.paid-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const entry = historyCache.find((h) => h.id === cb.dataset.id);
      if (entry) {
        entry.paid = cb.checked;
        saveHistoryCache();
      }
    });
  });

  wrap.querySelectorAll('.history-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('למחוק את הרשומה הזו?')) return;
      historyCache = historyCache.filter((h) => h.id !== btn.dataset.id);
      saveHistoryCache();
      populateTenantNamesList();
      renderHistoryTable();
    });
  });
}

function openHistory() {
  refreshHistoryCache();
  renderHistoryTable();
  document.getElementById('historyModal').hidden = false;
  document.body.classList.add('modal-open');
}

function closeHistory() {
  document.getElementById('historyModal').hidden = true;
  document.body.classList.remove('modal-open');
}

function init() {
  document.getElementById('tenantName').addEventListener('input', (e) => {
    state.tenant.name = e.target.value;
    saveState();

    const lastCurr = findLastReadingForName(e.target.value);
    if (lastCurr !== null && lastCurr !== undefined) {
      state.tenant.prev = lastCurr;
      document.getElementById('prevReading').value = lastCurr;
      updateKwhReadout();
    }
  });

  document.getElementById('prevReading').addEventListener('input', (e) => {
    state.tenant.prev = numOrNull(e.target.value);
    saveState();
    updateKwhReadout();
    hideResults();
  });

  document.getElementById('currReading').addEventListener('input', (e) => {
    state.tenant.curr = numOrNull(e.target.value);
    saveState();
    updateKwhReadout();
    hideResults();
  });

  document.getElementById('periodStart').addEventListener('input', (e) => {
    hideResults();
    if (!periodEndManuallySet && e.target.value) {
      document.getElementById('periodEnd').value = addTwoMonthsMinusDay(e.target.value);
    }
  });

  document.getElementById('periodEnd').addEventListener('input', () => {
    periodEndManuallySet = true;
    hideResults();
  });

  document.getElementById('discountPercent').addEventListener('input', (e) => {
    state.settings.discountPercent = numOrNull(e.target.value) || 0;
    saveState();
    hideResults();
  });

  document.getElementById('fixedExpenses').addEventListener('input', (e) => {
    state.settings.fixedExpenses = numOrNull(e.target.value) || 0;
    saveState();
    hideResults();
  });

  document.getElementById('water').addEventListener('input', (e) => {
    state.settings.water = numOrNull(e.target.value) || 0;
    saveState();
    hideResults();
  });

  document.getElementById('calcBtn').addEventListener('click', calculate);
  document.getElementById('saveHistoryBtn').addEventListener('click', saveToHistory);

  document.getElementById('historyToggle').addEventListener('click', openHistory);
  document.getElementById('closeHistory').addEventListener('click', closeHistory);
  document.getElementById('historyModal').addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') closeHistory();
  });

  loadState();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.error('SW registration failed:', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
