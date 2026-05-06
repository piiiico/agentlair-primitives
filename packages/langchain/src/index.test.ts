/**
 * @agentlair/langchain — unit tests
 *
 * Mocks globalThis.fetch (or per-call fetchImpl) for all tests.
 * No live network calls — runs offline. Run: bun test
 */

import { describe, it, expect, mock } from 'bun:test';
import {
  issueAATForAgent,
  recordAuditEvent,
  wrapTool,
  withAgentLair,
  AgentLairError,
  VERSION,
  STATUS,
  ADAPTER,
  FRAMEWORK,
  type AAT,
  type AuditEvent,
  type LangChainToolLike,
} from './index.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

// A real-looking JWT with a `did` claim. base64url(payload):
//   {"did":"did:web:agentlair.dev:agents:acc_test","sub":"acc_test"}
const FAKE_JWT_PAYLOAD = Buffer.from(
  JSON.stringify({
    did: 'did:web:agentlair.dev:agents:acc_test',
    sub: 'acc_test',
    iss: 'https://agentlair.dev',
    aud: 'https://test.example.com',
  }),
)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const FAKE_JWT = `eyJhbGciOiJFZERTQSJ9.${FAKE_JWT_PAYLOAD}.fake_signature`;

const FRESH_EXPIRY = new Date(Date.now() + 3600_000).toISOString();
const STALE_EXPIRY = new Date(Date.now() - 1_000).toISOString();

const ISSUE_RESPONSE_OK = {
  token: FAKE_JWT,
  token_type: 'Bearer' as const,
  expires_at: FRESH_EXPIRY,
  expires_in: 3600,
  jti: 'aat_testaaaaaaaaaa',
  audit_url: 'https://agentlair.dev/v1/audit/aat_testaaaaaaaaaa',
};

function makeFetch(status: number, body: unknown, opts?: { throws?: Error }) {
  if (opts?.throws) {
    return mock(async () => {
      throw opts.throws;
    }) as unknown as typeof fetch;
  }
  return mock(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function makePreIssuedAAT(overrides: Partial<AAT> = {}): AAT {
  return {
    token: FAKE_JWT,
    tokenType: 'Bearer',
    expiresAt: FRESH_EXPIRY,
    expiresIn: 3600,
    jti: 'aat_pretest12345678',
    auditUrl: 'https://agentlair.dev/v1/audit/aat_pretest12345678',
    did: 'did:web:agentlair.dev:agents:acc_test',
    ...overrides,
  };
}

// ── Package metadata ─────────────────────────────────────────────────────────

describe('package metadata', () => {
  it('exports VERSION 0.2.1 (live, langchain adapter)', () => {
    expect(VERSION).toBe('0.2.1');
    expect(STATUS).toBe('live');
    expect(ADAPTER).toBe('langchain');
    expect(FRAMEWORK).toBe('LangChain.js');
  });
});

// ── issueAATForAgent — happy path ────────────────────────────────────────────

describe('issueAATForAgent — happy path', () => {
  it('POSTs to /v1/tokens/issue with bearer auth and returns the AAT', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const aat = await issueAATForAgent({
      apiKey: 'al_live_test123',
      audience: 'https://test.example.com',
      scopes: ['mcp:tools:read'],
      ttl: 3600,
      agentName: 'demo',
      fetchImpl,
    });

    expect(aat.token).toBe(FAKE_JWT);
    expect(aat.tokenType).toBe('Bearer');
    expect(aat.jti).toBe('aat_testaaaaaaaaaa');
    expect(aat.expiresIn).toBe(3600);
    expect(aat.expiresAt).toBe(FRESH_EXPIRY);
    expect(aat.auditUrl).toBe('https://agentlair.dev/v1/audit/aat_testaaaaaaaaaa');
    expect(aat.did).toBe('did:web:agentlair.dev:agents:acc_test');

    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(callArgs[0]).toBe('https://agentlair.dev/v1/tokens/issue');
    const init = callArgs[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer al_live_test123',
    );
    const body = JSON.parse(init.body as string);
    expect(body.audience).toBe('https://test.example.com');
    expect(body.scopes).toEqual(['mcp:tools:read']);
    expect(body.ttl).toBe(3600);
    expect(body.agent_name).toBe('demo');
  });

  it('uses default scope mcp:tools:read when scopes omitted', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    await issueAATForAgent({
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      fetchImpl,
    });
    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const body = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(body.scopes).toEqual(['mcp:tools:read']);
  });

  it('respects agentLairBaseUrl override', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    await issueAATForAgent({
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      agentLairBaseUrl: 'https://staging.agentlair.dev',
      fetchImpl,
    });
    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    expect(callArgs[0]).toBe('https://staging.agentlair.dev/v1/tokens/issue');
  });
});

// ── issueAATForAgent — failure modes ─────────────────────────────────────────

