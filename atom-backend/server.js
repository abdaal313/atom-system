const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- CONFIG ---
const BASE_URL = process.env.BASE_URL || 'https://atom-system.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'atom_super_secret_key_123';
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'abdal123';
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set. Set it in Render Environment.');
if (!process.env.DEV_PASSWORD) console.warn('⚠️  DEV_PASSWORD not set. Set it in Render Environment.');

// --- MIDDLEWARE ---
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pool = mysql.createPool({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true }, connectTimeout: 10000
});

// --- EMAIL ---
// Render's free plan blocks SMTP ports, so on Render we send through Brevo's HTTPS API.
// Locally (no BREVO_API_KEY) it falls back to Gmail SMTP.
const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const gmailTransporter = process.env.EMAIL_USER
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
    : null;

async function sendEmail({ to, bcc, subject, html }) {
    if (process.env.BREVO_API_KEY) {
        if (!EMAIL_FROM) throw new Error('EMAIL_FROM is not set');
        const body = { sender: { name: 'ATOM', email: EMAIL_FROM }, to: [{ email: to }], subject, htmlContent: html };
        if (bcc && bcc.length) body.bcc = bcc.map(email => ({ email }));
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
        return;
    }
    if (!gmailTransporter) throw new Error('No email provider configured. Set BREVO_API_KEY and EMAIL_FROM.');
    await gmailTransporter.sendMail({ from: `"ATOM" <${EMAIL_FROM}>`, to, bcc, subject, html });
}

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
    try { await pool.query('INSERT INTO activity_logs (user_id, action) VALUES (?, ?)', [userId, action]); } catch (e) {}
}

// --- AUTH & RECOVERY ROUTES ---
// --- SIGNUP WITH PHONE + EMAIL OTP ---
app.set('trust proxy', 1);
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normPhone = (p) => String(p || '').replace(/[\s\-()]/g, '');
const hashOtp = (email, otp) => crypto.createHmac('sha256', JWT_SECRET).update(`${email}:${otp}`).digest('hex');

// Simple per-IP limit so nobody can spam OTP emails (10 per hour)
const otpIpHits = new Map();
function otpIpLimit(req, res, next) {
    const now = Date.now();
    const rec = otpIpHits.get(req.ip);
    if (!rec || now > rec.reset) { otpIpHits.set(req.ip, { count: 1, reset: now + 3600000 }); return next(); }
    if (rec.count >= 10) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    rec.count++;
    next();
}

const otpEmailHtml = (name, otp) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:20px">
    <h2 style="color:#FF5A1F;margin:0 0 10px">Verify your email</h2>
    <p>Hi ${escapeHtml(name)}, use this code to finish creating your ATOM account:</p>
    <p style="font-size:34px;letter-spacing:10px;font-weight:bold;background:#FFF3EC;padding:14px 20px;border-radius:10px;text-align:center;margin:20px 0">${otp}</p>
    <p style="color:#666;font-size:13px">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
