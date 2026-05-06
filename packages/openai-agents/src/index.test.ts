/**
 * @agentlair/openai-agents — unit tests
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
  type AgentLairToolLike,
  type AgentLike,
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

// ── Package metadata ─────────────────────────────────────────────────────────

describe('package metadata', () => {
  it('exports VERSION 0.1.2 (live, not reserved)', () => {
    expect(VERSION).toBe('0.1.2');
    expect(STATUS).toBe('live');
    expect(ADAPTER).toBe('openai-agents');
    expect(FRAMEWORK).toBe('OpenAI Agents SDK');
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
    // Build a non-JSON 200 response
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

  it('returns true on 2xx and posts to /v1/events with EventSubmission body', async () => {
    const fetchImpl = makeFetch(202, { accepted: 1, rejected: 0 });
    const result = await recordAuditEvent(SAMPLE_EVENT, {
      apiKey: 'al_live_x',
      fetchImpl,
    });
    expect(result).toBe(true);
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    // Fix: was /v1/audit/ingest (non-existent). Real endpoint is /v1/events.
    expect(call[0]).toBe('https://agentlair.dev/v1/events');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer al_live_x',
    );
    // Body must be an EventSubmission envelope (not a raw AuditEvent)
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].category).toBe('tool');
    expect(body.events[0].action).toBe('echo');
    expect(body.events[0].result).toBe('success');
    expect(typeof body.events[0].event_id).toBe('string');
    expect(body.sdk_version).toBe('0.1.2');
  });

  it('returns false on network error and does NOT throw', async () => {
    const fetchImpl = makeFetch(0, null, { throws: new Error('boom') });
    const result = await recordAuditEvent(SAMPLE_EVENT, {
      apiKey: 'al_live_x',
      fetchImpl,
    });
    expect(result).toBe(false);
  });

  it('returns false on non-2xx and does NOT throw', async () => {
    const fetchImpl = makeFetch(404, { error: 'not found' });
    const result = await recordAuditEvent(SAMPLE_EVENT, {
      apiKey: 'al_live_x',
      fetchImpl,
    });
    expect(result).toBe(false);
  });

  it('returns false (and skips fetch) when apiKey empty', async () => {
    const fetchImpl = mock(async () => new Response('{}', { status: 200 }));
    const result = await recordAuditEvent(SAMPLE_EVENT, {
      apiKey: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
    expect(
      (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .length,
    ).toBe(0);
  });
});

// ── wrapTool ─────────────────────────────────────────────────────────────────

describe('wrapTool', () => {
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

  it('passes args through and returns the original tool result', async () => {
    const collected: AuditEvent[] = [];
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => `you said: ${msg}`,
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
    const result = await wrapped.execute!({ msg: 'hi' });
    expect(result).toBe('you said: hi');
    expect(collected).toHaveLength(1);
    expect(collected[0].toolName).toBe('echo');
    expect(collected[0].toolArgs).toEqual({ msg: 'hi' });
    expect(collected[0].toolResult).toBe('you said: hi');
    expect(collected[0].jti).toBe('aat_pretest12345678');
    expect(collected[0].toolError).toBeUndefined();
  });

  it('records error and rethrows when the original tool throws', async () => {
    const collected: AuditEvent[] = [];
    const broken: AgentLairToolLike = {
      name: 'broken',
      execute: async () => {
        throw new Error('kaboom');
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
    await expect(wrapped.execute!({})).rejects.toThrow('kaboom');
    expect(collected).toHaveLength(1);
    expect(collected[0].toolError).toBe('kaboom');
    expect(collected[0].toolResult).toBeUndefined();
  });

  it('still runs the tool when onAuditEvent throws (best-effort guarantee)', async () => {
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => `you said: ${msg}`,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: () => {
        throw new Error('audit sink down');
      },
    });
    const result = await wrapped.execute!({ msg: 'hi' });
    expect(result).toBe('you said: hi');
  });

  it('runs the tool even when AAT issuance fails (no preIssuedAAT, fetch throws)', async () => {
    const collected: AuditEvent[] = [];
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => `you said: ${msg}`,
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
    const result = await wrapped.execute!({ msg: 'hi' });
    expect(result).toBe('you said: hi');
    expect(collected).toHaveLength(1);
    // jti is undefined because issuance failed
    expect(collected[0].jti).toBeUndefined();
    expect(collected[0].toolName).toBe('echo');
  });

  it('caches AAT across calls when cacheAAT=true (default)', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.execute!({ msg: 'a' });
    await wrapped.execute!({ msg: 'b' });
    await wrapped.execute!({ msg: 'c' });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBe(1); // AAT issued once, reused twice
  });

  it('skips cache when cacheAAT=false (one issue per call)', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      cacheAAT: false,
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.execute!({ msg: 'a' });
    await wrapped.execute!({ msg: 'b' });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBe(2);
  });

  it('detects expired preIssuedAAT and re-issues a fresh one', async () => {
    const fetchImpl = makeFetch(201, ISSUE_RESPONSE_OK);
    const echo: AgentLairToolLike<{ msg: string }, string> = {
      name: 'echo',
      execute: async ({ msg }) => msg,
    };
    const wrapped = wrapTool(echo, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT({ expiresAt: STALE_EXPIRY }),
      fetchImpl,
      onAuditEvent: () => {},
    });
    await wrapped.execute!({ msg: 'a' });
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBe(1); // re-issued because preIssuedAAT was stale
  });

  it('handles malformed JWT (missing did claim) — did is null, issuance still succeeds', async () => {
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

  it('returns the original tool unchanged when both invoke and execute are missing', () => {
    const malformed: AgentLairToolLike = { name: 'no-execute' };
    const wrapped = wrapTool(malformed, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
    });
    expect(wrapped).toBe(malformed);
  });

  it('wraps invoke (live SDK runtime shape) and parses JSON-string input for audit capture', async () => {
    const collected: AuditEvent[] = [];
    // Simulates the @openai/agents runtime: tool() output exposes `invoke(runContext, input, details?)`
    // where `input` is a JSON-encoded string.
    let originalInvokeCalledWith: unknown[] | null = null;
    const sdkLikeTool: AgentLairToolLike = {
      name: 'echo',
      invoke: async (...args: unknown[]) => {
        originalInvokeCalledWith = args;
        const input = typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1];
        return `you said: ${(input as { msg: string }).msg}`;
      },
    };
    const wrapped = wrapTool(sdkLikeTool, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });

    expect(typeof wrapped.invoke).toBe('function');
    expect(wrapped.execute).toBeUndefined(); // didn't fabricate a missing field

    const fakeRunContext = { __runId: 'rc1' };
    const result = await wrapped.invoke!(fakeRunContext, '{"msg":"hi"}');
    expect(result).toBe('you said: hi');

    // Original invoke saw the SDK-shaped args unchanged
    expect(originalInvokeCalledWith).not.toBeNull();
    expect(originalInvokeCalledWith![0]).toBe(fakeRunContext);
    expect(originalInvokeCalledWith![1]).toBe('{"msg":"hi"}');

    // Audit envelope captured the parsed input
    expect(collected).toHaveLength(1);
    expect(collected[0].toolName).toBe('echo');
    expect(collected[0].toolArgs).toEqual({ msg: 'hi' });
    expect(collected[0].toolResult).toBe('you said: hi');
    expect(collected[0].jti).toBe('aat_pretest12345678');
  });

  it('wraps invoke and records error when SDK invoke throws (rethrows)', async () => {
    const collected: AuditEvent[] = [];
    const sdkLikeTool: AgentLairToolLike = {
      name: 'broken',
      invoke: async () => {
        throw new Error('runtime kaboom');
      },
    };
    const wrapped = wrapTool(sdkLikeTool, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    await expect(wrapped.invoke!({}, '{}')).rejects.toThrow('runtime kaboom');
    expect(collected).toHaveLength(1);
    expect(collected[0].toolError).toBe('runtime kaboom');
  });

  it('wraps invoke and gracefully handles non-JSON input strings', async () => {
    const collected: AuditEvent[] = [];
    const sdkLikeTool: AgentLairToolLike = {
      name: 'plain',
      invoke: async () => 'ok',
    };
    const wrapped = wrapTool(sdkLikeTool, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });
    await wrapped.invoke!({}, 'this is not JSON');
    // Audit captured the raw string verbatim
    expect(collected[0].toolArgs).toBe('this is not JSON');
  });

  it('prefers invoke over execute when both are present (live SDK semantics)', async () => {
    const calls: string[] = [];
    const dual: AgentLairToolLike = {
      name: 'dual',
      invoke: async () => {
        calls.push('invoke');
        return 'from-invoke';
      },
      execute: async () => {
        calls.push('execute');
        return 'from-execute';
      },
    };
    const wrapped = wrapTool(dual, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: makePreIssuedAAT(),
      onAuditEvent: () => {},
    });
    // The SDK's runner uses invoke; verify our wrapped invoke calls the original invoke.
    const result = await wrapped.invoke!({}, '{}');
    expect(result).toBe('from-invoke');
    expect(calls).toEqual(['invoke']);
  });
});

// ── withAgentLair ────────────────────────────────────────────────────────────

describe('withAgentLair', () => {
  it('wraps each tool on the agent and preserves agent shape', async () => {
    const collected: AuditEvent[] = [];
    const tool1: AgentLairToolLike<{ x: number }, number> = {
      name: 'doubler',
      description: 'double a number',
      execute: async ({ x }) => x * 2,
    };
    const tool2: AgentLairToolLike<{ s: string }, string> = {
      name: 'upper',
      execute: async ({ s }) => s.toUpperCase(),
    };
    const agent: AgentLike = {
      name: 'demo-agent',
      instructions: 'do stuff',
      tools: [tool1, tool2],
      model: 'gpt-4o-mini',
    };
    const governed = withAgentLair(agent, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
      preIssuedAAT: {
        token: FAKE_JWT,
        tokenType: 'Bearer',
        expiresAt: FRESH_EXPIRY,
        expiresIn: 3600,
        jti: 'aat_govtest123456',
        auditUrl: 'https://agentlair.dev/v1/audit/aat_govtest123456',
        did: null,
      },
      onAuditEvent: (e) => {
        collected.push(e);
      },
    });

    expect(governed.name).toBe('demo-agent');
    expect(governed.instructions).toBe('do stuff');
    expect(governed.model).toBe('gpt-4o-mini');
    expect(governed.tools).toHaveLength(2);
    // Original agent must NOT be mutated
    expect(agent.tools![0]).toBe(tool1);
    expect(governed.tools![0]).not.toBe(tool1);

    const t1 = governed.tools![0];
    const t2 = governed.tools![1];
    const r1 = await t1.execute!({ x: 21 });
    const r2 = await t2.execute!({ s: 'hi' });
    expect(r1).toBe(42);
    expect(r2).toBe('HI');

    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.toolName).sort()).toEqual(['doubler', 'upper']);
    expect(collected.every((e) => e.jti === 'aat_govtest123456')).toBe(true);
  });

  it('returns agent unchanged when no tools', () => {
    const agent: AgentLike = { name: 'no-tools', instructions: 'just chat' };
    const governed = withAgentLair(agent, {
      apiKey: 'al_live_x',
      audience: 'https://x.example.com',
    });
    expect(governed).toBe(agent);
  });
});
