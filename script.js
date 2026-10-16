/* ==========================================================================
   ATOM MASTER SCRIPT - V2.8 (Secure Developer Wall & Action Bindings)
   ========================================================================== */

const API = 'http://localhost:8080';
console.log('%cATOM script V2.8 loaded on ' + location.pathname, 'color:#25D366;font-weight:bold');

// --- 1. GLOBAL UTILITIES & BROADCAST LISTENER ---
function toggleMenu() { document.getElementById('navLinks')?.classList.toggle('active'); }

// Escape text before putting it into innerHTML (prevents broken markup / XSS)
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// True only on developer.html
function isDeveloperPage() {
    return !!document.getElementById('devContentWrapper');
}

// Automatically creates the toast container if it's missing from the HTML
window.showGlobalToast = function (message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
        background: ${type === 'success' ? '#25D366' : type === 'admin' ? '#FF5A1F' : '#ef4444'};
        color: white; padding: 12px 24px; border-radius: 12px; font-family: 'Inter', sans-serif; font-weight: 600;
        font-size: 0.9rem; box-shadow: 0 10px 20px rgba(0,0,0,0.15);
        transform: translateX(120%); transition: transform 0.3s ease;
    `;
    toast.innerText = type === 'admin' ? `📢 ADMIN: ${message}` : message;
    container.appendChild(toast);
    
    setTimeout(() => (toast.style.transform = 'translateX(0)'), 10);
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
};

// Polling for Admin Broadcasts (checks every 15 seconds)
let lastBroadcast = '';
setInterval(async () => {
    try {
        const res = await fetch(`${API}/api/broadcast`);
        const data = await res.json();
        if (data.message && data.message !== lastBroadcast) {
            lastBroadcast = data.message;
            window.showGlobalToast(data.message, 'admin');
        }
    } catch (e) { /* server offline: ignore silently */ }
}, 15000);

// --- 2. AUTHENTICATION ---
function switchAuth(type) {
    const l = document.getElementById('loginForm');
    const s = document.getElementById('signupForm');
    const t = document.getElementById('toggleSlider');
    
    if (!l || !s) return;

    l.classList.remove('hidden-form');
    s.classList.remove('hidden-form');

    document.getElementById('toggleLogin')?.classList.toggle('active', type === 'login');
    document.getElementById('toggleSignup')?.classList.toggle('active', type !== 'login');

    if (type === 'login') {
        l.style.display = 'block'; l.style.opacity = '1'; s.style.display = 'none';
        if (t) t.style.transform = 'translateX(0%)';
    } else {
        l.style.display = 'none'; s.style.display = 'block'; s.style.opacity = '1';
        if (t) t.style.transform = 'translateX(100%)';
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const btn = document.getElementById('signupBtn');
    if (btn) { btn.innerText = 'Creating...'; btn.disabled = true; }
    try {
        const res = await fetch(`${API}/api/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName: document.getElementById('signupName')?.value || '',
                email: document.getElementById('signupEmail')?.value || '',
                password: document.getElementById('signupPassword')?.value || ''
            })
        });
        if (res.ok) {
            window.showGlobalToast('Created! Log in.', 'success');
            switchAuth('login');
        } else {
            window.showGlobalToast('Signup failed.', 'error');
        }
    } catch (err) {
        window.showGlobalToast('Server not reachable. Is the backend running?', 'error');
    } finally {
        if (btn) { btn.innerText = 'Create Account'; btn.disabled = false; }
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.querySelector('#loginForm button[type="submit"]');
    if (btn) { btn.innerText = 'Verifying...'; btn.disabled = true; }
    try {
        const res = await fetch(`${API}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: document.getElementById('loginEmail')?.value || '',
                password: document.getElementById('loginPassword')?.value || ''
            })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('atom_token', data.token);
            localStorage.setItem('atom_cafe_id', data.userId);
            window.showGlobalToast(`Welcome, ${data.name}!`, 'success');
            setTimeout(() => (window.location.href = 'dashboard.html'), 1000);
        } else {
            window.showGlobalToast(data.error || 'Invalid credentials', 'error');
        }
    } catch (err) {
        window.showGlobalToast('Server not reachable. Is the backend running?', 'error');
    } finally {
        if (btn) { btn.innerText = 'Access Dashboard'; btn.disabled = false; }
    }
}

// --- 3. CAFE DASHBOARD & HEADERS ---
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('atom_token')}`
    };
}

function getDevHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('atom_dev_token')}`
    };
}

function toggleNightMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('atom_theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

function initMasterDashboard() {
    if (isDeveloperPage()) return;

    const onDashboard = document.getElementById('productsList') || document.getElementById('shopsList');
    if (!onDashboard) return;

    const token = localStorage.getItem('atom_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    if (localStorage.getItem('atom_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
    loadDashboardData().catch(e => console.error('Dashboard load error:', e));
}

function renderProductCard(p) {
    const isChecked = p.inStock ? 'checked' : '';
    return `
    <div class="card-item">
        <div class="card-info">
            <img src="${esc(p.photo_url)}" class="card-img">
            <div>
                <strong style="display:block;">${esc(p.name)}</strong>
                <span style="font-size:0.7em; background:#eee; color:#111; padding:2px 6px; border-radius:4px;">${esc(p.category || 'General')}</span>
                <span style="font-size:0.8em; color:#666; margin-left:5px;">₹${esc(p.price)}</span>
            </div>
        </div>
        <div style="display:flex; align-items:center;">
            <input type="checkbox" class="stock-toggle" ${isChecked} onchange="toggleStock(${Number(p.id)}, this.checked)" title="Toggle Stock">
            <button class="btn-delete" onclick="deleteItem('menu', ${Number(p.id)})">X</button>
        </div>
    </div>`;
}

function renderShopCard(s) {
    return `<div class="card-item"><div class="card-info"><img src="${esc(s.photo_url)}" class="card-img"><strong>${esc(s.name)}</strong></div><button class="btn-delete" onclick="deleteItem('shops', ${Number(s.id)})">X</button></div>`;
}
function renderEmployeeCard(e) {
    return `<div class="card-item"><div class="card-info"><img src="${esc(e.photo_url)}" class="card-img" style="border-radius:50%;"><div><strong style="display:block;">${esc(e.name)}</strong><span style="font-size:0.8em;">${esc(e.role)}</span></div></div><button class="btn-delete" onclick="deleteItem('employees', ${Number(e.id)})">X</button></div>`;
}

async function loadDashboardData() {
    await fetchAndRender(`${API}/api/shops`, 'shopsList', renderShopCard);
    await fetchAndRender(`${API}/api/employees`, 'employeesList', renderEmployeeCard);

    try {
        const res = await fetch(`${API}/api/menu`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const container = document.getElementById('productsList');
        if (container) {
            container.innerHTML = data.map(renderProductCard).join('');
        }

        const cats = { Beverages: 0, Mains: 0, Desserts: 0, General: 0 };
        data.forEach(d => {
            const key = d.category in cats ? d.category : 'General';
            cats[key]++;
        });

        const ctx = document.getElementById('salesChart');
        if (ctx && typeof Chart !== 'undefined') {
            if (window.salesChartInstance) window.salesChartInstance.destroy();
            window.salesChartInstance = new Chart(ctx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: Object.keys(cats),
                    datasets: [{ data: Object.values(cats), backgroundColor: ['#FF5A1F', '#25D366', '#45A29E', '#999'] }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    } catch (e) {
        console.error('Menu load error:', e);
    }
}

async function fetchAndRender(url, cid, renderFn) {
    const c = document.getElementById(cid);
    if (!c) return;
    try {
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (res.status === 401) {
            localStorage.removeItem('atom_token');
            window.location.href = 'login.html';
            return;
        }
        const data = await res.json();
        c.innerHTML = data.map(renderFn).join('');
    } catch (e) {
        console.error(`Failed to load ${cid}:`, e);
    }
}

async function addShop() {
    const n = document.getElementById('newShopName')?.value;
    if (!n) return;
    await fetch(`${API}/api/shops`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: n, photo_url: document.getElementById('newShopPhoto')?.value || '' })
    });
    if (document.getElementById('newShopName')) document.getElementById('newShopName').value = '';
    loadDashboardData();
}

async function addProduct() {
    const n = document.getElementById('newProductName')?.value;
    const p = document.getElementById('newProductPrice')?.value;
    const c = document.getElementById('newProductCategory')?.value || 'General';
    if (!n || !p) return;
    await fetch(`${API}/api/menu`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: n, price: p, category: c, photo_url: document.getElementById('newProductPhoto')?.value || '' })
    });
    if (document.getElementById('newProductName')) document.getElementById('newProductName').value = '';
    if (document.getElementById('newProductPrice')) document.getElementById('newProductPrice').value = '';
    loadDashboardData();
}

async function addEmployee() {
    const n = document.getElementById('newEmpName')?.value;
    const r = document.getElementById('newEmpRole')?.value || '';
    if (!n) return;
    await fetch(`${API}/api/employees`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: n, role: r })
    });
    if (document.getElementById('newEmpName')) document.getElementById('newEmpName').value = '';
    loadDashboardData();
}

async function deleteItem(table, id) {
    if (!confirm('Delete this?')) return;
    await fetch(`${API}/api/${table}/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    loadDashboardData();
}

