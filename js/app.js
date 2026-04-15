// ==========================================
// Main Application Logic
// ==========================================

const App = {
    currentSection: 'dashboard',
    dailyData: [],        // Current daily table data
    monthlyData: [],      // Current monthly aggregate data
    tenantsList: [],      // Cached tenants list
    tokoVariants: [],     // Cached toko variants
    tenantVariantsMap: {}, // Cached variants per tenant { tenantId: [variants] }
    selectedSettingsTenantId: null, // Currently selected tenant in settings variant card
    
    // Realtime / auto-save state
    dailyListener: null,       // Firestore onSnapshot unsubscribe
    saveTimeout: null,         // Debounce timer for auto-save
    isSaving: false,           // Flag to prevent snapshot-loop
    dailyVariants: [],         // Current daily variants cache
    dailyLocation: null,       // Current daily location cache
    dailyDate: null,           // Current daily date cache

    // Notes state
    notesDate: null,               // Current notes date
    notesContent: '',              // Current notes content
    notesSaveTimeout: null,        // Debounce timer for notes autosave
    notesIsSaving: false,          // Saving flag
    notesListener: null,           // Firestore onSnapshot unsubscribe

    // ========================================
    // Initialization
    // ========================================

    async init() {
        // Set current date display
        document.getElementById('currentDate').textContent = Utils.formatDate(Utils.getToday());

        // Set default date inputs
        document.getElementById('dailyDate').value = Utils.getToday();
        document.getElementById('monthlyMonth').value = Utils.getCurrentMonth();

        // Setup navigation
        this.setupNavigation();
        this.setupFilters();
        this.setupMobileMenu();

        // Initialize Firebase
        Utils.showLoading();
        const connected = await initFirebase();
        
        if (connected) {
            await DataManager.initializeDefaults();
            await DataManager.initAdminPassword();

            // Check authentication
            const isAuth = await this.checkAuth();
            if (!isAuth) {
                Utils.hideLoading();
                return; // Stop init until user logs in
            }

            await this.loadSettingsCache();
            await this.refreshDashboard();
        } else {
            Utils.toast('Firebase belum dikonfigurasi. Silakan isi config di firebase-config.js', 'warning');
        }
        
        Utils.hideLoading();
    },

    // ========================================
    // Authentication
    // ========================================

    /**
     * Check if user is authenticated
     */
    async checkAuth() {
        const session = sessionStorage.getItem('lapis_admin_auth');
        if (session === 'true') {
            return true;
        }
        this.showLoginOverlay();
        return false;
    },

    /**
     * Show login overlay
     */
    showLoginOverlay() {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
            setTimeout(() => {
                const input = document.getElementById('loginPasswordInput');
                if (input) input.focus();
            }, 200);
        }
    },

    /**
     * Attempt login with password
     */
    async login() {
        const input = document.getElementById('loginPasswordInput');
        const errorEl = document.getElementById('loginError');
        const password = input ? input.value : '';

        if (!password) {
            if (errorEl) { errorEl.textContent = 'Masukkan password'; errorEl.style.display = 'block'; }
            return;
        }

        // Hash input and compare
        const inputHash = await DataManager.hashPassword(password);
        const storedHash = await DataManager.getAdminPasswordHash();

        if (inputHash === storedHash) {
            sessionStorage.setItem('lapis_admin_auth', 'true');
            document.getElementById('loginOverlay').style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            if (input) input.value = '';

            // Continue initialization
            Utils.showLoading();
            await this.loadSettingsCache();
            await this.refreshDashboard();
            Utils.hideLoading();

            Utils.toast('Login berhasil! 🎉', 'success');
        } else {
            if (errorEl) { errorEl.textContent = 'Password salah!'; errorEl.style.display = 'block'; }
            if (input) { input.value = ''; input.focus(); }
        }
    },

    /**
     * Handle Enter key on login input
     */
    onLoginKeydown(e) {
        if (e.key === 'Enter') this.login();
    },

    /**
     * Logout
     */
    logout() {
        if (!confirm('Logout dari admin panel?')) return;
        sessionStorage.removeItem('lapis_admin_auth');
        this.showLoginOverlay();
        Utils.toast('Berhasil logout', 'info');
    },

    /**
     * Open change password modal
     */
    openChangePassword() {
        this.openModal(
            'Ubah Password Admin',
            `<div class="form-group">
                <label for="oldPasswordInput">Password Lama</label>
                <input type="password" id="oldPasswordInput" class="form-control" placeholder="Masukkan password lama" autofocus>
            </div>
            <div class="form-group">
                <label for="newPasswordInput">Password Baru</label>
                <input type="password" id="newPasswordInput" class="form-control" placeholder="Masukkan password baru">
            </div>
            <div class="form-group">
                <label for="confirmPasswordInput">Konfirmasi Password Baru</label>
                <input type="password" id="confirmPasswordInput" class="form-control" placeholder="Ulangi password baru">
            </div>`,
            `<button class="btn btn-outline" onclick="App.closeModal()">Batal</button>
             <button class="btn btn-primary" onclick="App.saveChangePassword()">Simpan</button>`
        );
        setTimeout(() => document.getElementById('oldPasswordInput').focus(), 100);
    },

    /**
     * Save changed password
     */
    async saveChangePassword() {
        const oldPass = document.getElementById('oldPasswordInput').value;
        const newPass = document.getElementById('newPasswordInput').value;
        const confirmPass = document.getElementById('confirmPasswordInput').value;

        if (!oldPass || !newPass || !confirmPass) {
            Utils.toast('Semua field harus diisi', 'warning');
            return;
        }

        if (newPass !== confirmPass) {
            Utils.toast('Password baru dan konfirmasi tidak cocok', 'warning');
            return;
        }

        if (newPass.length < 4) {
            Utils.toast('Password baru minimal 4 karakter', 'warning');
            return;
        }

        // Verify old password
        const oldHash = await DataManager.hashPassword(oldPass);
        const storedHash = await DataManager.getAdminPasswordHash();

        if (oldHash !== storedHash) {
            Utils.toast('Password lama salah!', 'error');
            return;
        }

        // Save new password
        Utils.showLoading();
        const newHash = await DataManager.hashPassword(newPass);
        const success = await DataManager.setAdminPasswordHash(newHash);
        Utils.hideLoading();

        if (success) {
            Utils.toast('Password berhasil diubah! 🔒', 'success');
            this.closeModal();
        } else {
            Utils.toast('Gagal mengubah password', 'error');
        }
    },

    /**
     * Cache settings data
     */
    async loadSettingsCache() {
        this.tokoVariants = await DataManager.getVariants('toko');
        this.tenantsList = await DataManager.getTenants();
        // Load variants for each tenant
        this.tenantVariantsMap = {};
        for (const tenant of this.tenantsList) {
            this.tenantVariantsMap[tenant.id] = await DataManager.getVariants('tenant', tenant.id);
        }
        this.populateTenantDropdowns();
    },

    // ========================================
    // Navigation
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
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Update sections
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`section-${section}`).classList.add('active');

        // Update title
        const titles = {
            'dashboard': 'Dashboard',
            'rekap-harian': 'Rekap Harian',
            'rekap-bulanan': 'Rekap Bulanan',
            'pengaturan': 'Pengaturan'
        };
        document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';

        this.currentSection = section;

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');

        // Refresh section data
        if (section === 'dashboard') this.refreshDashboard();
        if (section === 'pengaturan') this.renderSettings();
    },

    setupMobileMenu() {
        document.getElementById('menuBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('sidebar');
            const menuBtn = document.getElementById('menuBtn');
            if (window.innerWidth <= 1024 && sidebar.classList.contains('open')) {
                if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
    },

    // ========================================
    // Filters
    // ========================================

    setupFilters() {
        // Daily filters - auto-load on change
        document.getElementById('dailyDate').addEventListener('change', () => this.onDailyFilterChange());
        document.getElementById('dailyLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('dailyTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? 'flex' : 'none';
            if (e.target.value === 'toko') this.onDailyFilterChange();
        });
        document.getElementById('dailyTenantSelect').addEventListener('change', () => this.onDailyFilterChange());

        // Monthly filters - auto-load on change
        document.getElementById('monthlyMonth').addEventListener('change', () => this.onMonthlyFilterChange());
        document.getElementById('monthlyLocationType').addEventListener('change', (e) => {
            const tenantGroup = document.getElementById('monthlyTenantGroup');
            tenantGroup.style.display = e.target.value === 'tenant' ? 'flex' : 'none';
            if (e.target.value === 'toko') this.onMonthlyFilterChange();
        });
        document.getElementById('monthlyTenantSelect').addEventListener('change', () => this.onMonthlyFilterChange());
    },

    onDailyFilterChange() {
        const location = this.getSelectedLocation('daily');
        const date = document.getElementById('dailyDate').value;
        if (location && date) this.loadDailyData();
    },

    onMonthlyFilterChange() {
        const location = this.getSelectedLocation('monthly');
        const month = document.getElementById('monthlyMonth').value;
        if (location && month) this.loadMonthlyData();
    },

    populateTenantDropdowns() {
        const selects = ['dailyTenantSelect', 'monthlyTenantSelect'];
        selects.forEach(selId => {
            const sel = document.getElementById(selId);
            sel.innerHTML = '<option value="">-- Pilih Tenant --</option>';
            this.tenantsList.forEach(t => {
                sel.innerHTML += `<option value="${t.id}">${t.name}</option>`;
            });
        });
    },

    getSelectedLocation(prefix) {
        const locationType = document.getElementById(`${prefix}LocationType`).value;
        let locationId = 'main';
        
        if (locationType === 'tenant') {
            locationId = document.getElementById(`${prefix}TenantSelect`).value;
            if (!locationId) {
                Utils.toast('Pilih tenant terlebih dahulu', 'warning');
                return null;
            }
        }
        
        return { locationType, locationId };
    },

    // ========================================
    // Dashboard
    // ========================================

    async refreshDashboard() {
        if (!firebaseReady) return;

        // Update stats
        document.getElementById('statTokoVariants').textContent = this.tokoVariants.length;
        document.getElementById('statTenantCount').textContent = this.tenantsList.length;

        // Load today's toko data
        const today = Utils.getToday();
        const tokoData = await DataManager.loadStockData('toko', 'main', today);
        
        if (tokoData && tokoData.items) {
            const totals = Utils.calculateTotals(tokoData.items);
            document.getElementById('dashTokoStokAkhir').textContent = Utils.formatNumber(totals.stokAkhir);
            document.getElementById('dashTokoSales').textContent = Utils.formatNumber(totals.sales);
            document.getElementById('dashTokoSelisih').textContent = Utils.formatNumber(totals.selisih);
            document.getElementById('dashTokoStatus').textContent = 'Sudah diisi';
            document.getElementById('dashTokoStatus').classList.add('filled');

            document.getElementById('statTodaySales').textContent = Utils.formatNumber(totals.sales);
            document.getElementById('statTodaySelisih').textContent = Utils.formatNumber(totals.selisih);
        } else {
            document.getElementById('dashTokoStokAkhir').textContent = '-';
            document.getElementById('dashTokoSales').textContent = '-';
            document.getElementById('dashTokoSelisih').textContent = '-';
            document.getElementById('dashTokoStatus').textContent = 'Belum diisi';
            document.getElementById('dashTokoStatus').classList.remove('filled');
        }

        // Render tenant quick list
        this.renderTenantQuickList();
    },

    async renderTenantQuickList() {
        const list = document.getElementById('tenantQuickList');
        
        if (this.tenantsList.length === 0) {
            list.innerHTML = '<p class="empty-msg">Belum ada tenant. Tambahkan di Pengaturan.</p>';
            document.getElementById('dashTenantBadge').textContent = '0 tenant';
            return;
        }

        document.getElementById('dashTenantBadge').textContent = `${this.tenantsList.length} tenant`;
        
        const today = Utils.getToday();
        let html = '';
        
        for (const tenant of this.tenantsList) {
            const data = await DataManager.loadStockData('tenant', tenant.id, today);
            const status = data ? 'Sudah diisi' : 'Belum diisi';
            const statusClass = data ? 'color: var(--success)' : 'color: var(--text-muted)';
            
            html += `
                <div class="tenant-quick-item" onclick="App.goToDaily('tenant', '${tenant.id}')">
                    <span class="tq-name">🏬 ${tenant.name}</span>
                    <span class="tq-status" style="${statusClass}">${status}</span>
                </div>
            `;
        }
        
        list.innerHTML = html;
    },

    // Navigate to daily recap with pre-selected location
    goToDaily(locationType, locationId) {
        this.navigateTo('rekap-harian');
        document.getElementById('dailyLocationType').value = locationType;
        
        if (locationType === 'tenant') {
            document.getElementById('dailyTenantGroup').style.display = 'flex';
            document.getElementById('dailyTenantSelect').value = locationId;
        } else {
            document.getElementById('dailyTenantGroup').style.display = 'none';
        }
        
        document.getElementById('dailyDate').value = Utils.getToday();
        this.loadDailyData();
    },

    // ========================================
    // Daily Recap
    // ========================================

    /**
     * Stop current daily listener and save timeout
     */
    stopDailyListener() {
        if (this.dailyListener) {
            this.dailyListener();
            this.dailyListener = null;
        }
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
    },

    async loadDailyData() {
        const location = this.getSelectedLocation('daily');
        if (!location) return;

        const date = document.getElementById('dailyDate').value;
        if (!date) return;

        // Stop previous listener
        this.stopDailyListener();

        // Cache current context
        this.dailyLocation = location;
        this.dailyDate = date;

        Utils.showLoading();
        this.updateSaveStatus('loading');

        try {
            const variants = await DataManager.getVariants(location.locationType, location.locationId);
            this.dailyVariants = variants;
            const prevClosing = await DataManager.getPreviousDayClosing(location.locationType, location.locationId, date);

            // Set up real-time listener
            this.dailyListener = DataManager.listenToStockData(
                location.locationType, location.locationId, date,
                (data) => {
                    // Skip if we're the one saving (avoid loop)
                    if (this.isSaving) return;

                    // Build rows from snapshot data
                    this.dailyData = variants.map(v => {
                        const existing = data?.items?.find(item => item.variantId === v.id);
                        if (existing) {
                            return { ...existing };
                        } else {
                            return {
                                variantId: v.id,
                                variantName: v.name,
                                stokAwal: prevClosing?.[v.id] || 0,
                                stokIn: 0, rollingMasuk: 0,
                                sales: 0, returnExp: 0, returnTester: 0,
                                keepPO: 0, mixAdj: 0, kirimStok: 0,
                                rollingKeluar: 0, stokAvailable: 0
                            };
                        }
                    });

                    this.renderDailyTable();
                    document.getElementById('btnExportDaily').disabled = false;
                    this.updateSaveStatus('synced');
                }
            );

        } catch (error) {
            console.error('Error loading daily data:', error);
            Utils.toast('Gagal memuat data', 'error');
            this.updateSaveStatus('error');
        }

        Utils.hideLoading();
    },

    /**
     * Update the save status indicator
     */
    updateSaveStatus(status) {
        const el = document.getElementById('saveStatus');
        if (!el) return;
        const map = {
            'loading': { text: 'Memuat...', icon: '⏳', cls: 'status-loading' },
            'saving': { text: 'Menyimpan...', icon: '💾', cls: 'status-saving' },
            'synced': { text: 'Tersimpan', icon: '✅', cls: 'status-synced' },
            'error': { text: 'Error', icon: '❌', cls: 'status-error' },
            'idle': { text: '', icon: '', cls: '' }
        };
        const s = map[status] || map['idle'];
        el.className = 'save-status ' + s.cls;
        el.innerHTML = s.icon ? `<span>${s.icon}</span> ${s.text}` : '';
    },

    renderDailyTable() {
        const tbody = document.getElementById('dailyTableBody');
        const tfoot = document.getElementById('dailyTableFoot');

        if (this.dailyData.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="17" class="empty-cell">
                        <div class="empty-state">
                            <span class="empty-icon">📋</span>
                            <p>Tidak ada data varian</p>
                        </div>
                    </td>
                </tr>`;
            tfoot.style.display = 'none';
            return;
        }

        const inputFields = ['stokAwal', 'stokIn', 'rollingMasuk', 'sales', 'returnExp', 'returnTester', 'keepPO', 'mixAdj', 'kirimStok', 'rollingKeluar', 'stokAvailable'];

        let html = '';
        this.dailyData.forEach((row, idx) => {
            const calc = Utils.calculateRow(row);
            const selisihClass = calc.selisih > 0 ? 'cell-selisih-positive' : calc.selisih < 0 ? 'cell-selisih-negative' : 'cell-selisih-zero';
            
            html += `<tr data-idx="${idx}">`;
            html += `<td class="sticky-col col-no">${idx + 1}</td>`;
            html += `<td class="sticky-col-2 col-varian">${row.variantName}</td>`;
            
            // Stok Awal
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.stokAwal}" data-field="stokAwal" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Stok In
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.stokIn}" data-field="stokIn" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Rolling Masuk
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.rollingMasuk}" data-field="rollingMasuk" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Total Masuk (calculated)
            html += `<td class="cell-calc" id="calc_totalMasuk_${idx}">${Utils.f2(calc.totalMasuk)}</td>`;
            // Sales
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.sales}" data-field="sales" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Return Exp
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.returnExp}" data-field="returnExp" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Return Tester
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.returnTester}" data-field="returnTester" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Keep PO
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.keepPO}" data-field="keepPO" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Mix Adj
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.mixAdj}" data-field="mixAdj" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Kirim Stok
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.kirimStok}" data-field="kirimStok" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Rolling Keluar
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.rollingKeluar}" data-field="rollingKeluar" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Total Keluar (calculated)
            html += `<td class="cell-calc" id="calc_totalKeluar_${idx}">${Utils.f2(calc.totalKeluar)}</td>`;
            // Stok Akhir (calculated)
            html += `<td class="cell-calc" id="calc_stokAkhir_${idx}">${Utils.f2(calc.stokAkhir)}</td>`;
            // Stok Available Closing
            html += `<td><input type="number" step="0.01" class="cell-input" value="${row.stokAvailable}" data-field="stokAvailable" data-idx="${idx}" onchange="App.onCellChange(this)" onfocus="this.select()"></td>`;
            // Selisih (calculated)
            html += `<td class="cell-calc ${selisihClass}" id="calc_selisih_${idx}">${Utils.f2(calc.selisih)}</td>`;
            
            html += `</tr>`;
        });

        tbody.innerHTML = html;
        tfoot.style.display = '';
        this.updateDailyTotals();
    },

    onCellChange(input) {
        const idx = parseInt(input.dataset.idx);
        const field = input.dataset.field;
        const value = parseFloat(input.value) || 0;

        // Update data
        this.dailyData[idx][field] = value;

        // Recalculate
        const calc = Utils.calculateRow(this.dailyData[idx]);
        
        document.getElementById(`calc_totalMasuk_${idx}`).textContent = Utils.f2(calc.totalMasuk);
        document.getElementById(`calc_totalKeluar_${idx}`).textContent = Utils.f2(calc.totalKeluar);
        document.getElementById(`calc_stokAkhir_${idx}`).textContent = Utils.f2(calc.stokAkhir);
        
        const selisihCell = document.getElementById(`calc_selisih_${idx}`);
        selisihCell.textContent = Utils.f2(calc.selisih);
        selisihCell.className = 'cell-calc ' + (calc.selisih > 0 ? 'cell-selisih-positive' : calc.selisih < 0 ? 'cell-selisih-negative' : 'cell-selisih-zero');

        this.updateDailyTotals();

        // Auto-save
        this.scheduleSave();
    },

    updateDailyTotals() {
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

    /**
     * Auto-save daily data with debounce
     */
    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.updateSaveStatus('saving');

        this.saveTimeout = setTimeout(async () => {
            if (!this.dailyLocation || !this.dailyDate) return;
            if (this.dailyData.length === 0) return;

            this.isSaving = true;
            const success = await DataManager.saveStockData(
                this.dailyLocation.locationType,
                this.dailyLocation.locationId,
                this.dailyDate,
                this.dailyData
            );

            // Brief delay before re-enabling listener to avoid echo
            setTimeout(() => { this.isSaving = false; }, 500);

            if (success) {
                this.updateSaveStatus('synced');
            } else {
                this.updateSaveStatus('error');
                Utils.toast('Gagal menyimpan data', 'error');
            }
        }, 1000); // 1s debounce
    },

    exportDaily() {
        if (this.dailyData.length === 0) return;

        const date = document.getElementById('dailyDate').value;
        const location = this.getSelectedLocation('daily');
        if (!location) return;

        const locationName = location.locationType === 'toko' ? 'Toko' : 
            this.tenantsList.find(t => t.id === location.locationId)?.name || 'Tenant';

        const headers = ['No', 'Varian', 'Stok Awal', 'Stok In', 'Rolling Masuk', 'Total Masuk', 'Sales', 'Return Exp', 'Return Tester', 'Keep PO', 'Mix Adj', 'Kirim Stok', 'Rolling Keluar', 'Total Keluar', 'Stok Akhir', 'Stok Avail. Closing', 'Selisih'];

        const rows = this.dailyData.map((row, idx) => {
            const calc = Utils.calculateRow(row);
            return [
                idx + 1,
                row.variantName,
                row.stokAwal, row.stokIn, row.rollingMasuk, calc.totalMasuk,
                row.sales, row.returnExp, row.returnTester, row.keepPO, row.mixAdj, row.kirimStok, row.rollingKeluar, calc.totalKeluar,
                calc.stokAkhir, row.stokAvailable, calc.selisih
            ];
        });

        // Add totals row
        const totals = Utils.calculateTotals(this.dailyData);
        rows.push([
            '', 'TOTAL',
            totals.stokAwal, totals.stokIn, totals.rollingMasuk, totals.totalMasuk,
            totals.sales, totals.returnExp, totals.returnTester, totals.keepPO, totals.mixAdj, totals.kirimStok, totals.rollingKeluar, totals.totalKeluar,
            totals.stokAkhir, totals.stokAvailable, totals.selisih
        ]);

        Utils.exportCSV(headers, rows, `Rekap_Harian_${locationName}_${date}.csv`);
        Utils.toast('File CSV berhasil di-export', 'success');
    },

    importDaily(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Must have date and location selected first
        const location = this.getSelectedLocation('daily');
        const date = document.getElementById('dailyDate').value;
        if (!location || !date) {
            Utils.toast('Pilih tanggal dan lokasi terlebih dahulu', 'warning');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                
                if (lines.length < 2) {
                    Utils.toast('File CSV kosong atau tidak valid', 'error');
                    return;
                }

                // Parse header
                const headers = this.parseCSVLine(lines[0]);
                
                // Find column indices
                const colMap = {};
                const fieldNames = {
                    'stok awal': 'stokAwal',
                    'stok in': 'stokIn',
                    'rolling masuk': 'rollingMasuk',
                    'sales': 'sales',
                    'return exp': 'returnExp',
                    'return tester': 'returnTester',
                    'keep po': 'keepPO',
                    'mix adj': 'mixAdj',
                    'kirim stok': 'kirimStok',
                    'rolling keluar': 'rollingKeluar',
                    'stok avail. closing': 'stokAvailable',
                    'stok available closing': 'stokAvailable',
                    'stok available': 'stokAvailable'
                };

                headers.forEach((h, i) => {
                    const key = h.toLowerCase().trim();
                    if (fieldNames[key]) {
                        colMap[fieldNames[key]] = i;
                    }
                    if (key === 'varian' || key === 'variant') {
                        colMap._varianIdx = i;
                    }
                });

                if (colMap._varianIdx === undefined) {
                    Utils.toast('Kolom "Varian" tidak ditemukan di CSV', 'error');
                    return;
                }

                // Parse data rows (skip TOTAL row)
                let importCount = 0;
                for (let r = 1; r < lines.length; r++) {
                    const cols = this.parseCSVLine(lines[r]);
                    const variantName = (cols[colMap._varianIdx] || '').trim();
                    
                    // Skip empty or TOTAL row
                    if (!variantName || variantName.toUpperCase() === 'TOTAL') continue;

                    // Find matching row in dailyData
                    const dataRow = this.dailyData.find(d => 
                        d.variantName.toLowerCase() === variantName.toLowerCase()
                    );
                    
                    if (dataRow) {
                        // Update fields from CSV
                        Object.keys(colMap).forEach(field => {
                            if (field.startsWith('_')) return; // Skip internal
                            const val = parseFloat(cols[colMap[field]]) || 0;
                            dataRow[field] = val;
                        });
                        importCount++;
                    }
                }

                if (importCount === 0) {
                    Utils.toast('Tidak ada varian yang cocok', 'warning');
                } else {
                    this.renderDailyTable();
                    this.scheduleSave();
                    Utils.toast(`${importCount} varian berhasil diimport`, 'success');
                }

            } catch (err) {
                console.error('Import error:', err);
                Utils.toast('Gagal membaca file CSV', 'error');
            }

            // Reset file input
            event.target.value = '';
        };

        reader.readAsText(file);
    },

    /**
     * Parse a single CSV line handling quoted fields
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current.trim());
        return result;
    },

    // ========================================
    // Monthly Recap
    // ========================================

    async loadMonthlyData() {
        const location = this.getSelectedLocation('monthly');
        if (!location) return;

        const monthStr = document.getElementById('monthlyMonth').value;
        if (!monthStr) {
            Utils.toast('Pilih bulan terlebih dahulu', 'warning');
            return;
        }

        Utils.showLoading();

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
            const lastDay = sortedDays[sortedDays.length - 1];

            // Sum all daily data
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

            // Stok Awal = first day's stok awal; Stok Avail. Closing = last day's stok available
            if (firstDay && firstDay.items) {
                firstDay.items.forEach(item => {
                    if (aggregated[item.variantId]) {
                        aggregated[item.variantId].stokAwal = Number(item.stokAwal) || 0;
                    }
                });
            }
            // Walk through all days in order - keep the latest stokAvailable per variant
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
            this.renderMonthlyBreakdown(allDays, monthStr);

            document.getElementById('btnExportMonthly').disabled = false;

        } catch (error) {
            console.error('Error loading monthly data:', error);
            Utils.toast('Gagal memuat data bulanan', 'error');
        }

        Utils.hideLoading();
    },

    renderMonthlyTable() {
        const tbody = document.getElementById('monthlyTableBody');
        const tfoot = document.getElementById('monthlyTableFoot');

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
            tfoot.style.display = 'none';
            return;
        }

        let html = '';
        this.monthlyData.forEach((row, idx) => {
            const calc = Utils.calculateRow(row);
            const selisihClass = calc.selisih > 0 ? 'cell-selisih-positive' : calc.selisih < 0 ? 'cell-selisih-negative' : 'cell-selisih-zero';
            
            html += `<tr>`;
            html += `<td class="sticky-col col-no">${idx + 1}</td>`;
            html += `<td class="sticky-col-2 col-varian">${row.variantName}</td>`;
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
        const totals = Utils.calculateTotals(this.monthlyData);
        document.getElementById('mTotalStokAwal').textContent = Utils.f2(totals.stokAwal);
        document.getElementById('mTotalStokIn').textContent = Utils.f2(totals.stokIn);
        document.getElementById('mTotalRollingMasuk').textContent = Utils.f2(totals.rollingMasuk);
        document.getElementById('mTotalTotalMasuk').textContent = Utils.f2(totals.totalMasuk);
        document.getElementById('mTotalSales').textContent = Utils.f2(totals.sales);
        document.getElementById('mTotalReturnExp').textContent = Utils.f2(totals.returnExp);
        document.getElementById('mTotalReturnTester').textContent = Utils.f2(totals.returnTester);
        document.getElementById('mTotalKeepPO').textContent = Utils.f2(totals.keepPO);
        document.getElementById('mTotalMixAdj').textContent = Utils.f2(totals.mixAdj);
        document.getElementById('mTotalKirimStok').textContent = Utils.f2(totals.kirimStok);
        document.getElementById('mTotalRollingKeluar').textContent = Utils.f2(totals.rollingKeluar);
        document.getElementById('mTotalTotalKeluar').textContent = Utils.f2(totals.totalKeluar);
        document.getElementById('mTotalStokAkhir').textContent = Utils.f2(totals.stokAkhir);
        document.getElementById('mTotalStokAvailable').textContent = Utils.f2(totals.stokAvailable);
        document.getElementById('mTotalSelisih').textContent = Utils.f2(totals.selisih);
    },

    renderMonthlyBreakdown(allDays, monthStr) {
        const container = document.getElementById('monthlyBreakdown');
        const list = document.getElementById('breakdownList');
        
        const allDates = Utils.getDatesInMonth(monthStr);
        const dateMap = {};
        allDays.forEach(d => { dateMap[d.date] = d; });

        let html = '';
        allDates.forEach(date => {
            const dayNum = parseInt(date.split('-')[2]);
            const hasData = dateMap[date];
            const dataClass = hasData ? 'has-data' : '';
            let salesTotal = 0;
            
            if (hasData && hasData.items) {
                hasData.items.forEach(item => { salesTotal += Number(item.sales) || 0; });
            }

            html += `
                <div class="breakdown-day ${dataClass}" onclick="App.goToDayFromMonthly('${date}')">
                    <span class="day-date">${dayNum}</span>
                    <span class="day-sales">${hasData ? `Sales: ${salesTotal}` : '-'}</span>
                </div>
            `;
        });

        list.innerHTML = html;
        container.style.display = 'block';
    },

    goToDayFromMonthly(date) {
        const location = this.getSelectedLocation('monthly');
        if (!location) return;

        this.navigateTo('rekap-harian');
        document.getElementById('dailyDate').value = date;
        document.getElementById('dailyLocationType').value = location.locationType;
        
        if (location.locationType === 'tenant') {
            document.getElementById('dailyTenantGroup').style.display = 'flex';
            document.getElementById('dailyTenantSelect').value = location.locationId;
        }
        
        this.loadDailyData();
    },

    exportMonthly() {
        if (this.monthlyData.length === 0) return;

        const monthStr = document.getElementById('monthlyMonth').value;
        const location = this.getSelectedLocation('monthly');
        if (!location) return;

        const locationName = location.locationType === 'toko' ? 'Toko' : 
            this.tenantsList.find(t => t.id === location.locationId)?.name || 'Tenant';

        const headers = ['No', 'Varian', 'Stok Awal', 'Stok In', 'Rolling Masuk', 'Total Masuk', 'Sales', 'Return Exp', 'Return Tester', 'Keep PO', 'Mix Adj', 'Kirim Stok', 'Rolling Keluar', 'Total Keluar', 'Stok Akhir', 'Stok Avail. Closing', 'Selisih'];

        const rows = this.monthlyData.map((row, idx) => {
            const calc = Utils.calculateRow(row);
            return [
                idx + 1, row.variantName,
                row.stokAwal, row.stokIn, row.rollingMasuk, calc.totalMasuk,
                row.sales, row.returnExp, row.returnTester, row.keepPO, row.mixAdj, row.kirimStok, row.rollingKeluar, calc.totalKeluar,
                calc.stokAkhir, row.stokAvailable, calc.selisih
            ];
        });

        const totals = Utils.calculateTotals(this.monthlyData);
        rows.push([
            '', 'TOTAL',
            totals.stokAwal, totals.stokIn, totals.rollingMasuk, totals.totalMasuk,
            totals.sales, totals.returnExp, totals.returnTester, totals.keepPO, totals.mixAdj, totals.kirimStok, totals.rollingKeluar, totals.totalKeluar,
            totals.stokAkhir, totals.stokAvailable, totals.selisih
        ]);

        Utils.exportCSV(headers, rows, `Rekap_Bulanan_${locationName}_${monthStr}.csv`);
        Utils.toast('File CSV berhasil di-export', 'success');
    },

    // ========================================
    // Settings
    // ========================================

    async renderSettings() {
        await this.loadSettingsCache();
        this.renderVariantList('toko');
        this.renderTenantVariantCard();
        this.renderTenantSettings();
    },

    renderVariantList(type, tenantId) {
        if (type === 'toko') {
            const list = document.getElementById('tokoVariantList');
            const variants = this.tokoVariants;

            if (variants.length === 0) {
                list.innerHTML = '<p class="empty-msg">Belum ada varian</p>';
                return;
            }

            let html = '';
            variants.forEach((v, idx) => {
                html += `
                    <div class="variant-item">
                        <span class="item-name">${v.name}</span>
                        <div class="item-actions">
                            <button class="btn-icon" onclick="App.editVariant('toko', ${idx})" title="Edit">✏️</button>
                            <button class="btn-icon delete" onclick="App.deleteVariant('toko', ${idx})" title="Hapus">🗑️</button>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
        } else {
            // Tenant variant list
            const list = document.getElementById('tenantVariantList');
            if (!tenantId) {
                list.innerHTML = '<p class="empty-msg">Pilih tenant di atas untuk mengelola varian</p>';
                return;
            }

            const variants = this.tenantVariantsMap[tenantId] || [];

            if (variants.length === 0) {
                list.innerHTML = '<p class="empty-msg">Belum ada varian untuk tenant ini</p>';
                return;
            }

            let html = '';
            variants.forEach((v, idx) => {
                html += `
                    <div class="variant-item">
                        <span class="item-name">${v.name}</span>
                        <div class="item-actions">
                            <button class="btn-icon" onclick="App.editVariant('tenant', ${idx})" title="Edit">✏️</button>
                            <button class="btn-icon delete" onclick="App.deleteVariant('tenant', ${idx})" title="Hapus">🗑️</button>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
        }
    },

    /**
     * Render the tenant variant card with a tenant selector dropdown
     */
    renderTenantVariantCard() {
        const headerArea = document.getElementById('tenantVariantHeader');
        if (!headerArea) return;

        // Build tenant selector
        let selectorHtml = '<select id="settingsTenantSelect" class="filter-input" style="min-width:140px;font-size:0.82rem;padding:6px 10px;" onchange="App.onSettingsTenantChange(this.value)">';
        selectorHtml += '<option value="">-- Pilih Tenant --</option>';
        this.tenantsList.forEach(t => {
            const selected = t.id === this.selectedSettingsTenantId ? 'selected' : '';
            selectorHtml += `<option value="${t.id}" ${selected}>${t.name}</option>`;
        });
        selectorHtml += '</select>';
        headerArea.innerHTML = selectorHtml;

        // Update add button state
        const addBtn = document.getElementById('btnAddTenantVariant');
        if (addBtn) {
            addBtn.disabled = !this.selectedSettingsTenantId;
        }

        // Render variant list for selected tenant
        this.renderVariantList('tenant', this.selectedSettingsTenantId);
    },

    onSettingsTenantChange(tenantId) {
        this.selectedSettingsTenantId = tenantId || null;
        const addBtn = document.getElementById('btnAddTenantVariant');
        if (addBtn) addBtn.disabled = !tenantId;
        this.renderVariantList('tenant', this.selectedSettingsTenantId);
    },

    renderTenantSettings() {
        const list = document.getElementById('tenantSettingsList');

        if (this.tenantsList.length === 0) {
            list.innerHTML = '<p class="empty-msg">Belum ada tenant</p>';
            return;
        }

        let html = '';
        this.tenantsList.forEach((t, idx) => {
            const varCount = (this.tenantVariantsMap[t.id] || []).length;
            html += `
                <div class="tenant-item">
                    <div>
                        <span class="item-name">🏬 ${t.name}</span>
                        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:8px;">${varCount} varian</span>
                    </div>
                    <div class="item-actions">
                        <button class="btn-icon" onclick="App.editTenant(${idx})" title="Edit">✏️</button>
                        <button class="btn-icon delete" onclick="App.deleteTenant(${idx})" title="Hapus">🗑️</button>
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;
    },

    // ========================================
    // Modal Helpers
    // ========================================

    openModal(title, bodyHtml, footerHtml) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = bodyHtml;
        document.getElementById('modalFooter').innerHTML = footerHtml;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    closeModal() {
        document.getElementById('modalOverlay').style.display = 'none';
    },

    // ========================================
    // Variant CRUD
    // ========================================

    addVariant(type) {
        if (type === 'tenant' && !this.selectedSettingsTenantId) {
            Utils.toast('Pilih tenant terlebih dahulu', 'warning');
            return;
        }
        const typeName = type === 'toko' ? 'Toko' : this.tenantsList.find(t => t.id === this.selectedSettingsTenantId)?.name || 'Tenant';
        this.openModal(
            `Tambah Varian — ${typeName}`,
            `<div class="form-group">
                <label for="variantNameInput">Nama Varian</label>
                <input type="text" id="variantNameInput" class="form-control" placeholder="Contoh: Lapis Legit Original" autofocus>
            </div>`,
            `<button class="btn btn-outline" onclick="App.closeModal()">Batal</button>
             <button class="btn btn-primary" onclick="App.saveNewVariant('${type}')">Simpan</button>`
        );

        // Focus input
        setTimeout(() => document.getElementById('variantNameInput').focus(), 100);
    },

    async saveNewVariant(type) {
        const name = document.getElementById('variantNameInput').value.trim();
        if (!name) {
            Utils.toast('Nama varian tidak boleh kosong', 'warning');
            return;
        }

        let variants, locationId;
        if (type === 'toko') {
            variants = this.tokoVariants;
            locationId = 'main';
        } else {
            locationId = this.selectedSettingsTenantId;
            if (!locationId) { Utils.toast('Pilih tenant terlebih dahulu', 'warning'); return; }
            if (!this.tenantVariantsMap[locationId]) this.tenantVariantsMap[locationId] = [];
            variants = this.tenantVariantsMap[locationId];
        }

        variants.push({ id: Utils.generateId(), name: name });

        Utils.showLoading();
        const success = await DataManager.saveVariants(type, variants, locationId);
        Utils.hideLoading();

        if (success) {
            Utils.toast(`Varian "${name}" berhasil ditambahkan`, 'success');
            this.closeModal();
            this.renderVariantList(type, type === 'tenant' ? locationId : undefined);
        } else {
            variants.pop(); // Revert
            Utils.toast('Gagal menyimpan varian', 'error');
        }
    },

    editVariant(type, idx) {
        let variants, typeName;
        if (type === 'toko') {
            variants = this.tokoVariants;
            typeName = 'Toko';
        } else {
            const tenantId = this.selectedSettingsTenantId;
            variants = this.tenantVariantsMap[tenantId] || [];
            typeName = this.tenantsList.find(t => t.id === tenantId)?.name || 'Tenant';
        }
        const variant = variants[idx];

        this.openModal(
            `Edit Varian — ${typeName}`,
            `<div class="form-group">
                <label for="variantNameInput">Nama Varian</label>
                <input type="text" id="variantNameInput" class="form-control" value="${variant.name}">
            </div>`,
            `<button class="btn btn-outline" onclick="App.closeModal()">Batal</button>
             <button class="btn btn-primary" onclick="App.saveEditVariant('${type}', ${idx})">Simpan</button>`
        );

        setTimeout(() => document.getElementById('variantNameInput').focus(), 100);
    },

    async saveEditVariant(type, idx) {
        const name = document.getElementById('variantNameInput').value.trim();
        if (!name) {
            Utils.toast('Nama varian tidak boleh kosong', 'warning');
            return;
        }

        let variants, locationId;
        if (type === 'toko') {
            variants = this.tokoVariants;
            locationId = 'main';
        } else {
            locationId = this.selectedSettingsTenantId;
            variants = this.tenantVariantsMap[locationId] || [];
        }
        variants[idx].name = name;

        Utils.showLoading();
        const success = await DataManager.saveVariants(type, variants, locationId);
        Utils.hideLoading();

        if (success) {
            Utils.toast('Varian berhasil diupdate', 'success');
            this.closeModal();
            this.renderVariantList(type, type === 'tenant' ? locationId : undefined);
        } else {
            Utils.toast('Gagal menyimpan perubahan', 'error');
        }
    },

    async deleteVariant(type, idx) {
        let variants, locationId;
        if (type === 'toko') {
            variants = this.tokoVariants;
            locationId = 'main';
        } else {
            locationId = this.selectedSettingsTenantId;
            variants = this.tenantVariantsMap[locationId] || [];
        }
        const name = variants[idx].name;

        if (!confirm(`Hapus varian "${name}"?\nData stok yang sudah tersimpan tidak akan terpengaruh.`)) return;

        variants.splice(idx, 1);

        Utils.showLoading();
        const success = await DataManager.saveVariants(type, variants, locationId);
        Utils.hideLoading();

        if (success) {
            Utils.toast(`Varian "${name}" berhasil dihapus`, 'success');
            this.renderVariantList(type, type === 'tenant' ? locationId : undefined);
        } else {
            Utils.toast('Gagal menghapus varian', 'error');
        }
    },

    // ========================================
    // Tenant CRUD
    // ========================================

    addTenant() {
        this.openModal(
            'Tambah Tenant Baru',
            `<div class="form-group">
                <label for="tenantNameInput">Nama Tenant / Lokasi</label>
                <input type="text" id="tenantNameInput" class="form-control" placeholder="Contoh: Mall Grand City Lt.2" autofocus>
            </div>`,
            `<button class="btn btn-outline" onclick="App.closeModal()">Batal</button>
             <button class="btn btn-primary" onclick="App.saveNewTenant()">Simpan</button>`
        );

        setTimeout(() => document.getElementById('tenantNameInput').focus(), 100);
    },

    async saveNewTenant() {
        const name = document.getElementById('tenantNameInput').value.trim();
        if (!name) {
            Utils.toast('Nama tenant tidak boleh kosong', 'warning');
            return;
        }

        const newTenant = {
            id: Utils.generateId(),
            name: name
        };
        this.tenantsList.push(newTenant);

        Utils.showLoading();
        const success = await DataManager.saveTenants(this.tenantsList);
        
        if (success) {
            // Initialize default variants for the new tenant
            await DataManager.initTenantVariants(newTenant.id);
            this.tenantVariantsMap[newTenant.id] = [...DataManager.defaultTenantVariants];
        }
        Utils.hideLoading();

        if (success) {
            Utils.toast(`Tenant "${name}" berhasil ditambahkan (dengan varian default)`, 'success');
            this.closeModal();
            this.renderTenantSettings();
            this.renderTenantVariantCard();
            this.populateTenantDropdowns();
        } else {
            this.tenantsList.pop();
            Utils.toast('Gagal menyimpan tenant', 'error');
        }
    },

    editTenant(idx) {
        const tenant = this.tenantsList[idx];

        this.openModal(
            'Edit Tenant',
            `<div class="form-group">
                <label for="tenantNameInput">Nama Tenant / Lokasi</label>
                <input type="text" id="tenantNameInput" class="form-control" value="${tenant.name}">
            </div>`,
            `<button class="btn btn-outline" onclick="App.closeModal()">Batal</button>
             <button class="btn btn-primary" onclick="App.saveEditTenant(${idx})">Simpan</button>`
        );

        setTimeout(() => document.getElementById('tenantNameInput').focus(), 100);
    },

    async saveEditTenant(idx) {
        const name = document.getElementById('tenantNameInput').value.trim();
        if (!name) {
            Utils.toast('Nama tenant tidak boleh kosong', 'warning');
            return;
        }

        this.tenantsList[idx].name = name;

        Utils.showLoading();
        const success = await DataManager.saveTenants(this.tenantsList);
        Utils.hideLoading();

        if (success) {
            Utils.toast('Tenant berhasil diupdate', 'success');
            this.closeModal();
            this.renderTenantSettings();
            this.populateTenantDropdowns();
        } else {
            Utils.toast('Gagal menyimpan perubahan', 'error');
        }
    },

    async deleteTenant(idx) {
        const name = this.tenantsList[idx].name;
        if (!confirm(`Hapus tenant "${name}"?\nData stok tenant ini yang sudah tersimpan TIDAK akan dihapus.`)) return;

        this.tenantsList.splice(idx, 1);

        Utils.showLoading();
        const success = await DataManager.saveTenants(this.tenantsList);
        Utils.hideLoading();

        if (success) {
            Utils.toast(`Tenant "${name}" berhasil dihapus`, 'success');
            this.renderTenantSettings();
            this.populateTenantDropdowns();
        } else {
            Utils.toast('Gagal menghapus tenant', 'error');
        }
    },

    // ========================================
    // Backup & Restore
    // ========================================

    async exportAllData() {
        Utils.showLoading();
        const data = await DataManager.getAllStockData();
        Utils.hideLoading();

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Lapis_Stok_Backup_${Utils.getToday()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        Utils.toast('Backup berhasil di-download', 'success');
    },

    async importAllData(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!confirm('Import data akan menimpa settings yang ada. Lanjutkan?')) {
            event.target.value = '';
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            Utils.showLoading();
            const success = await DataManager.importAllData(data);
            Utils.hideLoading();

            if (success) {
                Utils.toast('Data berhasil di-import!', 'success');
                await this.loadSettingsCache();
                this.renderSettings();
                this.refreshDashboard();
            } else {
                Utils.toast('Gagal import data', 'error');
            }
        } catch (error) {
            console.error('Import error:', error);
            Utils.toast('File tidak valid', 'error');
        }

        event.target.value = '';
    },

    async initDefaults() {
        if (!confirm('Reset semua pengaturan ke default? Data stok yang tersimpan TIDAK akan dihapus.')) return;

        Utils.showLoading();
        const success = await DataManager.resetToDefaults();
        Utils.hideLoading();

        if (success) {
            Utils.toast('Pengaturan direset ke default', 'success');
            await this.loadSettingsCache();
            this.renderSettings();
        } else {
            Utils.toast('Gagal reset pengaturan', 'error');
        }
    },

    // ========================================
    // Notes
    // ========================================

    /**
     * Open the notes modal
     */
    openNotes() {
        const overlay = document.getElementById('notesOverlay');
        overlay.style.display = 'flex';

        // Default to today
        const today = Utils.getToday();
        document.getElementById('notesDate').value = today;
        this.notesDate = today;
        document.getElementById('notesDateLabel').textContent = Utils.formatDate(today);

        this.loadNotes(today);

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeNotes();
        });

        // Close on Escape key
        this._notesEscHandler = (e) => {
            if (e.key === 'Escape') this.closeNotes();
        };
        document.addEventListener('keydown', this._notesEscHandler);
    },

    /**
     * Close the notes modal
     */
    closeNotes() {
        // Save before closing if there's pending content
        if (this.notesSaveTimeout) {
            clearTimeout(this.notesSaveTimeout);
            this.notesSaveTimeout = null;
            // Force save now
            this._saveNotesNow();
        }

        // Stop listener
        if (this.notesListener) {
            this.notesListener();
            this.notesListener = null;
        }

        document.getElementById('notesOverlay').style.display = 'none';

        // Remove escape handler
        if (this._notesEscHandler) {
            document.removeEventListener('keydown', this._notesEscHandler);
            this._notesEscHandler = null;
        }
    },

    /**
     * Navigate to previous day
     */
    notesDatePrev() {
        const current = document.getElementById('notesDate').value;
        const prev = Utils.getPreviousDate(current);
        document.getElementById('notesDate').value = prev;
        this.onNotesDateChange();
    },

    /**
     * Navigate to next day
     */
    notesDateNext() {
        const current = document.getElementById('notesDate').value;
        const d = new Date(current + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        const next = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
        document.getElementById('notesDate').value = next;
        this.onNotesDateChange();
    },

    /**
     * Handle notes date change
     */
    onNotesDateChange() {
        // Save current notes before switching
        if (this.notesSaveTimeout) {
            clearTimeout(this.notesSaveTimeout);
            this.notesSaveTimeout = null;
            this._saveNotesNow();
        }

        const date = document.getElementById('notesDate').value;
        if (!date) return;

        this.notesDate = date;
        document.getElementById('notesDateLabel').textContent = Utils.formatDate(date);
        this.loadNotes(date);
    },

    /**
     * Load notes for a specific date
     */
    async loadNotes(date) {
        // Stop previous listener
        if (this.notesListener) {
            this.notesListener();
            this.notesListener = null;
        }

        const textarea = document.getElementById('notesTextarea');
        textarea.value = '';
        this.notesContent = '';
        this.updateNotesSaveStatus('loading');

        try {
            const data = await DataManager.loadNote(date);
            if (data && data.content) {
                textarea.value = data.content;
                this.notesContent = data.content;
            }
            this.updateNotesSaveStatus('synced');
        } catch (error) {
            console.error('Error loading notes:', error);
            this.updateNotesSaveStatus('error');
        }

        // Focus textarea
        setTimeout(() => textarea.focus(), 100);
    },

    /**
     * Handle textarea input — autosave with debounce
     */
    onNotesInput() {
        const content = document.getElementById('notesTextarea').value;
        this.notesContent = content;
        this.scheduleNotesSave();
    },

    /**
     * Schedule autosave for notes
     */
    scheduleNotesSave() {
        if (this.notesSaveTimeout) clearTimeout(this.notesSaveTimeout);
        this.updateNotesSaveStatus('saving');

        this.notesSaveTimeout = setTimeout(() => {
            this._saveNotesNow();
        }, 1200); // 1.2s debounce
    },

    /**
     * Actually save notes now
     */
    async _saveNotesNow() {
        if (!this.notesDate) return;

        this.notesIsSaving = true;

        const content = this.notesContent;

        // If content is empty, delete the note doc
        if (!content || content.trim() === '') {
            const success = await DataManager.deleteNote(this.notesDate);
            this.notesIsSaving = false;
            this.updateNotesSaveStatus(success ? 'synced' : 'error');
            return;
        }

        const success = await DataManager.saveNote(this.notesDate, content);
        this.notesIsSaving = false;

        if (success) {
            this.updateNotesSaveStatus('synced');
        } else {
            this.updateNotesSaveStatus('error');
        }
    },

    /**
     * Update notes save status indicator
     */
    updateNotesSaveStatus(status) {
        const container = document.getElementById('notesSaveStatus');
        if (!container) return;

        const dot = container.querySelector('.notes-status-dot');
        const text = container.querySelector('.notes-status-text');

        const statusMap = {
            'loading': { text: 'Memuat...', cls: 'loading' },
            'saving': { text: 'Menyimpan...', cls: 'saving' },
            'synced': { text: 'Tersimpan', cls: 'synced' },
            'error': { text: 'Error', cls: 'error' },
            'idle': { text: 'Siap', cls: 'idle' }
        };

        const s = statusMap[status] || statusMap['idle'];
        container.className = 'notes-save-status notes-status-' + s.cls;
        text.textContent = s.text;
    },

    /**
     * Clear/delete notes for the current date
     */
    async clearNotes() {
        if (!this.notesDate) return;

        const content = document.getElementById('notesTextarea').value;
        if (!content || content.trim() === '') {
            Utils.toast('Catatan sudah kosong', 'info');
            return;
        }

        if (!confirm(`Hapus catatan tanggal ${Utils.formatDate(this.notesDate)}?`)) return;

        if (this.notesSaveTimeout) {
            clearTimeout(this.notesSaveTimeout);
            this.notesSaveTimeout = null;
        }

        this.updateNotesSaveStatus('saving');
        const success = await DataManager.deleteNote(this.notesDate);

        if (success) {
            document.getElementById('notesTextarea').value = '';
            this.notesContent = '';
            this.updateNotesSaveStatus('synced');
            Utils.toast('Catatan berhasil dihapus', 'success');
        } else {
            this.updateNotesSaveStatus('error');
            Utils.toast('Gagal menghapus catatan', 'error');
        }
    }
};

// ==========================================
// Initialize App
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
