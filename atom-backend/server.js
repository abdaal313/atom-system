const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'atom_super_secret_key_123';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pool = mysql.createPool({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true }, connectTimeout: 10000
});

const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied.' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); } 
    catch (err) { res.status(401).json({ error: 'Invalid token.' }); }
};

const requireDeveloper = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Developer access denied.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'developer') return res.status(403).json({ error: 'Forbidden.' });
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid developer token.' }); }
};

async function logActivity(userId, action) {
    try { await pool.query('INSERT INTO activity_logs (user_id, action) VALUES (?, ?)', [userId, action]); } catch(e) {}
}

// --- AUTH & RECOVERY ROUTES ---
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (fullName, email, password) VALUES (?, ?, ?)', [fullName, email, hash]);
        await logActivity(result.insertId, `Created account`);
        res.status(201).json({ message: 'Success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [req.body.email]);
        if (users.length === 0 || !(await bcrypt.compare(req.body.password, users[0].password))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '7d' });
        await logActivity(users[0].id, `Logged in`);
        res.json({ message: 'Success!', name: users[0].fullName, token, userId: users[0].id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ error: 'Email not found.' });
        const resetToken = jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `http://localhost:5500/reset-password.html?token=${resetToken}`;
        await transporter.sendMail({ from: `"ATOM" <${process.env.EMAIL_USER}>`, to: email, subject: 'Password Recovery', html: `<p><a href="${resetLink}">Reset Password</a></p>` });
        res.json({ message: 'Recovery email sent!' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- DASHBOARD ROUTES ---
app.get('/api/menu', authenticate, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM menu_items WHERE user_id = ? ORDER BY category', [req.user.id]); res.json(rows); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menu', authenticate, async (req, res) => {
    try {
        const { name, price, category, photo_url, description } = req.body;
        await pool.query('INSERT INTO menu_items (user_id, name, price, category, photo_url, description, inStock) VALUES (?, ?, ?, ?, ?, ?, true)', 
            [req.user.id, name, price, category || 'General', photo_url || '', description || '']);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menu/:id/stock', authenticate, async (req, res) => {
    try { await pool.query('UPDATE menu_items SET inStock = ? WHERE id = ? AND user_id = ?', [req.body.inStock, req.params.id, req.user.id]); res.json({ message: 'Updated' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menu/:id', authenticate, async (req, res) => {
    try { await pool.query('DELETE FROM menu_items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]); res.json({ message: 'Deleted' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shops', authenticate, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM shops WHERE user_id = ?', [req.user.id]); res.json(rows); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shops', authenticate, async (req, res) => {
    try {
        await pool.query('INSERT INTO shops (user_id, name, photo_url) VALUES (?, ?, ?)', [req.user.id, req.body.name, req.body.photo_url || '']);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/shops/whatsapp', authenticate, async (req, res) => {
    try { await pool.query('UPDATE shops SET chef_whatsapp = ? WHERE user_id = ? LIMIT 1', [req.body.chef_whatsapp, req.user.id]); res.json({ message: 'Updated' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/shops/payment', authenticate, async (req, res) => {
    try { await pool.query('UPDATE shops SET upi_id = ?, upi_qr_url = ? WHERE user_id = ? LIMIT 1', [req.body.upi_id, req.body.upi_qr_url, req.user.id]); res.json({ message: 'Payment config updated' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/employees', authenticate, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM employees WHERE user_id = ?', [req.user.id]); res.json(rows); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', authenticate, async (req, res) => {
    try {
        const { name, role, phone, salary, photo_url } = req.body;
        await pool.query('INSERT INTO employees (user_id, name, role, phone, salary, photo_url) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, name, role, phone || '', parseFloat(salary) || 0, photo_url || '']);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employees/:id', authenticate, async (req, res) => {
    try { await pool.query('DELETE FROM employees WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]); res.json({ message: 'Deleted' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/revenue', authenticate, async (req, res) => {
    try {
        const query = `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date_str, SUM(total_amount) as daily_revenue FROM orders WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY date_str ORDER BY date_str ASC`;
        const [rows] = await pool.query(query, [req.user.id]);
        const chartData = { labels: [], data: [] };
        for(let i=6; i>=0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            chartData.labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const row = rows.find(r => r.date_str === dateStr);
            chartData.data.push(row ? parseFloat(row.daily_revenue) : 0);
        }
        res.json(chartData);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NEW: LIVE ORDERS ROUTES ---
app.get('/api/orders', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', authenticate, async (req, res) => {
    try {
        await pool.query('UPDATE orders SET status = ? WHERE id = ? AND user_id = ?', [req.body.status, req.params.id, req.user.id]);
        res.json({ message: 'Status updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- SAVED QR & PUBLIC ROUTES ---
app.get('/api/qr', authenticate, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM qr_codes WHERE user_id = ? ORDER BY id DESC', [req.user.id]); res.json(rows); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/qr', authenticate, async (req, res) => {
    try {
        const { tableNo, color } = req.body;
        const targetUrl = `https://abdaal313.github.io/atom-system/menu.html?cafe=${req.user.id}&table=${encodeURIComponent(tableNo)}`;
        const qrCodeDataUrl = await QRCode.toDataURL(targetUrl, { color: { dark: color || '#FF5A1F', light: '#ffffff' }, width: 400, margin: 2 });
        await pool.query('INSERT INTO qr_codes (user_id, table_no, color, target_url, qr_data_url) VALUES (?, ?, ?, ?, ?)', [req.user.id, tableNo, color || '#FF5A1F', targetUrl, qrCodeDataUrl]);
        res.status(201).json({ message: 'QR Saved' });
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/qr/:id', authenticate, async (req, res) => {
    try { await pool.query('DELETE FROM qr_codes WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]); res.json({ message: 'Deleted' }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// PUBLIC: Fetch Shop Details
app.get('/api/public/shop/:cafeId', async (req, res) => {
    try {
        const [shops] = await pool.query('SELECT name, photo_url, upi_id, upi_qr_url FROM shops WHERE user_id = ? LIMIT 1', [req.params.cafeId]);
        if(shops.length > 0) res.json(shops[0]);
        else res.status(404).json({error: "Shop not found"});
    } catch(e) { res.status(500).json({error: e.message}); }
});

// PUBLIC: Fetch Menu
app.get('/api/public/menu/:cafeId', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM menu_items WHERE user_id = ? AND inStock = true ORDER BY category', [req.params.cafeId]); res.json(rows); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// PUBLIC: Order Checkout
app.post('/api/public/order', async (req, res) => {
    try {
        const { cafeId, tableNo, cartTotal, orderDetails, paymentMethod } = req.body;
        
        await pool.query(
            'INSERT INTO orders (user_id, total_amount, table_no, order_details, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)', 
            [cafeId, cartTotal, tableNo, orderDetails, paymentMethod, 'pending']
        );

        const [shops] = await pool.query('SELECT chef_whatsapp FROM shops WHERE user_id = ? LIMIT 1', [cafeId]);
        let waNumber = shops.length > 0 ? shops[0].chef_whatsapp : '';
        if (waNumber) waNumber = waNumber.replace(/\D/g, '');

        const text = `🛎️ *NEW ORDER - ${tableNo}*\n\n${orderDetails}\n💳 *Payment:* ${paymentMethod}\n💰 *Total: ₹${cartTotal}*`;
        const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;

        res.json({ success: true, waLink });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- DEVELOPER ROUTES ---
app.post('/api/developer/auth', (req, res) => {
    if (req.body.password === (process.env.DEV_PASSWORD || 'abdal123')) res.json({ success: true, token: jwt.sign({ role: 'developer' }, JWT_SECRET, { expiresIn: '2h' }) });
    else res.status(401).json({ error: 'Invalid password' });
});
app.get('/api/developer/ping', async (req, res) => { res.json({ status: 'ok' }); });
app.get('/api/developer/stats', requireDeveloper, async (req, res) => {
    try {
        const [[u]] = await pool.query('SELECT COUNT(*) as c FROM users'); const [[s]] = await pool.query('SELECT COUNT(*) as c FROM shops');
        const [[p]] = await pool.query('SELECT COUNT(*) as c FROM menu_items'); const [[e]] = await pool.query('SELECT COUNT(*) as c FROM employees');
        const [allUsers] = await pool.query(`SELECT u.id, u.fullName, u.email, (SELECT GROUP_CONCAT(name SEPARATOR ', ') FROM shops WHERE user_id = u.id) as shopNames, (SELECT COUNT(*) FROM menu_items WHERE user_id = u.id) as productCount FROM users u ORDER BY u.id DESC`);
        res.json({ totalUsers: u.c, totalShops: s.c, totalProducts: p.c, totalEmployees: e.c, allUsers, chartData: [u.c, s.c, p.c, e.c] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/api/developer/impersonate/:id', requireDeveloper, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
        res.json({ token: jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '1h' }), name: users[0].fullName, userId: users[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/developer/users/:id', requireDeveloper, async (req, res) => {
    try {
        const userId = req.params.id;
        await Promise.all(['activity_logs', 'menu_items', 'shops', 'employees', 'qr_codes', 'orders'].map(table => pool.query(`DELETE FROM ${table} WHERE user_id = ?`, [userId])));
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ message: 'Terminated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS shops (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, photo_url TEXT, chef_whatsapp VARCHAR(20), upi_id VARCHAR(100), upi_qr_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, price DECIMAL(10,2) NOT NULL, category VARCHAR(100) DEFAULT 'General', photo_url TEXT, description TEXT, inStock BOOLEAN DEFAULT true, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS employees (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(100), phone VARCHAR(20), salary DECIMAL(10,2), photo_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, action TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS qr_codes (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, table_no VARCHAR(100) NOT NULL, color VARCHAR(20) DEFAULT '#FF5A1F', target_url TEXT, qr_data_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, total_amount DECIMAL(10,2) NOT NULL, status VARCHAR(50) DEFAULT 'pending', table_no VARCHAR(100) DEFAULT 'Takeaway', order_details TEXT, payment_method VARCHAR(100) DEFAULT 'Desk', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);

        try { await pool.query(`ALTER TABLE shops ADD COLUMN chef_whatsapp VARCHAR(20)`); } catch(e) {}
        try { await pool.query(`ALTER TABLE shops ADD COLUMN upi_id VARCHAR(100)`); } catch(e) {}
        try { await pool.query(`ALTER TABLE shops ADD COLUMN upi_qr_url TEXT`); } catch(e) {}
        try { await pool.query(`ALTER TABLE menu_items ADD COLUMN description TEXT`); } catch(e) {}
        try { await pool.query(`ALTER TABLE employees ADD COLUMN phone VARCHAR(20)`); } catch(e) {}
        try { await pool.query(`ALTER TABLE employees ADD COLUMN salary DECIMAL(10,2)`); } catch(e) {}
        
        try { await pool.query(`ALTER TABLE orders ADD COLUMN table_no VARCHAR(100) DEFAULT 'Takeaway'`); } catch(e) {}
        try { await pool.query(`ALTER TABLE orders ADD COLUMN order_details TEXT`); } catch(e) {}
        try { await pool.query(`ALTER TABLE orders ADD COLUMN payment_method VARCHAR(100) DEFAULT 'Desk'`); } catch(e) {}

        console.log('✅ TiDB Database upgraded and ready!');
    } catch (err) { console.error('❌ DATABASE SETUP ERROR:', err.message); }
});