async function toggleStock(id, inStock) {
    await fetch(`${API}/api/menu/${id}/stock`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ inStock })
    });
    window.showGlobalToast(inStock ? 'Item back in stock!' : 'Item marked out of stock', 'success');
}

// --- 4. DYNAMIC TABLE & PAYMENT QR GENERATOR ---
async function updateQRPreview() {
    const tableInput = document.getElementById('qrTableNo');
    if (!tableInput) return;

    const tableNo = tableInput.value || '1';
    const upi = document.getElementById('qrUPI')?.value || '';
    const color = document.getElementById('qrColor')?.value || '#FF5A1F';

    const tableDisplay = document.getElementById('previewTableDisplay');
    if (tableDisplay) tableDisplay.innerText = `TABLE ${tableNo.toUpperCase()}`;

    const topBar = document.getElementById('standeeTopBar');
    if (topBar) topBar.style.background = color;

    try {
        const profileRes = await fetch(`${API}/api/shops`, { headers: getAuthHeaders() });
        const shops = await profileRes.json();
        const cafeNameEl = document.getElementById('previewCafeName');
        if (cafeNameEl) cafeNameEl.innerText = shops.length > 0 ? shops[0].name : 'My Cafe';
    } catch (e) {
        const cafeNameEl = document.getElementById('previewCafeName');
        if (cafeNameEl) cafeNameEl.innerText = 'ATOM Cafe';
    }

    try {
        const res = await fetch(`${API}/api/generate-qr`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ tableNo, color, paymentUPI: upi })
        });
        const data = await res.json();
        const qrContainer = document.getElementById('qrImageContainer');
        if (data.qrCodeUrl && qrContainer) {
            qrContainer.innerHTML = `<img src="${esc(data.qrCodeUrl)}" style="width: 200px; height: 200px; display: block; border-radius: 8px;">`;
        }
    } catch (e) {
        console.error('QR Generation error', e);
    }
}

