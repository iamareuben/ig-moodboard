import { randomUUID, randomBytes, createHash } from 'crypto';

// Minimal single-user OAuth 2.1 authorization server, just enough to satisfy MCP clients
// (Claude Desktop/Claude.ai) that only support OAuth for remote connectors — not a real
// multi-user auth system. The "password" gating the one-time browser authorize screen is
// the same shared secret as the static bearer token (MCP_AUTH_TOKEN); there is only ever
// one legitimate user of this server.
const PASSWORD = process.env.MCP_AUTH_TOKEN;

const clients = new Map();       // client_id -> { redirect_uris, client_name }
const authCodes = new Map();     // code -> { clientId, redirectUri, codeChallenge, expiresAt }
const accessTokens = new Map();  // access_token -> { clientId, expiresAt }
const refreshTokens = new Map(); // refresh_token -> { clientId }

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function issueTokens(clientId) {
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  accessTokens.set(accessToken, { clientId, expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
  refreshTokens.set(refreshToken, { clientId });
  return { accessToken, refreshToken };
}

export function isValidOAuthAccessToken(token) {
  const entry = accessTokens.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    accessTokens.delete(token);
    return false;
  }
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function registerOAuthRoutes(app, { baseUrl }) {
  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
    });
  });

  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  });

  // Dynamic Client Registration (RFC 7591) — lets the client self-register with no manual
  // Client ID entry required.
  app.post('/oauth/register', (req, res) => {
    const { redirect_uris, client_name } = req.body || {};
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
    }
    const clientId = randomUUID();
    clients.set(clientId, { redirect_uris, client_name: client_name || 'MCP Client' });
    console.log(`[mcp:oauth] registered client "${client_name || 'MCP Client'}" (${clientId}), redirect_uris: ${redirect_uris.join(', ')}`);
    res.status(201).json({
      client_id: clientId,
      redirect_uris,
      client_name,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  app.get('/oauth/authorize', (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, response_type } = req.query;
    const client = clients.get(client_id);
    if (!client || !client.redirect_uris.includes(redirect_uri)) {
      return res.status(400).send('Unknown client or redirect_uri');
    }
    if (response_type !== 'code') {
      return res.status(400).send('Only response_type=code is supported');
    }
    res.send(`<!doctype html>
<html><body style="font-family: monospace; max-width: 400px; margin: 80px auto;">
  <h3>Authorize MCP access</h3>
  <p>${escapeHtml(client.client_name)} is requesting access to your analytics data.</p>
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
    <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge || '')}" />
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method || '')}" />
    <input type="password" name="password" placeholder="Access token" style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box;" autofocus />
    <button type="submit" style="width:100%;padding:8px;">Authorize</button>
  </form>
</body></html>`);
  });

  app.post('/oauth/authorize', (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, password } = req.body || {};
    const client = clients.get(client_id);
    if (!client || !client.redirect_uris.includes(redirect_uri)) {
      console.warn(`[mcp:oauth] authorize rejected — unknown client/redirect_uri (client_id: ${client_id})`);
      return res.status(400).send('Unknown client or redirect_uri');
    }
    if (password !== PASSWORD) {
      console.warn(`[mcp:oauth] authorize rejected — wrong password (client: ${client.client_name})`);
      return res.status(401).send('Incorrect access token — go back and try again.');
    }
    const code = randomBytes(24).toString('hex');
    authCodes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    console.log(`[mcp:oauth] authorized client "${client.client_name}" (${client_id}) — code issued`);
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  app.post('/oauth/token', (req, res) => {
    const { grant_type } = req.body || {};

    if (grant_type === 'authorization_code') {
      const { code, redirect_uri, code_verifier, client_id } = req.body;
      const entry = authCodes.get(code);
      if (!entry || entry.expiresAt < Date.now()) {
        console.warn('[mcp:oauth] token exchange rejected — invalid or expired code');
        return res.status(400).json({ error: 'invalid_grant' });
      }
      authCodes.delete(code); // single use
      if (entry.redirectUri !== redirect_uri || entry.clientId !== client_id) {
        console.warn('[mcp:oauth] token exchange rejected — redirect_uri/client_id mismatch');
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (entry.codeChallenge) {
        const computed = createHash('sha256').update(code_verifier || '').digest('base64url');
        if (computed !== entry.codeChallenge) {
          console.warn('[mcp:oauth] token exchange rejected — PKCE verification failed');
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
      }
      const { accessToken, refreshToken } = issueTokens(client_id);
      console.log(`[mcp:oauth] issued access token for client ${client_id}`);
      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        refresh_token: refreshToken,
      });
    }

    if (grant_type === 'refresh_token') {
      const { refresh_token, client_id } = req.body;
      const entry = refreshTokens.get(refresh_token);
      if (!entry || entry.clientId !== client_id) {
        console.warn('[mcp:oauth] refresh rejected — invalid refresh_token/client_id');
        return res.status(400).json({ error: 'invalid_grant' });
      }
      refreshTokens.delete(refresh_token);
      const { accessToken, refreshToken } = issueTokens(client_id);
      console.log(`[mcp:oauth] refreshed access token for client ${client_id}`);
      return res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        refresh_token: refreshToken,
      });
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });
}
