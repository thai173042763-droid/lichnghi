// ============================================================
// Driver Leave Dashboard - app.js
// Complete application logic for Vietnamese driver leave management
// ============================================================

(() => {
  'use strict';

  // ── Google Sheets Config ──────────────────────────────────
  const SHEET_ID = '15vy8MLlDXP0yNR9V98lNaF7O-b1qF5-rTWXbaB0sb4g';
  const GID = '1269318824';
  const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

  const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => url, // direct (no proxy)
  ];

  // ── State ─────────────────────────────────────────────────
  let rawData = [];
  let filteredData = [];
  let currentPage = 1;
  let pageSize = 20;
  let sortColumn = null;
  let sortDirection = 'asc';
  let autoRefreshTimer = null;
  let datesPrefilled = false;
  const AUTO_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

  // ── DOM Helpers ───────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ============================================================
  // 1. CLOCK
  // ============================================================
  function startClock() {
    function tick() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();

      const clockEl = $('headerClock');
      const dateEl = $('headerDate');
      if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss}`;
      if (dateEl) dateEl.textContent = `${dd}/${mo}/${yyyy}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ============================================================
  // 2. CSV PARSER
  // ============================================================
  function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          current += '"';
          i++; // skip escaped quote
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current.trim());
          current = '';
        } else if (ch === '\r' && next === '\n') {
          row.push(current.trim());
          current = '';
          rows.push(row);
          row = [];
          i++; // skip \n
        } else if (ch === '\n') {
          row.push(current.trim());
          current = '';
          rows.push(row);
          row = [];
        } else {
          current += ch;
        }
      }
    }

    // last field / row
    if (current || row.length > 0) {
      row.push(current.trim());
      rows.push(row);
    }

    return rows;
  }

  // ============================================================
  // 3. HELPER FUNCTIONS
  // ============================================================
  function parseDate(str) {
    if (!str) return null;
    const s = str.trim();
    // DD/MM/YYYY or DD/MM/YYYY HH:mm:ss
    const parts = s.split(' ')[0].split('/');
    if (parts.length < 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
    return new Date(y, m, d);
  }

  function formatDate(str) {
    if (!str) return '';
    const s = str.trim();
    const parts = s.split(' ')[0].split('/');
    if (parts.length < 3) return s;
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }

  function getInitials(name) {
    if (!name) return '??';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase();
    }
    return words[0].substring(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, (c) => map[c]);
  }

  function animateNumber(id, target) {
    const el = $(id);
    if (!el) return;
    const start = parseInt(el.textContent, 10) || 0;
    const diff = target - start;
    if (diff === 0) { el.textContent = target; return; }
    const duration = 500; // ms
    const steps = 25;
    const stepTime = duration / steps;
    let step = 0;

    function update() {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(start + diff * eased);
      if (step < steps) {
        requestAnimationFrame(() => setTimeout(update, stepTime));
      } else {
        el.textContent = target;
      }
    }
    update();
  }

  function formatInputDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ============================================================
  // 4. FETCH DATA
  // ============================================================
  async function fetchWithProxies(url) {
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxyUrl = CORS_PROXIES[i](url);
      try {
        const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (!text || text.length < 10) throw new Error('Empty response');
        return text;
      } catch (err) {
        console.warn(`Proxy ${i + 1} failed:`, err.message);
        if (i === CORS_PROXIES.length - 1) throw err;
      }
    }
  }

  async function loadData() {
    const loadingOverlay = $('loadingOverlay');
    const refreshBtn = $('btnRefreshData');
    const dashboardContainer = $('dashboardContainer');

    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (refreshBtn) refreshBtn.classList.add('loading');

    try {
      const csvText = await fetchWithProxies(CSV_URL);
      const rows = parseCSV(csvText);

      rawData = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 3) continue;
        if (r.every((cell) => !cell)) continue;

        rawData.push({
          id: i,
          dateReq: r[0] || '',
          msnv: r[1] || '',
          name: r[2] || '',
          shift: r[3] || '',
          timeOff: r[4] || '',
          dateOff: r[5] || '',
          timeOn: r[6] || '',
          dateOn: r[7] || '',
          reason: r[8] || '',
          days: r[9] || '',
          status: r[10] || '',
          col1: r[11] || '',
          col2: r[12] || '',
        });
      }

      // Prefill date filters on first load based on dataset boundaries
      if (!datesPrefilled && rawData.length > 0) {
        const dates = rawData.map(r => parseDate(r.dateOff)).filter(Boolean);
        if (dates.length > 0) {
          const minDate = new Date(Math.min(...dates));
          const maxDate = new Date(Math.max(...dates));

          const fromInput = $('globalDateFrom');
          const toInput = $('globalDateTo');

          if (fromInput) {
            fromInput.value = formatInputDate(minDate);
            fromInput.min = formatInputDate(minDate);
            fromInput.max = formatInputDate(maxDate);
          }
          if (toInput) {
            toInput.value = formatInputDate(maxDate);
            toInput.min = formatInputDate(minDate);
            toInput.max = formatInputDate(maxDate);
          }
          datesPrefilled = true;
        }
      }

      // Update last updated time
      const now = new Date();
      const timeStr =
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0') + ' ' +
        String(now.getDate()).padStart(2, '0') + '/' +
        String(now.getMonth() + 1).padStart(2, '0') + '/' +
        now.getFullYear();
      const lastUpdEl = $('lastUpdatedTime');
      if (lastUpdEl) lastUpdEl.textContent = 'Cập nhật: ' + timeStr;

      // Apply filters and render
      applyGlobalFilters();

      // Show dashboard
      if (dashboardContainer) dashboardContainer.style.display = '';

    } catch (err) {
      console.error('Failed to load data:', err);
      alert('Không thể kết nối đến Google Sheets. Hãy thử ấn nút "Làm mới" hoặc kiểm tra lại mạng.');
    } finally {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (refreshBtn) refreshBtn.classList.remove('loading');
    }

    // Set up auto-refresh
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadData, AUTO_REFRESH_MS);
  }

  // ============================================================
  // 5. GLOBAL FILTERS
  // ============================================================
  function applyGlobalFilters() {
    const dateFromVal = $('globalDateFrom') ? $('globalDateFrom').value : '';
    const dateToVal = $('globalDateTo') ? $('globalDateTo').value : '';
    const statusVal = $('globalStatus') ? $('globalStatus').value : '';
    const shiftVal = $('globalShift') ? $('globalShift').value : '';

    const dateFrom = dateFromVal ? new Date(dateFromVal) : null;
    const dateTo = dateToVal ? new Date(dateToVal) : null;
    if (dateTo) dateTo.setHours(23, 59, 59, 999);

    filteredData = rawData.filter((row) => {
      // Filter by dateOff
      if (dateFrom || dateTo) {
        const d = parseDate(row.dateOff);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }

      // Filter by status
      if (statusVal && row.status !== statusVal) return false;

      // Filter by shift (check if shift string contains the value)
      if (shiftVal && !row.shift.includes(shiftVal)) return false;

      return true;
    });

    currentPage = 1;

    // Re-render components
    renderStats();
    applySection2Filters();
    renderTable();
  }

  // ============================================================
  // 6. STATS
  // ============================================================
  function renderStats() {
    animateNumber('statTotal', rawData.length);
    animateNumber('statFiltered', filteredData.length);

    const approved = filteredData.filter((r) => r.status === 'Xong').length;
    const cancelled = filteredData.filter((r) => r.status === 'Hủy').length;

    animateNumber('statApproved', approved);
    animateNumber('statCancelled', cancelled);
  }

  // ============================================================
  // 7. SECTION 2 - DRIVER CARDS
  // ============================================================
  function getSection2Filters() {
    const msnvFilter = $('filterMSNV') ? $('filterMSNV').value.trim().toLowerCase() : '';
    const nameFilter = $('filterName') ? $('filterName').value.trim().toLowerCase() : '';
    const shiftFilter = $('filterShift2') ? $('filterShift2').value : '';
    return { msnvFilter, nameFilter, shiftFilter };
  }

  function applySection2Filters() {
    renderDriverCards();
  }

  function renderDriverCards() {
    const container = $('driverCardsContainer');
    const noDataEl = $('noDataSection2');
    if (!container) return;

    const { msnvFilter, nameFilter, shiftFilter } = getSection2Filters();

    // Group by MSNV
    const groups = {};
    filteredData.forEach((row) => {
      const key = row.msnv || 'N/A';
      if (!groups[key]) {
        groups[key] = {
          msnv: key,
          name: row.name,
          rows: [],
        };
      }
      groups[key].rows.push(row);
    });

    let drivers = Object.values(groups);

    // Apply sub-filters
    if (msnvFilter) {
      drivers = drivers.filter((d) => d.msnv.toLowerCase().includes(msnvFilter));
    }
    if (nameFilter) {
      drivers = drivers.filter((d) => d.name.toLowerCase().includes(nameFilter));
    }
    if (shiftFilter) {
      drivers = drivers.filter((d) =>
        d.rows.some((r) => r.shift.includes(shiftFilter))
      );
    }

    // Sort by number of leave requests descending
    drivers.sort((a, b) => b.rows.length - a.rows.length);

    if (drivers.length === 0) {
      container.innerHTML = '';
      if (noDataEl) noDataEl.classList.remove('hidden');
      return;
    }

    if (noDataEl) noDataEl.classList.add('hidden');

    container.innerHTML = drivers.map((driver) => {
      const totalRequests = driver.rows.length;
      const totalDays = driver.rows.reduce((sum, r) => sum + (parseFloat(r.days) || 0), 0);
      const approved = driver.rows.filter((r) => r.status === 'Xong').length;
      const cancelled = driver.rows.filter((r) => r.status === 'Hủy').length;

      // Most recent leave date
      let recentDate = '';
      let recentDateObj = null;
      driver.rows.forEach((r) => {
        const d = parseDate(r.dateOff);
        if (d && (!recentDateObj || d > recentDateObj)) {
          recentDateObj = d;
          recentDate = formatDate(r.dateOff);
        }
      });

      // Collect unique shifts
      const shifts = new Set();
      driver.rows.forEach((r) => {
        if (r.shift) {
          r.shift.split(',').forEach((s) => {
            const trimmed = s.trim();
            if (trimmed) shifts.add(trimmed);
          });
        }
      });

      const initials = getInitials(driver.name);

      const shiftTags = Array.from(shifts)
        .map((s) => `<span class="shift-tag">${escapeHtml(s)}</span>`)
        .join('');

      return `
        <div class="driver-card" onclick="window.filterTableByDriver('${escapeHtml(driver.msnv)}')" title="Nhấn để xem chi tiết">
          <div class="driver-card-header">
            <div class="driver-avatar">${escapeHtml(initials)}</div>
            <div class="driver-info">
              <h3>${escapeHtml(driver.name)}</h3>
              <div class="driver-msnv">${escapeHtml(driver.msnv)}</div>
            </div>
          </div>
          <div class="driver-card-body">
            <div class="driver-stat">
              <span class="driver-stat-label">Số lần nghỉ</span>
              <span class="driver-stat-value">${totalRequests}</span>
            </div>
            <div class="driver-stat">
              <span class="driver-stat-label">Tổng ngày nghỉ</span>
              <span class="driver-stat-value">${totalDays} ngày</span>
            </div>
            <div class="driver-stat" style="grid-column: span 2">
              <span class="driver-stat-label">Nghỉ gần nhất</span>
              <span class="driver-stat-value">${recentDate || 'N/A'}</span>
            </div>
          </div>
          <div class="driver-card-footer">
            <div class="driver-badges">
              ${approved > 0 ? `<span class="status-badge status-xong">Xong: ${approved}</span>` : ''}
              ${cancelled > 0 ? `<span class="status-badge status-huy">Hủy: ${cancelled}</span>` : ''}
            </div>
            <div class="driver-shifts">
              ${shiftTags}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function filterTableByDriver(msnv) {
    const filterEl = $('filterMSNV');
    if (filterEl) {
      filterEl.value = msnv;
    }

    // Scroll to section 3
    const section3 = $('section-detail');
    if (section3) {
      section3.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Re-render
    currentPage = 1;
    applySection2Filters();
    renderTable();
  }

  // ============================================================
  // 8. SECTION 3 - DATA TABLE
  // ============================================================
  function getTableData() {
    const { msnvFilter, nameFilter, shiftFilter } = getSection2Filters();

    let data = [...filteredData];

    // Apply section 2 sub-filters to the table too
    if (msnvFilter) {
      data = data.filter((r) => r.msnv.toLowerCase().includes(msnvFilter));
    }
    if (nameFilter) {
      data = data.filter((r) => r.name.toLowerCase().includes(nameFilter));
    }
    if (shiftFilter) {
      data = data.filter((r) => r.shift.includes(shiftFilter));
    }

    // Apply sorting
    if (sortColumn !== null) {
      data.sort((a, b) => {
        let valA = getSortValue(a, sortColumn);
        let valB = getSortValue(b, sortColumn);

        // Numeric comparison for days
        if (sortColumn === 'days') {
          valA = parseFloat(valA) || 0;
          valB = parseFloat(valB) || 0;
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }

        // Date comparison
        if (['dateReq', 'dateOff', 'dateOn'].includes(sortColumn)) {
          const dA = parseDate(valA);
          const dB = parseDate(valB);
          const tA = dA ? dA.getTime() : 0;
          const tB = dB ? dB.getTime() : 0;
          return sortDirection === 'asc' ? tA - tB : tB - tA;
        }

        // String comparison
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return data;
  }

  function getSortValue(row, col) {
    return row[col] ?? '';
  }

  function renderTable() {
    const tbody = $('dataTableBody');
    const pageSizeEl = $('pageSizeSelect');
    const tableInfo = $('detailCountText');

    if (pageSizeEl) {
      pageSize = parseInt(pageSizeEl.value, 10) || 20;
    }

    const data = getTableData();
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));

    // Clamp current page
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, data.length);
    const pageData = data.slice(startIdx, endIdx);

    // Update table count badge
    if (tableInfo) {
      if (data.length === 0) {
        tableInfo.textContent = 'Không có dữ liệu';
      } else {
        tableInfo.textContent = `Hiển thị ${startIdx + 1}-${endIdx} / ${data.length} dòng`;
      }
    }

    // Render rows
    if (tbody) {
      if (pageData.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="14" class="no-data" style="padding: 40px 0;">
              <div class="no-data-icon">📥</div>
              <div class="no-data-text">Không có dữ liệu chi tiết phù hợp</div>
            </td>
          </tr>`;
      } else {
        tbody.innerHTML = pageData.map((row, idx) => {
          const stt = startIdx + idx + 1;

          // Shift tags
          const shiftTags = row.shift
            ? row.shift.split(',').map((s) => {
                const t = s.trim();
                return t ? `<span class="shift-tag">${escapeHtml(t)}</span>` : '';
              }).join('')
            : '';

          // Days badge with color classes
          const daysNum = parseFloat(row.days) || 0;
          let daysClass = 'days-badge';
          if (daysNum >= 3) daysClass += ' days-many';
          else if (daysNum >= 2) daysClass += ' days-3';
          else if (daysNum >= 1) daysClass += ' days-2';
          else daysClass += ' days-1';

          // Status badge
          let statusClass = 'status-badge';
          if (row.status === 'Xong') statusClass += ' status-xong';
          else if (row.status === 'Hủy') statusClass += ' status-huy';
          else statusClass += ' status-pending';

          return `
            <tr>
              <td class="col-stt">${stt}</td>
              <td class="col-date">${escapeHtml(formatDate(row.dateReq))}</td>
              <td class="col-msnv">${escapeHtml(row.msnv)}</td>
              <td class="col-name">${escapeHtml(row.name)}</td>
              <td class="col-shift">${shiftTags}</td>
              <td class="col-date">${escapeHtml(row.timeOff)}</td>
              <td class="col-date">${escapeHtml(formatDate(row.dateOff))}</td>
              <td class="col-date">${escapeHtml(row.timeOn)}</td>
              <td class="col-date">${escapeHtml(formatDate(row.dateOn))}</td>
              <td class="col-reason"><div class="reason-cell" title="${escapeHtml(row.reason)}">${escapeHtml(row.reason)}</div></td>
              <td class="col-days"><span class="${daysClass}">${daysNum}</span></td>
              <td class="col-status"><span class="${statusClass}">${escapeHtml(row.status || 'Chờ')}</span></td>
              <td>${escapeHtml(row.col1)}</td>
              <td>${escapeHtml(row.col2)}</td>
            </tr>`;
        }).join('');
      }
    }

    renderPagination(totalPages, data.length);
    updateSortHeaders();
  }

  function renderPagination(totalPages, totalRecords) {
    const prevBtn = $('prevBtn');
    const nextBtn = $('nextBtn');
    const pageInfo = $('pageInfo');
    const paginationEl = $('pagination');

    if (!paginationEl) return;

    if (totalRecords === 0 || totalPages <= 1) {
      paginationEl.style.display = 'none';
      return;
    } else {
      paginationEl.style.display = 'flex';
    }

    // Enable/disable page control buttons
    if (prevBtn) {
      prevBtn.disabled = currentPage === 1;
      prevBtn.className = `page-btn${currentPage === 1 ? ' disabled' : ''}`;
    }
    if (nextBtn) {
      nextBtn.disabled = currentPage === totalPages;
      nextBtn.className = `page-btn${currentPage === totalPages ? ' disabled' : ''}`;
    }

    // Page text display
    if (pageInfo) {
      pageInfo.textContent = `Trang ${currentPage} / ${totalPages}`;
    }
  }

  function generatePageNumbers(current, total) {
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = [];
    if (current <= 3) {
      for (let i = 1; i <= 4; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 2) {
      pages.push(1);
      pages.push('...');
      for (let i = total - 3; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    }
    return pages;
  }

  function changePage(page) {
    const data = getTableData();
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTable();

    // Scroll table into view
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
      tableContainer.scrollTop = 0;
    }
  }

  function sortTable(col) {
    if (sortColumn === col) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = col;
      sortDirection = 'asc';
    }
    currentPage = 1;
    renderTable();
  }

  function updateSortHeaders() {
    $$('th[data-sort]').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === sortColumn) {
        th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // ============================================================
  // 9. RESET ALL FILTERS
  // ============================================================
  function resetAllFilters() {
    const dateFrom = $('globalDateFrom');
    const dateTo = $('globalDateTo');
    const globalStatus = $('globalStatus');
    const globalShift = $('globalShift');

    // Default dates cover full dataset if boundaries are known
    if (rawData.length > 0) {
      const dates = rawData.map(r => parseDate(r.dateOff)).filter(Boolean);
      if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        if (dateFrom) dateFrom.value = formatInputDate(minDate);
        if (dateTo) dateTo.value = formatInputDate(maxDate);
      }
    } else {
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
    }

    if (globalStatus) globalStatus.value = '';
    if (globalShift) globalShift.value = '';

    // Reset section 2 inputs
    const filterMSNV = $('filterMSNV');
    const filterName = $('filterName');
    const filterShift2 = $('filterShift2');

    if (filterMSNV) filterMSNV.value = '';
    if (filterName) filterName.value = '';
    if (filterShift2) filterShift2.value = '';

    // Reset table variables
    sortColumn = null;
    sortDirection = 'asc';
    currentPage = 1;

    const pageSizeEl = $('pageSizeSelect');
    if (pageSizeEl) pageSizeEl.value = '20';
    pageSize = 20;

    applyGlobalFilters();
  }

  // ============================================================
  // 10. KEYBOARD SHORTCUTS
  // ============================================================
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.altKey && e.key === 'r') {
        e.preventDefault();
        loadData();
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        const data = getTableData();
        const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
        if (currentPage < totalPages) changePage(currentPage + 1);
      }

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentPage > 1) changePage(currentPage - 1);
      }
    });
  }

  // ============================================================
  // CSV DOWNLOAD
  // ============================================================
  function downloadCSV() {
    const data = getTableData();
    if (data.length === 0) {
      alert('Không có dữ liệu để tải xuống.');
      return;
    }

    const headers = [
      'STT',
      'Ngày Xin Nghỉ',
      'MSNV',
      'Họ Tên',
      'Ca Nghỉ',
      'T.Gian Nghỉ',
      'Ngày Bắt Đầu Nghỉ',
      'T.Gian Đi Làm',
      'Ngày Đi Làm',
      'Lý Do Xin Nghỉ',
      'Số Ngày',
      'Xác Nhận',
      'Cột 1',
      'Cột 2'
    ];

    const rows = [headers];

    data.forEach((row, index) => {
      rows.push([
        index + 1,
        row.dateReq,
        row.msnv,
        row.name,
        row.shift,
        row.timeOff,
        row.dateOff,
        row.timeOn,
        row.dateOn,
        row.reason,
        row.days,
        row.status,
        row.col1,
        row.col2
      ]);
    });

    // Convert to CSV with BOM for Vietnamese characters in Excel
    const csvContent = "\uFEFF" + rows.map(r => 
      r.map(val => {
        let str = String(val ?? '').replace(/"/g, '""');
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          str = `"${str}"`;
        }
        return str;
      }).join(',')
    ).join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const now = new Date();
    const dateStr = formatInputDate(now);
    link.setAttribute('href', url);
    link.setAttribute('download', `danh_sach_tai_xe_nghi_${dateStr}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ============================================================
  // 11. EVENT BINDINGS & LISTENERS
  // ============================================================
  function bindEvents() {
    const globalDateFrom = $('globalDateFrom');
    const globalDateTo = $('globalDateTo');
    const globalStatus = $('globalStatus');
    const globalShift = $('globalShift');
    const resetFiltersBtn = $('resetFiltersBtn');
    const clearFiltersBtn = $('btnClearFilters');
    const refreshBtn = $('btnRefreshData');
    const downloadCSVBtn = $('btnDownloadCSV');

    if (globalDateFrom) globalDateFrom.addEventListener('change', applyGlobalFilters);
    if (globalDateTo) globalDateTo.addEventListener('change', applyGlobalFilters);
    if (globalStatus) globalStatus.addEventListener('change', applyGlobalFilters);
    if (globalShift) globalShift.addEventListener('change', applyGlobalFilters);
    if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetAllFilters);
    if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', resetAllFilters);
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);
    if (downloadCSVBtn) downloadCSVBtn.addEventListener('click', downloadCSV);

    // Section 3 text & select filters (debounced text search)
    const filterMSNV = $('filterMSNV');
    const filterName = $('filterName');
    const filterShift2 = $('filterShift2');

    let section2Timer = null;
    const debouncedSection2 = () => {
      clearTimeout(section2Timer);
      section2Timer = setTimeout(() => {
        currentPage = 1;
        applySection2Filters();
        renderTable();
      }, 300);
    };

    if (filterMSNV) filterMSNV.addEventListener('input', debouncedSection2);
    if (filterName) filterName.addEventListener('input', debouncedSection2);
    if (filterShift2) filterShift2.addEventListener('change', () => {
      currentPage = 1;
      applySection2Filters();
      renderTable();
    });

    // Page size selection
    const pageSizeEl = $('pageSizeSelect');
    if (pageSizeEl) {
      pageSizeEl.addEventListener('change', () => {
        pageSize = parseInt(pageSizeEl.value, 10) || 20;
        currentPage = 1;
        renderTable();
      });
    }

    // Sort column headings (delegated click listener)
    document.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (th && th.dataset.sort) {
        sortTable(th.dataset.sort);
      }
    });
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  function init() {
    // Force table container max-height for 20 lines (each row ~42px, header ~48px)
    const tableContainer = document.querySelector('.table-container');
    if (tableContainer) {
      tableContainer.style.maxHeight = '890px'; 
    }

    bindEvents();
    setupKeyboardShortcuts();
    startClock();
    loadData();
  }

  // Register window properties for callbacks from inline elements or dynamic templates
  window.changePage = (pageOrOffset) => {
    if (pageOrOffset === -1) {
      changePage(currentPage - 1);
    } else if (pageOrOffset === 1) {
      changePage(currentPage + 1);
    } else {
      changePage(pageOrOffset);
    }
  };
  window.sortTable = sortTable;
  window.filterTableByDriver = filterTableByDriver;
  window.applyGlobalFilters = applyGlobalFilters;
  window.resetAllFilters = resetAllFilters;
  window.applySection2Filters = applySection2Filters;
  window.refreshData = loadData;

  // DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