describe('issueAATForAgent — failures', () => {
  it('throws invalid_options when apiKey missing', async () => {
    await expect(
      issueAATForAgent({
        // @ts-expect-error — testing runtime guard
        apiKey: undefined,
        audience: 'https://x.example.com',
      }),
    ).rejects.toMatchObject({
      name: 'AgentLairError',
      code: 'invalid_options',
    });
  });

  it('throws invalid_options when audience missing', async () => {
    await expect(
      issueAATForAgent({
        apiKey: 'al_live_x',
        // @ts-expect-error — testing runtime guard
        audience: undefined,
      }),
    ).rejects.toMatchObject({
      name: 'AgentLairError',
      code: 'invalid_options',
    });
  });

  it('throws network_error when fetch rejects', async () => {
    const fetchImpl = makeFetch(0, null, {
      throws: new TypeError('failed to fetch'),
    });
    await expect(
      issueAATForAgent({
        apiKey: 'al_live_x',
        audience: 'https://x.example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'AgentLairError',
      code: 'network_error',
    });
  });

  it('throws http_error with status on non-2xx', async () => {
    const fetchImpl = makeFetch(401, { error: 'unauthorized' });
    let caught: AgentLairError | null = null;
    try {
      await issueAATForAgent({
        apiKey: 'al_live_bad',
        audience: 'https://x.example.com',
        fetchImpl,
      });
    } catch (e) {
      caught = e as AgentLairError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('http_error');
    expect(caught?.status).toBe(401);
  });

  it('throws invalid_response when body shape is unexpected', async () => {
    const fetchImpl = makeFetch(201, { unrelated: 'shape' });
    await expect(
      issueAATForAgent({
        apiKey: 'al_live_x',
        audience: 'https://x.example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'AgentLairError',
      code: 'invalid_response',
    });
  });

  it('throws invalid_response when body is not JSON', async () => {
    const fetchImpl = mock(
      async () =>
        new Response('<html>oops</html>', {
          status: 201,
          headers: { 'Content-Type': 'text/html' },
        }),
    ) as unknown as typeof fetch;
    await expect(
      issueAATForAgent({
        apiKey: 'al_live_x',
        audience: 'https://x.example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: 'AgentLairError',
      code: 'invalid_response',
    });
  });

  it('decodeDidFromJWT regression: malformed JWT yields null did, issuance still succeeds', async () => {
    const malformedJwt = 'header.notbase64.signature';
    const fetchImpl = makeFetch(201, {
      ...ISSUE_RESPONSE_OK,
      token: malformedJwt,
    });
    const aat = await issueAATForAgent({
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      fetchImpl,
    });
    expect(aat.token).toBe(malformedJwt);
    expect(aat.did).toBeNull();
  });
});

// ── recordAuditEvent — best-effort behaviour ─────────────────────────────────

describe('recordAuditEvent', () => {
  const SAMPLE_EVENT: AuditEvent = {
    toolName: 'echo',
    toolArgs: { msg: 'hi' },
    toolResult: 'you said: hi',
    startedAt: new Date(Date.now() - 100).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
  };

  it('returns true on 2xx and posts to /v1/events with translated body shape', async () => {
    const fetchImpl = makeFetch(202, { ok: true });
    const result = await recordAuditEvent(
      {
        ...SAMPLE_EVENT,
        jti: 'aat_test12345',
        agentName: 'demo',
        audience: 'https://x.example.com',
      },
      {
        apiKey: 'al_live_x',
        fetchImpl,
      },
    );
    expect(result).toBe(true);
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    // Mirrors the @agentlair/openai-agents v0.1.2 fix — real endpoint is /v1/events.
    expect(call[0]).toBe('https://agentlair.dev/v1/events');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer al_live_x',
    );
    // Body is wrapped in { events: [...], sdk_version }
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(typeof body.sdk_version).toBe('string');
    const evt = body.events[0];
    expect(evt.category).toBe('tool');
    expect(evt.action).toBe('echo');
    expect(evt.resource_type).toBe('echo');
    expect(evt.result).toBe('success');
    expect(typeof evt.duration_ms).toBe('number');
    expect(typeof evt.event_id).toBe('string');
    expect(evt.event_id.startsWith('evt_')).toBe(true);
    expect(typeof evt.timestamp).toBe('string');
    expect(evt.metadata).toEqual({
      agent_name: 'demo',
      audience: 'https://x.example.com',
      aat_jti: 'aat_test12345',
    });
  });

  it('translates failure envelopes (toolError → result:"failure" + error_code)', async () => {
    const fetchImpl = makeFetch(202, { ok: true });
    await recordAuditEvent(
      {
        ...SAMPLE_EVENT,
        toolError: 'something went wrong'.repeat(50), // long error to test slicing
      },
      { apiKey: 'al_live_x', fetchImpl },
    );
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.events[0].result).toBe('failure');
    expect(typeof body.events[0].error_code).toBe('string');
    // Sliced to 128 chars max
    expect(body.events[0].error_code.length).toBeLessThanOrEqual(128);
  });

  it('returns false on network error and does NOT throw', async () => {
    const fetchImpl = makeFetch(0, null, { throws: new Error('boom') });
    const result = await recordAuditEvent(SAMPLE_EVENT, {
      apiKey: 'al_live_x',
      fetchImpl,
    });
    expect(result).toBe(false);
  });
});

// ── wrapTool — invoke (LangChain Runnable) shape ─────────────────────────────

describe('wrapTool — invoke (LangChain Runnable shape)', () => {
  it('passes input through and returns the original tool result, audit captures parsed input', async () => {
    const collected: AuditEvent[] = [];
    let capturedInvokeArgs: unknown[] | null = null;
    // Mimics LangChain StructuredTool: invoke(input, config?) — input is parsed object
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      description: 'echo a message',
      invoke: async (...args: unknown[]) => {
        capturedInvokeArgs = args;
        const input = args[0] as { msg: string };
        return `you said: ${input.msg}`;
      },
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    expect(wrapped.name).toBe('echo');
    expect(wrapped.description).toBe('echo a message');

    const result = await wrapped.invoke!({ msg: 'hi' }, { metadata: { runId: 'r1' } });
    expect(result).toBe('you said: hi');

    // Original invoke saw (input, config) unchanged — transparent passthrough
    expect(capturedInvokeArgs).not.toBeNull();
    expect(capturedInvokeArgs![0]).toEqual({ msg: 'hi' });
    expect(capturedInvokeArgs![1]).toEqual({ metadata: { runId: 'r1' } });

    expect(collected).toHaveLength(1);
    expect(collected[0].toolName).toBe('echo');
    // Audit envelope captures the input object as-is (not a JSON string — LangChain passes parsed)
    expect(collected[0].toolArgs).toEqual({ msg: 'hi' });
    expect(collected[0].toolResult).toBe('you said: hi');
    expect(collected[0].jti).toBe('aat_pretest12345678');
    expect(collected[0].toolError).toBeUndefined();
    expect(typeof collected[0].durationMs).toBe('number');
  });

  it('records error and rethrows when invoke throws', async () => {
    const collected: AuditEvent[] = [];
    const broken: LangChainToolLike = {
      name: 'broken',
      invoke: async () => {
        throw new Error('runtime kaboom');
      },
    };
    const wrapped = wrapTool(broken, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    await expect(wrapped.invoke!({})).rejects.toThrow('runtime kaboom');
    expect(collected).toHaveLength(1);
    expect(collected[0].toolError).toBe('runtime kaboom');
    expect(collected[0].toolResult).toBeUndefined();
  });

  it('still runs the tool when onAuditEvent throws (best-effort guarantee)', async () => {
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      invoke: async (...args: unknown[]) =>
        `you said: ${(args[0] as { msg: string }).msg}`,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: () => {
        throw new Error('audit sink down');
      },
    });
    const result = await wrapped.invoke!({ msg: 'hi' });
    expect(result).toBe('you said: hi');
  });

  it('caches AAT across invoke calls when cacheAAT=true (default)', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      invoke: async (...args: unknown[]) => (args[0] as { msg: string }).msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.invoke!({ msg: 'a' });
    await wrapped.invoke!({ msg: 'b' });
    await wrapped.invoke!({ msg: 'c' });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    // Only one call to /v1/tokens/issue — the audit POSTs went to a no-op onAuditEvent.
    expect(calls.length).toBe(1);
  });

  it('preIssuedAAT precedence: skips fetch entirely when preIssuedAAT is fresh', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      invoke: async (...args: unknown[]) => (args[0] as { msg: string }).msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.invoke!({ msg: 'a' });
    await wrapped.invoke!({ msg: 'b' });
    // No issuance calls made — preIssuedAAT was fresh and used directly.
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBe(0);
  });

  it('detects expired preIssuedAAT and re-issues a fresh one', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      invoke: async (...args: unknown[]) => (args[0] as { msg: string }).msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT({ expiresAt: STALE_EXPIRY }),
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.invoke!({ msg: 'a' });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBe(1);
  });
});

