/* ==========================================================================
   ATOM MASTER SCRIPT - UNIFIED VERSION V5.4
   ========================================================================== */

const API = 'https://atom-system.onrender.com';
let liveOrdersInterval = null;
let highestOrderId = 0;
window.currentShopQrUrl = '';

// --- 1. GLOBAL UTILITIES ---
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.showGlobalToast = function (message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `background: ${type === 'success' ? '#25D366' : type === 'admin' ? '#FF5A1F' : '#ef4444'}; color: white; padding: 12px 24px; border-radius: 12px; font-weight: 600; box-shadow: 0 10px 20px rgba(0,0,0,0.15); transform: translateX(120%); transition: transform 0.3s ease;`;
    toast.innerText = type === 'admin' ? `📢 ADMIN: ${message}` : message;
    container.appendChild(toast);
    setTimeout(() => (toast.style.transform = 'translateX(0)'), 10);
    setTimeout(() => { toast.style.transform = 'translateX(120%)'; setTimeout(() => toast.remove(), 300); }, 4000);
};

function playDing() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        const osc1 = ctx.createOscillator(); const gain1 = ctx.createGain();
        osc1.type = 'sine'; osc1.frequency.setValueAtTime(987.77, ctx.currentTime);
        gain1.gain.setValueAtTime(0.5, ctx.currentTime); gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc1.connect(gain1); gain1.connect(ctx.destination); osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.5);

        const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
        osc2.type = 'sine'; osc2.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.15);
        gain2.gain.setValueAtTime(0.5, ctx.currentTime + 0.15); gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.65);
        osc2.connect(gain2); gain2.connect(ctx.destination); osc2.start(ctx.currentTime + 0.15); osc2.stop(ctx.currentTime + 0.65);
    } catch (e) { console.error('Audio error', e); }
}

function getAuthHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('atom_token')}` }; }
function getDevHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('atom_dev_token')}` }; }

function toggleNightMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('atom_theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
function isDeveloperPage() { return !!document.getElementById('devContentWrapper'); }

// --- 2. AUTHENTICATION ---
function switchAuth(type) {
    const l = document.getElementById('loginForm'), s = document.getElementById('signupForm'), t = document.getElementById('toggleSlider');
    if (!l || !s) return;
    l.classList.remove('hidden-form'); s.classList.remove('hidden-form');
    document.getElementById('toggleLogin')?.classList.toggle('active', type === 'login');
    document.getElementById('toggleSignup')?.classList.toggle('active', type !== 'login');
    if (type === 'login') { l.style.display = 'block'; l.style.opacity = '1'; s.style.display = 'none'; if (t) t.style.transform = 'translateX(0%)'; }
    else { l.style.display = 'none'; s.style.display = 'block'; s.style.opacity = '1'; if (t) t.style.transform = 'translateX(100%)'; }
}

async function handleSignup(e) {
    e.preventDefault();
    const btn = document.getElementById('signupBtn');
    if (btn) { btn.innerText = 'Creating...'; btn.disabled = true; }
    try {
        const res = await fetch(`${API}/api/signup`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName: document.getElementById('signupName')?.value || '',
                email: document.getElementById('signupEmail')?.value || '',
                password: document.getElementById('signupPassword')?.value || ''
            })
        });
        if (res.ok) { window.showGlobalToast('Created! Log in.', 'success'); switchAuth('login'); }
        else { window.showGlobalToast('Signup failed.', 'error'); }
    } catch (err) { window.showGlobalToast('Server not reachable.', 'error'); }
    finally { if (btn) { btn.innerText = 'Create Account'; btn.disabled = false; } }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.querySelector('#loginForm button[type="submit"]');
    if (btn) { btn.innerText = 'Verifying...'; btn.disabled = true; }
    try {
        const res = await fetch(`${API}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('loginEmail')?.value || '', password: document.getElementById('loginPassword')?.value || '' })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('atom_token', data.token);
            localStorage.setItem('atom_cafe_id', data.userId);
            window.showGlobalToast(`Welcome, ${data.name}!`, 'success');
            setTimeout(() => (window.location.href = 'dashboard.html'), 1000);
        } else { window.showGlobalToast(data.error || 'Invalid credentials', 'error'); }
    } catch (err) { window.showGlobalToast('Server not reachable.', 'error'); }
    finally { if (btn) { btn.innerText = 'Access Dashboard'; btn.disabled = false; } }
}

async function triggerForgotPassword(e) {
    e.preventDefault();
    const email = prompt('Enter your registered email address for recovery:');
    if (!email) return;
    try {
        const res = await fetch(`${API}/api/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await res.json();
        if (res.ok) window.showGlobalToast(data.message, 'success'); else window.showGlobalToast(data.error || 'Recovery failed.', 'error');
    } catch (err) { window.showGlobalToast('Network error.', 'error'); }
}

