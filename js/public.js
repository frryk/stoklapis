// ==========================================
// Public Page Logic (Read-Only)
// ==========================================

const PublicApp = {
    currentSection: 'rekap-harian',
    tenantsList: [],
    tokoVariants: [],
    tenantVariantsMap: {},
    dailyData: [],
    monthlyData: [],
    rekapTotalData: [],
    monthlySummaryOverrides: {},

    // Notes state
    notesContent: '',
    notesSaveTimeout: null,
    currentNotesDate: null,

    // ========================================
    // Initialization
    // ========================================

    async init() {
        // Set current date
        const today = Utils.getToday();
        const currentMonth = Utils.getCurrentMonth();
        document.getElementById('currentDate').textContent = Utils.formatDate(today);
        
        document.getElementById('dailyDate').value = today;
        document.getElementById('monthlyMonth').value = currentMonth;
        document.getElementById('rtMonth').value = currentMonth;

        // Setup UI
        this.setupNavigation();
        this.setupMobileMenu();
        this.setupFilters();

        // Initialize Firebase
        this.setLoadingState(true);
        const connected = await initFirebase();

        if (connected) {
            await DataManager.initializeDefaults();
            await this.loadSettingsCache();
            // Auto-load today's toko data and other defaults
            this.loadDailyData();
        } else {
            this.showMessage('Firebase belum terhubung. Hubungi admin.', 'warning');
        }

        this.setLoadingState(false);
    },

    async loadSettingsCache() {
        this.tokoVariants = await DataManager.getVariants('toko');
        this.tenantsList = await DataManager.getTenants();
        this.tenantVariantsMap = {};
        for (const tenant of this.tenantsList) {
            this.tenantVariantsMap[tenant.id] = await DataManager.getVariants('tenant', tenant.id);
        }
        this.populateTenantDropdowns();
    },

    // ========================================
    // Navigation & UI
    // ========================================
    
    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.navigateTo(section);
            });
        });
    },

    navigateTo(section) {
        // Update nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navTarget = document.querySelector(`[data-section="${section}"]`);
        if (navTarget) navTarget.classList.add('active');

        // Update sections
        document.querySelectorAll('.content-section').forEach(s => {
            s.style.display = 'none';
            s.classList.remove('active');
        });
        const secTarget = document.getElementById(`section-${section}`);
        if(secTarget) {
            secTarget.style.display = '';
            secTarget.classList.add('active');
        }

        this.currentSection = section;

        // Close mobile sidebar
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');

        // Refresh section data lazily if needed
        if (section === 'rekap-total' && this.rekapTotalData.length === 0) this.loadRekapTotalData();
        if (section === 'rekap-bulanan' && this.monthlyData.length === 0) this.loadMonthlyData();
    },

    setupMobileMenu() {
        const menuBtn = document.getElementById('menuBtn');
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');

        if (menuBtn && sidebar) {
            menuBtn.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }
        
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
            });
        }

        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
            if (sidebar && sidebar.classList.contains('open')) {
                if (!sidebar.contains(e.target) && menuBtn && !menuBtn.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
    },

    // ========================================
    // Filters
    // ========================================

    setupFilters() {
        // Daily
        document.getElementById('dailyDate').addEventListener('change', () => this.loadDailyData());
        document.getElementById('dailyLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('dailyTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? '' : 'none';
            if (e.target.value === 'toko') this.loadDailyData();
        });
        document.getElementById('dailyTenantSelect').addEventListener('change', () => this.loadDailyData());

        // Monthly
        document.getElementById('monthlyMonth').addEventListener('change', () => this.loadMonthlyData());
        document.getElementById('monthlyLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('monthlyTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? '' : 'none';
            if (e.target.value === 'toko') this.loadMonthlyData();
        });
        document.getElementById('monthlyTenantSelect').addEventListener('change', () => this.loadMonthlyData());

        // Rekap Total
        document.getElementById('rtMonth').addEventListener('change', () => this.loadRekapTotalData());
        document.getElementById('rtLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('rtTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? '' : 'none';
            if (e.target.value === 'toko' || e.target.value === 'semua') this.loadRekapTotalData();
        });
        document.getElementById('rtTenantSelect').addEventListener('change', () => this.loadRekapTotalData());
    },

    populateTenantDropdowns() {
        const optionsHtml = '<option value="">-- Pilih --</option>' + this.tenantsList.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        
        const selDaily = document.getElementById('dailyTenantSelect');
        if (selDaily) selDaily.innerHTML = optionsHtml;

        const selMonthly = document.getElementById('monthlyTenantSelect');
        if (selMonthly) selMonthly.innerHTML = optionsHtml;

        const selRt = document.getElementById('rtTenantSelect');
        if (selRt) selRt.innerHTML = optionsHtml;
    },

    getSelectedLocation(prefix = 'daily') {
        let typeId = `${prefix}LocationType`;
        let selectId = `${prefix}TenantSelect`;

        // Special handling for Rekap Total Terjual prefix
        if (prefix === 'rt') {
            typeId = 'rtLocationType';
            selectId = 'rtTenantSelect';
        }

        const typeEl = document.getElementById(typeId);
        const selEl = document.getElementById(selectId);
        
        if (!typeEl) return null;
        const locationType = typeEl.value;
        let locationId = locationType === 'toko' ? 'main' : (locationType === 'semua' ? 'semua' : '');

        if (locationType === 'tenant') {
            locationId = selEl ? selEl.value : '';
            if (!locationId) return null;
        }

        return { locationType, locationId };
    },

    // ========================================
    // Load & Render Daily Data (Read-Only)
    // ========================================

    async loadDailyData() {
        const location = this.getSelectedLocation('daily');
        const date = document.getElementById('dailyDate').value;
        if (!location || !date) return;

        this.setLoadingState(true);

        try {
            const variants = await DataManager.getVariants(location.locationType, location.locationId);
            const data = await DataManager.loadStockData(location.locationType, location.locationId, date);

            if (data && data.items && data.items.length > 0) {
                this.dailyData = variants.map(v => {
                    const existing = data.items.find(item => item.variantId === v.id);
                    return existing || {
                        variantId: v.id,
                        variantName: v.name,
                        stokAwal: 0, stokIn: 0, rollingMasuk: 0,
                        sales: 0, returnExp: 0, returnTester: 0,
                        keepPO: 0, mixAdj: 0, kirimStok: 0,
                        rollingKeluar: 0, stokAvailable: 0
                    };
                });
            } else {
                this.dailyData = [];
            }

            this.renderTable();
            this.loadNotes(date);
        } catch (error) {
            console.error('Error loading data:', error);
            this.dailyData = [];
            this.renderTable();
        }

        this.setLoadingState(false);
    },

    renderTable() {
        const tbody = document.getElementById('dailyTableBody');
        const tfoot = document.getElementById('dailyTableFoot');

        if (!tbody) return;

        if (this.dailyData.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="17" class="empty-cell">
                        <div class="empty-state">
                            <span class="empty-icon">📋</span>
                            <p>Belum ada data untuk tanggal dan lokasi ini</p>
                        </div>
                    </td>
                </tr>`;
            if(tfoot) tfoot.style.display = 'none';
            return;
        }

        let html = '';
        this.dailyData.forEach((row, idx) => {
            const calc = Utils.calculateRow(row);
            const selisihClass = calc.selisih > 0 ? 'cell-selisih-positive' : calc.selisih < 0 ? 'cell-selisih-negative' : 'cell-selisih-zero';

            html += `<tr>`;
            html += `<td class="col-no">${idx + 1}</td>`;
            html += `<td class="col-varian">${row.variantName}</td>`;
            html += `<td>${Utils.f2(row.stokAwal)}</td>`;
            html += `<td>${Utils.f2(row.stokIn)}</td>`;
            html += `<td>${Utils.f2(row.rollingMasuk)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.totalMasuk)}</td>`;
            html += `<td>${Utils.f2(row.sales)}</td>`;
            html += `<td>${Utils.f2(row.returnExp)}</td>`;
            html += `<td>${Utils.f2(row.returnTester)}</td>`;
            html += `<td>${Utils.f2(row.keepPO)}</td>`;
            html += `<td>${Utils.f2(row.mixAdj)}</td>`;
            html += `<td>${Utils.f2(row.kirimStok)}</td>`;
            html += `<td>${Utils.f2(row.rollingKeluar)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.totalKeluar)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.stokAkhir)}</td>`;
            html += `<td>${Utils.f2(row.stokAvailable)}</td>`;
            html += `<td class="cell-calc ${selisihClass}">${Utils.f2(calc.selisih)}</td>`;
            html += `</tr>`;
        });

        tbody.innerHTML = html;
        if(tfoot) tfoot.style.display = '';

        // Update totals
        const totals = Utils.calculateTotals(this.dailyData);
        document.getElementById('totalStokAwal').textContent = Utils.f2(totals.stokAwal);
        document.getElementById('totalStokIn').textContent = Utils.f2(totals.stokIn);
        document.getElementById('totalRollingMasuk').textContent = Utils.f2(totals.rollingMasuk);
        document.getElementById('totalTotalMasuk').textContent = Utils.f2(totals.totalMasuk);
        document.getElementById('totalSales').textContent = Utils.f2(totals.sales);
        document.getElementById('totalReturnExp').textContent = Utils.f2(totals.returnExp);
        document.getElementById('totalReturnTester').textContent = Utils.f2(totals.returnTester);
        document.getElementById('totalKeepPO').textContent = Utils.f2(totals.keepPO);
        document.getElementById('totalMixAdj').textContent = Utils.f2(totals.mixAdj);
        document.getElementById('totalKirimStok').textContent = Utils.f2(totals.kirimStok);
        document.getElementById('totalRollingKeluar').textContent = Utils.f2(totals.rollingKeluar);
        document.getElementById('totalTotalKeluar').textContent = Utils.f2(totals.totalKeluar);
        document.getElementById('totalStokAkhir').textContent = Utils.f2(totals.stokAkhir);
        document.getElementById('totalStokAvailable').textContent = Utils.f2(totals.stokAvailable);
        document.getElementById('totalSelisih').textContent = Utils.f2(totals.selisih);
    },

    // ========================================
    // Rekap Bulanan
    // ========================================

    async loadMonthlyData() {
        const location = this.getSelectedLocation('monthly');
        const monthStr = document.getElementById('monthlyMonth') ? document.getElementById('monthlyMonth').value : '';
        
        if (!location || !monthStr) return;

        this.setLoadingState(true);

        try {
            const allDays = await DataManager.loadMonthlyStockData(location.locationType, location.locationId, monthStr);
            const variants = await DataManager.getVariants(location.locationType, location.locationId);

            // Aggregate by variant
            const aggregated = {};
            variants.forEach(v => {
                aggregated[v.id] = {
                    variantId: v.id,
                    variantName: v.name,
                    stokAwal: 0, stokIn: 0, rollingMasuk: 0,
                    sales: 0, returnExp: 0, returnTester: 0, keepPO: 0, mixAdj: 0, kirimStok: 0, rollingKeluar: 0,
                    stokAvailable: 0,
                    daysCount: 0
                };
            });

            // Find earliest and latest day data for Stok Awal and Closing
            const sortedDays = allDays.sort((a, b) => a.date.localeCompare(b.date));
            const firstDay = sortedDays[0];
            
            allDays.forEach(dayData => {
                if (!dayData.items) return;
                dayData.items.forEach(item => {
                    if (!aggregated[item.variantId]) return;
                    const agg = aggregated[item.variantId];
                    agg.stokIn += Number(item.stokIn) || 0;
                    agg.rollingMasuk += Number(item.rollingMasuk) || 0;
                    agg.sales += Number(item.sales) || 0;
                    agg.returnExp += Number(item.returnExp) || 0;
                    agg.returnTester += Number(item.returnTester) || 0;
                    agg.keepPO += Number(item.keepPO) || 0;
                    agg.mixAdj += Number(item.mixAdj) || 0;
                    agg.kirimStok += Number(item.kirimStok) || 0;
                    agg.rollingKeluar += Number(item.rollingKeluar) || 0;
                    agg.daysCount++;
                });
            });

            if (firstDay && firstDay.items) {
                firstDay.items.forEach(item => {
                    if (aggregated[item.variantId]) {
                        aggregated[item.variantId].stokAwal = Number(item.stokAwal) || 0;
                    }
                });
            }
            
            sortedDays.forEach(dayData => {
                if (!dayData.items) return;
                dayData.items.forEach(item => {
                    if (!aggregated[item.variantId]) return;
                    const val = Number(item.stokAvailable) || Number(item.closing) || 0;
                    if (val !== 0) {
                        aggregated[item.variantId].stokAvailable = val;
                    }
                });
            });

            this.monthlyData = Object.values(aggregated);
            this.renderMonthlyTable();

        } catch (error) {
            console.error('Error loading monthly data:', error);
            this.showMessage('Gagal memuat data bulanan', 'error');
        }

        this.setLoadingState(false);
    },

    renderMonthlyTable() {
        const tbody = document.getElementById('monthlyTableBody');
        const tfoot = document.getElementById('monthlyTableFoot');
        
        if (!tbody) return;

        if (this.monthlyData.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="17" class="empty-cell">
                        <div class="empty-state">
                            <span class="empty-icon">📆</span>
                            <p>Tidak ada data untuk bulan ini</p>
                        </div>
                    </td>
                </tr>`;
            if (tfoot) tfoot.style.display = 'none';
            return;
        }

        let html = '';
        this.monthlyData.forEach((row, idx) => {
            const calc = Utils.calculateRow(row);
            const selisihClass = calc.selisih > 0 ? 'cell-selisih-positive' : calc.selisih < 0 ? 'cell-selisih-negative' : 'cell-selisih-zero';
            
            html += `<tr>`;
            html += `<td class="col-no">${idx + 1}</td>`;
            html += `<td class="col-varian">${row.variantName}</td>`;
            html += `<td>${Utils.f2(row.stokAwal)}</td>`;
            html += `<td>${Utils.f2(row.stokIn)}</td>`;
            html += `<td>${Utils.f2(row.rollingMasuk)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.totalMasuk)}</td>`;
            html += `<td>${Utils.f2(row.sales)}</td>`;
            html += `<td>${Utils.f2(row.returnExp)}</td>`;
            html += `<td>${Utils.f2(row.returnTester)}</td>`;
            html += `<td>${Utils.f2(row.keepPO)}</td>`;
            html += `<td>${Utils.f2(row.mixAdj)}</td>`;
            html += `<td>${Utils.f2(row.kirimStok)}</td>`;
            html += `<td>${Utils.f2(row.rollingKeluar)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.totalKeluar)}</td>`;
            html += `<td class="cell-calc">${Utils.f2(calc.stokAkhir)}</td>`;
            html += `<td>${Utils.f2(row.stokAvailable)}</td>`;
            html += `<td class="cell-calc ${selisihClass}">${Utils.f2(calc.selisih)}</td>`;
            html += `</tr>`;
        });

        tbody.innerHTML = html;
        if (tfoot) tfoot.style.display = '';

        // Update totals
        const totals = Utils.calculateTotals(this.monthlyData);
        if(document.getElementById('mTotalStokAwal')) document.getElementById('mTotalStokAwal').textContent = Utils.f2(totals.stokAwal);
        if(document.getElementById('mTotalStokIn')) document.getElementById('mTotalStokIn').textContent = Utils.f2(totals.stokIn);
        if(document.getElementById('mTotalRollingMasuk')) document.getElementById('mTotalRollingMasuk').textContent = Utils.f2(totals.rollingMasuk);
        if(document.getElementById('mTotalTotalMasuk')) document.getElementById('mTotalTotalMasuk').textContent = Utils.f2(totals.totalMasuk);
        if(document.getElementById('mTotalSales')) document.getElementById('mTotalSales').textContent = Utils.f2(totals.sales);
        if(document.getElementById('mTotalReturnExp')) document.getElementById('mTotalReturnExp').textContent = Utils.f2(totals.returnExp);
        if(document.getElementById('mTotalReturnTester')) document.getElementById('mTotalReturnTester').textContent = Utils.f2(totals.returnTester);
        if(document.getElementById('mTotalKeepPO')) document.getElementById('mTotalKeepPO').textContent = Utils.f2(totals.keepPO);
        if(document.getElementById('mTotalMixAdj')) document.getElementById('mTotalMixAdj').textContent = Utils.f2(totals.mixAdj);
        if(document.getElementById('mTotalKirimStok')) document.getElementById('mTotalKirimStok').textContent = Utils.f2(totals.kirimStok);
        if(document.getElementById('mTotalRollingKeluar')) document.getElementById('mTotalRollingKeluar').textContent = Utils.f2(totals.rollingKeluar);
        if(document.getElementById('mTotalTotalKeluar')) document.getElementById('mTotalTotalKeluar').textContent = Utils.f2(totals.totalKeluar);
        if(document.getElementById('mTotalStokAkhir')) document.getElementById('mTotalStokAkhir').textContent = Utils.f2(totals.stokAkhir);
        if(document.getElementById('mTotalStokAvailable')) document.getElementById('mTotalStokAvailable').textContent = Utils.f2(totals.stokAvailable);
        if(document.getElementById('mTotalSelisih')) document.getElementById('mTotalSelisih').textContent = Utils.f2(totals.selisih);
    },

    // ========================================
    // Rekap Total Terjual
    // ========================================

    async loadRekapTotalData() {
        const monthStr = document.getElementById('rtMonth') ? document.getElementById('rtMonth').value : '';
        const location = this.getSelectedLocation('rt');
        
        if (!monthStr || !location) return;

        this.setLoadingState(true);

        try {
            let allItems = [];
            const promises = [];

            if (location.locationType === 'semua') {
                promises.push(DataManager.loadMonthlyStockData('toko', 'main', monthStr));
                this.tenantsList.forEach(t => {
                    promises.push(DataManager.loadMonthlyStockData('tenant', t.id, monthStr));
                });
            } else {
                promises.push(DataManager.loadMonthlyStockData(location.locationType, location.locationId, monthStr));
            }

            const results = await Promise.all(promises);
            results.forEach(locDays => {
                locDays.forEach(day => {
                    if (day.items) {
                        allItems.push(...day.items);
                    }
                });
            });

            // Aggregate by variantName exactly
            const aggregated = {};
            allItems.forEach(item => {
                const vName = String(item.variantName).trim();
                if (!aggregated[vName]) {
                    aggregated[vName] = { variantName: vName, sales: 0 };
                }
                aggregated[vName].sales += Number(item.sales) || 0;
            });

            this.rekapTotalData = Object.values(aggregated);
            this.monthlySummaryOverrides = await DataManager.loadMonthlySummary(location.locationType, location.locationId, monthStr) || {};
            this.renderMonthlySalesSummary(monthStr);

        } catch (err) {
            console.error('Error load rekap total:', err);
            this.showMessage('Gagal memuat Rekap Total', 'error');
        }

        this.setLoadingState(false);
    },

    renderMonthlySalesSummary(monthStr) {
        const wrapper = document.getElementById('rtSalesSummaryWrapper');
        const tbody = document.getElementById('rtSalesSummaryBody');
        const tfoot = document.getElementById('rtSalesSummaryFoot');

        if (!tbody) return;

        if (!this.rekapTotalData || this.rekapTotalData.length === 0) {
            if (wrapper) wrapper.style.display = 'none';
            return;
        }

        let html = '';
        let no = 1;

        // Grouping variables...
        let masterMap = {};

        this.rekapTotalData.forEach(item => {
            const numSales = Number(item.sales) || 0;
            if (numSales === 0) return;

            let name = item.variantName.trim();
            // Simplify names
            let baseName = name;
            let type = 'unknown';

            let nUpper = name.toUpperCase();
            if (nUpper === 'MIX BOX') {
                baseName = 'Mix Box';
                type = 'mix-box';
            } else if (nUpper.includes('(SLICE)')) {
                baseName = name.replace(/\(SLICE\)/i, '').trim();
                type = 'slice'; // which means "small" usually
            } else if (nUpper.includes(' 1/2') || nUpper.includes(' HALF')) {
                baseName = name.replace(/1\/2/i, '').replace(/half/i, '').replace(/\(\)/, '').trim();
                type = 'half';
            } else if (nUpper.includes('(LOYANG)')) {
                baseName = name.replace(/\(LOYANG\)/i, '').trim();
                type = 'full';
            } else {
                type = 'full';
            }

            if (!masterMap[baseName]) {
                masterMap[baseName] = { full: 0, half: 0, small: 0 };
            }

            if (type === 'full') masterMap[baseName].full += numSales;
            else if (type === 'half') masterMap[baseName].half += numSales;
            else if (type === 'slice' || type === 'small') masterMap[baseName].small += numSales;
            else if (type === 'mix-box') masterMap[baseName].small += numSales; // Mix box is small/slice
        });

        // Use keys that have actual counts
        let baseNamesList = Object.keys(masterMap).filter(k => (masterMap[k].full + masterMap[k].half + masterMap[k].small) > 0);
        baseNamesList.sort();

        let rowIdx = 0;
        let sumFull = 0, sumHalf = 0, sumSmall = 0, sumSetaraFull = 0;

        baseNamesList.forEach(baseName => {
            let data = masterMap[baseName];
            
            // Check overrides
            let keyRow = `row_${rowIdx}`;
            if (this.monthlySummaryOverrides && this.monthlySummaryOverrides[keyRow]) {
                const ov = this.monthlySummaryOverrides[keyRow];
                if (ov.full !== undefined) data.full = ov.full;
                if (ov.half !== undefined) data.half = ov.half;
                if (ov.small !== undefined) data.small = ov.small;
            }

            // Calculation (half = 1/2 full, small = 1/10 full initially - adjustable)
            const dFull = Number(data.full) || 0;
            const dHalf = Number(data.half) || 0;
            const dSmall = Number(data.small) || 0;
            
            // Lapis standard setara full = full + (half / 2) + (small / 10)
            const setaraFull = dFull + (dHalf / 2) + (dSmall / 10);

            html += `<tr>`;
            html += `<td style="text-align:center;">${no++}</td>`;
            html += `<td>${baseName}</td>`;
            html += `<td style="text-align:center;">${Utils.f2(dFull)}</td>`;
            html += `<td style="text-align:center;">${Utils.f2(dHalf)}</td>`;
            html += `<td style="text-align:center;">${Utils.f2(dSmall)}</td>`;
            html += `<td class="cell-calc" style="text-align:center; font-weight:600; font-size:1.05em; background:rgba(201,169,110,0.15); color:var(--text-primary);">${Utils.f2(setaraFull)}</td>`;
            html += `</tr>`;

            sumFull += dFull;
            sumHalf += dHalf;
            sumSmall += dSmall;
            sumSetaraFull += setaraFull;

            rowIdx++;
        });

        tbody.innerHTML = html;
        if (wrapper) wrapper.style.display = '';

        if (tfoot) {
            tfoot.innerHTML = `
                <tr class="total-row">
                    <td colspan="2" style="text-align:right;"><strong>TOTAL</strong></td>
                    <td style="text-align:center; font-weight:700;">${Utils.f2(sumFull)}</td>
                    <td style="text-align:center; font-weight:700;">${Utils.f2(sumHalf)}</td>
                    <td style="text-align:center; font-weight:700;">${Utils.f2(sumSmall)}</td>
                    <td style="text-align:center; font-weight:700; font-size:1.1em; background:rgba(201,169,110,0.25); color:var(--text-primary);">${Utils.f2(sumSetaraFull)}</td>
                </tr>
            `;
        }
    },


    // ========================================
    // Notes (Read-Only — below table)
    // ========================================

    async loadNotes(date) {
        const contentEl = document.getElementById('publicNotesContent');
        if (!contentEl) return;

        try {
            const data = await DataManager.loadNote(date);
            if (data && data.content && data.content.trim()) {
                const escaped = data.content
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                contentEl.innerHTML = `<div class="public-notes-text">${escaped}</div>`;
            } else {
                contentEl.innerHTML = '<span class="pn-empty">Belum ada catatan untuk hari ini</span>';
            }
        } catch (error) {
            console.error('Error loading notes:', error);
            contentEl.innerHTML = '<span class="pn-empty">Gagal memuat catatan</span>';
        }
    },

    // ========================================
    // Helpers
    // ========================================

    setLoadingState(loading) {
        const el = document.getElementById('loadingOverlay');
        if (el) el.style.display = loading ? 'flex' : 'none';
    },

    showMessage(msg, type) {
        Utils.toast(msg, type);
    }
};

// ==========================================
// Initialize Public App
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    PublicApp.init();
});
