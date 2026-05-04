/**
 * AgentLair API client — pure fetch wrappers, no MCP coupling.
 *
 * Each call returns a discriminated union:
 *   - { ok: true, data }
 *   - { ok: false, kind: 'http_error' | 'payment_required' | 'invalid_response' | 'network_error', ... }
 *
 * Why no throws? MCP tools convert errors into structured `isError: true`
 * responses. Returning a result object keeps the caller in control of how
 * to format that — and lets the same client be unit-tested with mock fetch
 * without juggling try/catch.
 */

export const DEFAULT_BASE_URL = 'https://api.agentlair.dev';

// ── Error / payment shapes ───────────────────────────────────────────────────

export interface PaymentAccept {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequiredBody {
  x402Version: number;
  error: string;
  accepts: PaymentAccept[];
  extensions?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'http_error'; status: number; message: string; body?: unknown }
  | { ok: false; kind: 'payment_required'; status: 402; payment: PaymentRequiredBody }
  | { ok: false; kind: 'invalid_response'; message: string }
  | { ok: false; kind: 'network_error'; message: string };

// ── Domain types ─────────────────────────────────────────────────────────────

export interface PoPAMetrics {
  did: string;
  streak_days: number;
  longest_streak: number;
  total_attestations: number;
  last_attestation_at: string;
  gap_count: number;
  genesis_at: string;
  latest_scitt_entry: string;
}

export interface LeaderboardRow {
  did: string;
  controller: string | null;
  enrolled_at: string;
  last_attested_at: string;
  revoked_at: string | null;
  attestation_count: number;
}

export interface LeaderboardResponse {
  sort: string;
  limit: number;
  rows: LeaderboardRow[];
  generated_at: string;
}

export interface TrustProfile {
  agent_id: string;
  score: number;
  atf_level?: 'intern' | 'junior' | 'senior' | 'principal';
  confidence?: number;
  observations?: number;
  dimensions?: Record<string, unknown>;
  trend?: string;
  [key: string]: unknown;
}

export interface TrustGateResult {
  agentId: string;
  score: number;
  atfLevel: string;
  meetsMinimum: boolean;
  requiredLevel: string;
  confidence?: number;
  cached?: boolean;
  [key: string]: unknown;
}

export interface AuditTokenInfo {
  jti: string;
  issued_at: string;
  expires_at: string;
  audience?: string | string[];
  scopes?: string[];
  status: 'active' | 'expired' | 'revoked';
  revoked_at: string | null;
  revocation_reason: string | null;
  audit_log_url?: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

export const AGENT_ID_RE = /^acc_[A-Za-z0-9_-]{1,64}$/;
export const JTI_RE = /^aat_[A-Za-z0-9]{16}$/;

// ── Client config ────────────────────────────────────────────────────────────

export interface ClientOptions {
  /** Override the AgentLair API base URL. @default "https://api.agentlair.dev" */
  baseUrl?: string;
  /** AgentLair AAT — Bearer token. When set, skips x402 payment for paid endpoints. */
  aat?: string;
  /** Optional per-request timeout in ms. @default 15000 */
  timeoutMs?: number;
}

// ── Internal fetch wrapper ───────────────────────────────────────────────────

async function callJson<T>(
  url: string,
  opts: ClientOptions,
  validate: (data: unknown) => data is T,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.aat) headers.Authorization = `Bearer ${opts.aat}`;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (e) {
    return {
      ok: false,
      kind: 'network_error',
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 402) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        kind: 'invalid_response',
        message: '402 response body is not valid JSON',
      };
    }
    if (!body || typeof body !== 'object' || !Array.isArray((body as PaymentRequiredBody).accepts)) {
      return {
        ok: false,
        kind: 'invalid_response',
        message: '402 response missing accepts[] array',
      };
    }
    return { ok: false, kind: 'payment_required', status: 402, payment: body as PaymentRequiredBody };
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const message =
      body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `HTTP ${response.status}`;
    return { ok: false, kind: 'http_error', status: response.status, message, body };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, kind: 'invalid_response', message: 'Response body is not valid JSON' };
  }

  if (!validate(data)) {
    return {
      ok: false,
      kind: 'invalid_response',
      message: 'Response shape does not match expected schema',
    };
  }

  return { ok: true, data };
}

