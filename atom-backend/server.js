const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Broadened CORS so the browser doesn't block your developer buttons
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'atom_super_secret_key_123';
let globalBroadcastMessage = ""; 

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// 1. Database Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 10000
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ---------------------------------------------------------
// MIDDLEWARE: SECURITY FIREWALLS
// ---------------------------------------------------------
// Cafe-owner auth middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied.' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid token.' }); }
};

// NEW: Developer "God Mode" Auth Middleware
const requireDeveloper = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Developer access denied.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'developer') return res.status(403).json({ error: 'Forbidden.' });
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid developer token.' }); }
};

// --- SYSTEM LOGGER ---
async function logActivity(userId, action) {
    try { 
        await pool.query('INSERT INTO activity_logs (user_id, action) VALUES (?, ?)', [userId, action]); 
    } catch(e) { console.error("Logging error:", e.message); }
}

// ==========================================================================
// AUTHENTICATION ROUTES
// ==========================================================================
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (fullName, email, password) VALUES (?, ?, ?)', [fullName, email, hash]);
        await logActivity(result.insertId, `Created account: ${email}`);

        const mailOptions = {
            from: `"ATOM Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Welcome to ATOM | Creating Ease 🚀',
            html: `
            <div style="background-color: #f4f5f7; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
                    <div style="background: #111111; padding: 30px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 2px;">ATOM<span style="color: #FF5A1F;">.</span></h1>
                    </div>
                    <div style="padding: 40px 30px;">
                        <h2 style="color: #111111; margin-top: 0;">Welcome aboard, ${escapeHtml(fullName)}! 🚀</h2>
                        <p style="color: #555555; font-size: 16px; line-height: 1.6;">Your multi-tenant SaaS workspace has been successfully provisioned.</p>
                        <div style="text-align: center; margin-top: 40px;">
                            <a href="http://localhost:5500/login.html" style="display: inline-block; background-color: #FF5A1F; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold;">Access Your Dashboard</a>
                        </div>
                    </div>
                </div>
            </div>`
        };
        transporter.sendMail(mailOptions).catch(err => console.error('Email failed:', err));

        res.status(201).json({ message: 'Success' });
    } catch (error) { 
        console.error('Signup error:', error.message);
        res.status(500).json({ error: error.message }); 
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [req.body.email]);
        if (users.length === 0 || !(await bcrypt.compare(req.body.password, users[0].password))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '7d' });
        await logActivity(users[0].id, `Logged in`);
        res.json({ message: 'Success!', name: users[0].fullName, token, userId: users[0].id });
    } catch (error) { 
        console.error('Login error:', error.message);
        res.status(500).json({ error: error.message }); 
    }
});

// ==========================================================================
// CAFE DASHBOARD ROUTES
// ==========================================================================
app.get('/api/menu', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menu_items WHERE user_id = ? ORDER BY category', [req.user.id]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menu', authenticate, async (req, res) => {
    try {
        const { name, price, category, photo_url } = req.body;
        const photo = photo_url || 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=300&q=80';
        const cat = category || 'General';
        await pool.query('INSERT INTO menu_items (user_id, name, price, category, photo_url, inStock) VALUES (?, ?, ?, ?, ?, true)', [req.user.id, name, price, cat, photo]);
        await logActivity(req.user.id, `Added product: ${name}`);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menu/:id/stock', authenticate, async (req, res) => {
    try {
        await pool.query('UPDATE menu_items SET inStock = ? WHERE id = ? AND user_id = ?', [req.body.inStock, req.params.id, req.user.id]);
        res.json({ message: 'Stock updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menu/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM menu_items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shops', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM shops WHERE user_id = ?', [req.user.id]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/shops', authenticate, async (req, res) => {
    try {
        const photo = req.body.photo_url || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=300&q=80';
        await pool.query('INSERT INTO shops (user_id, name, photo_url) VALUES (?, ?, ?)', [req.user.id, req.body.name, photo]);
        await logActivity(req.user.id, `Added shop: ${req.body.name}`);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shops/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM shops WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/employees', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM employees WHERE user_id = ?', [req.user.id]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', authenticate, async (req, res) => {
    try {
        const photo = req.body.photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80';
        await pool.query('INSERT INTO employees (user_id, name, role, photo_url) VALUES (?, ?, ?, ?)', [req.user.id, req.body.name, req.body.role, photo]);
        res.status(201).json({ message: 'Added' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employees/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM employees WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================================================
// PUBLIC ROUTES & BROADCASTS
// ==========================================================================
app.get('/api/public/menu/:cafeId', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menu_items WHERE user_id = ? AND inStock = true ORDER BY category', [req.params.cafeId]);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/generate-qr', authenticate, async (req, res) => {
    try {
        const { tableNo, color, paymentUPI } = req.body;
        const cafeId = req.user.id;

        const targetUrl = `http://localhost:5500/menu.html?cafe=${cafeId}&table=${encodeURIComponent(tableNo)}&upi=${encodeURIComponent(paymentUPI || '')}`;

        const qrCodeDataUrl = await QRCode.toDataURL(targetUrl, {
            color: { dark: color || '#FF5A1F', light: '#ffffff' },
            width: 400,
            margin: 2
        });

        res.json({ qrCodeUrl: qrCodeDataUrl, targetUrl });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate QR' });
    }
});

app.get('/api/broadcast', (req, res) => {
    res.json({ message: globalBroadcastMessage });
});

// ==========================================================================
// DEVELOPER "GOD MODE" ROUTES (Highly Secured)
// ==========================================================================

