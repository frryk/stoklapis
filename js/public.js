// ==========================================
// Public Page Logic (Read-Only)
// ==========================================

const PublicApp = {
    tenantsList: [],
    tokoVariants: [],
    tenantVariantsMap: {},
    dailyData: [],

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
        document.getElementById('currentDate').textContent = Utils.formatDate(today);
        document.getElementById('dailyDate').value = today;

        // Setup filters
        this.setupFilters();

        // Initialize Firebase
        this.setLoadingState(true);
        const connected = await initFirebase();

        if (connected) {
            await DataManager.initializeDefaults();
            await this.loadSettingsCache();
            // Auto-load today's toko data
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
        this.populateTenantDropdown();
    },

    // ========================================
    // Filters
    // ========================================

    setupFilters() {
        document.getElementById('dailyDate').addEventListener('change', () => this.loadDailyData());
        document.getElementById('dailyLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('dailyTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? '' : 'none';
            if (e.target.value === 'toko') this.loadDailyData();
        });
        document.getElementById('dailyTenantSelect').addEventListener('change', () => this.loadDailyData());
    },

    populateTenantDropdown() {
        const sel = document.getElementById('dailyTenantSelect');
        sel.innerHTML = '<option value="">-- Pilih --</option>';
        this.tenantsList.forEach(t => {
            sel.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });
    },

    getSelectedLocation() {
        const locationType = document.getElementById('dailyLocationType').value;
        let locationId = 'main';

        if (locationType === 'tenant') {
            locationId = document.getElementById('dailyTenantSelect').value;
            if (!locationId) return null;
        }

        return { locationType, locationId };
    },

    // ========================================
    // Load & Render Daily Data (Read-Only)
    // ========================================

    async loadDailyData() {
        const location = this.getSelectedLocation();
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
            tfoot.style.display = 'none';
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
        tfoot.style.display = '';

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
    // Notes (Read-Only — below table)
    // ========================================

    async loadNotes(date) {
        const contentEl = document.getElementById('publicNotesContent');
        if (!contentEl) return;

        try {
            const data = await DataManager.loadNote(date);
            if (data && data.content && data.content.trim()) {
                // Render content as formatted text (preserving line breaks)
                const escaped = data.content
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                contentEl.innerHTML = `<div class="public-notes-text">${escaped}</div>`;
            } else {
                contentEl.innerHTML = '<span class="pn-empty">Belum ada catatan untuk hari ini</span>';;
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
