/**
 * @agentlair/popa — Proof of Persistent Activity verifier client
 *
 * Verify PoPA attestations and enroll DIDs for daily attestation without
 * speaking to the worker directly. Zero runtime dependencies — uses Web
 * Crypto + fetch only.
 *
 * @example
 * ```typescript
 * import { verify, enroll, isFresh } from '@agentlair/popa';
 *
 * // Check an agent's activity streak
 * const result = await verify({ did: 'did:web:my-agent.example.com' });
 * console.log(result.streak_days); // 42
 * console.log(result.fresh);       // true — attested within last 25h
 *
 * // Enroll a DID for daily attestation
 * const enrollment = await enroll({
 *   did: 'did:web:my-agent.example.com',
 *   aat: process.env.AGENTLAIR_AAT!,
 * });
 * console.log(enrollment.enrolled_at);
 * ```
 *
 * @see https://agentlair.dev/specs/popa
 */

// ── Package metadata ──────────────────────────────────────────────────────────

export const VERSION = '0.1.0';
export const STATUS = 'live' as const;
export const PRIMITIVE = 'PoPA' as const;
export const EXPANSION = 'Proof of Persistent Activity' as const;
export const SPEC_URL = 'https://agentlair.dev/specs/popa' as const;
export const DEFAULT_BASE_URL = 'https://api.agentlair.dev' as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Raw metrics returned by GET /v1/popa/:did.
 *
 * Mirrors the PoPAMetrics shape emitted by the AgentLair worker's
 * popa-aggregator. All timestamps are ISO 8601 strings.
 */
export interface PoPAMetrics {
  /** The DID this attestation covers */
  did: string;
  /** Current unbroken streak in days */
  streak_days: number;
  /** Longest streak ever recorded */
  longest_streak: number;
  /** Total number of attestations on record */
  total_attestations: number;
  /** ISO timestamp of the most recent attestation window end */
  last_attestation_at: string;
  /** Number of gaps (missed days) in the attestation history */
  gap_count: number;
  /** ISO timestamp of the first attestation (genesis) */
  genesis_at: string;
  /** SCITT transparency log entry ID for the latest attestation */
  latest_scitt_entry: string;
}

/**
 * PoPAMetrics enriched with freshness metadata, returned by verify().
 */
export interface AttestationResult extends PoPAMetrics {
  /** ISO timestamp of when this response was fetched */
  fetchedAt: string;
  /** True if last_attestation_at is within maxAgeHours (default 25h) */
  fresh: boolean;
}

/** Successful response from a POST /v1/popa/enroll call */
export interface EnrollmentResult {
  agent_did: string;
  account_id: string | null;
  enabled: boolean;
  enrolled_at: string;
}

/** Error codes thrown by VerifyError */
export type VerifyErrorCode =
  | 'no_attestation'
  | 'stale'
  | 'invalid_signature'
  | 'network_error'
  | 'http_error';

// ── VerifyError ───────────────────────────────────────────────────────────────

/**
 * Typed error thrown by verify() and enroll() on any failure.
 *
 * Check `error.code` to distinguish failure modes without string-matching
 * the message.
 */
export class VerifyError extends Error {
  readonly code: VerifyErrorCode;
  /** HTTP status code, if the error came from a non-2xx response */
  readonly status?: number;