function handleLogout() {
    localStorage.removeItem('atom_token');
    localStorage.removeItem('atom_cafe_id');
    localStorage.removeItem('atom_dev_token');
    window.location.href = 'login.html';
}

// --- 3. CAFE DASHBOARD ---
function renderAmazonProductCard(p) {
    const isChecked = p.inStock ? 'checked' : '';
    const stockColor = p.inStock ? '#25D366' : '#ff4646';
    const stockText = p.inStock ? 'LIVE' : 'OFFLINE';
    return `<div class="amazon-card"><div class="amazon-img-box"><img src="${esc(p.photo_url)}" alt="${esc(p.name)}"><div style="position:absolute; top:10px; right:10px; background:${stockColor}; color:#fff; font-size:0.7rem; font-weight:bold; padding:4px 8px; border-radius:12px;">${stockText}</div></div><div class="amazon-card-body"><div style="display:flex; justify-content:space-between; align-items:start;"><h4 class="amazon-title">${esc(p.name)}</h4><span class="amazon-price">₹${esc(p.price)}</span></div><p class="amazon-desc">${esc(p.description) || 'No description provided.'}</p><div class="amazon-controls"><label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:600; cursor:pointer;"><input type="checkbox" class="stock-toggle" ${isChecked} onchange="toggleStock(${Number(p.id)}, this.checked)"> In Stock</label><button class="btn-delete" onclick="deleteItem('menu', ${Number(p.id)})">Delete</button></div></div></div>`;
}

function renderEmployeeCard(e) {
    return `<div class="card-item" style="display:flex; justify-content:space-between; align-items:center; padding: 15px;"><div class="card-info" style="display:flex; gap:15px; align-items:center;"><img src="${esc(e.photo_url)}" class="card-img" style="border-radius:50%; width: 60px; height: 60px;"><div><strong style="display:block; font-size:1.1rem;">${esc(e.name)}</strong><span style="font-size:0.85rem; color:#FF5A1F; font-weight:bold;">${esc(e.role)}</span></div></div><div style="text-align:right; font-size:0.9rem;"><p style="margin:0; color:#555;">📞 ${esc(e.phone || 'N/A')}</p><p style="margin:0; font-weight:bold;">₹${esc(e.salary || '0')} /mo</p><button class="btn-delete" style="margin-top:8px; padding: 4px 10px;" onclick="deleteItem('employees', ${Number(e.id)})">Remove</button></div></div>`;
}

function renderLiveMenuPreviewItem(p) {
    if (!p.inStock) return '';
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #ddd;"><div style="display:flex; gap:10px; align-items:center;"><img src="${esc(p.photo_url)}" style="width:40px; height:40px; border-radius:8px; object-fit:cover;"><div><strong style="display:block; font-size:0.9rem;">${esc(p.name)}</strong><span style="font-size:0.75rem; color:#666;">${esc(p.category)}</span></div></div><strong style="color:var(--primary-orange);">₹${esc(p.price)}</strong></div>`;
}

