// ==========================================
// Data Management (Firebase Firestore)
// ==========================================

const DataManager = {
    // Default variants for Toko
    defaultTokoVariants: [
        { id: 'toko_v1', name: 'Lapis Legit Original' },
        { id: 'toko_v2', name: 'Lapis Legit Keju' },
        { id: 'toko_v3', name: 'Lapis Legit Pandan' },
        { id: 'toko_v4', name: 'Lapis Legit Coklat' },
        { id: 'toko_v5', name: 'Lapis Legit Prune' },
        { id: 'toko_v6', name: 'Lapis Surabaya' },
        { id: 'toko_v7', name: 'Spiku Original' },
        { id: 'toko_v8', name: 'Bolu Gulung' }
    ],

    // Default variants for Tenant
    defaultTenantVariants: [
        { id: 'tenant_v1', name: 'Lapis Legit Original (Slice)' },
        { id: 'tenant_v2', name: 'Lapis Legit Keju (Slice)' },
        { id: 'tenant_v3', name: 'Lapis Surabaya (Slice)' },
        { id: 'tenant_v4', name: 'Spiku Original (Slice)' },
        { id: 'tenant_v5', name: 'Lapis Legit Original (Loyang)' },
        { id: 'tenant_v6', name: 'Mix Box' }
    ],

    // ========================================
    // Settings: Variants
    // ========================================

    /**
     * Get variants for a location type
     * @param {string} locationType - 'toko' or 'tenant'
     * @param {string} locationId - tenant ID (required when locationType is 'tenant')
     */
    async getVariants(locationType, locationId) {
        if (!firebaseReady) return locationType === 'toko' ? [...this.defaultTokoVariants] : [...this.defaultTenantVariants];
        
        try {
            const doc = await db.collection('settings').doc('config').get();
            if (doc.exists) {
                const data = doc.data();
                if (locationType === 'toko') {
                    if (data.tokoVariants !== undefined && Array.isArray(data.tokoVariants)) {
                        return data.tokoVariants;
                    }
                } else {
                    // Per-tenant variants stored in tenantVariantsMap
                    if (data.tenantVariantsMap && data.tenantVariantsMap[locationId] !== undefined && Array.isArray(data.tenantVariantsMap[locationId])) {
                        return data.tenantVariantsMap[locationId];
                    }
                }
            }
            // Return defaults if no data
            return locationType === 'toko' ? [...this.defaultTokoVariants] : [...this.defaultTenantVariants];
        } catch (error) {
            console.error('Error getting variants:', error);
            return locationType === 'toko' ? [...this.defaultTokoVariants] : [...this.defaultTenantVariants];
        }
    },

    /**
     * Save variants for a location type
     * @param {string} locationType - 'toko' or 'tenant'
     * @param {Array} variants - array of variant objects
     * @param {string} locationId - tenant ID (required when locationType is 'tenant')
     */
    async saveVariants(locationType, variants, locationId) {
        if (!firebaseReady) {
            Utils.toast('Firebase belum terhubung', 'error');
            return false;
        }
        
        try {
            if (locationType === 'toko') {
                await db.collection('settings').doc('config').update({
                    tokoVariants: variants,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Use update() for dot-notation nested field paths
                await db.collection('settings').doc('config').update({
                    [`tenantVariantsMap.${locationId}`]: variants,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            return true;
        } catch (error) {
            console.error('Error saving variants:', error);
            return false;
        }
    },

    /**
     * Initialize default variants for a specific tenant
     */
    async initTenantVariants(tenantId) {
        if (!firebaseReady) return false;
        try {
            // Use update() for dot-notation nested field paths
            await db.collection('settings').doc('config').update({
                [`tenantVariantsMap.${tenantId}`]: [...this.defaultTenantVariants],
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error('Error initializing tenant variants:', error);
            return false;
        }
    },

    // ========================================
    // Settings: Tenants
    // ========================================

    /**
     * Get list of tenants
     */
    async getTenants() {
        if (!firebaseReady) return [];
        
        try {
            const doc = await db.collection('settings').doc('config').get();
            if (doc.exists && doc.data().tenants) {
                return doc.data().tenants;
            }
            return [];
        } catch (error) {
            console.error('Error getting tenants:', error);
            return [];
        }
    },

    /**
     * Save tenants list
     */
    async saveTenants(tenants) {
        if (!firebaseReady) {
            Utils.toast('Firebase belum terhubung', 'error');
            return false;
        }
        
        try {
            await db.collection('settings').doc('config').set(
                { tenants, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                { merge: true }
            );
            return true;
        } catch (error) {
            console.error('Error saving tenants:', error);
            return false;
        }
    },

    // ========================================
    // Stock Data
    // ========================================

    /**
     * Save daily stock data
     */
    async saveStockData(locationType, locationId, date, items) {
        if (!firebaseReady) {
            Utils.toast('Firebase belum terhubung', 'error');
            return false;
        }
        
        try {
            const docId = Utils.createDocId(locationType, locationId, date);
            
            // Calculate totals for each item before saving
            const processedItems = items.map(item => {
                const calc = Utils.calculateRow(item);
                return {
                    ...item,
                    totalMasuk: calc.totalMasuk,
                    totalKeluar: calc.totalKeluar,
                    stokAkhir: calc.stokAkhir,
                    selisih: calc.selisih
                };
            });

            await db.collection('stock_data').doc(docId).set({
                locationType,
                locationId,
                date,
                items: processedItems,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            return true;
        } catch (error) {
            console.error('Error saving stock data:', error);
            return false;
        }
    },

    /**
     * Load daily stock data
     */
    async loadStockData(locationType, locationId, date) {
        if (!firebaseReady) return null;
        
        try {
            const docId = Utils.createDocId(locationType, locationId, date);
            const doc = await db.collection('stock_data').doc(docId).get();
            
            if (doc.exists) {
                return doc.data();
            }
            return null;
        } catch (error) {
            console.error('Error loading stock data:', error);
            return null;
        }
    },

    /**
     * Listen to stock data changes in real-time
     * @returns {Function} unsubscribe function
     */
    listenToStockData(locationType, locationId, date, callback) {
        if (!firebaseReady) return null;
        
        const docId = Utils.createDocId(locationType, locationId, date);
        return db.collection('stock_data').doc(docId).onSnapshot(doc => {
            if (doc.exists) {
                callback(doc.data());
            } else {
                callback(null);
            }
        }, error => {
            console.error('Snapshot listener error:', error);
        });
    },

    /**
     * Load stock data for a whole month (for monthly recap)
     */
    async loadMonthlyStockData(locationType, locationId, monthStr) {
        if (!firebaseReady) return [];
        
        try {
            const dates = Utils.getDatesInMonth(monthStr);
            const results = [];
            
            // Fetch each day by document ID (no composite index needed)
            const promises = dates.map(date => {
                const docId = Utils.createDocId(locationType, locationId, date);
                return db.collection('stock_data').doc(docId).get();
            });
            
            const docs = await Promise.all(promises);
            
            docs.forEach(doc => {
                if (doc.exists) {
                    results.push(doc.data());
                }
            });
            
            // Sort by date
            results.sort((a, b) => a.date.localeCompare(b.date));
            
            return results;
        } catch (error) {
            console.error('Error loading monthly data:', error);
            return [];
        }
    },

    /**
     * Save monthly summary override data
     */
    async saveMonthlySummary(locationType, locationId, monthStr, dataMap) {
        if (!firebaseReady) return false;
        try {
            const docId = Utils.createDocId(locationType, locationId, monthStr);
            await db.collection('monthly_summary').doc(docId).set({
                locationType,
                locationId,
                month: monthStr,
                data: dataMap,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error('Error saving monthly summary:', error);
            return false;
        }
    },

    /**
     * Load monthly summary override data
     */
    async loadMonthlySummary(locationType, locationId, monthStr) {
        if (!firebaseReady) return null;
        try {
            const docId = Utils.createDocId(locationType, locationId, monthStr);
            const doc = await db.collection('monthly_summary').doc(docId).get();
            if (doc.exists) {
                return doc.data().data;
            }
            return null;
        } catch (error) {
            console.error('Error loading monthly summary:', error);
            return null;
        }
    },

    /**
     * Get stok available data from previous day (for auto-fill Stok Awal)
     */
    async getPreviousDayClosing(locationType, locationId, date) {
        if (!firebaseReady) return null;
        
        try {
            const prevDate = Utils.getPreviousDate(date);
            const data = await this.loadStockData(locationType, locationId, prevDate);
            
            if (data && data.items) {
                // Return map of variantId -> stokAvailable value (used as next day's Stok Awal)
                const closingMap = {};
                data.items.forEach(item => {
                    closingMap[item.variantId] = item.stokAvailable || 0;
                });
                return closingMap;
            }
            return null;
        } catch (error) {
            console.error('Error getting previous stok available:', error);
            return null;
        }
    },

    /**
     * Get all stock data (for export/backup)
     */
    async getAllStockData() {
        if (!firebaseReady) return { settings: {}, stockData: [] };
        
        try {
            // Get settings
            const settingsDoc = await db.collection('settings').doc('config').get();
            const settings = settingsDoc.exists ? settingsDoc.data() : {};
            
            // Get all stock data
            const stockSnapshot = await db.collection('stock_data').get();
            const stockData = [];
            stockSnapshot.forEach(doc => {
                stockData.push({ id: doc.id, ...doc.data() });
            });
            
            return { settings, stockData };
        } catch (error) {
            console.error('Error exporting data:', error);
            return { settings: {}, stockData: [] };
        }
    },

    /**
     * Import all data (restore from backup)
     */
    async importAllData(data) {
        if (!firebaseReady) {
            Utils.toast('Firebase belum terhubung', 'error');
            return false;
        }

        try {
            // Restore settings
            if (data.settings) {
                await db.collection('settings').doc('config').set(data.settings);
            }

            // Restore stock data
            if (data.stockData && Array.isArray(data.stockData)) {
                const batch = db.batch();
                let count = 0;

                for (const item of data.stockData) {
                    const docId = item.id || Utils.createDocId(item.locationType, item.locationId, item.date);
                    const docRef = db.collection('stock_data').doc(docId);
                    
                    // Remove the id field from the data
                    const { id, ...docData } = item;
                    batch.set(docRef, docData);

                    count++;
                    // Firestore batch limit is 500
                    if (count >= 499) {
                        await batch.commit();
                        count = 0;
                    }
                }

                if (count > 0) {
                    await batch.commit();
                }
            }

            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    },

    /**
     * Initialize default settings if none exist
     */
    async initializeDefaults() {
        if (!firebaseReady) return false;
        
        try {
            const doc = await db.collection('settings').doc('config').get();
            if (!doc.exists) {
                await db.collection('settings').doc('config').set({
                    tokoVariants: this.defaultTokoVariants,
                    tenantVariantsMap: {},
                    tenants: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('✅ Default settings initialized');
            }
            return true;
        } catch (error) {
            console.error('Error initializing defaults:', error);
            return false;
        }
    },

    /**
     * Reset all settings to defaults
     */
    async resetToDefaults() {
        if (!firebaseReady) return false;
        
        try {
            await db.collection('settings').doc('config').set({
                tokoVariants: this.defaultTokoVariants,
                tenantVariantsMap: {},
                tenants: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error('Error resetting defaults:', error);
            return false;
        }
    },

    // ========================================
    // Admin Password
    // ========================================

    /**
     * Hash a password string using SHA-256
     * @param {string} password
     * @returns {Promise<string>} hex hash
     */
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    /**
     * Get admin password hash from Firebase
     */
    async getAdminPasswordHash() {
        if (!firebaseReady) return null;

        try {
            const doc = await db.collection('settings').doc('config').get();
            if (doc.exists && doc.data().adminPasswordHash) {
                return doc.data().adminPasswordHash;
            }
            return null;
        } catch (error) {
            console.error('Error getting admin password:', error);
            return null;
        }
    },

    /**
     * Set admin password hash in Firebase
     */
    async setAdminPasswordHash(hash) {
        if (!firebaseReady) return false;

        try {
            await db.collection('settings').doc('config').set(
                { adminPasswordHash: hash, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
                { merge: true }
            );
            return true;
        } catch (error) {
            console.error('Error setting admin password:', error);
            return false;
        }
    },

    /**
     * Initialize admin password if not set (default: admin123)
     */
    async initAdminPassword() {
        if (!firebaseReady) return false;

        try {
            const existing = await this.getAdminPasswordHash();
            if (!existing) {
                const defaultHash = await this.hashPassword('admin123');
                await this.setAdminPasswordHash(defaultHash);
                console.log('✅ Default admin password initialized (admin123)');
            }
            return true;
        } catch (error) {
            console.error('Error initializing admin password:', error);
            return false;
        }
    },

    // ========================================
    // Notes (Daily)
    // ========================================

    /**
     * Save daily notes
     * @param {string} date - YYYY-MM-DD
     * @param {string} content - note text
     */
    async saveNote(date, content) {
        if (!firebaseReady) {
            Utils.toast('Firebase belum terhubung', 'error');
            return false;
        }

        try {
            await db.collection('notes').doc(date).set({
                date,
                content,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return true;
        } catch (error) {
            console.error('Error saving note:', error);
            return false;
        }
    },

    /**
     * Load daily notes
     * @param {string} date - YYYY-MM-DD
     */
    async loadNote(date) {
        if (!firebaseReady) return null;

        try {
            const doc = await db.collection('notes').doc(date).get();
            if (doc.exists) {
                return doc.data();
            }
            return null;
        } catch (error) {
            console.error('Error loading note:', error);
            return null;
        }
    },

    /**
     * Delete daily notes
     * @param {string} date - YYYY-MM-DD
     */
    async deleteNote(date) {
        if (!firebaseReady) return false;

        try {
            await db.collection('notes').doc(date).delete();
            return true;
        } catch (error) {
            console.error('Error deleting note:', error);
            return false;
        }
    },

    /**
     * Listen to notes changes in real-time
     * @param {string} date - YYYY-MM-DD
     * @param {Function} callback
     * @returns {Function} unsubscribe function
     */
    listenToNote(date, callback) {
        if (!firebaseReady) return null;

        return db.collection('notes').doc(date).onSnapshot(doc => {
            if (doc.exists) {
                callback(doc.data());
            } else {
                callback(null);
            }
        }, error => {
            console.error('Notes snapshot error:', error);
        });
    }
};
