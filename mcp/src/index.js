import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { registerOAuthRoutes, isValidOAuthAccessToken } from './oauth.js';

const PORT = process.env.PORT || 3002;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
// Public URL this service is reachable at — needed for correct OAuth metadata responses
// (must be the real external URL, not the internal docker-network address).
const PUBLIC_URL = process.env.MCP_PUBLIC_URL || `http://localhost:${PORT}`;

if (!AUTH_TOKEN) {
  console.error('MCP_AUTH_TOKEN is not configured — refusing to start an unauthenticated server.');
  process.exit(1);
}

const server = new McpServer({ name: 'ig-mood-story-board-analytics', version: '1.0.0' });
registerTools(server);

// Stateless transport — single shared instance, no per-session state needed for read-only tools.
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // OAuth token endpoint + our own authorize form

app.get('/health', (req, res) => res.json({ ok: true }));

registerOAuthRoutes(app, { baseUrl: PUBLIC_URL });

app.use('/mcp', (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // Accept either the static bearer token (Claude Code, curl, direct integrations) or a
  // token issued via the OAuth flow above (Claude Desktop/Claude.ai).
  if (token && (token === AUTH_TOKEN || isValidOAuthAccessToken(token))) {
    return next();
  }
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`);
  return res.status(401).json({ error: 'Unauthorized' });
});

app.all('/mcp', async (req, res) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