// NEW: Missing Auth Route that verifies the Dev login
app.post('/api/developer/auth', (req, res) => {
    const { password } = req.body;
    // Uses the password from .env, but defaults to 'abdal123' so you don't get locked out right now
    const masterPassword = process.env.DEV_PASSWORD || 'abdal123'; 

    if (password === masterPassword) {
        const token = jwt.sign({ role: 'developer' }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid developer password' });
    }
});

app.get('/api/developer/ping', async (req, res) => {
    res.json({ status: 'ok' });
});

// Secured with requireDeveloper
app.get('/api/developer/stats', requireDeveloper, async (req, res) => {
    try {
        const [[u]] = await pool.query('SELECT COUNT(*) as c FROM users');
        const [[s]] = await pool.query('SELECT COUNT(*) as c FROM shops');
        const [[p]] = await pool.query('SELECT COUNT(*) as c FROM menu_items');
        const [[e]] = await pool.query('SELECT COUNT(*) as c FROM employees');

        const [allUsers] = await pool.query(`
            SELECT u.id, u.fullName, u.email, u.password,
            (SELECT GROUP_CONCAT(name SEPARATOR ', ') FROM shops WHERE user_id = u.id) as shopNames,
            (SELECT COUNT(*) FROM menu_items WHERE user_id = u.id) as productCount
            FROM users u ORDER BY u.id DESC
        `);

        const [logs] = await pool.query(`
            SELECT l.action, l.timestamp, u.fullName
            FROM activity_logs l
            JOIN users u ON l.user_id = u.id
            ORDER BY l.id DESC LIMIT 15
        `);

        res.json({
            totalUsers: u.c, totalShops: s.c, totalProducts: p.c, totalEmployees: e.c,
            allUsers: allUsers,
            logs: logs,
            chartData: [u.c, s.c, p.c, e.c]
        });
    } catch (error) { 
        console.error("Stats API error:", error.message);
        res.status(500).json({ error: error.message }); 
    }
});

// Secured with requireDeveloper
app.delete('/api/developer/users/:id', requireDeveloper, async (req, res) => {
    try {
        const userId = req.params.id;
        await pool.query('DELETE FROM activity_logs WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM menu_items WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM shops WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM employees WHERE user_id = ?', [userId]);
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ message: 'Terminated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Secured with requireDeveloper
app.get('/api/developer/impersonate/:id', requireDeveloper, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
        const token = jwt.sign({ id: users[0].id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, name: users[0].fullName, userId: users[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Missing Flush Logs endpoint for the Developer button
app.delete('/api/developer/logs', requireDeveloper, async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE activity_logs');
        res.json({ message: 'Logs wiped successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Secured with requireDeveloper
app.post('/api/developer/broadcast', requireDeveloper, async (req, res) => {
    const message = req.body.message;
    globalBroadcastMessage = message;

    try {
        const [users] = await pool.query('SELECT email FROM users');
        const bccList = users.map(u => u.email).join(', ');

        if (bccList) {
            const mailOptions = {
                from: `"ATOM Admin" <${process.env.EMAIL_USER}>`,
                bcc: bccList,
                subject: 'ATOM Platform Update 📢',
                html: `
                <div style="background-color: #0B0C10; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                    <div style="max-width: 600px; margin: 0 auto; background: #1F2833; border-radius: 12px; overflow: hidden; border: 1px solid #45A29E;">
                        <div style="background: #FF5A1F; padding: 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">SYSTEM BROADCAST</h1>
                        </div>
                        <div style="padding: 40px 30px; text-align: center;">
                            <p style="color: #C5C6C7; font-size: 18px; line-height: 1.6;">${escapeHtml(message)}</p>
                            <a href="http://localhost:5500/login.html" style="display: inline-block; margin-top: 30px; background-color: #45A29E; color: #0B0C10; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold;">Open Dashboard</a>
                        </div>
                    </div>
                </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error('Broadcast email failed:', err));
        }

        res.json({ success: true, emailedCount: users.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================================================
// PASSWORD RECOVERY ROUTES
// ==========================================================================
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ error: 'Email not found in our records.' });

        const user = users[0];
        const resetToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `http://localhost:5500/reset-password.html?token=${resetToken}`;

        const mailOptions = {
            from: `"ATOM Security" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Recovery Request 🔒',
            html: `
            <div style="background-color: #0B0C10; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                <div style="max-width: 600px; margin: 0 auto; background: #1F2833; border-radius: 12px; overflow: hidden; border: 1px solid #45A29E;">
                    <div style="background: #FF5A1F; padding: 20px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">PASSWORD RECOVERY</h1>
                    </div>
                    <div style="padding: 40px 30px; text-align: center;">
                        <p style="color: #C5C6C7; font-size: 16px; line-height: 1.6;">We received a request to reset your ATOM account password. Click the button below to choose a new password. This link expires in 1 hour.</p>
                        <a href="${resetLink}" style="display: inline-block; margin-top: 30px; background-color: #45A29E; color: #0B0C10; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold;">Reset Password</a>
                    </div>
                </div>
            </div>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'Password recovery email sent successfully!' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const hash = await bcrypt.hash(newPassword, 10);

        await pool.query('UPDATE users SET password = ? WHERE id = ?', [hash, decoded.id]);
        await logActivity(decoded.id, 'Reset account password successfully');

        res.json({ message: 'Password updated successfully!' });
    } catch (error) {
        res.status(400).json({ error: 'Invalid or expired reset token.' });
    }
});

// 2. Auto-initialize Database Tables on Server Boot
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                fullName VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS shops (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                photo_url TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS menu_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                category VARCHAR(100) DEFAULT 'General',
                photo_url TEXT,
                inStock BOOLEAN DEFAULT true,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(100),
                photo_url TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                action TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ TiDB Database tables verified & created successfully!');
    } catch (err) {
        console.error('❌ DATABASE SETUP ERROR:', err.message);
    }
});