</div>`;

// Step 1: validate details, store them as "pending", email a 6-digit code
app.post('/api/signup/request-otp', otpIpLimit, async (req, res) => {
    try {
        const fullName = String(req.body.fullName || '').trim();
        const email = normEmail(req.body.email);
        const phone = normPhone(req.body.phone);
        const { password, confirmPassword } = req.body;

        if (!fullName || fullName.length > 100) return res.status(400).json({ error: 'Please enter your full name.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
        if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
        if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

        const [existing] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
        if (existing.length > 0) return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });

        await pool.query('DELETE FROM pending_signups WHERE expires_at < ?', [Date.now()]);

        const [pending] = await pool.query('SELECT last_sent_at FROM pending_signups WHERE email = ?', [email]);
        if (pending.length > 0) {
            const wait = OTP_RESEND_MS - (Date.now() - Number(pending[0].last_sent_at));
            if (wait > 0) return res.status(429).json({ error: `Please wait ${Math.ceil(wait / 1000)} seconds before requesting another code.` });
        }

        const hash = await bcrypt.hash(password, 10);
        const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const now = Date.now();
        await pool.query(
            `INSERT INTO pending_signups (email, fullName, phone, password, otp_hash, expires_at, attempts, last_sent_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE fullName = VALUES(fullName), phone = VALUES(phone), password = VALUES(password),
             otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), attempts = 0, last_sent_at = VALUES(last_sent_at)`,
            [email, fullName, phone, hash, hashOtp(email, otp), now + OTP_TTL_MS, now]
        );

        try {
            await sendEmail({ to: email, subject: `${otp} is your ATOM verification code`, html: otpEmailHtml(fullName, otp) });
        } catch (mailErr) {
            console.error('OTP email failed:', mailErr.message);
            await pool.query('DELETE FROM pending_signups WHERE email = ?', [email]);
            return res.status(500).json({ error: 'Could not send the verification email. Please try again later.' });
        }

        res.json({ message: 'Verification code sent', resendIn: OTP_RESEND_MS / 1000 });
    } catch (error) { console.error('request-otp error:', error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Step 2: check the code, then actually create the account
app.post('/api/signup/verify-otp', async (req, res) => {
    try {
        const email = normEmail(req.body.email);
        const otp = String(req.body.otp || '').trim();
        if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Enter the 6-digit code.' });

        const [rows] = await pool.query('SELECT * FROM pending_signups WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(400).json({ error: 'No pending signup found. Please start again.' });
        const p = rows[0];

        if (Date.now() > Number(p.expires_at)) {
            await pool.query('DELETE FROM pending_signups WHERE email = ?', [email]);
            return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
        }
        if (p.attempts >= OTP_MAX_ATTEMPTS) {
            await pool.query('DELETE FROM pending_signups WHERE email = ?', [email]);
            return res.status(429).json({ error: 'Too many wrong attempts. Please request a new code.' });
        }

        const a = Buffer.from(hashOtp(email, otp)), b = Buffer.from(p.otp_hash);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            await pool.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?', [email]);
            const left = OTP_MAX_ATTEMPTS - (p.attempts + 1);
            return res.status(400).json({ error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Please request a new one.' });
        }

        let userId;
        try {
            const [result] = await pool.query('INSERT INTO users (fullName, email, phone, password) VALUES (?, ?, ?, ?)', [p.fullName, p.email, p.phone, p.password]);
            userId = result.insertId;
        } catch (dbErr) {
            if (dbErr.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
            throw dbErr;
        }
        await pool.query('DELETE FROM pending_signups WHERE email = ?', [email]);
        await logActivity(userId, 'Created account (email verified)');

        sendEmail({
            to: p.email,
            subject: 'Welcome to ATOM',
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
                <h2 style="color:#FF5A1F">Welcome to ATOM, ${escapeHtml(p.fullName)}!</h2>
                <p>Your account is ready. Log in to set up your menu, QR codes and kitchen routing.</p>
                <p><a href="${BASE_URL}/login.html" style="background:#FF5A1F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Open Dashboard</a></p>
            </div>`
        }).catch(e => console.error('Welcome email failed:', e.message));

        const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'Account created', token, userId, name: p.fullName });
    } catch (error) { console.error('verify-otp error:', error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE LOWER(email) = ?', [normEmail(req.body.email)]);
        if (users.length === 0 || !(await bcrypt.compare(req.body.password || '', users[0].password))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '7d' });
        await logActivity(users[0].id, 'Logged in');
        res.json({ message: 'Success!', name: users[0].fullName, token, userId: users[0].id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE LOWER(email) = ?', [normEmail(email)]);
        if (users.length === 0) return res.status(404).json({ error: 'Email not found.' });
        const resetToken = jwt.sign({ id: users[0].id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${BASE_URL}/reset-password.html?token=${resetToken}`;
        await sendEmail({
            to: email,
            subject: 'ATOM Password Recovery',
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
                <h2 style="color:#FF5A1F">Reset your password</h2>
                <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
                <p><a href="${resetLink}" style="background:#FF5A1F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a></p>
                <p style="color:#888;font-size:12px">If you did not request this, you can ignore this email.</p>
            </div>`
        });
        res.json({ message: 'Recovery email sent!' });
    } catch (error) {
        console.error('Forgot-password email failed:', error.message);
        res.status(500).json({ error: 'Could not send the recovery email. Please try again later.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        let decoded;
        try { decoded = jwt.verify(token, JWT_SECRET); }
        catch (e) { return res.status(400).json({ error: 'Reset link is invalid or has expired.' }); }
        if (decoded.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset link.' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hash, decoded.id]);
        await logActivity(decoded.id, 'Reset password');
        res.json({ message: 'Password updated' });
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
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            chartData.labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const row = rows.find(r => r.date_str === dateStr);
            chartData.data.push(row ? parseFloat(row.daily_revenue) : 0);
        }
        res.json(chartData);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- LIVE ORDERS ---
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

// --- SAVED QR ---
app.get('/api/qr', authenticate, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM qr_codes WHERE user_id = ? ORDER BY id DESC', [req.user.id]); res.json(rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/qr', authenticate, async (req, res) => {
    try {
        const { tableNo, color } = req.body;
        const targetUrl = `${BASE_URL}/menu.html?cafe=${req.user.id}&table=${encodeURIComponent(tableNo)}`;
        const qrCodeDataUrl = await QRCode.toDataURL(targetUrl, { color: { dark: color || '#FF5A1F', light: '#ffffff' }, width: 400, margin: 2 });
        await pool.query('INSERT INTO qr_codes (user_id, table_no, color, target_url, qr_data_url) VALUES (?, ?, ?, ?, ?)', [req.user.id, tableNo, color || '#FF5A1F', targetUrl, qrCodeDataUrl]);
        res.status(201).json({ message: 'QR Saved' });
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/qr/:id', authenticate, async (req, res) => {
    try { await pool.query('DELETE FROM qr_codes WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]); res.json({ message: 'Deleted' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- PUBLIC ROUTES ---
app.get('/api/public/shop/:cafeId', async (req, res) => {
    try {
        const [shops] = await pool.query('SELECT name, photo_url, upi_id, upi_qr_url FROM shops WHERE user_id = ? LIMIT 1', [req.params.cafeId]);
        if (shops.length > 0) res.json(shops[0]);
        else res.status(404).json({ error: 'Shop not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/public/menu/:cafeId', async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM menu_items WHERE user_id = ? AND inStock = true ORDER BY category', [req.params.cafeId]); res.json(rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/public/order', async (req, res) => {
    try {
        const { cafeId, tableNo, cartTotal, orderDetails, paymentMethod } = req.body;
        if (!cafeId || !cartTotal || !orderDetails) return res.status(400).json({ error: 'Invalid order.' });

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
    if (req.body.password === DEV_PASSWORD) res.json({ success: true, token: jwt.sign({ role: 'developer' }, JWT_SECRET, { expiresIn: '2h' }) });
    else res.status(401).json({ error: 'Invalid password' });
});

app.get('/api/developer/ping', (req, res) => { res.json({ status: 'ok' }); });

app.get('/api/developer/stats', requireDeveloper, async (req, res) => {
    try {
        const [[u]] = await pool.query('SELECT COUNT(*) as c FROM users');
        const [[s]] = await pool.query('SELECT COUNT(*) as c FROM shops');
        const [[p]] = await pool.query('SELECT COUNT(*) as c FROM menu_items');
        const [[e]] = await pool.query('SELECT COUNT(*) as c FROM employees');
        const [allUsers] = await pool.query(`SELECT u.id, u.fullName, u.email, (SELECT GROUP_CONCAT(name SEPARATOR ', ') FROM shops WHERE user_id = u.id) as shopNames, (SELECT COUNT(*) FROM menu_items WHERE user_id = u.id) as productCount FROM users u ORDER BY u.id DESC`);
        const [logs] = await pool.query(`SELECT a.action, a.timestamp, u.fullName FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50`);
        res.json({ totalUsers: u.c, totalShops: s.c, totalProducts: p.c, totalEmployees: e.c, allUsers, logs, chartData: [u.c, s.c, p.c, e.c] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/developer/impersonate/:id', requireDeveloper, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
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

app.post('/api/developer/broadcast', requireDeveloper, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });
        const [users] = await pool.query('SELECT email FROM users');
        if (users.length === 0) return res.json({ emailedCount: 0 });
        await sendEmail({
            to: EMAIL_FROM,
            bcc: users.map(u => u.email),
            subject: 'ATOM Announcement',
            html: `<p>${escapeHtml(message)}</p>`
        });
        res.json({ emailedCount: users.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/developer/logs', requireDeveloper, async (req, res) => {
    try { await pool.query('DELETE FROM activity_logs'); res.json({ message: 'Cleared' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- START SERVER + DB SETUP ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, fullName VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS shops (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, photo_url TEXT, chef_whatsapp VARCHAR(20), upi_id VARCHAR(100), upi_qr_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, price DECIMAL(10,2) NOT NULL, category VARCHAR(100) DEFAULT 'General', photo_url TEXT, description TEXT, inStock BOOLEAN DEFAULT true, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS employees (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(255) NOT NULL, role VARCHAR(100), phone VARCHAR(20), salary DECIMAL(10,2), photo_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS activity_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, action TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS qr_codes (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, table_no VARCHAR(100) NOT NULL, color VARCHAR(20) DEFAULT '#FF5A1F', target_url TEXT, qr_data_url TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, total_amount DECIMAL(10,2) NOT NULL, status VARCHAR(50) DEFAULT 'pending', table_no VARCHAR(100) DEFAULT 'Takeaway', order_details TEXT, payment_method VARCHAR(100) DEFAULT 'Desk', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);

        await pool.query(`CREATE TABLE IF NOT EXISTS pending_signups (email VARCHAR(255) PRIMARY KEY, fullName VARCHAR(255) NOT NULL, phone VARCHAR(20) NOT NULL, password VARCHAR(255) NOT NULL, otp_hash VARCHAR(64) NOT NULL, expires_at BIGINT NOT NULL, attempts INT DEFAULT 0, last_sent_at BIGINT NOT NULL)`);

        const alters = [
            `ALTER TABLE users ADD COLUMN phone VARCHAR(20)`,
            `ALTER TABLE shops ADD COLUMN chef_whatsapp VARCHAR(20)`,
            `ALTER TABLE shops ADD COLUMN upi_id VARCHAR(100)`,
            `ALTER TABLE shops ADD COLUMN upi_qr_url TEXT`,
            `ALTER TABLE menu_items ADD COLUMN description TEXT`,
            `ALTER TABLE employees ADD COLUMN phone VARCHAR(20)`,
            `ALTER TABLE employees ADD COLUMN salary DECIMAL(10,2)`,
            `ALTER TABLE orders ADD COLUMN table_no VARCHAR(100) DEFAULT 'Takeaway'`,
            `ALTER TABLE orders ADD COLUMN order_details TEXT`,
            `ALTER TABLE orders ADD COLUMN payment_method VARCHAR(100) DEFAULT 'Desk'`
        ];
        for (const q of alters) { try { await pool.query(q); } catch (e) {} }

        console.log('✅ TiDB Database upgraded and ready!');
    } catch (err) { console.error('❌ DATABASE SETUP ERROR:', err.message); }
});