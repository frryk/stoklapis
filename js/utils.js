// ==========================================
// Utility Functions
// ==========================================

const Utils = {
    /**
     * Format date to Indonesian locale string
     * @param {string} dateStr - YYYY-MM-DD format
     * @returns {string} formatted date
     */
    formatDate(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },

    /**
     * Format date to short Indonesian format
     */
    formatDateShort(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    },

    /**
     * Format month-year for display
     */
    formatMonth(monthStr) {
        const [year, month] = monthStr.split('-');
        const date = new Date(year, month - 1, 1);
        return date.toLocaleDateString('id-ID', {
            month: 'long',
            year: 'numeric'
        });
    },

    /**
     * Get today's date in YYYY-MM-DD format
     */
    getToday() {
        const now = new Date();
        return now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
    },

    /**
     * Get current month in YYYY-MM format
     */
    getCurrentMonth() {
        const now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    },

    /**
     * Get yesterday's date in YYYY-MM-DD format
     */
    getYesterday() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    },

    /**
     * Get all dates in a given month
     */
    getDatesInMonth(monthStr) {
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const dates = [];
        for (let d = 1; d <= daysInMonth; d++) {
            dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }
        return dates;
    },

    /**
     * Get a previous date string
     */
    getPreviousDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    },

    /**
     * Calculate inventory values for a single row
     */
    calculateRow(data) {
        const stokAwal = Number(data.stokAwal) || 0;
        const stokIn = Number(data.stokIn) || 0;
        const rollingMasuk = Number(data.rollingMasuk) || 0;
        const sales = Number(data.sales) || 0;
        const returnExp = Number(data.returnExp) || 0;
        const returnTester = Number(data.returnTester) || 0;
        const keepPO = Number(data.keepPO) || 0;
        const mixAdj = Number(data.mixAdj) || 0;
        const kirimStok = Number(data.kirimStok) || 0;
        const rollingKeluar = Number(data.rollingKeluar) || 0;
        const stokAvailable = Number(data.stokAvailable) || 0;

        const totalMasuk = Math.round((stokAwal + stokIn + rollingMasuk) * 100) / 100;
        const totalKeluar = Math.round((sales + returnExp + returnTester + keepPO + mixAdj + kirimStok + rollingKeluar) * 100) / 100;
        const stokAkhir = Math.round((totalMasuk - totalKeluar) * 100) / 100;
        const selisih = Math.round((stokAvailable - stokAkhir) * 100) / 100;

        return {
            totalMasuk,
            totalKeluar,
            stokAkhir,
            selisih
        };
    },

    /**
     * Calculate totals for a whole table (array of row data)
     */
    calculateTotals(rows) {
        const fields = [
            'stokAwal', 'stokIn', 'rollingMasuk', 'totalMasuk',
            'sales', 'returnExp', 'returnTester', 'keepPO', 'mixAdj', 'kirimStok', 'rollingKeluar', 'totalKeluar',
            'stokAkhir', 'stokAvailable', 'selisih'
        ];
        
        const totals = {};
        fields.forEach(f => totals[f] = 0);
        
        rows.forEach(row => {
            const calc = Utils.calculateRow(row);
            fields.forEach(f => {
                if (f === 'totalMasuk' || f === 'totalKeluar' || f === 'stokAkhir' || f === 'selisih') {
                    totals[f] += calc[f];
                } else {
                    totals[f] += Number(row[f]) || 0;
                }
            });
        });
        
        return totals;
    },

    /**
     * Generate a UUID
     */
    generateId() {
        return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Export data to CSV and trigger download
     */
    exportCSV(headers, rows, filename) {
        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Show toast notification
     */
    toast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    },

    /**
     * Show loading overlay
     */
    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    },

    /**
     * Hide loading overlay
     */
    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    },

    /**
     * Format number to 2 decimal places
     */
    f2(num) {
        return Number(num).toFixed(2);
    },

    /**
     * Format number for display (with locale)
     */
    formatNumber(num) {
        return Number(num).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    /**
     * Create Firestore document ID for stock data
     */
    createDocId(locationType, locationId, date) {
        return `${locationType}_${locationId}_${date}`;
    }
};