  constructor(code: VerifyErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'VerifyError';
    this.code = code;
    this.status = status;
    // Maintain proper prototype chain in transpiled ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** The DID to verify. Accepts did:web: and did:key: */
  did: string;
  /**
   * Override the AgentLair API base URL.
   * @default "https://api.agentlair.dev"
   */
  agentLairBaseUrl?: string;
  /**
   * Maximum age in hours before an attestation is considered stale.
   * @default 25
   */
  maxAgeHours?: number;
  /**
   * If true, throws VerifyError('stale') when the attestation is not fresh.
   * @default false
   */
  throwIfStale?: boolean;
}

export interface EnrollOptions {
  /** The DID to enroll. Must be did:web: or did:key: */
  did: string;
  /**
   * Override the AgentLair API base URL.
   * @default "https://api.agentlair.dev"
   */
  agentLairBaseUrl?: string;
  /** AgentLair Agent Authentication Token (AAT) — Bearer token */
  aat: string;
  /**
   * Enable or disable daily attestation for this DID.
   * @default true
   */
  enabled?: boolean;
}

// ── Internal validators ───────────────────────────────────────────────────────

function isPoPAMetrics(data: unknown): data is PoPAMetrics {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.did === 'string' &&
    typeof d.streak_days === 'number' &&
    typeof d.longest_streak === 'number' &&
    typeof d.total_attestations === 'number' &&
    typeof d.last_attestation_at === 'string' &&
    typeof d.gap_count === 'number' &&
    typeof d.genesis_at === 'string' &&
    typeof d.latest_scitt_entry === 'string'
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify PoPA attestations for a DID.
 *
 * Fetches the latest attestation metrics from the AgentLair API and returns
 * them with freshness metadata. Throws VerifyError on any failure — check
 * `error.code` to handle specific cases.
 *
 * @throws {VerifyError} code='no_attestation' — DID has no attestations yet
 * @throws {VerifyError} code='stale' — attestation exists but is older than maxAgeHours (only when throwIfStale=true)
 * @throws {VerifyError} code='invalid_signature' — response shape is invalid or unparseable
 * @throws {VerifyError} code='network_error' — fetch threw (DNS failure, timeout, etc.)
 * @throws {VerifyError} code='http_error' — non-404 HTTP error from the API
 *
 * @example
 * ```typescript
 * try {
 *   const result = await verify({ did: 'did:web:my-agent.example.com' });
 *   if (!result.fresh) console.warn('Attestation is stale');
 * } catch (e) {
 *   if (e instanceof VerifyError && e.code === 'no_attestation') {
 *     console.log('Agent not enrolled yet');
 *   }
 * }
 * ```
 */
export async function verify(options: VerifyOptions): Promise<AttestationResult> {
  const {
    did,
    agentLairBaseUrl = DEFAULT_BASE_URL,
    maxAgeHours = 25,
    throwIfStale = false,
  } = options;

  let response: Response;
  try {
    const url = `${agentLairBaseUrl}/v1/popa/${encodeURIComponent(did)}`;
    response = await fetch(url);
  } catch (e) {
    throw new VerifyError(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (response.status === 404) {
    throw new VerifyError(
      'no_attestation',
      `No attestations found for DID: ${did}`,
      404,
    );
  }

  if (!response.ok) {
    throw new VerifyError(
      'http_error',
      `HTTP ${response.status} from PoPA API`,
      response.status,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new VerifyError(
      'invalid_signature',
      'Response body is not valid JSON — possible tampering or proxy corruption',
    );
  }

  if (!isPoPAMetrics(data)) {
    throw new VerifyError(
      'invalid_signature',
      'Response shape does not match PoPAMetrics schema — possible API version mismatch or tampering',
    );
  }

  const fetchedAt = new Date().toISOString();
  const fresh = isFresh({ last_attestation_at: data.last_attestation_at }, maxAgeHours);

  if (throwIfStale && !fresh) {
    throw new VerifyError(
      'stale',
      `Attestation for ${did} is stale — last_attestation_at=${data.last_attestation_at}, maxAgeHours=${maxAgeHours}`,
    );
  }

  return { ...data, fetchedAt, fresh };
}

/**
 * Enroll a DID for daily PoPA attestation.
 *
 * Idempotent — safe to call multiple times for the same DID. Requires an
 * AgentLair AAT (Agent Authentication Token) as the Bearer credential.
 *
 * @throws {VerifyError} code='network_error' — fetch threw
 * @throws {VerifyError} code='http_error' — non-2xx response
 * @throws {VerifyError} code='invalid_signature' — response body is not valid JSON
 *
 * @example
 * ```typescript
 * const result = await enroll({
 *   did: 'did:web:my-agent.example.com',
 *   aat: process.env.AGENTLAIR_AAT!,
 * });
 * console.log(`Enrolled at ${result.enrolled_at}`);
 * ```
 */
export async function enroll(options: EnrollOptions): Promise<EnrollmentResult> {
  const {
    did,
    agentLairBaseUrl = DEFAULT_BASE_URL,
    aat,
    enabled = true,
  } = options;

  let response: Response;
  try {
    response = await fetch(`${agentLairBaseUrl}/v1/popa/enroll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agent_did: did, enabled }),
    });
  } catch (e) {
    throw new VerifyError(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    throw new VerifyError(
      'http_error',
      `HTTP ${response.status} from enroll API`,
      response.status,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new VerifyError(
      'invalid_signature',
      'Response body is not valid JSON',
    );
  }

  const d = data as Record<string, unknown>;
  return {
    agent_did: d.agent_did as string,
    account_id: typeof d.account_id === 'string' ? d.account_id : null,
    enabled: d.enabled as boolean,
    enrolled_at: d.enrolled_at as string,
  };
}

/**
 * Check whether an attestation is fresh.
 *
 * Convenience helper for downstream consumers who already have an
 * AttestationResult but want to re-check freshness against a custom window.
 *
 * @param attestation - Any object with a last_attestation_at field
 * @param maxAgeHours - Maximum acceptable age in hours. @default 25
 * @returns true if the attestation is within maxAgeHours of now
 *
 * @example
 * ```typescript
 * if (!isFresh(result, 48)) {
 *   await refreshAttestation(result.did);
 * }
 * ```
 */
export function isFresh(
  attestation: Pick<PoPAMetrics, 'last_attestation_at'>,
  maxAgeHours = 25,
): boolean {
  const lastAt = new Date(attestation.last_attestation_at).getTime();
  if (isNaN(lastAt)) return false;
  const ageMs = Date.now() - lastAt;
  return ageMs < maxAgeHours * 60 * 60 * 1000;
}
