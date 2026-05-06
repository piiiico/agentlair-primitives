/**
 * @agentlair/openai-agents — AgentLair adapter for the OpenAI Agents SDK
 *
 * Issue an AgentLair Agent Authentication Token (AAT) for an OpenAI Agents
 * SDK agent and emit per-tool audit envelopes. Wraps an existing `Agent` so
 * each tool invocation carries a verifiable identity envelope.
 *
 * Zero runtime dependencies — uses `fetch` only. `@openai/agents` is a
 * peer dependency; this package never instantiates it directly, just
 * wraps tool definitions duck-typed by shape.
 *
 * @example
 * ```typescript
 * import { Agent, run, tool } from '@openai/agents';
 * import { issueAATForAgent, withAgentLair } from '@agentlair/openai-agents';
 * import { z } from 'zod';
 *
 * const echo = tool({
 *   name: 'echo',
 *   description: 'Echo a string',
 *   parameters: z.object({ msg: z.string() }),
 *   execute: async ({ msg }) => `you said: ${msg}`,
 * });
 *
 * const myAgent = new Agent({
 *   name: 'demo',
 *   instructions: 'Say hello, then echo.',
 *   tools: [echo],
 * });
 *
 * const governed = withAgentLair(myAgent, {
 *   apiKey: process.env.AGENTLAIR_API_KEY!,
 *   audience: 'https://my-mcp.example.com',
 *   scopes: ['mcp:tools:read'],
 *   agentName: 'demo',
 * });
 *
 * const result = await run(governed, 'echo "ok"');
 * // AgentLair issued an AAT and recorded an audit envelope per tool call.
 * ```
 *
 * @see https://agentlair.dev
 */

// ── Package metadata ─────────────────────────────────────────────────────────

export const VERSION = '0.1.2';
export const STATUS = 'live' as const;
export const ADAPTER = 'openai-agents' as const;
export const FRAMEWORK = 'OpenAI Agents SDK' as const;
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
  /** Tool name (matches the OpenAI Agents SDK `tool({name})`). */
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
   * `${agentLairBaseUrl}/v1/events`. Failures NEVER throw.
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
 * tool error is re-thrown to the agent runner.
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
 * Minimal duck-typed shape of an OpenAI Agents SDK tool. We touch:
 *  - `name` (read-only metadata)
 *  - `invoke` — the live SDK's runtime entry-point (post `tool()` wrap)
 *  - `execute` — the user-provided handler before `tool()` wraps it
 *
 * Whichever of `invoke` / `execute` is present is wrapped; the other is
 * left alone. `invoke` wins if both are defined.
 */
export interface AgentLairToolLike<TArgs = unknown, TReturn = unknown> {
  name?: string;
  /** Live OpenAI Agents SDK runtime entry-point: invoke(runContext, input, details?). */
  invoke?: (...args: unknown[]) => unknown;
  /** Pre-`tool()` user handler: execute(args, ...rest). */
  execute?: (args: TArgs, ...rest: unknown[]) => TReturn | Promise<TReturn>;
  [key: string]: unknown;
}

/**
 * Minimal duck-typed shape of an OpenAI Agents SDK Agent. We only touch
 * `tools` and `name`; the rest is opaque.
 */