async function loadLiveOrders() {
    try {
        const res = await fetch(`${API}/api/orders`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const orders = await res.json();
        const container = document.getElementById('liveOrdersContainer');
        if (!container) return;

        if (orders.length === 0) { container.innerHTML = '<p style="color: #666;">No active orders right now.</p>'; return; }

        const currentMaxId = Math.max(...orders.map(o => o.id));
        if (highestOrderId !== 0 && currentMaxId > highestOrderId) { playDing(); window.showGlobalToast('🔔 New Order Arrived!', 'success'); }
        highestOrderId = currentMaxId;

        container.innerHTML = orders.map(o => {
            const isPending = o.status === 'pending';
            const statusColor = isPending ? '#ff4646' : '#25D366';
            const actionBtn = isPending
                ? `<button onclick="updateOrderStatus(${Number(o.id)}, 'completed')" style="background: #25D366; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">✔ Mark Done</button>`
                : `<button disabled style="background: #eee; color: #999; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold;">Done</button>`;
            return `<div class="card-item" style="flex-direction: column; align-items: stretch; gap: 10px; border-left: 5px solid ${statusColor}; background: #fff; padding: 15px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);"><div style="display: flex; justify-content: space-between; align-items: center;"><strong style="font-size: 1.2rem; font-family: 'Space Grotesk', sans-serif;">Table: ${esc(o.table_no)}</strong><span style="font-weight: 800; color: #FF5A1F; font-size: 1.1rem;">₹${esc(o.total_amount)}</span></div><div style="font-size: 0.95rem; color: #444; white-space: pre-line; background: #f9f9f9; padding: 12px; border-radius: 8px; font-weight: 500;">${esc(o.order_details)}</div><div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #eee; padding-top: 10px;"><span style="font-size: 0.85rem; color: #666; font-weight: 600;">💳 ${esc(o.payment_method)}</span>${actionBtn}</div></div>`;
        }).join('');
    } catch (e) { console.error('Error loading live orders:', e); }
}

async function updateOrderStatus(id, status) {
    await fetch(`${API}/api/orders/${id}/status`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ status }) });
    loadLiveOrders();
}

