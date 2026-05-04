/**
 * @agentlair/mcp-server — MCP server for AgentLair trust verification.
 *
 * Exposes 5 tools to any MCP client (Claude desktop, Cursor, Cline, Smithery,
 * etc.) so agents can verify other agents through their own tooling layer:
 *
 *   verify_agent          — full behavioral trust score for an agent (acc_...)
 *   check_trust_gate      — fast-path enforcement check (meets-minimum-level?)
 *   get_popa              — daily attestation streak for any DID
 *   get_popa_leaderboard  — top agents by attestation count
 *   lookup_audit_token    — per-token metadata for an AAT (jti = aat_...)
 *
 * Auth: AGENTLAIR_AAT env var (Bearer). Optional — without it, paid endpoints
 * return the 402 payment requirements as structured output instead of failing.
 *
 * @see https://agentlair.dev/specs/mcp-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getPopa,
  getPopaLeaderboard,
  verifyAgent,
  checkTrustGate,
  lookupAuditToken,
  AGENT_ID_RE,
  JTI_RE,
  type ApiResult,
  type ClientOptions,
} from './client.js';

// ── Package metadata ─────────────────────────────────────────────────────────

export const VERSION = '0.1.0';
export const SERVER_NAME = 'agentlair' as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ToolContent {
  type: 'text';
  text: string;
}

interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
  // SDK CallToolResult schema permits arbitrary additional fields.
  [key: string]: unknown;
}

/** Format an ApiResult into a structured MCP tool response. */
function formatResult<T>(result: ApiResult<T>, summary: (data: T) => string): ToolResponse {
  if (result.ok) {
    return {
      content: [
        { type: 'text', text: summary(result.data) },
        { type: 'text', text: JSON.stringify(result.data, null, 2) },
      ],
    };
  }

  if (result.kind === 'payment_required') {
    const accept = result.payment.accepts[0];
    const human = accept
      ? `Payment required: ${accept.maxAmountRequired} of asset ${accept.asset} on ${accept.network} → ${accept.payTo}.\n\n` +
        `Resource: ${accept.resource}\n` +
        `Description: ${accept.description}\n\n` +
        `To skip payment, set AGENTLAIR_AAT (Agent Authentication Token) and restart the MCP server. ` +
        `To pay, use an x402-capable client and re-call this tool.`
      : 'Payment required (402) — no accept[] details returned.';
    return {
      content: [
        { type: 'text', text: human },
        { type: 'text', text: JSON.stringify(result.payment, null, 2) },
      ],
      isError: true,
    };
  }

  if (result.kind === 'http_error') {
    return {
      content: [
        { type: 'text', text: `HTTP ${result.status}: ${result.message}` },
        ...(result.body ? [{ type: 'text' as const, text: JSON.stringify(result.body, null, 2) }] : []),
      ],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: `${result.kind}: ${result.message}` }],
    isError: true,
  };
}

