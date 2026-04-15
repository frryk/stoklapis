// ==========================================
// Firebase Configuration
// ==========================================
// TODO: User will provide Firebase config
// Replace the placeholder values below with your Firebase project config

const firebaseConfig = {
    apiKey: "AIzaSyCxUhUmF98XxHSxuB40OIFWAWeWBWJ_kYw",
    authDomain: "lapis-3614c.firebaseapp.com",
    projectId: "lapis-3614c",
    storageBucket: "lapis-3614c.firebasestorage.app",
    messagingSenderId: "692503259208",
    appId: "1:692503259208:web:ecf7e5ae6ea33d86e1907d"
};

// Firebase CDN - using compat version for simplicity
// These will be loaded dynamically
let db = null;
let firebaseReady = false;

async function initFirebase() {
    try {
        // Check if Firebase scripts are already loaded
        if (typeof firebase === 'undefined') {
            // Load Firebase scripts dynamically
            await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
            await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');
        }

        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }

        db = firebase.firestore();
        firebaseReady = true;

        // Update UI status
        updateFirebaseStatus(true);
        console.log('✅ Firebase initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Firebase initialization failed:', error);
        updateFirebaseStatus(false);
        return false;
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function updateFirebaseStatus(online) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    if (statusDot && statusText) {
        statusDot.className = 'status-dot ' + (online ? 'online' : 'offline');
        statusText.textContent = 'Firebase: ' + (online ? 'Online' : 'Offline');
    }
}
