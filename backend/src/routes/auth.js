import express from 'express';
import { timingSafeEqual } from 'crypto';

const router = express.Router();

// In-memory rate limiter: max 10 attempts per 15 minutes per IP
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

router.post('/login', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body;
  const expected = process.env.AUTH_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'AUTH_PASSWORD is not configured on the server' });
  }

  // Use constant-time comparison to prevent timing attacks
  const a = Buffer.from(password || '');
  const b = Buffer.from(expected);
  const match = a.length === b.length && timingSafeEqual(a, b);

  if (match) {
    loginAttempts.delete(ip); // clear attempts on success
    req.session.authenticated = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ error: 'Invalid password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  // Auth is disabled when AUTH_PASSWORD is not set
  if (!process.env.AUTH_PASSWORD) return res.json({ authenticated: true });
  res.json({ authenticated: !!req.session?.authenticated });
});

export default router;
