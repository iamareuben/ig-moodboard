export function requireAuth(req, res, next) {
  // If no AUTH_PASSWORD is configured, auth is disabled (dev mode)
  if (!process.env.AUTH_PASSWORD) return next();
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