/** Build ClientOptions from process.env at call time (so tests can override). */
function envOptions(): ClientOptions {
  const aat = process.env.AGENTLAIR_AAT;
  const baseUrl = process.env.AGENTLAIR_BASE_URL;
  return {
    ...(aat ? { aat } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

// ── Server factory ──────────────────────────────────────────────────────────

/**
 * Build a configured McpServer with all five AgentLair tools registered.
 * Exported so callers can mount the same server on a non-stdio transport
 * (HTTP, SSE, etc.) if they want to host it themselves.
 */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  // ── verify_agent ──────────────────────────────────────────────────────────

  server.tool(
    'verify_agent',
    `Verify an AgentLair agent's behavioral trust score. Returns the full trust profile: overall score [0, 100], confidence interval, ATF maturity level (intern → junior → senior → principal), and per-dimension breakdown (consistency, restraint, transparency).

Use this when you need to know whether to trust another agent before delegating, paying, or extending capability. The score is computed from the agent's audit trail — behavior, not declarations.

Anonymous callers pay 0.01 USDC via x402. Set AGENTLAIR_AAT to skip payment.`,
    {
      agent_id: z
        .string()
        .regex(AGENT_ID_RE)
        .describe('AgentLair agent ID, format: acc_<alphanumeric>. Example: "acc_qgdxSULsXsmtHklZ".'),
    },
    async ({ agent_id }) => {
      const result = await verifyAgent(agent_id, envOptions());
      return formatResult(result, (p) => {
        const id = (p.agent_id ?? p.agentId) as string;
        const level = p.atf_level ?? 'unknown';
        const conf = typeof p.confidence === 'number' ? ` (confidence ${p.confidence.toFixed(2)})` : '';
        const obs = typeof p.observations === 'number' ? `, ${p.observations} observations` : '';
        return `Agent ${id}: trust score ${p.score.toFixed(1)}/100, ATF level ${level}${conf}${obs}.`;
      });
    },
  );

  // ── check_trust_gate ──────────────────────────────────────────────────────

  server.tool(
    'check_trust_gate',
    `Fast-path trust check: does this agent meet a minimum ATF level? Use before granting access to a tool, capability, or paid action. Cheaper than the full profile — returns just the gate decision.

Levels: intern (default minimum), junior, senior, principal.

Same x402 pricing as verify_agent (0.01 USDC anonymous; free with AGENTLAIR_AAT).`,
    {
      agent_id: z.string().regex(AGENT_ID_RE).describe('Agent ID (acc_...).'),
      min_level: z
        .enum(['intern', 'junior', 'senior', 'principal'])
        .optional()
        .describe('Minimum ATF level required. Default: "intern".'),
    },
    async ({ agent_id, min_level }) => {
      const result = await checkTrustGate(agent_id, min_level, envOptions());
      return formatResult(result, (g) => {
        const verdict = g.meetsMinimum ? 'PASS' : 'FAIL';
        return `${verdict} — ${g.agentId} at ${g.atfLevel} (required: ${g.requiredLevel}, score ${g.score.toFixed(1)}).`;
      });
    },
  );

  // ── get_popa ──────────────────────────────────────────────────────────────

  server.tool(
    'get_popa',
    `Get the Proof of Persistent Activity streak for any DID. Returns: current streak in days, longest streak ever, total attestations, last attestation timestamp, gap count, genesis date, and the latest SCITT transparency-log entry.

PoPA is the bond-of-presence — agents earn it by being active each day, signed and chained into a transparency log. Useful as a freshness signal: an agent attesting today is operationally alive today.

Public endpoint. No auth required.`,
    {
      did: z
        .string()
        .min(7)
        .describe('Decentralized Identifier. Accepts did:web: and did:key:. Example: "did:web:agentlair.dev".'),
    },
    async ({ did }) => {
      const result = await getPopa(did, envOptions());
      return formatResult(result, (m) => {
        const lastAt = new Date(m.last_attestation_at);
        const ageHours = (Date.now() - lastAt.getTime()) / (60 * 60 * 1000);
        const fresh = ageHours < 25 ? 'fresh' : `stale (${ageHours.toFixed(1)}h ago)`;
        return `${m.did}: ${m.streak_days}d streak (longest ${m.longest_streak}d), ${m.total_attestations} total attestations, ${fresh}. Latest SCITT entry: ${m.latest_scitt_entry}.`;
      });
    },
  );

  // ── get_popa_leaderboard ──────────────────────────────────────────────────

  server.tool(
    'get_popa_leaderboard',
    `Top AgentLair agents by attestation count. Useful for discovering agents with the longest behavioral track records, or sanity-checking that the registry is alive.

Public endpoint. No auth required.`,
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max rows to return. Default: 10. Hard cap: 100.'),
    },
    async ({ limit }) => {
      const result = await getPopaLeaderboard(limit, envOptions());
      return formatResult(result, (lb) => {
        if (lb.rows.length === 0) return 'PoPA leaderboard is empty.';
        const top = lb.rows
          .slice(0, 10)
          .map((r, i) => `  ${i + 1}. ${r.did} — ${r.attestation_count} attestation${r.attestation_count !== 1 ? 's' : ''}, last seen ${r.last_attested_at}`)
          .join('\n');
        return `PoPA leaderboard (${lb.rows.length} row${lb.rows.length !== 1 ? 's' : ''}, sorted by ${lb.sort}):\n${top}`;
      });
    },
  );

  // ── lookup_audit_token ────────────────────────────────────────────────────

  server.tool(
    'lookup_audit_token',
    `Look up metadata for an AgentLair Agent Authentication Token (AAT) by its jti. Returns: issued_at, expires_at, audience, scopes, and live status (active | expired | revoked).

Use this to verify a token presented by another agent — was it issued? is it still valid? has it been revoked? Tokens are auditable while valid and up to ~5 minutes after expiry.

x402-gated at 0.001 USDC per lookup for anonymous callers. With AGENTLAIR_AAT set, the call is rejected — this endpoint is intentionally pay-as-you-go (payment IS authentication for token introspection).`,
    {
      jti: z
        .string()
        .regex(JTI_RE)
        .describe('AAT jti claim, format: aat_<16-char-alphanumeric>.'),
    },
    async ({ jti }) => {
      // Per worker semantics, /v1/audit/:jti is x402-only — don't pass AAT.
      const opts = envOptions();
      delete opts.aat;
      const result = await lookupAuditToken(jti, opts);
      return formatResult(result, (a) => {
        const flags: string[] = [`status=${a.status}`];
        if (a.revoked_at) flags.push(`revoked_at=${a.revoked_at}`);
        return `Token ${a.jti}: issued ${a.issued_at}, expires ${a.expires_at}, ${flags.join(', ')}.`;
      });
    },
  );

  return server;
}

// ── Stdio runner ─────────────────────────────────────────────────────────────

/**
 * Run the MCP server on stdio. Used by the bin/cli.ts entry point. Returns
 * a promise that resolves when the transport closes — wire SIGINT/SIGTERM
 * to the returned controller for clean shutdown if needed.
 */
export async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive — McpServer keeps the transport open until the process exits
  // or stdin closes. Log to stderr so we don't pollute the JSON-RPC stream.
  // eslint-disable-next-line no-console
  console.error(`@agentlair/mcp-server v${VERSION} running on stdio`);
}
