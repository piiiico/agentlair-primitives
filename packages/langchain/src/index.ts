/**
 * @agentlair/langchain — AgentLair adapter for LangChain.js
 *
 * Issue an AgentLair Agent Authentication Token (AAT) for LangChain tools and
 * emit per-tool audit envelopes. Wraps existing tools (StructuredTool,
 * DynamicStructuredTool, DynamicTool, or anything duck-typed with `.invoke` or
 * `._call`) so each tool invocation carries a verifiable identity envelope.
 *
 * Zero runtime dependencies — uses `fetch` only. `@langchain/core` is a peer
 * dependency; this package never instantiates LangChain types directly, just
 * wraps tool definitions duck-typed by shape.
 *
 * @example
 * ```typescript
 * import { DynamicStructuredTool } from '@langchain/core/tools';
 * import { withAgentLair } from '@agentlair/langchain';
 * import { z } from 'zod';
 *
 * const echo = new DynamicStructuredTool({
 *   name: 'echo',
 *   description: 'Echo a string back',
 *   schema: z.object({ msg: z.string() }),
 *   func: async ({ msg }) => `you said: ${msg}`,
 * });
 *
 * const [governedEcho] = withAgentLair([echo], {
 *   apiKey: process.env.AGENTLAIR_API_KEY!,
 *   audience: 'https://my-mcp.example.com',
 *   scopes: ['mcp:tools:read'],
 *   agentName: 'demo',
 * });
 *
 * const result = await governedEcho.invoke({ msg: 'hello' });
 * // AgentLair issued an AAT and recorded an audit envelope per tool call.
 * ```
 *
 * @see https://agentlair.dev
 */

// ── Package metadata ─────────────────────────────────────────────────────────

export const VERSION = '0.2.1';
export const STATUS = 'live' as const;
export const ADAPTER = 'langchain' as const;
export const FRAMEWORK = 'LangChain.js' as const;
export const AGENTLAIR_URL = 'https://agentlair.dev' as const;
export const DEFAULT_BASE_URL = 'https://agentlair.dev' as const;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The AgentLair Agent Authentication Token (AAT) issued for an agent run.
 * The `token` field is the JWT to attach as a Bearer credential on outbound
 * tool calls. `did` is the did:web identifier embedded in the JWT claims.
 */
export interface AAT {
  /** EdDSA-signed JWT — JWKS at https://agentlair.dev/.well-known/jwks.json */
  token: string;
  /** Token type — always "Bearer" */
  tokenType: 'Bearer';
  /** ISO 8601 expiry timestamp */
  expiresAt: string;
  /** Seconds until expiry, as returned by the issuing API */
  expiresIn: number;
  /** Token ID — `aat_<16-base32>` — used as the audit log path segment */
  jti: string;
  /** Public per-token audit URL — `https://agentlair.dev/v1/audit/<jti>` */
  auditUrl: string;
  /** did:web identifier embedded in the JWT (decoded from claims) */
  did: string | null;
}

/** Options for {@link issueAATForAgent}. */
export interface IssueAATOptions {
  /** AgentLair API key — `al_live_*` or `al_pod_*`. Required. */
  apiKey: string;
  /**
   * Target service URL the AAT will be presented to (audience claim).
   * Required, must be a valid URL.
   */
  audience: string;
  /**
   * Scopes requested. Defaults to `['mcp:tools:read']`. Each scope must match
   * `^[a-z][a-z0-9._:-]*$` per AgentLair's token-issuance rules.
   */
  scopes?: string[];
  /** Lifetime in seconds. Default 3600, max 86400. */
  ttl?: number;
  /** Override agent name used for the `al_name` claim. */
  agentName?: string;
  /** Override agent email used for the `al_email` claim. */
  agentEmail?: string;
  /** Override the AgentLair base URL. Default `https://agentlair.dev`. */
  agentLairBaseUrl?: string;
  /** Inject an alternate fetch (testing, edge runtimes). */
  fetchImpl?: typeof fetch;
}

/**
 * Audit envelope emitted per tool invocation. Suitable for fire-and-forget
 * POST to AgentLair's audit ingest, or any sink the integrator chooses.
 */