// ── wrapTool — _call (legacy) shape ──────────────────────────────────────────

describe('wrapTool — _call (legacy shape)', () => {
  it('wraps _call when invoke is absent and audits the call', async () => {
    const collected: AuditEvent[] = [];
    const legacy: LangChainToolLike<{ s: string }, string> = {
      name: 'legacy-tool',
      _call: async ({ s }: { s: string }) => `parsed: ${s}`,
    };
    const wrapped = wrapTool(legacy, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    expect(typeof wrapped._call).toBe('function');
    expect(wrapped.invoke).toBeUndefined();

    const result = await wrapped._call!({ s: 'hello' });
    expect(result).toBe('parsed: hello');
    expect(collected).toHaveLength(1);
    expect(collected[0].toolName).toBe('legacy-tool');
    expect(collected[0].toolArgs).toEqual({ s: 'hello' });
    expect(collected[0].toolResult).toBe('parsed: hello');
  });

  it('prefers invoke over _call when both are present (live LangChain semantics)', async () => {
    const calls: string[] = [];
    const dual: LangChainToolLike = {
      name: 'dual',
      invoke: async (...args: unknown[]) => {
        calls.push('invoke');
        const input = args[0] as { v: string };
        return `from-invoke:${input.v}`;
      },
      _call: async (input: unknown) => {
        calls.push('_call');
        return `from-call:${(input as { v: string }).v}`;
      },
    };
    const wrapped = wrapTool(dual, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: () => {},
    });
    // The wrapped.invoke calls the original invoke, not _call.
    const result = await wrapped.invoke!({ v: 'x' });
    expect(result).toBe('from-invoke:x');
    expect(calls).toEqual(['invoke']);
    // _call still references the ORIGINAL (unwrapped) implementation —
    // we only override invoke, since invoke is the live runtime entrypoint.
    expect(wrapped._call).toBe(dual._call);
  });
});

