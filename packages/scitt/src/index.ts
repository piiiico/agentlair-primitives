/**
 * @agentlair/scitt — SCITT receipt corpus client
 *
 * Verify entries and browse the AgentLair SCITT transparency log without
 * manual fetch calls. Zero runtime dependencies. Uses Web Fetch only.
 *
 * @example
 * ```typescript
 * import { verifyEntry, listCorpus, getCorpusStats } from '@agentlair/scitt';
 *
 * // Check an entry exists in the transparency log
 * const result = await verifyEntry({ entry_id: 'abc123' });
 * if (result.ok) {
 *   console.log(result.data.receipt_cbor); // base64 COSE_Sign1
 *   console.log(result.data.byte_length);  // 128
 * }
 *
 * // Browse the public corpus
 * const page = await listCorpus({ limit: 10 });
 * if (page.ok) console.log(page.data.count);
 * ```
 *
 * @see https://agentlair.dev/specs/scitt
 */

// ── Package metadata ──────────────────────────────────────────────────────────

export const VERSION = '0.1.0';
export const STATUS = 'live' as const;
export const PRIMITIVE = 'SCITT' as const;
export const EXPANSION = 'Supply Chain Integrity, Transparency, and Trust' as const;
export const SPEC_URL = 'https://agentlair.dev/specs/scitt' as const;
export const DEFAULT_BASE_URL = 'https://api.agentlair.dev' as const;

// ── Error types ───────────────────────────────────────────────────────────────

export type ScittErrorCode =
  | 'not_found'
  | 'network_error'
  | 'http_error'
  | 'invalid_response';

export interface ScittError {
  code: ScittErrorCode;
  message: string;
  /** HTTP status, when the error originates from a non-2xx response */
  status?: number;
}

// ── ApiResult discriminated union ─────────────────────────────────────────────

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ScittError };

// ── Domain types ──────────────────────────────────────────────────────────────

/**
 * A SCITT receipt as returned by the public receipt endpoint.
 * The receipt_cbor field contains base64-encoded COSE_Sign1 bytes —
 * a Merkle inclusion proof from the AgentLair Transparency Service.
 */
export interface EntryReceipt {
  /** The entry_id that was looked up */
  entry_id: string;
  /** Base64-encoded COSE_Sign1 receipt bytes */
  receipt_cbor: string;
  /** Byte length of the raw receipt (for quick size checks) */
  byte_length: number;
  /**
   * Only present when expected_receipt was provided.
   * True if the fetched receipt matches the expected value exactly.
   */
  payload_match?: boolean;
}

/**
 * A single item in the public SCITT corpus.
 * Fields mirror the AgentLair GET /v1/scitt/corpus response shape.
 */
export interface CorpusItem {
  entry_id: string;
  issuer_did: string;
  issued_at: string;
  statement_type: string;
  leaf_index: number;
  tree_size: number;
  root_hash: string;
  signature: string;
  receipt_url: string;
}

/**
 * Paginated corpus response from GET /v1/scitt/corpus.
 */
export interface CorpusPage {
  items: CorpusItem[];
  /** Leaf index cursor for next page. null when no more pages. */
  next_cursor: number | null;
  /** Number of items in this page (not total corpus size) */
  count: number;
}

/**
 * Aggregate statistics for the entire SCITT corpus.
 * Returned by GET /v1/scitt/corpus/stats.
 */
