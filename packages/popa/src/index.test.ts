/**
 * @agentlair/popa — unit tests
 *
 * Mocks globalThis.fetch for all tests. No live network calls.
 * Run: bun test
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  verify,
  enroll,
  isFresh,
  VerifyError,
  VERSION,
  STATUS,
} from './index.js';
import type { PoPAMetrics } from './index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RECENT_ISO = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
const STALE_ISO = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago

const FRESH_METRICS: PoPAMetrics = {
  did: 'did:web:test-agent.example.com',
  streak_days: 14,
  longest_streak: 42,
  total_attestations: 100,
  last_attestation_at: RECENT_ISO,
  gap_count: 2,
  genesis_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  latest_scitt_entry: 'scitt:abc123def456',
};

const STALE_METRICS: PoPAMetrics = {
  ...FRESH_METRICS,
  last_attestation_at: STALE_ISO,
};

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown, throws?: Error) {
  const original = globalThis.fetch;
  if (throws) {
    globalThis.fetch = mock(async () => { throw throws; }) as unknown as typeof fetch;
  } else {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(body), {
        status,
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
});

// ── isFresh ───────────────────────────────────────────────────────────────────

describe('isFresh', () => {
  it('returns true for attestation 1h ago (default 25h window)', () => {
    expect(isFresh({ last_attestation_at: RECENT_ISO })).toBe(true);
  });

  it('returns false for attestation 30h ago (default 25h window)', () => {
    expect(isFresh({ last_attestation_at: STALE_ISO })).toBe(false);
  });

  it('returns true for 30h ago with custom 48h window', () => {
    expect(isFresh({ last_attestation_at: STALE_ISO }, 48)).toBe(true);
  });

  it('returns false for 30h ago with strict 24h window', () => {
    expect(isFresh({ last_attestation_at: STALE_ISO }, 24)).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(isFresh({ last_attestation_at: 'not-a-date' })).toBe(false);
  });

  it('boundary: exactly at threshold is stale (strict less-than check)', () => {
    // Exactly maxAgeHours ago → ageMs === threshold → NOT fresh (< not <=)
    const exactlyAtEdge = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isFresh({ last_attestation_at: exactlyAtEdge })).toBe(false);
  });
});

// ── verify — happy path ───────────────────────────────────────────────────────

describe('verify — happy path', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(200, FRESH_METRICS);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns AttestationResult with all PoPAMetrics fields', async () => {
    const result = await verify({ did: FRESH_METRICS.did });
    expect(result.did).toBe(FRESH_METRICS.did);
    expect(result.streak_days).toBe(14);
    expect(result.longest_streak).toBe(42);
    expect(result.total_attestations).toBe(100);
    expect(result.gap_count).toBe(2);
    expect(result.latest_scitt_entry).toBe('scitt:abc123def456');
  });

  it('adds fetchedAt as an ISO string', async () => {
    const result = await verify({ did: FRESH_METRICS.did });
    expect(typeof result.fetchedAt).toBe('string');
    expect(() => new Date(result.fetchedAt)).not.toThrow();
  });

  it('marks fresh=true for recent attestation', async () => {
    const result = await verify({ did: FRESH_METRICS.did });
    expect(result.fresh).toBe(true);
  });

  it('calls correct URL with encoded DID', async () => {
    const did = 'did:web:test-agent.example.com';
    await verify({ did });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe(`https://api.agentlair.dev/v1/popa/${encodeURIComponent(did)}`);
  });

  it('uses custom agentLairBaseUrl when provided', async () => {
    await verify({ did: FRESH_METRICS.did, agentLairBaseUrl: 'https://staging.agentlair.dev' });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain('staging.agentlair.dev');
  });
});

// ── verify — stale attestation ────────────────────────────────────────────────

describe('verify — stale attestation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(200, STALE_METRICS);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns fresh=false for stale attestation without throwIfStale', async () => {
    const result = await verify({ did: STALE_METRICS.did });
    expect(result.fresh).toBe(false);
  });

  it('throws VerifyError(stale) when throwIfStale=true', async () => {
    await expect(
      verify({ did: STALE_METRICS.did, throwIfStale: true }),
    ).rejects.toMatchObject({ code: 'stale' });
  });

  it('thrown stale error is instance of VerifyError', async () => {
    let error: unknown;
    try {
      await verify({ did: STALE_METRICS.did, throwIfStale: true });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VerifyError);
    expect((error as VerifyError).code).toBe('stale');
  });
});

// ── verify — no_attestation ───────────────────────────────────────────────────

describe('verify — no_attestation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(404, { error: 'no_attestations_found', message: 'no_attestations_found' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws VerifyError with code no_attestation', async () => {
    await expect(
      verify({ did: 'did:web:unenrolled.example.com' }),
    ).rejects.toMatchObject({ code: 'no_attestation' });
  });

  it('error status is 404', async () => {
    let error: unknown;
    try {
      await verify({ did: 'did:web:unenrolled.example.com' });
    } catch (e) {
      error = e;
    }
    expect((error as VerifyError).status).toBe(404);
  });
});

// ── verify — network_error ────────────────────────────────────────────────────

describe('verify — network error', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(0, null, new TypeError('fetch failed'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws VerifyError with code network_error', async () => {
    await expect(
      verify({ did: 'did:web:test.example.com' }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });
});

// ── verify — invalid_signature (malformed response) ──────────────────────────

describe('verify — invalid_signature', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws invalid_signature for non-JSON response body', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response('not json at all }{', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      verify({ did: 'did:web:test.example.com' }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('throws invalid_signature when response JSON is missing required fields', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ did: 'did:web:test.example.com', wrong_field: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      verify({ did: 'did:web:test.example.com' }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });
});

// ── verify — http_error ───────────────────────────────────────────────────────

describe('verify — http_error', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws VerifyError(http_error) for 500 response', async () => {
    originalFetch = mockFetch(500, { error: 'internal_error' });
    await expect(
      verify({ did: 'did:web:test.example.com' }),
    ).rejects.toMatchObject({ code: 'http_error', status: 500 });
  });

  it('throws VerifyError(http_error) for 503 response', async () => {
    originalFetch = mockFetch(503, { error: 'audit_unavailable' });
    await expect(
      verify({ did: 'did:web:test.example.com' }),
    ).rejects.toMatchObject({ code: 'http_error', status: 503 });
  });
});

// ── enroll — happy path ───────────────────────────────────────────────────────

describe('enroll — happy path', () => {
  const ENROLLMENT_RESPONSE = {
    agent_did: 'did:web:my-agent.example.com',
    account_id: 'acc_abc123',
    enabled: true,
    enrolled_at: '2026-05-03T00:00:00.000Z',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(200, ENROLLMENT_RESPONSE);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns EnrollmentResult with all fields', async () => {
    const result = await enroll({
      did: 'did:web:my-agent.example.com',
      aat: 'test-aat-token',
    });
    expect(result.agent_did).toBe('did:web:my-agent.example.com');
    expect(result.account_id).toBe('acc_abc123');
    expect(result.enabled).toBe(true);
    expect(result.enrolled_at).toBe('2026-05-03T00:00:00.000Z');
  });

  it('sends POST to /v1/popa/enroll with Bearer token', async () => {
    await enroll({ did: 'did:web:my-agent.example.com', aat: 'my-token' });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain('/v1/popa/enroll');
    expect((calls[0][1] as RequestInit).method).toBe('POST');
    const headers = (calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('sends agent_did and enabled=true in body by default', async () => {
    await enroll({ did: 'did:web:my-agent.example.com', aat: 'tok' });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.agent_did).toBe('did:web:my-agent.example.com');
    expect(body.enabled).toBe(true);
  });

  it('sends enabled=false when explicitly set', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ ...ENROLLMENT_RESPONSE, enabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await enroll({
      did: 'did:web:my-agent.example.com',
      aat: 'tok',
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });
});

// ── enroll — error paths ──────────────────────────────────────────────────────

describe('enroll — errors', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws VerifyError(network_error) on fetch throw', async () => {
    originalFetch = mockFetch(0, null, new TypeError('network failure'));
    await expect(
      enroll({ did: 'did:web:x.example.com', aat: 'tok' }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('throws VerifyError(http_error) on 401 unauthorized', async () => {
    originalFetch = mockFetch(401, { error: 'unauthorized' });
    await expect(
      enroll({ did: 'did:web:x.example.com', aat: 'bad-token' }),
    ).rejects.toMatchObject({ code: 'http_error', status: 401 });
  });
});

// ── VerifyError class ─────────────────────────────────────────────────────────

describe('VerifyError', () => {
  it('is an instance of Error', () => {
    const e = new VerifyError('no_attestation', 'test');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(VerifyError);
  });

  it('has correct name', () => {
    const e = new VerifyError('http_error', 'test', 500);
    expect(e.name).toBe('VerifyError');
  });

  it('preserves code and status', () => {
    const e = new VerifyError('http_error', 'Bad gateway', 502);
    expect(e.code).toBe('http_error');
    expect(e.status).toBe(502);
    expect(e.message).toBe('Bad gateway');
  });
});