// ── wrapTool — degenerate inputs ─────────────────────────────────────────────

describe('wrapTool — degenerate inputs', () => {
  it('returns the original tool unchanged when both invoke and _call are missing', () => {
    const malformed: LangChainToolLike = { name: 'no-handler' };
    const wrapped = wrapTool(malformed, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
    });
    expect(wrapped).toBe(malformed);
  });

  it('runs the tool even when AAT issuance fails (no preIssuedAAT, fetch throws)', async () => {
    const collected: AuditEvent[] = [];
    const echo: LangChainToolLike<{ msg: string }, string> = {
      name: 'echo',
      invoke: async (...args: unknown[]) =>
        `you said: ${(args[0] as { msg: string }).msg}`,
    };
    const fetchImpl = makeFetch(0, null, {
      throws: new TypeError('failed to fetch'),
    });
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      cacheAAT: false,
      fetchImpl,
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    const result = await wrapped.invoke!({ msg: 'hi' });
    expect(result).toBe('you said: hi');
    expect(collected).toHaveLength(1);
    // jti is undefined because issuance failed
    expect(collected[0].jti).toBeUndefined();
    expect(collected[0].toolName).toBe('echo');
  });
});

// ── withAgentLair — array shape ──────────────────────────────────────────────

describe('withAgentLair', () => {
  it('returns [] when given an empty array', () => {
    expect(withAgentLair([], { apiKey: 'al_live_x', audience: 'https://x.example.com' }))
      .toEqual([]);
  });

  it('wraps each tool in an array and preserves names; original tools untouched', async () => {
    const collected: AuditEvent[] = [];
    const tool1: LangChainToolLike<{ x: number }, number> = {
      name: 'doubler',
      description: 'double a number',
      invoke: async (...args: unknown[]) => (args[0] as { x: number }).x * 2,
    };
    const tool2: LangChainToolLike<{ s: string }, string> = {
      name: 'upper',
      invoke: async (...args: unknown[]) =>
        (args[0] as { s: string }).s.toUpperCase(),
    };
    const governed = withAgentLair([tool1, tool2], {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT({ jti: 'aat_govarray12345' }),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });

    expect(governed).toHaveLength(2);
    expect(governed[0]).not.toBe(tool1);
    expect(governed[1]).not.toBe(tool2);
    expect(governed[0].name).toBe('doubler');
    expect(governed[0].description).toBe('double a number');
    expect(governed[1].name).toBe('upper');

    const r1 = await governed[0].invoke!({ x: 21 });
    const r2 = await governed[1].invoke!({ s: 'hi' });
    expect(r1).toBe(42);
    expect(r2).toBe('HI');

    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.toolName).sort()).toEqual(['doubler', 'upper']);
    expect(collected.every((e) => e.jti === 'aat_govarray12345')).toBe(true);
  });

  it('skips tools missing both invoke and _call (returns them as-is in the array)', () => {
    const valid: LangChainToolLike = {
      name: 'valid',
      invoke: async (...args: unknown[]) => (args[0] as { v: string }).v,
    };
    const invalid: LangChainToolLike = { name: 'no-handler' };
    const governed = withAgentLair([valid, invalid], {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: () => {},
    });
    expect(governed).toHaveLength(2);
    // valid is wrapped (different reference)
    expect(governed[0]).not.toBe(valid);
    // invalid is returned as-is (same reference, no wrap)
    expect(governed[1]).toBe(invalid);
  });
});