async function loadDashboardData() {
    try {
        const sRes = await fetch(`${API}/api/shops`, { headers: getAuthHeaders() });
        if (sRes.status === 401) return handleLogout();
        const shops = await sRes.json();
        const headerEl = document.getElementById('welcomeCafeName'), shopListEl = document.getElementById('shopsList');

        if (shops.length > 0) {
            if (headerEl) headerEl.innerText = shops[0].name;
            if (shopListEl) shopListEl.innerHTML = `<div style="display:flex; align-items:center; gap:15px; background:#fff; padding:15px; border-radius:12px; border:2px solid #FF5A1F;"><img src="${esc(shops[0].photo_url)}" style="width:50px; height:50px; border-radius:8px;"><h2>${esc(shops[0].name)}</h2></div>`;

            const codeEl = document.getElementById('chefCountryCode'), waEl = document.getElementById('chefWhatsapp');
            if (shops[0].chef_whatsapp && waEl) {
                const match = shops[0].chef_whatsapp.match(/^(\+\d{1,3})(\d+)$/);
                if (match && codeEl) { codeEl.value = match[1]; waEl.value = match[2]; }
                else { waEl.value = shops[0].chef_whatsapp; }
            }
            if (document.getElementById('shopUpiId')) document.getElementById('shopUpiId').value = shops[0].upi_id || '';
            window.currentShopQrUrl = shops[0].upi_qr_url || '';
        } else {
            if (headerEl) headerEl.innerText = 'Welcome, Cafe Owner';
            if (shopListEl) shopListEl.innerHTML = '<p>No workspace configured yet.</p>';
        }
    } catch (e) { console.error('Dashboard shops error:', e); }

    try {
        const eRes = await fetch(`${API}/api/employees`, { headers: getAuthHeaders() });
        const employees = await eRes.json();
        const eContainer = document.getElementById('employeesList');
        if (eContainer) eContainer.innerHTML = employees.map(renderEmployeeCard).join('');
    } catch (e) { console.error('Dashboard employees error:', e); }

    try {
        const mRes = await fetch(`${API}/api/menu`, { headers: getAuthHeaders() });
        if (mRes.status === 401) return handleLogout();
        const menu = await mRes.json();

        const pContainer = document.getElementById('productsList');
        if (pContainer) pContainer.innerHTML = menu.map(renderAmazonProductCard).join('');
        const liveContainer = document.getElementById('liveMenuPreview');
        if (liveContainer) liveContainer.innerHTML = menu.map(renderLiveMenuPreviewItem).join('') || '<p>No live items available.</p>';

        const cats = { Beverages: 0, Mains: 0, Desserts: 0, Specials: 0 };
        menu.forEach(d => { if (cats[d.category] !== undefined) cats[d.category]++; });

        const ctx1 = document.getElementById('salesChart');
        if (ctx1 && typeof Chart !== 'undefined') {
            if (window.salesChartInstance) window.salesChartInstance.destroy();
            window.salesChartInstance = new Chart(ctx1.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: ['#FF5A1F', '#25D366', '#45A29E', '#999'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Menu Distribution' } } } });
        }
    } catch (e) { console.error('Dashboard menu error:', e); }

    try {
        const revRes = await fetch(`${API}/api/revenue`, { headers: getAuthHeaders() });
        if (revRes.ok) {
            const revData = await revRes.json();
            const ctx2 = document.getElementById('revenueChart');
            if (ctx2 && typeof Chart !== 'undefined') {
                if (window.revChartInstance) window.revChartInstance.destroy();
                window.revChartInstance = new Chart(ctx2.getContext('2d'), { type: 'line', data: { labels: revData.labels, datasets: [{ label: 'Revenue (₹)', data: revData.data, borderColor: '#FF5A1F', tension: 0.4, fill: true, backgroundColor: 'rgba(255, 90, 31, 0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Weekly Revenue Trajectory' } } } });
            }
        }
    } catch (e) { console.error('Revenue chart error:', e); }

    loadSavedQRs(); loadLiveOrders();
    if (!liveOrdersInterval && document.getElementById('liveOrdersContainer')) { liveOrdersInterval = setInterval(loadLiveOrders, 10000); }
}

async function addShop() {
    const name = document.getElementById('newShopName')?.value;
    if (!name) return window.showGlobalToast('Workspace name required', 'error');
    await fetch(`${API}/api/shops`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ name, photo_url: document.getElementById('newShopPhoto')?.value }) });
    loadDashboardData();
}

async function addProduct() {
    const n = document.getElementById('newProductName')?.value, p = document.getElementById('newProductPrice')?.value;
    if (!n || !p) return window.showGlobalToast('Product name and price required', 'error');
    await fetch(`${API}/api/menu`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ name: n, price: p, category: document.getElementById('newProductCategory')?.value, photo_url: document.getElementById('newProductPhoto')?.value, description: document.getElementById('newProductDesc')?.value }) });
    document.getElementById('newProductName').value = '';
    document.getElementById('newProductPrice').value = '';
    document.getElementById('newProductDesc').value = '';
    loadDashboardData();
}

async function addEmployee() {
    const n = document.getElementById('newEmpName')?.value;
    if (!n) return window.showGlobalToast('Name required', 'error');
    await fetch(`${API}/api/employees`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ name: n, role: document.getElementById('newEmpRole')?.value, phone: document.getElementById('newEmpPhone')?.value, salary: document.getElementById('newEmpSalary')?.value, photo_url: document.getElementById('newEmpPhoto')?.value }) });
    document.getElementById('newEmpName').value = '';
    document.getElementById('newEmpSalary').value = '';
    loadDashboardData();
}

async function saveWhatsapp() {
    const code = document.getElementById('chefCountryCode')?.value || '', num = document.getElementById('chefWhatsapp')?.value;
    if (!num) return window.showGlobalToast('Enter the WhatsApp number', 'error');
    await fetch(`${API}/api/shops/whatsapp`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ chef_whatsapp: code + num }) });
    window.showGlobalToast('Kitchen routing activated!', 'success');
}

