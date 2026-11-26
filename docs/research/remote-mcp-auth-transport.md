# Remote MCP server: auth and transport

Research for [#6](https://github.com/Miconen/geo-coach/issues/6). Researched 2026-11-21 against the MCP spec revision **2026-07-28** (current "latest"), the official TypeScript SDK **v2.4.0** (`main`, released 2026-10-23), and the Claude Code and Codex docs.

## Question

How should geo-coach expose a remote MCP server over HTTPS, in TypeScript, that only the two Duo members can use? What does the spec say about remote transports and auth, what does the TypeScript SDK support, how do Claude Code and other agents connect with headers or OAuth, and can it share Discord login with the web app?

## Recommendation

1. **Transport:** use Streamable HTTP with a single `POST /mcp` endpoint on the VPS, behind the HTTPS reverse proxy. Build it with `@modelcontextprotocol/server` v2 `createMcpHandler` (stateless, one server instance per request). Keep the default `legacy: 'stateless'` so 2025-era clients still connect. Do not use the old HTTP+SSE transport.
2. **Auth, first version:** use **per-member bearer tokens issued by the web app**. A Duo member signs into the web app with Discord (which only lets in the two allowlisted Discord user IDs) and creates or revokes an "MCP token". The server stores only a hash of each token, plus the member and an expiry. The MCP endpoint checks tokens with the SDK's `requireBearerAuth` and a custom `verifyAccessToken` that looks up the hash. The agent sends the token as `Authorization: Bearer …` from an environment variable.
3. **Sharing Discord login:** share the *identity* but not the *token*. Discord access tokens must not be sent to the MCP server. The spec forbids token passthrough, and Discord tokens are not bound to our server. Discord login is how a member proves who they are to the web app, and the web app then issues credentials meant only for geo-coach.
4. **Later upgrade (optional):** turn the web app into a full OAuth 2.1 authorization server that uses Discord as its login step, for example better-auth's `oauth-provider` and `mcp` plugins (**unverified** for this stack). Then `/mcp` in Claude Code runs a browser login and nobody copies tokens by hand. This adds a lot of moving parts for two users. Only do it if copying tokens becomes a real annoyance.

## Findings

### Transport (spec 2026-07-28)

- The spec defines two standard transports, stdio and Streamable HTTP. With Streamable HTTP, "each message is an HTTP POST to a single MCP endpoint; replies arrive as a JSON object or a request-scoped SSE stream." [transports overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- Revision 2026-07-28 **removed the GET stream endpoint and protocol-level sessions** (`Mcp-Session-Id`). It also dropped resumable streams (`Last-Event-ID`). Messages from the server to the client now travel inside results (MRTR). A server that only speaks this revision should answer GET or DELETE with `405`. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- Every POST must include `MCP-Protocol-Version` and `Mcp-Method` headers (and `Mcp-Name` for `tools/call`). They must match the body, or the server returns `400 HeaderMismatch` (`-32020`). [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#request-metadata)
- Security rules: servers "MUST validate the `Origin` header" (403 if it is present and invalid), and "SHOULD implement proper authentication for all connections." Servers SHOULD send `X-Accel-Buffering: no` on SSE responses so nginx-style proxies don't buffer them. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security--endpoint)
- The old HTTP+SSE transport (2024-11-05) is deprecated: "New implementations SHOULD NOT adopt it." [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#httpsse-transport-2024-11-05)

### Authorization (spec 2026-07-28)

- "Authorization is **OPTIONAL** for MCP implementations." HTTP implementations that do support it "SHOULD conform" to the OAuth-based spec. [authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
  - So a static bearer token is allowed. It just isn't the spec's interoperable OAuth flow, and clients can't discover it on their own.
- The spec-conforming design works like this:
  - The MCP server is an **OAuth 2.1 resource server**. A separate (or co-hosted) authorization server issues the tokens.
  - The MCP server MUST serve **Protected Resource Metadata (RFC 9728)** and point to it from a `WWW-Authenticate: Bearer resource_metadata="…"` header on `401` responses.
  - Clients find the authorization server through RFC 8414 or OIDC discovery.
  - Clients get a client ID in one of three ways, in this priority order: **Client ID Metadata Documents** (SHOULD), pre-registration, or Dynamic Client Registration (now **deprecated**, kept for backwards compatibility).
  - Clients use PKCE and MUST send the RFC 8707 `resource` parameter.
- Token rules that settle the Discord question:
  - "MCP servers MUST validate that access tokens were issued specifically for them as the intended audience."
  - "MCP servers MUST only accept tokens that are valid for use with their own resources."
  - "MCP servers **MUST NOT accept or transit any other tokens**."
  - Tokens go in the `Authorization: Bearer` header on every request, never in the query string.
  - Source: [authorization: token handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#token-handling)

### TypeScript SDK (v2, `@modelcontextprotocol/server`)

- v2 implements spec 2026-07-28. v1 (`@modelcontextprotocol/sdk`) lives on the `v1.x` branch and gets fixes only. [README](https://github.com/modelcontextprotocol/typescript-sdk)
- `createMcpHandler(factory)` gives a web-standard `fetch` handler. The factory runs **once per HTTP request**, so the endpoint is stateless. Mount it with `toNodeHandler` (`@modelcontextprotocol/node`), or use the Express, Fastify, or Hono helpers, which also check Host and Origin. The handler itself "validates no `Host` header, no `Origin` header, and no token", so those checks must sit in front of it. [docs/serving/http.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
- Older clients: by default, `createMcpHandler` (`legacy: 'stateless'`) also answers 2025-era clients that start with `initialize`, using a fresh instance for each request. The SDK's own `Client` also defaults to the legacy handshake. So keep the default and don't use `'reject'`. [docs/serving/legacy-clients.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md), [docs/protocol-versions.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)
- **Auth support is for the resource server only.** `requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl, expectedResource })` wraps a `verifyAccessToken(token) => AuthInfo` that you write.
  - It returns `401 invalid_token` or `403 insufficient_scope` with the right `WWW-Authenticate` challenge.
  - `mcpAuthMetadataRouter` / `oauthMetadataResponse` serve the RFC 9728 document.
  - Tool handlers read the verified caller as `ctx.http.authInfo`, and the factory receives it as `authInfo`.
  - Per-tool scopes use `scopeChallenge`.
  - Gotcha: `requireBearerAuth` rejects any token whose `expiresAt` is unset, so always set an expiry.
  - "the SDK never issues tokens". The v1 authorization-server helpers (`mcpAuthRouter`, `ProxyOAuthServerProvider`) are frozen in `@modelcontextprotocol/server-legacy/auth`, and the docs say to "use a dedicated identity provider for new servers."
  - Source: [docs/serving/authorization.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md)

### How agents connect

- **Claude Code** ([docs](https://code.claude.com/docs/en/mcp)):
  - Static header: `claude mcp add --transport http geo-coach https://<host>/mcp --header "Authorization: Bearer <token>"`.
  - `.mcp.json` with environment variable expansion: `"headers": { "Authorization": "Bearer ${GEO_COACH_MCP_TOKEN}" }`.
  - A `headersHelper` script that prints JSON headers when the connection starts.
  - OAuth: run `/mcp` or `claude mcp login <name>`, which uses DCR by default. Pre-registered clients use `--client-id` / `--client-secret` / `--callback-port`.
  - SSE transport is deprecated.
- **Codex CLI** ([docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)): `[mcp_servers.<name>]` with `url`, `bearer_token_env_var`, `http_headers` / `env_http_headers`, and `codex mcp login <name>` for OAuth.
- Both of these accept a bearer token from an environment variable, so per-member tokens work in both without OAuth.

### Discord

- Discord has OAuth2 with OIDC discovery (`https://discord.com/.well-known/openid-configuration`). The `identify` scope returns the user ID. Its docs recommend authorization code with PKCE. [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2)
- Discord does not document Dynamic Client Registration, CIMD, or RFC 8707 `resource`. Its tokens are for Discord's API, not ours.
  - So Discord can't be the MCP authorization server directly, and passing Discord tokens through is forbidden by the spec (see above).
  - It can be the **login step** of our own authorization server or token issuer.
- better-auth's `mcp` / `oauth-provider` plugins say they make an app "act as an OAuth authorization server and protected resource for MCP clients": PRM, `aud` binding, PKCE, a CIMD profile for 2026-07-28. Combined with its Discord social login, this would be the upgrade path in step 4. [better-auth MCP plugin](https://better-auth.com/docs/plugins/mcp). **Not verified hands-on.**

## Sketch (first version)

```ts
// Web app: after Discord login, and only if discordId is in DUO_DISCORD_IDS,
// mint a random 32-byte token. Show it to the member once and store
// { sha256(token), memberId, expiresAt, revokedAt }.

const mcpUrl = new URL('https://geo-coach.example/mcp');
const auth = requireBearerAuth({
  verifier: { verifyAccessToken: async token => {
    const row = await db.mcpTokens.findActive(sha256(token)); // not revoked, not expired
    if (!row) throw new OAuthError(OAuthErrorCode.InvalidToken, 'unknown token');
    return { token, clientId: row.memberId, scopes: ['mcp'], expiresAt: row.expiresAt };
  } },
  requiredScopes: ['mcp'],
});
app.all('/mcp', auth, (req, res) => void toNodeHandler(createMcpHandler(buildServer))(req, res, req.body));
// Tools read ctx.http.authInfo.clientId to record which member started the Processing run.
```

Agent config (Claude Code `.mcp.json`, kept out of git or using the environment variable):

```json
{ "mcpServers": { "geo-coach": { "type": "http", "url": "https://geo-coach.example/mcp",
  "headers": { "Authorization": "Bearer ${GEO_COACH_MCP_TOKEN}" } } } }
```

## Unverified / open

- Whether every client accepts a static bearer token when the server publishes no Protected Resource Metadata. Claude Code and Codex do per their docs, but other agents weren't checked. If a client probes for OAuth when it gets a `401`, a correct token avoids the `401` in the first place.
- Whether Claude Code supports Client ID Metadata Documents, or only DCR and pre-registration. This only matters for the OAuth upgrade path.
- better-auth plugin behaviour with Discord as the upstream login. This is from its docs only and wasn't tested.
- That the reverse proxy (Caddy or nginx) passes SSE through unbuffered. The SDK and the `X-Accel-Buffering: no` header should handle this, but it hasn't been tested on the VPS.
