/**
 * @agentlair/scitt — unit tests
 *
 * Mocks globalThis.fetch for all unit tests. No live network calls.
 * Live round-trip tests are gated by AGENTLAIR_LIVE_TESTS=1.
 *
 * Run: bun test
 * Run live: AGENTLAIR_LIVE_TESTS=1 bun test
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  verifyEntry,
  listCorpus,
  getCorpusStats,
  getAtomFeed,
  VERSION,
  STATUS,
  DEFAULT_BASE_URL,
} from './index.js';
import type { CorpusItem, CorpusStats } from './index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_ENTRY_ID = 'test-entry-abc123';
const FAKE_RECEIPT_B64 = btoa('fake-cose-receipt-bytes');
const FAKE_RECEIPT_BYTES = Uint8Array.from(atob(FAKE_RECEIPT_B64), (c) => c.charCodeAt(0));

const CORPUS_ITEM: CorpusItem = {
  entry_id: FAKE_ENTRY_ID,
  issuer_did: 'did:web:agentlair.dev:agents:acc_test',
  issued_at: '2026-05-01T00:00:00.000Z',
  statement_type: 'api.request',
  leaf_index: 0,
  tree_size: 1,
  root_hash: 'abc123def456',
  signature: 'sig-base64',
  receipt_url: `https://agentlair.dev/v1/scitt/entries/${FAKE_ENTRY_ID}/receipt`,
};

const EMPTY_CORPUS_PAGE = { items: [], next_cursor: null, count: 0 };

const CORPUS_STATS: CorpusStats = {
  total_receipts: 3,
  unique_issuers: 2,
  by_statement_type: [{ statement_type: 'api.request', count: 3 }],
  by_week: [{ week: '2026-W18', count: 3 }],
  by_issuer: [{ issuer_did: 'did:web:agentlair.dev:agents:acc_test', count: 3 }],
};

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>AgentLair SCITT Receipt Corpus</title>
  <id>https://agentlair.dev/v1/scitt/corpus.atom</id>
  <updated>2026-05-01T00:00:00.000Z</updated>
</feed>`;

// ── Mock helpers ──────────────────────────────────────────────────────────────

type MockSetup =
  | { type: 'json'; status: number; body: unknown }
  | { type: 'bytes'; status: number; body: Uint8Array; contentType?: string }
  | { type: 'text'; status: number; body: string; contentType?: string }
  | { type: 'throw'; error: Error };

function setupFetch(setup: MockSetup): typeof globalThis.fetch {
  const original = globalThis.fetch;
  if (setup.type === 'throw') {
    globalThis.fetch = mock(async () => { throw setup.error; }) as unknown as typeof fetch;
  } else if (setup.type === 'bytes') {
    globalThis.fetch = mock(async () =>
      new Response(setup.body, {
        status: setup.status,
        headers: { 'Content-Type': setup.contentType ?? 'application/octet-stream' },
      }),
    ) as unknown as typeof fetch;
  } else if (setup.type === 'text') {
    globalThis.fetch = mock(async () =>
      new Response(setup.body, {
        status: setup.status,
        headers: { 'Content-Type': setup.contentType ?? 'text/plain' },
      }),
    ) as unknown as typeof fetch;
  } else {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(setup.body), {
        status: setup.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }
  return original;
}

// ── Package metadata ──────────────────────────────────────────────────────────

describe('package metadata', () => {
  it('exports VERSION 0.1.0', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('exports STATUS live', () => {
    expect(STATUS).toBe('live');
  });

  it('exports DEFAULT_BASE_URL pointing to api.agentlair.dev', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.agentlair.dev');
  });
});

// ── verifyEntry ───────────────────────────────────────────────────────────────

describe('verifyEntry — happy path', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = setupFetch({
      type: 'bytes',
      status: 200,
      body: FAKE_RECEIPT_BYTES,
      contentType: 'application/scitt-receipt+cose',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true on 200', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    expect(result.ok).toBe(true);
  });

  it('returns entry_id in data', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.entry_id).toBe(FAKE_ENTRY_ID);
  });

  it('returns base64 receipt_cbor', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.data.receipt_cbor).toBe('string');
    expect(result.data.receipt_cbor).toBe(FAKE_RECEIPT_B64);
  });

  it('returns correct byte_length', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.byte_length).toBe(FAKE_RECEIPT_BYTES.length);
  });

  it('does not set payload_match when expected_receipt is not provided', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.payload_match).toBeUndefined();
  });

  it('sets payload_match=true when expected_receipt matches', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID, expected_receipt: FAKE_RECEIPT_B64 });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.payload_match).toBe(true);
  });

  it('sets payload_match=false when expected_receipt does not match', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID, expected_receipt: 'different-base64' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.payload_match).toBe(false);
  });

  it('calls correct URL with encoded entry_id', async () => {
    await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toBe(
      `https://api.agentlair.dev/v1/scitt/entries/${encodeURIComponent(FAKE_ENTRY_ID)}/receipt`,
    );
  });

  it('uses custom agentLairBaseUrl', async () => {
    await verifyEntry({ entry_id: FAKE_ENTRY_ID, agentLairBaseUrl: 'https://staging.agentlair.dev' });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain('staging.agentlair.dev');
  });
});

describe('verifyEntry — not_found', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = setupFetch({ type: 'json', status: 404, body: { error: 'no_receipt' } });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=false with code not_found', async () => {
    const result = await verifyEntry({ entry_id: 'missing-entry' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('not_found');
  });

  it('includes status 404 in error', async () => {
    const result = await verifyEntry({ entry_id: 'missing-entry' });
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.status).toBe(404);
  });
});

describe('verifyEntry — network_error', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = setupFetch({ type: 'throw', error: new TypeError('fetch failed') });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=false with code network_error', async () => {
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('network_error');
  });
});

describe('verifyEntry — http_error', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns http_error for 500', async () => {
    originalFetch = setupFetch({ type: 'json', status: 500, body: { error: 'internal_error' } });
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('http_error');
    expect(result.error.status).toBe(500);
  });

  it('returns http_error for 503', async () => {
    originalFetch = setupFetch({ type: 'json', status: 503, body: { error: 'ts_unavailable' } });
    const result = await verifyEntry({ entry_id: FAKE_ENTRY_ID });
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('http_error');
    expect(result.error.status).toBe(503);
  });
});

// ── listCorpus ────────────────────────────────────────────────────────────────

describe('listCorpus — happy path', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true with empty corpus', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: EMPTY_CORPUS_PAGE });
    const result = await listCorpus();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.count).toBe(0);
    expect(result.data.items).toHaveLength(0);
    expect(result.data.next_cursor).toBeNull();
  });

  it('returns corpus page with items', async () => {
    originalFetch = setupFetch({
      type: 'json',
      status: 200,
      body: { items: [CORPUS_ITEM], next_cursor: null, count: 1 },
    });
    const result = await listCorpus();
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.count).toBe(1);
    expect(result.data.items[0].entry_id).toBe(FAKE_ENTRY_ID);
  });

  it('passes after and limit query params', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: EMPTY_CORPUS_PAGE });
    await listCorpus({ after: 5, limit: 20 });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    const url = String(calls[0][0]);
    expect(url).toContain('after=5');
    expect(url).toContain('limit=20');
  });

  it('omits query params when not provided', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: EMPTY_CORPUS_PAGE });
    await listCorpus();
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    const url = String(calls[0][0]);
    expect(url).not.toContain('?');
  });

  it('returns network_error on fetch throw', async () => {
    originalFetch = setupFetch({ type: 'throw', error: new TypeError('DNS failure') });
    const result = await listCorpus();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('network_error');
  });

  it('returns invalid_response for non-JSON body', async () => {
    originalFetch = setupFetch({ type: 'text', status: 200, body: 'not-json }{' });
    const result = await listCorpus();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('invalid_response');
  });

  it('returns invalid_response when shape is wrong', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: { wrong: true } });
    const result = await listCorpus();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('invalid_response');
  });
});

// ── getCorpusStats ────────────────────────────────────────────────────────────

describe('getCorpusStats — happy path', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true with valid stats', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: CORPUS_STATS });
    const result = await getCorpusStats();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.total_receipts).toBe(3);
    expect(result.data.unique_issuers).toBe(2);
  });

  it('returns by_week and by_issuer arrays', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: CORPUS_STATS });
    const result = await getCorpusStats();
    if (!result.ok) throw new Error('expected ok');
    expect(Array.isArray(result.data.by_week)).toBe(true);
    expect(Array.isArray(result.data.by_issuer)).toBe(true);
  });

  it('returns network_error on fetch throw', async () => {
    originalFetch = setupFetch({ type: 'throw', error: new TypeError('timeout') });
    const result = await getCorpusStats();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('network_error');
  });

  it('returns invalid_response when shape is wrong', async () => {
    originalFetch = setupFetch({ type: 'json', status: 200, body: { not: 'stats' } });
    const result = await getCorpusStats();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('invalid_response');
  });
});

// ── getAtomFeed ───────────────────────────────────────────────────────────────

describe('getAtomFeed — happy path', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true with Atom XML string', async () => {
    originalFetch = setupFetch({
      type: 'text',
      status: 200,
      body: ATOM_FEED,
      contentType: 'application/atom+xml; charset=UTF-8',
    });
    const result = await getAtomFeed();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.data).toBe('string');
    expect(result.data).toContain('<feed');
  });

  it('returns invalid_response when body has no <feed tag', async () => {
    originalFetch = setupFetch({ type: 'text', status: 200, body: '<html>not atom</html>' });
    const result = await getAtomFeed();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('invalid_response');
  });

  it('returns network_error on fetch throw', async () => {
    originalFetch = setupFetch({ type: 'throw', error: new TypeError('network gone') });
    const result = await getAtomFeed();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('network_error');
  });

  it('returns http_error on 503', async () => {
    originalFetch = setupFetch({ type: 'text', status: 503, body: 'unavailable' });
    const result = await getAtomFeed();
    if (result.ok) throw new Error('expected not ok');
    expect(result.error.code).toBe('http_error');
    expect(result.error.status).toBe(503);
  });
});

// ── Live round-trip tests (gated by AGENTLAIR_LIVE_TESTS=1) ──────────────────

const LIVE = process.env.AGENTLAIR_LIVE_TESTS === '1';
const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

describeIf(LIVE)('LIVE: listCorpus against api.agentlair.dev', () => {
  it('returns ok=true and a valid CorpusPage', async () => {
    const result = await listCorpus({ limit: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`corpus live test failed: ${result.error.message}`);
    expect(typeof result.data.count).toBe('number');
    expect(Array.isArray(result.data.items)).toBe(true);
    expect(result.data.next_cursor === null || typeof result.data.next_cursor === 'number').toBe(true);
  });
});

describeIf(LIVE)('LIVE: getCorpusStats against api.agentlair.dev', () => {
  it('returns ok=true and valid stats', async () => {
    const result = await getCorpusStats();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`stats live test failed: ${result.error.message}`);
    expect(typeof result.data.total_receipts).toBe('number');
    expect(typeof result.data.unique_issuers).toBe('number');
    expect(Array.isArray(result.data.by_week)).toBe(true);
  });
});