export interface CorpusStats {
  total_receipts: number;
  unique_issuers: number;
  by_statement_type: Array<{ statement_type: string; count: number }>;
  /** Weekly receipt counts — chronological, last 52 weeks */
  by_week: Array<{ week: string; count: number }>;
  /** Top 20 issuers by receipt count */
  by_issuer: Array<{ issuer_did: string; count: number }>;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface BaseOptions {
  /**
   * Override the AgentLair API base URL.
   * @default "https://api.agentlair.dev"
   */
  agentLairBaseUrl?: string;
}

export interface VerifyEntryOptions extends BaseOptions {
  /** The audit entry ID to look up in the transparency log */
  entry_id: string;
  /**
   * Expected base64 receipt CBOR to compare against.
   * When provided, payload_match is set on the returned data.
   */
  expected_receipt?: string;
}

export interface ListCorpusOptions extends BaseOptions {
  /** Leaf index cursor — returns entries with leaf_index > after */
  after?: number;
  /** Page size (1–100). @default 50 */
  limit?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(code: ScittErrorCode, message: string, status?: number): ApiResult<T> {
  return { ok: false, error: { code, message, status } };
}

async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify that an entry exists in the AgentLair SCITT transparency log.
 *
 * Calls the public `GET /v1/scitt/entries/:entry_id/receipt` endpoint —
 * no authentication required. Returns the base64-encoded COSE_Sign1 receipt
 * bytes (Merkle inclusion proof).
 *
 * Pass `expected_receipt` (base64) to check that the stored receipt matches
 * what you have locally. Useful for tamper detection.
 *
 * @example
 * ```typescript
 * const result = await verifyEntry({ entry_id: 'abc123' });
 * if (result.ok) {
 *   console.log(`Receipt: ${result.data.byte_length} bytes`);
 * } else if (result.error.code === 'not_found') {
 *   console.log('Entry not registered with transparency service');
 * }
 * ```
 */
export async function verifyEntry(options: VerifyEntryOptions): Promise<ApiResult<EntryReceipt>> {
  const { entry_id, expected_receipt, agentLairBaseUrl = DEFAULT_BASE_URL } = options;

  let response: Response;
  try {
    response = await doFetch(
      `${agentLairBaseUrl}/v1/scitt/entries/${encodeURIComponent(entry_id)}/receipt`,
    );
  } catch (e) {
    return fail(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (response.status === 404) {
    return fail('not_found', `No receipt found for entry: ${entry_id}`, 404);
  }

  if (!response.ok) {
    return fail('http_error', `HTTP ${response.status} from receipt API`, response.status);
  }

  let receiptBytes: Uint8Array;
  try {
    const buffer = await response.arrayBuffer();
    receiptBytes = new Uint8Array(buffer);
  } catch (e) {
    return fail(
      'invalid_response',
      `Failed to read receipt bytes: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Encode to base64 (works in Node 18+, Bun, and browser/edge runtimes)
  const receipt_cbor = btoa(String.fromCharCode(...receiptBytes));

  const data: EntryReceipt = {
    entry_id,
    receipt_cbor,
    byte_length: receiptBytes.length,
  };

  if (expected_receipt !== undefined) {
    data.payload_match = receipt_cbor === expected_receipt;
  }

  return ok(data);
}

/**
 * List receipts from the public SCITT corpus.
 *
 * The corpus is paginated via a leaf_index cursor. Pass `after` to get the
 * next page. An empty items array means no more pages.
 *
 * @example
 * ```typescript
 * let cursor: number | null = undefined;
 * do {
 *   const page = await listCorpus({ after: cursor ?? undefined, limit: 100 });
 *   if (!page.ok) break;
 *   // process page.data.items...
 *   cursor = page.data.next_cursor;
 * } while (cursor !== null);
 * ```
 */
export async function listCorpus(options: ListCorpusOptions = {}): Promise<ApiResult<CorpusPage>> {
  const { after, limit, agentLairBaseUrl = DEFAULT_BASE_URL } = options;

  const params = new URLSearchParams();
  if (after !== undefined) params.set('after', String(after));
  if (limit !== undefined) params.set('limit', String(limit));

  const qs = params.toString();
  const url = `${agentLairBaseUrl}/v1/scitt/corpus${qs ? `?${qs}` : ''}`;

  let response: Response;
  try {
    response = await doFetch(url);
  } catch (e) {
    return fail(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    return fail('http_error', `HTTP ${response.status} from corpus API`, response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return fail('invalid_response', 'Corpus response is not valid JSON');
  }

  if (!isCorpusPage(data)) {
    return fail('invalid_response', 'Corpus response shape does not match CorpusPage schema');
  }

  return ok(data);
}

/**
 * Fetch aggregate statistics for the entire SCITT corpus.
 *
 * No authentication required. Includes total receipt count, unique issuer
 * count, breakdown by statement type, weekly activity, and top issuers.
 *
 * @example
 * ```typescript
 * const stats = await getCorpusStats();
 * if (stats.ok) {
 *   console.log(`${stats.data.total_receipts} receipts from ${stats.data.unique_issuers} issuers`);
 * }
 * ```
 */
export async function getCorpusStats(options: BaseOptions = {}): Promise<ApiResult<CorpusStats>> {
  const { agentLairBaseUrl = DEFAULT_BASE_URL } = options;

  let response: Response;
  try {
    response = await doFetch(`${agentLairBaseUrl}/v1/scitt/corpus/stats`);
  } catch (e) {
    return fail(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    return fail('http_error', `HTTP ${response.status} from corpus/stats API`, response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return fail('invalid_response', 'Stats response is not valid JSON');
  }

  if (!isCorpusStats(data)) {
    return fail('invalid_response', 'Stats response shape does not match CorpusStats schema');
  }

  return ok(data);
}

/**
 * Fetch the Atom 1.0 feed of the 50 most recent SCITT receipts.
 *
 * Returns the raw Atom XML string. Cached for 5 minutes on the AgentLair CDN.
 * Suitable as a feed URL for RSS readers or change-detection pipelines.
 *
 * @example
 * ```typescript
 * const feed = await getAtomFeed();
 * if (feed.ok) {
 *   const parser = new DOMParser();
 *   const doc = parser.parseFromString(feed.data, 'application/xml');
 * }
 * ```
 */
export async function getAtomFeed(options: BaseOptions = {}): Promise<ApiResult<string>> {
  const { agentLairBaseUrl = DEFAULT_BASE_URL } = options;

  let response: Response;
  try {
    response = await doFetch(`${agentLairBaseUrl}/v1/scitt/corpus.atom`);
  } catch (e) {
    return fail(
      'network_error',
      `Network request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    return fail('http_error', `HTTP ${response.status} from corpus.atom`, response.status);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (e) {
    return fail(
      'invalid_response',
      `Failed to read Atom feed body: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!text.includes('<feed')) {
    return fail('invalid_response', 'Response body does not look like an Atom feed');
  }

  return ok(text);
}

// ── Internal validators ───────────────────────────────────────────────────────

function isCorpusPage(data: unknown): data is CorpusPage {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.items) &&
    (d.next_cursor === null || typeof d.next_cursor === 'number') &&
    typeof d.count === 'number'
  );
}

function isCorpusStats(data: unknown): data is CorpusStats {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.total_receipts === 'number' &&
    typeof d.unique_issuers === 'number' &&
    Array.isArray(d.by_statement_type) &&
    Array.isArray(d.by_week) &&
    Array.isArray(d.by_issuer)
  );
}