export interface AuditEvent {
  /** AAT jti (`aat_*`) covering this invocation, if known. */
  jti?: string;
  /** Agent display name (mirrors the AAT al_name claim). */
  agentName?: string;
  /** AAT audience claim (target service). */
  audience?: string;
  /** Tool name (matches the LangChain tool's `name`). */
  toolName: string;
  /** Tool arguments captured at call time. */
  toolArgs?: unknown;
  /** Tool return value, if the call succeeded. */
  toolResult?: unknown;
  /** Stringified error message, if the tool threw. */
  toolError?: string;
  /** ISO 8601 timestamp when the tool started executing. */
  startedAt: string;
  /** ISO 8601 timestamp when the tool finished (or threw). */
  completedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Options for {@link withAgentLair} and {@link wrapTool}. */
export interface WithAgentLairOptions extends IssueAATOptions {
  /**
   * Custom audit sink. If omitted, audit envelopes are POSTed best-effort to
   * `${agentLairBaseUrl}/v1/events` (the AgentLair behavioral event endpoint).
   * Failures NEVER throw.
   */
  onAuditEvent?: (event: AuditEvent) => void | Promise<void>;
  /**
   * Reuse a single AAT across tool calls until it expires (default true).
   * Set false to issue a fresh AAT per tool invocation.
   */
  cacheAAT?: boolean;
  /**
   * Pre-issued AAT to skip the issue call entirely. If set, takes precedence
   * over `cacheAAT`. Useful in tests and when the integrator manages tokens
   * out-of-band.
   */
  preIssuedAAT?: AAT;
}

/** Error codes thrown by {@link AgentLairError}. */
export type AgentLairErrorCode =
  | 'invalid_options'
  | 'network_error'
  | 'http_error'
  | 'invalid_response'
  | 'expired_aat';

/**
 * Typed error thrown by {@link issueAATForAgent}. Tool-wrapping errors are
 * never thrown — they are recorded in the audit envelope and the original
 * tool error is re-thrown to the LangChain runner.
 */
export class AgentLairError extends Error {
  readonly code: AgentLairErrorCode;
  readonly status?: number;

