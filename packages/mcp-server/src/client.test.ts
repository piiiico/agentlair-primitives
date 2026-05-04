/**
 * @agentlair/mcp-server — client tests.
 *
 * Mocks globalThis.fetch for unit tests + one live round-trip against
 * agentlair.dev (skipped if AGENTLAIR_LIVE_TESTS is not set).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  getPopa,
  getPopaLeaderboard,
  verifyAgent,
  checkTrustGate,
  lookupAuditToken,
  AGENT_ID_RE,
  JTI_RE,
  type PoPAMetrics,
  type LeaderboardResponse,
  type PaymentRequiredBody,
} from './client.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FRESH_METRICS: PoPAMetrics = {
  did: 'did:web:agentlair.dev',
  streak_days: 1,
  longest_streak: 1,
  total_attestations: 1,
  last_attestation_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  gap_count: 0,
  genesis_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  latest_scitt_entry: 'scitt:popa_5nJkiDL8Mu9Ph2Zy',
};

const LEADERBOARD_BODY: LeaderboardResponse = {
  sort: 'attestations',
  limit: 5,
  rows: [
    {
      did: 'did:web:agentlair.dev',
      controller: null,
      enrolled_at: '2026-05-02 14:33:49',
      last_attested_at: '2026-05-04T00:00:52.458Z',
      revoked_at: null,
      attestation_count: 1,
    },
  ],
  generated_at: new Date().toISOString(),
};

const PAYMENT_REQUIRED: PaymentRequiredBody = {
  x402Version: 2,
  error: 'Payment required: 0.01 USDC on Base — AgentLair trust score query.',
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      maxAmountRequired: '10000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
      resource: 'https://agentlair.dev/v1/trust',
      description: 'AgentLair trust score query — 0.01 USDC per lookup.',
    },
  ],
};

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown, throws?: Error) {
  const original = globalThis.fetch;
  if (throws) {
    globalThis.fetch = mock(async () => {
      throw throws;
    }) as unknown as typeof fetch;
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

// ── Validators ───────────────────────────────────────────────────────────────

describe('regex validators', () => {
  it('AGENT_ID_RE accepts acc_<alphanumeric>', () => {
    expect(AGENT_ID_RE.test('acc_qgdxSULsXsmtHklZ')).toBe(true);
    expect(AGENT_ID_RE.test('acc_a-_-1')).toBe(true);
  });

  it('AGENT_ID_RE rejects malformed IDs', () => {
    expect(AGENT_ID_RE.test('did:web:foo')).toBe(false);
    expect(AGENT_ID_RE.test('acc_')).toBe(false);
    expect(AGENT_ID_RE.test('user_abc')).toBe(false);
  });

  it('JTI_RE matches aat_<16 alphanumeric>', () => {
    expect(JTI_RE.test('aat_1234567890abcdef')).toBe(true);
    expect(JTI_RE.test('aat_short')).toBe(false);
    expect(JTI_RE.test('aat_1234567890abcdefX')).toBe(false); // 17 chars
  });
});

// ── getPopa ──────────────────────────────────────────────────────────────────

describe('getPopa', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true with PoPAMetrics on 200', async () => {
    originalFetch = mockFetch(200, FRESH_METRICS);
    const result = await getPopa('did:web:agentlair.dev');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.did).toBe('did:web:agentlair.dev');
      expect(result.data.streak_days).toBe(1);
    }
  });

  it('encodes the DID in the URL', async () => {
    originalFetch = mockFetch(200, FRESH_METRICS);
    await getPopa('did:web:agentlair.dev');
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain(encodeURIComponent('did:web:agentlair.dev'));
  });

  it('returns http_error on 404', async () => {
    originalFetch = mockFetch(404, { error: 'no_attestations_found', message: 'no_attestations_found' });
    const result = await getPopa('did:web:never.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('http_error');
      if (result.kind === 'http_error') expect(result.status).toBe(404);
    }
  });

  it('returns network_error when fetch throws', async () => {
    originalFetch = mockFetch(0, null, new TypeError('fetch failed'));
    const result = await getPopa('did:web:any.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network_error');
  });

  it('returns invalid_response when shape is wrong', async () => {
    originalFetch = mockFetch(200, { did: 'did:web:x', wrong_shape: true });
    const result = await getPopa('did:web:x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid_response');
  });
});

// ── getPopaLeaderboard ───────────────────────────────────────────────────────

describe('getPopaLeaderboard', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('omits ?limit when undefined', async () => {
    originalFetch = mockFetch(200, LEADERBOARD_BODY);
    await getPopaLeaderboard(undefined);
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).not.toContain('limit');
  });

  it('appends ?limit=N when set', async () => {
    originalFetch = mockFetch(200, LEADERBOARD_BODY);
    await getPopaLeaderboard(5);
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain('limit=5');
  });

  it('returns leaderboard with rows array', async () => {
    originalFetch = mockFetch(200, LEADERBOARD_BODY);
    const result = await getPopaLeaderboard(5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.data.rows)).toBe(true);
      expect(result.data.rows.length).toBe(1);
    }
  });
});

// ── verifyAgent — payment_required path ──────────────────────────────────────

describe('verifyAgent — payment required', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = mockFetch(402, PAYMENT_REQUIRED);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns kind=payment_required with accepts[]', async () => {
    const result = await verifyAgent('acc_qgdxSULsXsmtHklZ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('payment_required');
      if (result.kind === 'payment_required') {
        expect(result.payment.accepts.length).toBeGreaterThan(0);
        expect(result.payment.accepts[0]?.network).toBe('eip155:8453');
      }
    }
  });

  it('flags invalid_response when 402 body is malformed', async () => {
    globalThis.fetch = mock(async () =>
      new Response('garbage', { status: 402, headers: { 'Content-Type': 'text/plain' } }),
    ) as unknown as typeof fetch;

    const result = await verifyAgent('acc_qgdxSULsXsmtHklZ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('invalid_response');
  });
});

// ── verifyAgent — Bearer header ──────────────────────────────────────────────

describe('verifyAgent — auth header', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sets Authorization: Bearer <aat> when aat option set', async () => {
    originalFetch = mockFetch(200, { agent_id: 'acc_x', score: 78.4, atf_level: 'junior' });
    await verifyAgent('acc_x', { aat: 'tok_secret' });
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    const headers = (calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_secret');
  });

  it('omits Authorization header when no aat', async () => {
    originalFetch = mockFetch(200, { agent_id: 'acc_x', score: 50 });
    await verifyAgent('acc_x');
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    const headers = (calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

// ── checkTrustGate ───────────────────────────────────────────────────────────

describe('checkTrustGate', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes min_level as query param', async () => {
    originalFetch = mockFetch(200, {
      agentId: 'acc_x',
      score: 50,
      atfLevel: 'junior',
      meetsMinimum: true,
      requiredLevel: 'junior',
    });
    await checkTrustGate('acc_x', 'junior');
    const calls = (globalThis.fetch as ReturnType<typeof mock>).mock.calls;
    expect(String(calls[0][0])).toContain('min_level=junior');
    expect(String(calls[0][0])).toContain('/check');
  });
});

// ── lookupAuditToken ─────────────────────────────────────────────────────────

describe('lookupAuditToken', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns AuditTokenInfo on 200', async () => {
    originalFetch = mockFetch(200, {
      jti: 'aat_1234567890abcdef',
      issued_at: '2026-05-04T00:00:00Z',
      expires_at: '2026-05-04T01:00:00Z',
      status: 'active',
      revoked_at: null,
      revocation_reason: null,
      scopes: ['email.send'],
    });
    const result = await lookupAuditToken('aat_1234567890abcdef');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.jti).toBe('aat_1234567890abcdef');
      expect(result.data.status).toBe('active');
    }
  });

  it('returns payment_required on 402', async () => {
    originalFetch = mockFetch(402, {
      x402Version: 2,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          maxAmountRequired: '1000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x90EE1EbcCFA2021711C595E1410e22401570B4AC',
          resource: 'https://agentlair.dev/v1/audit',
          description: 'Audit token lookup — 0.001 USDC.',
        },
      ],
    });
    const result = await lookupAuditToken('aat_1234567890abcdef');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('payment_required');
  });
});

// ── Live round-trip — public PoPA endpoint ───────────────────────────────────
//
// Hits api.agentlair.dev for real. Skipped unless AGENTLAIR_LIVE_TESTS=1
// to keep CI deterministic. The bootstrap row did:web:agentlair.dev is
// always present (PoPA genesis 2026-05-03) so this should never be flaky
// from missing data — only from network outages.

const liveTests = process.env.AGENTLAIR_LIVE_TESTS === '1' ? describe : describe.skip;

liveTests('live round-trip (set AGENTLAIR_LIVE_TESTS=1)', () => {
  it('fetches PoPA metrics for did:web:agentlair.dev', async () => {
    const result = await getPopa('did:web:agentlair.dev');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.did).toBe('did:web:agentlair.dev');
      expect(result.data.total_attestations).toBeGreaterThanOrEqual(1);
      expect(result.data.latest_scitt_entry).toMatch(/^scitt:/);
    }
  }, 20000);

  it('fetches a non-empty PoPA leaderboard', async () => {
    const result = await getPopaLeaderboard(10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rows.length).toBeGreaterThan(0);
      expect(result.data.rows[0]?.did).toMatch(/^did:/);
    }
  }, 20000);
});