// --- 5. PUBLIC DIGITAL MENU (Categorized) ---
let cart = [];
let publicMenuItems = [];

async function fetchMenuFromDatabase() {
    const mc = document.getElementById('menu-container');
    if (!mc) return;
    const cafeId = new URLSearchParams(window.location.search).get('cafe') || localStorage.getItem('atom_cafe_id') || '1';
    try {
        const res = await fetch(`${API}/api/public/menu/${cafeId}`);
        publicMenuItems = await res.json();

        const categories = {};
        publicMenuItems.forEach((i, idx) => {
            const cat = i.category || 'General';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ item: i, idx });
        });

        let html = '';
        for (const [catName, entries] of Object.entries(categories)) {
            html += `<h3 style="margin: 30px 0 10px 0; border-bottom: 2px solid #eee; padding-bottom: 5px;">${esc(catName)}</h3>`;
            entries.forEach(({ item, idx }) => {
                html += `
                <div class="menu-card glass-panel" style="margin-bottom:15px;">
                    <img src="${esc(item.photo_url)}" style="width: 100%; height: 140px; object-fit: cover; border-radius: 12px; margin-bottom: 12px;">
                    <div class="menu-details">
                        <h4>${esc(item.name)}</h4>
                        <div class="menu-action-row" style="margin-top: 10px;">
                            <span class="menu-price">₹${esc(item.price)}</span>
                            <button class="btn-add" onclick="addToCartByIndex(${idx})">+ Add</button>
                        </div>
                    </div>
                </div>`;
            });
        }
        mc.innerHTML = html;
    } catch (e) {
        console.error('Public menu load error:', e);
    }
}

function addToCartByIndex(idx) {
    const item = publicMenuItems[idx];
    if (item) addToCart(item.name, item.price);
}

function addToCart(n, p) {
    cart.push({ name: n, price: p });
    updateCartUI();
    window.showGlobalToast(`Added ${n}!`);
}

function updateCartUI() {
    const fc = document.getElementById('floatingCart');
    if (!fc) return;
    fc.classList.toggle('visible', cart.length > 0);
    const countEl = document.getElementById('cartCount');
    if (countEl) countEl.innerText = `${cart.length} Item${cart.length > 1 ? 's' : ''}`;
    const totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.innerText = `₹${cart.reduce((s, i) => s + Number(i.price), 0)}`;
}