  constructor(code: AgentLairErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AgentLairError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Minimal duck-typed shape of a LangChain.js tool. We touch:
 *  - `name`, `description`, `schema` — read-only metadata, left intact.
 *  - `invoke(input, config?)` — the StructuredTool / Runnable runtime
 *    entry-point. Takes the parsed input object directly (not a JSON string).
 *  - `_call(input)` — the legacy / internal handler some tools expose.
 *
 * Whichever of `invoke` / `_call` is present is wrapped; the other is left
 * alone. `invoke` wins if both are defined (which is the live LangChain
 * runtime semantics — `invoke` is the public Runnable API; `_call` is internal).
 */
export interface LangChainToolLike<TInput = unknown, TReturn = unknown> {
  name?: string;
  description?: string;
  schema?: unknown;
  /** LangChain Runnable entry-point: invoke(input, config?). */
  invoke?: (input: TInput, config?: unknown) => TReturn | Promise<TReturn>;
  /** Legacy / internal handler: _call(input). */
  _call?: (input: TInput, ...rest: unknown[]) => TReturn | Promise<TReturn>;
  [key: string]: unknown;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface TokensIssueResponse {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
  expires_in: number;
  jti: string;
  audit_url: string;
}

function isTokensIssueResponse(data: unknown): data is TokensIssueResponse {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.token === 'string' &&
    typeof d.expires_at === 'string' &&
    typeof d.expires_in === 'number' &&
    typeof d.jti === 'string' &&
    typeof d.audit_url === 'string'
  );
}

/**
 * Decode the `did` claim from an unvalidated JWT payload. Returns null on any
 * malformed input — the caller treats this as best-effort metadata, not as
 * proof of identity. (Verification belongs to the relying party against
 * AgentLair's JWKS.)
 */
function decodeDidFromJWT(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → string
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '==='.slice((payloadB64.length + 3) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(json);
    return typeof claims?.did === 'string' ? claims.did : null;
  } catch {
    return null;
  }
}

function isExpired(aat: AAT, nowMs: number = Date.now()): boolean {
  const expiresMs = Date.parse(aat.expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  // Treat "within 5 seconds of expiry" as expired to avoid attaching tokens
  // that will be rejected mid-flight.
  return expiresMs - nowMs <= 5000;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Issue an AgentLair Agent Authentication Token (AAT) for an agent.
 *
 * Calls `POST {agentLairBaseUrl}/v1/tokens/issue` with the API key.
 * Returns the JWT, JTI, expiry, audit URL, and decoded did:web identifier.
 *
 * @throws {AgentLairError} code='invalid_options' — apiKey or audience missing.
 * @throws {AgentLairError} code='network_error' — fetch threw.
 * @throws {AgentLairError} code='http_error' — non-2xx response.
 * @throws {AgentLairError} code='invalid_response' — unparseable or unexpected shape.
 *
 * @example
 * ```typescript
 * const aat = await issueAATForAgent({
 *   apiKey: process.env.AGENTLAIR_API_KEY!,
 *   audience: 'https://my-mcp.example.com',
 *   scopes: ['mcp:tools:read', 'mcp:tools:execute'],
 *   ttl: 3600,
 *   agentName: 'researcher',
 * });
 * console.log(aat.token);     // eyJ...
 * console.log(aat.did);       // did:web:agentlair.dev:agents:acc_xyz
 * console.log(aat.auditUrl);  // https://agentlair.dev/v1/audit/aat_...
 * ```
 */
export async function issueAATForAgent(options: IssueAATOptions): Promise<AAT> {
  const {
    apiKey,
    audience,
    scopes = ['mcp:tools:read'],
    ttl,
    agentName,
    agentEmail,
    agentLairBaseUrl = DEFAULT_BASE_URL,
    fetchImpl = fetch,
  } = options;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new AgentLairError(
      'invalid_options',
      'apiKey is required (al_live_* or al_pod_*)',
    );
  }
  if (!audience || typeof audience !== 'string') {
    throw new AgentLairError('invalid_options', 'audience is required (https URL)');
  }

  const body: Record<string, unknown> = {
    audience,
    scopes,
  };
  if (typeof ttl === 'number') body.ttl = ttl;
  if (agentName) body.agent_name = agentName;
  if (agentEmail) body.agent_email = agentEmail;

  let response: Response;
  try {
    response = await fetchImpl(`${agentLairBaseUrl}/v1/tokens/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AgentLairError(
      'network_error',
      `Network request to /v1/tokens/issue failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = ` — ${await response.text()}`;
    } catch {
      /* ignore */
    }
    throw new AgentLairError(
      'http_error',
      `HTTP ${response.status} from /v1/tokens/issue${detail}`,
      response.status,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AgentLairError(
      'invalid_response',
      'Response body is not valid JSON',
    );
  }

  if (!isTokensIssueResponse(data)) {
    throw new AgentLairError(
      'invalid_response',
      'Response shape does not match AgentLair /v1/tokens/issue contract',
    );
  }

  return {
    token: data.token,
    tokenType: 'Bearer',
    expiresAt: data.expires_at,
    expiresIn: data.expires_in,
    jti: data.jti,
    auditUrl: data.audit_url,
    did: decodeDidFromJWT(data.token),
  };
}

/**
 * Translate an AuditEvent (SDK-internal shape) to the /v1/events request body.
 * The behavioral event endpoint expects an { events: BehavioralEvent[] } envelope.
 * Mirrors the @agentlair/openai-agents v0.1.2 fix.
 */
function auditEventToEventsBody(event: AuditEvent): {
  events: Array<{
    event_id: string;
    timestamp: string;
    category: 'tool';
    action: string;
    result: 'success' | 'failure';
    resource_type: string;
    duration_ms: number;
    error_code?: string;
    metadata?: Record<string, string | number | boolean>;
  }>;
  sdk_version: string;
} {
  // Generate a collision-resistant event_id without external dependencies
  const eventId = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const metadata: Record<string, string | number | boolean> = {};
  if (event.agentName) metadata.agent_name = event.agentName;
  if (event.audience) metadata.audience = event.audience;
  if (event.jti) metadata.aat_jti = event.jti;

  return {
    events: [
      {
        event_id: eventId,
        timestamp: event.startedAt,
        category: 'tool',
        action: event.toolName,
        result: event.toolError ? 'failure' : 'success',
        resource_type: event.toolName,
        duration_ms: event.durationMs,
        ...(event.toolError ? { error_code: event.toolError.slice(0, 128) } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
    ],
    sdk_version: VERSION,
  };
}

/**
 * POST an audit envelope to AgentLair's behavioral event ingestion endpoint,
 * best-effort. Failures are swallowed — the caller's tool run must never break
 * because the audit log is unavailable. Surfaces the response as a
 * Promise<boolean> so callers can opt into observability via tests.
 *
 * @param event — the audit envelope to record.
 * @param options — AgentLair credentials and base URL.
 * @returns true if the POST returned 2xx; false otherwise.
 */
export async function recordAuditEvent(
  event: AuditEvent,
  options: {
    apiKey: string;
    agentLairBaseUrl?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<boolean> {
  const {
    apiKey,
    agentLairBaseUrl = DEFAULT_BASE_URL,
    fetchImpl = fetch,
  } = options;

  if (!apiKey) return false;

  try {
    // Real endpoint is POST /v1/events — translate AuditEvent to EventSubmission shape.
    // (Mirror of @agentlair/openai-agents v0.1.2 fix.)
    const r = await fetchImpl(`${agentLairBaseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditEventToEventsBody(event)),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Wrap a single LangChain.js tool so that:
 * 1. Before each invocation, an AAT is issued (or reused if cached & live).
 * 2. After invocation, an audit envelope is emitted to `onAuditEvent`
 *    (defaults to {@link recordAuditEvent}).
 * 3. Tool errors are recorded but rethrown — the LangChain runner sees the
 *    original behaviour.
 *
 * LangChain `StructuredTool` / `DynamicStructuredTool` exposes both
 * `invoke(input, config?)` (the public Runnable API) and `_call(input)`
 * (the internal handler). We wrap `invoke` when present, otherwise fall
 * back to `_call` for the legacy shape (and for non-LangChain tools that
 * follow the same duck-type).
 *
 * Returns a shallow clone with the relevant field replaced.
 */
export function wrapTool<T extends LangChainToolLike>(
  tool: T,
  options: WithAgentLairOptions,
): T {
  if (!tool) return tool;
  const hasInvoke = typeof tool.invoke === 'function';
  const hasCall = typeof tool._call === 'function';
  if (!hasInvoke && !hasCall) return tool;

  const onAuditEvent =
    options.onAuditEvent ??
    ((event: AuditEvent) =>
      recordAuditEvent(event, {
        apiKey: options.apiKey,
        agentLairBaseUrl: options.agentLairBaseUrl,
        fetchImpl: options.fetchImpl,
      }).then(() => undefined));

  const cache: { aat: AAT | null } = { aat: options.preIssuedAAT ?? null };
  const cacheAAT = options.cacheAAT ?? true;

  // `invoke` wins if both are present — it's the live LangChain runtime API.
  const wrappedInvoke = hasInvoke
    ? buildWrappedInvoke(tool, options, cache, cacheAAT, onAuditEvent)
    : undefined;
  const wrappedCall = hasCall && !hasInvoke
    ? buildWrappedCall(tool, options, cache, cacheAAT, onAuditEvent)
    : undefined;

  const overrides: Record<string, unknown> = {};
  if (wrappedInvoke) overrides.invoke = wrappedInvoke;
  if (wrappedCall) overrides._call = wrappedCall;

  // Shallow clone preserving prototype + extras LangChain attaches
  // (lc_serializable, lc_kwargs, lc_runnable, callbacks, tags, etc.).
  const cloned: T = Object.assign(
    Object.create(Object.getPrototypeOf(tool)),
    tool,
    overrides,
  );
  return cloned;
}

/** Issue or reuse the AAT for one invocation, swallowing issuance failures. */
async function ensureAAT(
  toolName: string,
  options: WithAgentLairOptions,
  cache: { aat: AAT | null },
  cacheAAT: boolean,
): Promise<AAT | null> {
  if (options.preIssuedAAT && !isExpired(options.preIssuedAAT)) {
    return options.preIssuedAAT;
  }
  if (cacheAAT && cache.aat && !isExpired(cache.aat)) {
    return cache.aat;
  }
  try {
    const aat = await issueAATForAgent(options);
    if (cacheAAT) cache.aat = aat;
    return aat;
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[@agentlair/langchain] AAT issuance failed for tool "${toolName}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return null;
  }
}

/** Best-effort audit emit — swallows all errors. */
async function emitAuditSafely(
  onAuditEvent: (event: AuditEvent) => void | Promise<void>,
  event: AuditEvent,
): Promise<void> {
  try {
    await onAuditEvent(event);
  } catch {
    /* swallow */
  }
}

/**
 * LangChain Runnable shape: `invoke(input, config?)` where `input` is the
 * already-parsed payload (zod-validated for `StructuredTool`). We capture
 * the input verbatim for the audit envelope and pass arguments through
 * unchanged so the LangChain runner sees a transparent wrapper.
 */
function buildWrappedInvoke<T extends LangChainToolLike>(
  tool: T,
  options: WithAgentLairOptions,
  cache: { aat: AAT | null },
  cacheAAT: boolean,
  onAuditEvent: (event: AuditEvent) => void | Promise<void>,
) {
  const original = (tool.invoke as Function).bind(tool);
  return async (input: unknown, config?: unknown) => {
    const toolName = tool.name ?? 'unnamed';
    const aat = await ensureAAT(toolName, options, cache, cacheAAT);

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    let toolResult: unknown;
    let toolError: string | undefined;
    let threw: unknown;
    try {
      toolResult = await original(input, config);
    } catch (e) {
      threw = e;
      toolError = e instanceof Error ? e.message : String(e);
    }
    const completedAt = new Date().toISOString();

    await emitAuditSafely(onAuditEvent, {
      jti: aat?.jti,
      agentName: options.agentName,
      audience: options.audience,
      toolName,
      toolArgs: input,
      toolResult,
      toolError,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    });

    if (threw) throw threw;
    return toolResult;
  };
}

/**
 * Legacy / internal shape: `_call(input, ...rest)`. Receives the same parsed
 * input as `invoke` does in LangChain's StructuredTool implementation, so the
 * audit envelope captures it directly.
 */
function buildWrappedCall<T extends LangChainToolLike>(
  tool: T,
  options: WithAgentLairOptions,
  cache: { aat: AAT | null },
  cacheAAT: boolean,
  onAuditEvent: (event: AuditEvent) => void | Promise<void>,
) {
  const original = (tool._call as Function).bind(tool);
  return async (input: unknown, ...rest: unknown[]) => {
    const toolName = tool.name ?? 'unnamed';
    const aat = await ensureAAT(toolName, options, cache, cacheAAT);

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    let toolResult: unknown;
    let toolError: string | undefined;
    let threw: unknown;
    try {
      toolResult = await original(input, ...rest);
    } catch (e) {
      threw = e;
      toolError = e instanceof Error ? e.message : String(e);
    }
    const completedAt = new Date().toISOString();

    await emitAuditSafely(onAuditEvent, {
      jti: aat?.jti,
      agentName: options.agentName,
      audience: options.audience,
      toolName,
      toolArgs: input,
      toolResult,
      toolError,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    });

    if (threw) throw threw;
    return toolResult;
  };
}

/**
 * Wrap an array of LangChain.js tools so every tool is governed by AgentLair
 * (AAT issuance + audit envelope per call). Returns a new array of shallow
 * clones; the original tools are untouched.
 *
 * LangChain doesn't bundle agents with a `tools[]` field the same way the
 * OpenAI Agents SDK does — devs compose tool arrays themselves and hand them
 * to `bindTools`, `createReactAgent`, `createToolCallingAgent`, etc. This is
 * the natural shape: pass the array, get a wrapped array back.
 *
 * Empty / non-array inputs are returned unchanged. Tools missing both
 * `invoke` and `_call` are left as-is.
 */
export function withAgentLair<T extends LangChainToolLike>(
  tools: T[],
  options: WithAgentLairOptions,
): T[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return tools;
  }
  return tools.map((t) => wrapTool(t, options));
}