export interface AgentLike {
  name?: string;
  tools?: AgentLairToolLike[];
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
 * Fix: task 10dc049b50bdb8bf — recordAuditEvent was calling non-existent /v1/audit/ingest.
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
 * POST an audit envelope to AgentLair's behavioral event ingestion endpoint, best-effort.
 * Failures are swallowed — the caller's tool run must never break because
 * the audit log is unavailable. Surfaces the response as a Promise<boolean>
 * so callers can opt into observability via tests.
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
    // Fix (task 10dc049b50bdb8bf): was /v1/audit/ingest (non-existent → 401).
    // Real endpoint is POST /v1/events — translate AuditEvent to EventSubmission shape.
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
 * Wrap a single OpenAI Agents SDK tool so that:
 * 1. Before each invocation, an AAT is issued (or reused if cached & live).
 * 2. After invocation, an audit envelope is emitted to `onAuditEvent`
 *    (defaults to {@link recordAuditEvent}).
 * 3. Tool errors are recorded but rethrown — the SDK's runner sees the
 *    original behaviour.
 *
 * The live `@openai/agents` SDK transforms `tool({execute})` into a runtime
 * object that only exposes `invoke(runContext, input, details?)` — so we
 * wrap `invoke` when present, otherwise fall back to `execute` for the
 * pre-`tool()` shape (and for non-SDK tools that follow the same duck-type).
 *
 * Returns a shallow clone with the relevant field replaced.
 */
export function wrapTool<T extends AgentLairToolLike>(
  tool: T,
  options: WithAgentLairOptions,
): T {
  if (!tool) return tool;
  const hasInvoke = typeof tool.invoke === 'function';
  const hasExecute = typeof tool.execute === 'function';
  if (!hasInvoke && !hasExecute) return tool;

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

  const wrappedInvoke = hasInvoke
    ? buildWrappedInvoke(tool, options, cache, cacheAAT, onAuditEvent)
    : undefined;
  const wrappedExecute = hasExecute
    ? buildWrappedExecute(tool, options, cache, cacheAAT, onAuditEvent)
    : undefined;

  const overrides: Record<string, unknown> = {};
  if (wrappedInvoke) overrides.invoke = wrappedInvoke;
  if (wrappedExecute) overrides.execute = wrappedExecute;

  // Shallow clone preserving prototype + extras the SDK may attach.
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
        `[@agentlair/openai-agents] AAT issuance failed for tool "${toolName}": ${
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
 * Pre-`tool()` shape: execute(args, ...rest). args is whatever the caller
 * passes; we record it verbatim.
 */
function buildWrappedExecute<T extends AgentLairToolLike>(
  tool: T,
  options: WithAgentLairOptions,
  cache: { aat: AAT | null },
  cacheAAT: boolean,
  onAuditEvent: (event: AuditEvent) => void | Promise<void>,
) {
  const original = (tool.execute as Function).bind(tool);
  return async (args: unknown, ...rest: unknown[]) => {
    const toolName = tool.name ?? 'unnamed';
    const aat = await ensureAAT(toolName, options, cache, cacheAAT);

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    let toolResult: unknown;
    let toolError: string | undefined;
    let threw: unknown;
    try {
      toolResult = await original(args, ...rest);
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
      toolArgs: args,
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
 * Live SDK shape: invoke(runContext, input, details?) where input is a
 * JSON string. We capture the parsed input for the audit envelope but pass
 * arguments through unchanged so the SDK's runner sees a transparent wrapper.
 */
function buildWrappedInvoke<T extends AgentLairToolLike>(
  tool: T,
  options: WithAgentLairOptions,
  cache: { aat: AAT | null },
  cacheAAT: boolean,
  onAuditEvent: (event: AuditEvent) => void | Promise<void>,
) {
  const original = (tool.invoke as Function).bind(tool);
  return async (...invokeArgs: unknown[]) => {
    const toolName = tool.name ?? 'unnamed';
    const aat = await ensureAAT(toolName, options, cache, cacheAAT);

    // Best-effort capture of args: the SDK passes (runContext, jsonString, details?).
    let captured: unknown = invokeArgs[1];
    if (typeof captured === 'string') {
      try {
        captured = JSON.parse(captured);
      } catch {
        /* keep as string */
      }
    }

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    let toolResult: unknown;
    let toolError: string | undefined;
    let threw: unknown;
    try {
      toolResult = await original(...invokeArgs);
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
      toolArgs: captured,
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
 * Wrap an OpenAI Agents SDK `Agent` so every tool it owns is governed by
 * AgentLair (AAT issuance + audit envelope per call). Returns a shallow
 * clone with `tools` replaced; the original agent is untouched.
 *
 * Agents with no tools are returned unchanged.
 */
export function withAgentLair<A extends AgentLike>(
  agent: A,
  options: WithAgentLairOptions,
): A {
  if (!agent || !Array.isArray(agent.tools) || agent.tools.length === 0) {
    return agent;
  }

  const wrappedTools = agent.tools.map((t) => wrapTool(t, options));

  const cloned: A = Object.assign(
    Object.create(Object.getPrototypeOf(agent)),
    agent,
    { tools: wrappedTools },
  );
  return cloned;
}