// --- 6. SECURE DEVELOPER "GOD MODE" ---
let devPingTimer = null;

async function initDeveloperDashboard() {
    if (!isDeveloperPage()) return; 

    // Handle the Developer Login Form
    const devLoginForm = document.getElementById('devLoginForm');
    if (devLoginForm) {
        devLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const passInput = document.getElementById('devPasswordInput').value;
            const btn = document.getElementById('devLoginBtn');
            btn.innerText = 'Verifying...';
            btn.disabled = true;

            try {
                const res = await fetch(`${API}/api/developer/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: passInput })
                });

                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('atom_dev_token', data.token);
                    document.getElementById('authWall').style.display = 'none';
                    document.getElementById('devContentWrapper').style.display = 'block';
                    window.showGlobalToast('God Mode Activated', 'success');
                    
                    // Boot up the God Mode internals
                    await fetchPlatformStats();
                    if (devPingTimer) clearInterval(devPingTimer);
                    devPingTimer = setInterval(pingDatabase, 2000);
                } else {
                    window.showGlobalToast('Access Denied: Incorrect Password', 'error');
                    document.getElementById('devPasswordInput').value = '';
                }
            } catch (err) {
                window.showGlobalToast('Server unreachable.', 'error');
            } finally {
                btn.innerText = 'Verify Identity';
                btn.disabled = false;
            }
        });
    }

    // Check if they already have an active valid token
    const devToken = localStorage.getItem('atom_dev_token');
    if (devToken) {
        const statsCheck = await fetchPlatformStats();
        if (statsCheck === 'ok') {
            document.getElementById('authWall').style.display = 'none';
            document.getElementById('devContentWrapper').style.display = 'block';
            if (devPingTimer) clearInterval(devPingTimer);
            devPingTimer = setInterval(pingDatabase, 2000);
        } else {
            localStorage.removeItem('atom_dev_token'); // Token expired or invalid
        }
    }
}

// Bind the manual logout button for God Mode
window.devLogout = function() {
    localStorage.removeItem('atom_dev_token');
    if (devPingTimer) clearInterval(devPingTimer);
    document.getElementById('devContentWrapper').style.display = 'none';
    document.getElementById('authWall').style.display = 'flex';
    document.getElementById('devPasswordInput').value = '';
    window.showGlobalToast('Console locked.', 'success');
};

async function pingDatabase() {
    const start = Date.now();
    try {
        await fetch(`${API}/api/developer/ping`);
        const latency = Date.now() - start;
        const el = document.getElementById('devLatency');
        if (el) {
            el.innerText = `${latency} ms`;
            el.style.color = latency < 50 ? '#25D366' : latency < 150 ? '#FFA500' : '#ff4646';
        }
    } catch (e) { /* ignore */ }
}

async function sendBroadcast() {
    const msgInput = document.getElementById('broadcastMsg');
    const btn = document.querySelector('.broadcast-row button');
    if (!msgInput || !btn) return;
    
    const msg = msgInput.value;
    if (!msg) return;

    const originalText = btn.innerText;
    btn.innerText = 'Sending... ⏳';
    btn.disabled = true;

    try {
        const res = await fetch(`${API}/api/developer/broadcast`, {
            method: 'POST',
            headers: getDevHeaders(),
            body: JSON.stringify({ message: msg })
        });
        if (!res.ok) throw new Error('Broadcast rejected');
        const data = await res.json();
        msgInput.value = '';
        window.showGlobalToast(`Broadcast sent to ${data.emailedCount || 0} accounts!`, 'success');
    } catch (e) {
        window.showGlobalToast('Failed to send broadcast.', 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function impersonateUser(userId) {
    if (!confirm("Enter this user's dashboard?")) return;
    try {
        const res = await fetch(`${API}/api/developer/impersonate/${userId}`, { headers: getDevHeaders() });
        if (!res.ok) throw new Error('Rejected');
        const data = await res.json();
        localStorage.setItem('atom_token', data.token);
        localStorage.setItem('atom_cafe_id', data.userId);
        window.location.href = 'dashboard.html';
    } catch (e) {
        alert('Impersonation failed');
    }
}

async function fetchPlatformStats() {
    try {
        const res = await fetch(`${API}/api/developer/stats`, { headers: getDevHeaders() });
        if (!res.ok) return 'error';
        const data = await res.json();

        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        setText('devUsers', data.totalUsers);
        setText('devShops', data.totalShops);
        setText('devProducts', data.totalProducts);
        setText('devActiveTenants', data.totalUsers);

        const term = document.getElementById('terminalLogs');
        if (term) {
            term.innerHTML = (data.logs || []).map(l => {
                const time = new Date(l.timestamp).toLocaleTimeString();
                return `<div class="terminal-line">[${esc(time)}] ${esc(l.fullName)}: ${esc(l.action)}</div>`;
            }).join('');
        }

        const tbody = document.getElementById('devUsersTable');
        if (tbody) {
            tbody.innerHTML = (data.allUsers || []).map(u => {
                const hash = u.password ? esc(u.password.substring(0, 10)) + '...' : 'None';
                return `
                    <tr>
                        <td>#${Number(u.id)}</td>
                        <td><strong style="color:#fff;">${esc(u.fullName)}</strong><br><span style="font-size:0.8em; color:#889;">${esc(u.email)}</span></td>
                        <td><code>${hash}</code></td>
                        <td style="font-size:0.85em;"><strong style="color:#66FCF1;">Shops:</strong> ${esc(u.shopNames || 'None')}<br><strong style="color:#25D366;">Items:</strong> ${esc(u.productCount)}</td>
                        <td>
                            <button class="btn-ghost" onclick="impersonateUser(${Number(u.id)})">Ghost Login</button>
                            <button class="btn-terminate" onclick="terminateUser(${Number(u.id)})">Del</button>
                        </td>
                    </tr>`;
            }).join('');
        }

        const ctx = document.getElementById('devGrowthChart');
        if (ctx && typeof Chart !== 'undefined') {
            if (!window.devChart) {
                window.devChart = new Chart(ctx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: ['Users', 'Shops', 'Products', 'Staff'],
                        datasets: [{ data: data.chartData, backgroundColor: ['#66FCF1', '#45A29E', '#25D366', '#FF5A1F'] }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
            } else {
                window.devChart.data.datasets[0].data = data.chartData;
                window.devChart.update();
            }
        }
        return 'ok';
    } catch (e) {
        console.error('Platform stats error:', e);
        return 'error';
    }
}

async function terminateUser(id) {
    if (!confirm('Wipe this account forever?')) return;
    try {
        const res = await fetch(`${API}/api/developer/users/${id}`, { method: 'DELETE', headers: getDevHeaders() });
        if (res.ok) {
            window.showGlobalToast('Account wiped successfully.', 'success');
            fetchPlatformStats();
        } else {
            window.showGlobalToast('Failed to delete account.', 'error');
        }
    } catch (e) {
        console.error('Termination error:', e);
    }
}

// Binds the button in developer HTML to the backend route
window.flushBackendLogs = async function() {
    try {
        const res = await fetch(`${API}/api/developer/logs`, { method: 'DELETE', headers: getDevHeaders() });
        if (res.ok) {
            document.getElementById('terminalLogs').innerHTML = '<div class="terminal-line">[System] Audit logs wiped clean by admin.</div>';
            window.showGlobalToast('Activity audit logs cleared.', 'success');
        } else {
            window.showGlobalToast('Failed to clear logs.', 'error');
        }
    } catch (e) {
        window.showGlobalToast('Network error.', 'error');
    }
};

// --- 7. PASSWORD VISIBILITY & RECOVERY UTILITIES ---
function togglePasswordVisibility(fieldId, btn) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '👁️‍🗨️';
    } else {
        input.type = 'password';
        btn.innerText = '👁️';
    }
}

async function triggerForgotPassword(e) {
    e.preventDefault();
    const email = prompt('Enter your account registered email address for recovery:');
    if (!email) return;

    window.showGlobalToast('Sending recovery link...', 'success');
    try {
        const res = await fetch(`${API}/api/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            window.showGlobalToast(data.message, 'success');
        } else {
            window.showGlobalToast(data.error || 'Recovery failed.', 'error');
        }
    } catch (err) {
        window.showGlobalToast('Network error while requesting recovery.', 'error');
    }
}

// --- 8. SECURE LOGOUT ---
function handleLogout() {
    localStorage.removeItem('atom_token');
    localStorage.removeItem('atom_cafe_id');
    localStorage.removeItem('atom_dev_token');
    window.showGlobalToast('Logged out securely.', 'success');
    setTimeout(() => {
        window.location.href = 'login.html';
    }, 1000);
}

// --- INITIALIZE ON DOM READY ---
document.addEventListener('DOMContentLoaded', () => {
    fetchMenuFromDatabase();
    initMasterDashboard();
    initDeveloperDashboard();
});