async function savePaymentConfig() {
    const upi_id = document.getElementById('shopUpiId')?.value;
    const fileInput = document.getElementById('shopUpiQrFile');

    const saveToDb = async (qr_url) => {
        try {
            const res = await fetch(`${API}/api/shops/payment`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ upi_id, upi_qr_url: qr_url }) });
            if (!res.ok) throw new Error('Save failed');
            window.showGlobalToast('Payment configuration saved!', 'success');
            window.currentShopQrUrl = qr_url;
            if (fileInput) fileInput.value = '';
        } catch (e) { window.showGlobalToast('Could not save payment settings.', 'error'); }
    };

    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 300;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                saveToDb(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        saveToDb(window.currentShopQrUrl || '');
    }
}

async function toggleStock(id, inStock) {
    await fetch(`${API}/api/menu/${id}/stock`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ inStock }) });
    loadDashboardData();
}

async function deleteItem(table, id) {
    if (!confirm('Permanently delete this?')) return;
    await fetch(`${API}/api/${table}/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    loadDashboardData();
}

// --- 4. SAVED QR GRID MANAGEMENT ---
async function loadSavedQRs() {
    try {
        const res = await fetch(`${API}/api/qr`, { headers: getAuthHeaders() });
        const qrs = await res.json();
        const grid = document.getElementById('savedQrGrid');
        if (!grid) return;
        grid.innerHTML = qrs.map(q => `<div class="card-item" style="flex-direction: column; align-items: stretch; text-align: center; padding: 12px; border: 1px solid rgba(0,0,0,0.1);"><img src="${esc(q.qr_data_url)}" style="width: 100%; border-radius: 8px; background: #fff; padding: 5px;"><p style="font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 1rem; margin: 10px 0 5px 0;">${esc(q.table_no)}</p><button class="btn-delete" style="width: 100%; padding: 8px;" onclick="deleteQR(${Number(q.id)})">Delete QR</button></div>`).join('');
    } catch (e) { console.error('Error loading QRs:', e); }
}

async function generateAndSaveQR() {
    const tableNo = document.getElementById('dashQrTable')?.value, color = document.getElementById('dashQrColor')?.value || '#FF5A1F';
    if (!tableNo) return window.showGlobalToast('Enter a table name/number first', 'error');
    try {
        const res = await fetch(`${API}/api/qr`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ tableNo, color }) });
        if (res.ok) { window.showGlobalToast('QR Code Generated!', 'success'); document.getElementById('dashQrTable').value = ''; loadSavedQRs(); }
        else { window.showGlobalToast('Failed to save QR Code', 'error'); }
    } catch (e) { window.showGlobalToast('Network Error', 'error'); }
}

async function deleteQR(id) {
    if (!confirm('Delete this QR code permanently?')) return;
    await fetch(`${API}/api/qr/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    loadSavedQRs();
}

// --- 5. PUBLIC MENU & CHECKOUT ---
let publicMenuData = []; let customerCart = {}; let shopDetails = {};

async function initCustomerMenu() {
    const grid = document.getElementById('customerMenuGrid');
    const cafeId = new URLSearchParams(window.location.search).get('cafe') || '1';
    const tableNo = new URLSearchParams(window.location.search).get('table');

    if (document.getElementById('publicTableBadge') && tableNo) {
        document.getElementById('publicTableBadge').innerText = 'Table ' + tableNo;
    }

    if (grid) {
        grid.innerHTML = '<div style="text-align:center; padding:50px; color:#666;"><h3>Connecting to ATOM Cloud...</h3><p>Waking up server, please wait a few seconds...</p></div>';
    }

    try {
        const sRes = await fetch(`${API}/api/public/shop/${cafeId}`);

        if (!sRes.ok) {
            if (grid) {
                grid.innerHTML = `
                    <div style="text-align:center; padding:40px; color:#ff4646;">
                        <h3>QR Code Expired or Invalid</h3>
                        <p>Cafe #${esc(cafeId)} does not exist in the database.</p>
                        <p style="font-size:0.85rem; color:#888;">Check that you have created a shop in your dashboard first.</p>
                    </div>`;
            }
            return;
        }

        shopDetails = await sRes.json();
        const nameEl = document.getElementById('publicCafeName');
        if (nameEl && shopDetails.name) nameEl.innerText = shopDetails.name;

        const mRes = await fetch(`${API}/api/public/menu/${cafeId}`);
        if (mRes.ok) {
            publicMenuData = await mRes.json();
            renderCustomerMenu();
        } else {
            if (grid) grid.innerHTML = '<p style="text-align:center; padding:30px; color:#666;">Failed to load menu items.</p>';
        }
    } catch (err) {
        console.error('[ATOM] Critical error connecting to API:', err);
        if (grid) {
            grid.innerHTML = `
                <div style="text-align:center; padding:40px; color:#ff4646;">
                    <h3>Connection Error</h3>
                    <p>Unable to connect to ATOM backend.</p>
                    <p style="font-size:0.85rem; color:#888;">The server may be waking up. Refresh in 30 seconds.</p>
                </div>`;
        }
    }
}

function renderCustomerMenu() {
    const grid = document.getElementById('customerMenuGrid');
    if (!grid) return;

    if (!publicMenuData || publicMenuData.length === 0) {
        grid.innerHTML = `
            <div style="text-align:center; padding:40px; color:#777; grid-column:1/-1;">
                <h3>No Items on the Menu Yet</h3>
                <p>The cafe owner has not added any active menu items to this workspace.</p>
            </div>`;
        renderCartSummary();
        return;
    }

    grid.innerHTML = publicMenuData.map(item => {
        const qty = customerCart[item.id] || 0;
        let controlHtml = `<button onclick="updateCartItem(${Number(item.id)}, 1)" style="background:#111; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">+ Add</button>`;
        if (qty > 0) {
            controlHtml = `<div style="display:flex; align-items:center; gap:10px; background:#f5f5f5; padding:4px 8px; border-radius:8px;"><button onclick="updateCartItem(${Number(item.id)}, -1)" style="border:none; background:none; font-weight:bold; font-size:1.2rem; color:#FF5A1F; cursor:pointer;">-</button><span style="font-weight:700; min-width:20px; text-align:center;">${qty}</span><button onclick="updateCartItem(${Number(item.id)}, 1)" style="border:none; background:none; font-weight:bold; font-size:1.2rem; color:#25D366; cursor:pointer;">+</button></div>`;
        }
        return `
            <div style="display:flex; gap:15px; background:#fff; padding:15px; border-radius:16px; border:1px solid #eee; box-shadow:0 4px 10px rgba(0,0,0,0.02);">
                <img src="${esc(item.photo_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c')}" style="width:90px; height:90px; object-fit:cover; border-radius:12px;">
                <div style="flex-grow:1; display:flex; flex-direction:column; justify-content:center;">
                    <h4 style="margin:0 0 5px 0; font-family:'Space Grotesk', sans-serif; font-size:1.1rem; color:#111;">${esc(item.name)}</h4>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
                        <span style="font-weight:800; color:#FF5A1F; font-size:1.1rem;">₹${esc(item.price)}</span>
                        ${controlHtml}
                    </div>
                </div>
            </div>`;
    }).join('');
    renderCartSummary();
}

function updateCartItem(id, change) {
    const current = customerCart[id] || 0;
    const newQty = current + change;
    if (newQty <= 0) delete customerCart[id]; else customerCart[id] = newQty;
    renderCustomerMenu();
}

function renderCartSummary() {
    const section = document.getElementById('customerCartSection'), summaryList = document.getElementById('cartSummaryList'), totalAmtEl = document.getElementById('cartTotalAmt');
    if (!section || !summaryList || !totalAmtEl) return;
    if (Object.keys(customerCart).length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    let total = 0, html = '';
    for (const [id, qty] of Object.entries(customerCart)) {
        const item = publicMenuData.find(i => i.id == id);
        if (item) {
            const lineTotal = Number(item.price) * qty;
            total += lineTotal;
            html += `<div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:8px; color:#555;"><span>${qty}x ${esc(item.name)}</span><span style="font-weight:600; color:#111;">₹${lineTotal}</span></div>`;
        }
    }
    summaryList.innerHTML = html;
    totalAmtEl.innerText = `₹${total}`;
}

function toggleUpiView() {
    const methodEl = document.querySelector('input[name="payMethod"]:checked');
    if (!methodEl) return;
    const box = document.getElementById('upiDetailsBox');
    if (!box) return;

    if (methodEl.value === 'upi') {
        box.style.display = 'block';
        const idEl = document.getElementById('publicUpiId');
        if (idEl) idEl.innerText = shopDetails.upi_id || 'UPI ID not provided';

        const qrImg = document.getElementById('publicUpiQr');
        if (qrImg) {
            const fallback = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/UPI-Logo-vector.svg';
            const setFallback = () => { qrImg.src = fallback; qrImg.style.width = '100px'; qrImg.style.height = 'auto'; qrImg.style.marginBottom = '10px'; };
            qrImg.style.display = 'block';
            qrImg.onerror = function () { this.onerror = null; setFallback(); };

            if (!shopDetails.upi_qr_url || shopDetails.upi_qr_url.includes('blob:')) {
                setFallback();
            } else {
                qrImg.src = shopDetails.upi_qr_url;
                qrImg.style.width = '150px'; qrImg.style.height = '150px'; qrImg.style.marginBottom = '10px';
            }
        }
    } else {
        box.style.display = 'none';
    }
}

async function submitCustomerOrder() {
    if (Object.keys(customerCart).length === 0) return;
    const cafeId = new URLSearchParams(window.location.search).get('cafe') || '1';
    const tableNo = new URLSearchParams(window.location.search).get('table') || 'Takeaway';
    const payMethod = document.querySelector('input[name="payMethod"]:checked')?.value === 'upi' ? 'Paid via UPI' : 'Pay at Desk';
    let total = 0, orderText = '';
    for (const [id, qty] of Object.entries(customerCart)) {
        const item = publicMenuData.find(i => i.id == id);
        if (item) { total += Number(item.price) * qty; orderText += `▪️ ${qty}x ${item.name}\n`; }
    }

    try {
        const res = await fetch(`${API}/api/public/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cafeId, tableNo, cartTotal: total, orderDetails: orderText, paymentMethod: payMethod })
        });
        const data = await res.json();
        if (data.success && data.waLink) {
            customerCart = {};
            renderCustomerMenu();
            window.location.href = data.waLink;
        } else {
            window.showGlobalToast('Order failed.', 'error');
        }
    } catch (e) {
        window.showGlobalToast('Network Error', 'error');
    }
}

// --- 6. DEVELOPER GOD MODE ---
let devPingTimer = null;
const DEV_PING_MS = 10000;

async function initDeveloperDashboard() {
    if (!isDeveloperPage()) return;
    const devLoginForm = document.getElementById('devLoginForm');
    if (devLoginForm) {
        devLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const passInput = document.getElementById('devPasswordInput').value, btn = document.getElementById('devLoginBtn');
            btn.innerText = 'Verifying...'; btn.disabled = true;
            try {
                const res = await fetch(`${API}/api/developer/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: passInput }) });
                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('atom_dev_token', data.token);
                    document.getElementById('authWall').style.display = 'none';
                    document.getElementById('devContentWrapper').style.display = 'block';
                    window.showGlobalToast('God Mode Activated', 'success');
                    await fetchPlatformStats();
                    if (devPingTimer) clearInterval(devPingTimer);
                    devPingTimer = setInterval(pingDatabase, DEV_PING_MS);
                } else {
                    window.showGlobalToast('Access Denied: Incorrect Password', 'error');
                    document.getElementById('devPasswordInput').value = '';
                }
            } catch (err) { window.showGlobalToast('Server unreachable.', 'error'); }
            finally { btn.innerText = 'Verify Identity'; btn.disabled = false; }
        });
    }
    const devToken = localStorage.getItem('atom_dev_token');
    if (devToken) {
        const statsCheck = await fetchPlatformStats();
        if (statsCheck === 'ok') {
            document.getElementById('authWall').style.display = 'none';
            document.getElementById('devContentWrapper').style.display = 'block';
            if (devPingTimer) clearInterval(devPingTimer);
            devPingTimer = setInterval(pingDatabase, DEV_PING_MS);
        } else {
            localStorage.removeItem('atom_dev_token');
        }
    }
}

