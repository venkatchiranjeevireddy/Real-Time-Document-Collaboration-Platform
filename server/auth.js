/**
 * STEP 1: Auth routes — signup (send OTP), verify-otp (create user), signin (JWT).
 * OTP sent via nodemailer (Gmail). User created in Supabase Auth after OTP verify.
 */

const express = require('express');
const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db/supabase');
const logger = require('./logger');

const router = express.Router();
router.use(express.json());

// In-memory OTP store: email -> { otp, expiresAt }
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 min
const OTP_LENGTH = 6;

function generateOTP() {
  let s = '';
  for (let i = 0; i < OTP_LENGTH; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function getTransporter() {
  const { user, password } = config.email;
  if (!user || !password) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass: password },
  });
}

/** POST /auth/signup — send OTP to email */
router.post('/signup', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: 'Auth not configured (Supabase)' });
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'User already exists. Please sign in.' });
  }

  const transporter = getTransporter();
  if (!transporter) {
    return res.status(503).json({ error: 'Email not configured (EMAIL_USER, EMAIL_PASSWORD)' });
  }

  const otp = generateOTP();
  otpStore.set(email, { otp, expiresAt: Date.now() + OTP_TTL_MS });

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: email,
      subject: 'Doc Collab — Verify your email (OTP)',
      text: `Your verification code is: ${otp}\n\nIt expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
      html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 10 minutes.</p><p>If you didn't request this, ignore this email.</p>`,
    });
    logger.info('OTP sent to', email);
    return res.json({ message: 'OTP sent to your email. Check your inbox.' });
  } catch (err) {
    logger.error('OTP send failed', err.message);
    otpStore.delete(email);
    return res.status(500).json({ error: 'Failed to send OTP. Try again.' });
  }
});

/** POST /auth/verify-otp — verify OTP and create user in Supabase */
router.post('/verify-otp', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  const password = req.body.password;

  if (!email || !otp || !password) {
    return res.status(400).json({ error: 'Email, OTP, and password required' });
  }

  const entry = otpStore.get(email);
  if (!entry) {
    return res.status(400).json({ error: 'OTP expired or not found. Request a new one.' });
  }
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'OTP expired. Request a new one.' });
  }
  if (entry.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP.' });
  }

  otpStore.delete(email);

  const { data, error } = await db.createUserWithEmail(email, password);
  if (error) {
    logger.error('createUser failed', error.message);
    return res.status(400).json({ error: error.message || 'Account creation failed' });
  }

  logger.info('User created', email);
  return res.json({ message: 'Account created. You can now sign in.', user: data?.user });
});

/** POST /auth/signin — sign in with email/password, return Supabase session (JWT) */
router.post('/signin', async (req, res) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  if (!db.isConfigured()) {
    return res.status(503).json({ error: 'Auth not configured' });
  }

  const supabase = db.getClient && db.getClient();
  if (!supabase) {
    return res.status(503).json({ error: 'Auth not configured' });
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message && (error.message.includes('Invalid') || error.message.includes('credentials'))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return res.status(401).json({ error: error.message || 'Sign in failed' });
  }

  logger.info('Sign in', email);
  return res.json({
    session: data.session,
    user: data.user,
  });
});

/** POST /auth/signout — optional; client can clear session locally */
router.post('/signout', (req, res) => {
  res.json({ message: 'Signed out' });
});

/** Middleware: verify JWT and set req.user = { id, email }. Use for /api/documents etc. */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db.isConfigured()) {
    return res.status(503).json({ error: 'Auth not configured' });
  }
  try {
    const { data: { user }, error } = await db.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
