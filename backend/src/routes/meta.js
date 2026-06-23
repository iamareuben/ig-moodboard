import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  getOAuthDialogUrl,
  exchangeCodeForToken,
  getLongLivedToken,
  listPages,
  getIgAccountForPage,
} from '../services/metaGraph.js';
import { getMetaConnection, upsertMetaConnection, deleteMetaConnection, upsertAccount } from '../services/db.js';

const router = Router();

function redirectUri(req) {
  return process.env.META_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/meta/oauth/callback`;
}

// In-memory CSRF state for the OAuth redirect — single-user app, short-lived.
const pendingStates = new Set();

router.get('/oauth/start', (req, res) => {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET are not configured on the server' });
  }
  const state = randomUUID();
  pendingStates.add(state);
  res.redirect(getOAuthDialogUrl(redirectUri(req), state));
});

router.get('/oauth/callback', async (req, res) => {
  const { code, state, error_description } = req.query;
  if (error_description) {
    return res.status(400).send(`Meta OAuth error: ${error_description}`);
  }
  if (!state || !pendingStates.has(state)) {
    return res.status(400).send('Invalid or expired OAuth state');
  }
  pendingStates.delete(state);

  try {
    const shortLivedToken = await exchangeCodeForToken(code, redirectUri(req));
    const { accessToken, expiresAt } = await getLongLivedToken(shortLivedToken);

    const pages = await listPages(accessToken);
    if (pages.length === 0) {
      return res.status(400).send('No Facebook Pages found for this account. Connect a Page to your Instagram Business/Creator account first.');
    }

    // Find the first page with a linked IG business account.
    let page = null;
    let igAccount = null;
    for (const p of pages) {
      const ig = await getIgAccountForPage(p.id, accessToken);
      if (ig) { page = p; igAccount = ig; break; }
    }
    if (!igAccount) {
      return res.status(400).send('No Instagram Business/Creator account is linked to any of your Facebook Pages.');
    }

    const account = upsertAccount({
      username: igAccount.username,
      display_name: igAccount.username,
      ig_username: igAccount.username,
      ig_user_id: igAccount.id,
    });

    upsertMetaConnection({
      account_id: account.id,
      page_id: page.id,
      page_name: page.name,
      ig_user_id: igAccount.id,
      ig_username: igAccount.username,
      access_token: accessToken,
      token_expires_at: expiresAt,
    });

    res.redirect((process.env.CORS_ORIGIN || 'http://localhost:5173') + '/my-content?connected=1');
  } catch (err) {
    console.error('[meta oauth] callback failed:', err.message);
    res.status(500).send(`Connection failed: ${err.message}`);
  }
});

router.get('/status', (req, res) => {
  const conn = getMetaConnection();
  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    accountId: conn.account_id,
    igUsername: conn.ig_username,
    pageName: conn.page_name,
    tokenExpiresAt: conn.token_expires_at,
  });
});

router.post('/disconnect', (req, res) => {
  deleteMetaConnection();
  res.json({ ok: true });
});

export default router;