window.devLogout = function () {
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
    } catch (e) {}
}

async function sendBroadcast() {
    const msgInput = document.getElementById('broadcastMsg'), btn = document.querySelector('.broadcast-row button');
    if (!msgInput || !btn) return;
    const msg = msgInput.value;
    if (!msg) return;
    btn.innerText = 'Sending... ⏳'; btn.disabled = true;
    try {
        const res = await fetch(`${API}/api/developer/broadcast`, { method: 'POST', headers: getDevHeaders(), body: JSON.stringify({ message: msg }) });
        if (!res.ok) throw new Error('Broadcast rejected');
        const data = await res.json();
        msgInput.value = '';
        window.showGlobalToast(`Broadcast sent to ${data.emailedCount || 0} accounts!`, 'success');
    } catch (e) {
        window.showGlobalToast('Failed to send broadcast.', 'error');
    } finally {
        btn.innerText = 'Send Broadcast';
        btn.disabled = false;
    }
}

async function fetchPlatformStats() {
    try {
        const res = await fetch(`${API}/api/developer/stats`, { headers: getDevHeaders() });
        if (!res.ok) return 'error';
        const data = await res.json();
        const setText = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        setText('devUsers', data.totalUsers); setText('devShops', data.totalShops); setText('devProducts', data.totalProducts); setText('devActiveTenants', data.totalUsers);
        const term = document.getElementById('terminalLogs');
        if (term) {
            term.innerHTML = (data.logs || []).map(l => {
                const time = new Date(l.timestamp).toLocaleTimeString();
                return `<div class="terminal-line">[${esc(time)}] ${esc(l.fullName || 'Unknown')}: ${esc(l.action)}</div>`;
            }).join('');
        }
        const tbody = document.getElementById('devUsersTable');
        if (tbody) {
            tbody.innerHTML = (data.allUsers || []).map(u => {
                return `<tr><td>#${Number(u.id)}</td><td><strong style="color:#fff;">${esc(u.fullName)}</strong><br><span style="font-size:0.8em; color:#889;">${esc(u.email)}</span></td><td><code>Hidden</code></td><td style="font-size:0.85em;"><strong style="color:#66FCF1;">Shops:</strong> ${esc(u.shopNames || 'None')}<br><strong style="color:#25D366;">Items:</strong> ${esc(u.productCount)}</td><td><button class="btn-ghost" onclick="impersonateUser(${Number(u.id)})">Ghost Login</button> <button class="btn-terminate" onclick="terminateUser(${Number(u.id)})">Del</button></td></tr>`;
            }).join('');
        }
        return 'ok';
    } catch (e) { return 'error'; }
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
    } catch (e) { alert('Impersonation failed'); }
}

async function terminateUser(id) {
    if (!confirm('Wipe this account forever?')) return;
    try {
        const res = await fetch(`${API}/api/developer/users/${id}`, { method: 'DELETE', headers: getDevHeaders() });
        if (res.ok) { window.showGlobalToast('Account wiped successfully.', 'success'); fetchPlatformStats(); }
    } catch (e) {}
}

window.flushBackendLogs = async function () {
    try {
        const res = await fetch(`${API}/api/developer/logs`, { method: 'DELETE', headers: getDevHeaders() });
        if (res.ok) {
            document.getElementById('terminalLogs').innerHTML = '<div class="terminal-line">[System] Audit logs wiped clean by admin.</div>';
            window.showGlobalToast('Activity audit logs cleared.', 'success');
        }
    } catch (e) {}
};

// --- 7. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('atom_theme') === 'dark') document.body.classList.add('dark-mode');
    if (document.getElementById('welcomeCafeName')) loadDashboardData();
    if (document.getElementById('customerMenuGrid')) initCustomerMenu();
    if (isDeveloperPage()) initDeveloperDashboard();
});