// ── Validators ──────────────────────────────────────────────────────────────

function isPoPAMetrics(d: unknown): d is PoPAMetrics {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.did === 'string' &&
    typeof o.streak_days === 'number' &&
    typeof o.longest_streak === 'number' &&
    typeof o.total_attestations === 'number' &&
    typeof o.last_attestation_at === 'string' &&
    typeof o.gap_count === 'number' &&
    typeof o.genesis_at === 'string' &&
    typeof o.latest_scitt_entry === 'string'
  );
}

function isLeaderboard(d: unknown): d is LeaderboardResponse {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.sort === 'string' &&
    typeof o.limit === 'number' &&
    Array.isArray(o.rows) &&
    typeof o.generated_at === 'string'
  );
}

function isTrustProfile(d: unknown): d is TrustProfile {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  // Worker returns either { agent_id, score } or { agentId, score } depending on path — accept both.
  const hasId = typeof o.agent_id === 'string' || typeof o.agentId === 'string';
  return hasId && typeof o.score === 'number';
}

function isTrustGate(d: unknown): d is TrustGateResult {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.agentId === 'string' &&
    typeof o.atfLevel === 'string' &&
    typeof o.meetsMinimum === 'boolean'
  );
}

function isAuditTokenInfo(d: unknown): d is AuditTokenInfo {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.jti === 'string' &&
    typeof o.issued_at === 'string' &&
    typeof o.expires_at === 'string' &&
    typeof o.status === 'string'
  );
}

// ── Public client functions ─────────────────────────────────────────────────

/** GET /v1/popa/:did — public, no auth required. */
export async function getPopa(did: string, opts: ClientOptions = {}): Promise<ApiResult<PoPAMetrics>> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${base}/v1/popa/${encodeURIComponent(did)}`;
  return callJson(url, opts, isPoPAMetrics);
}

/** GET /v1/popa/leaderboard?limit= — public, no auth required. */
export async function getPopaLeaderboard(
  limit: number | undefined,
  opts: ClientOptions = {},
): Promise<ApiResult<LeaderboardResponse>> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const qp = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const url = `${base}/v1/popa/leaderboard${qp}`;
  return callJson(url, opts, isLeaderboard);
}

/** GET /v1/trust/:agentId — x402-gated 0.01 USDC for anonymous; free with AAT. */
export async function verifyAgent(
  agentId: string,
  opts: ClientOptions = {},
): Promise<ApiResult<TrustProfile>> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${base}/v1/trust/${encodeURIComponent(agentId)}`;
  return callJson(url, opts, isTrustProfile);
}

/** GET /v1/trust/:agentId/check?min_level= — x402-gated 0.01 USDC for anonymous; free with AAT. */
export async function checkTrustGate(
  agentId: string,
  minLevel: 'intern' | 'junior' | 'senior' | 'principal' | undefined,
  opts: ClientOptions = {},
): Promise<ApiResult<TrustGateResult>> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const qp = minLevel ? `?min_level=${encodeURIComponent(minLevel)}` : '';
  const url = `${base}/v1/trust/${encodeURIComponent(agentId)}/check${qp}`;
  return callJson(url, opts, isTrustGate);
}

/** GET /v1/audit/:jti — x402-gated 0.001 USDC; surfaces token metadata. */
export async function lookupAuditToken(
  jti: string,
  opts: ClientOptions = {},
): Promise<ApiResult<AuditTokenInfo>> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${base}/v1/audit/${encodeURIComponent(jti)}`;
  return callJson(url, opts, isAuditTokenInfo);
}
