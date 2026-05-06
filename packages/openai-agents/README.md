# @agentlair/openai-agents

AgentLair adapter for the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js). Issue an Agent Authentication Token (AAT) per agent run, attach it to outbound tool calls, and emit a signed audit envelope per invocation — without changing how you write agents.

## Install

```bash
npm install @agentlair/openai-agents @openai/agents
# or
bun add @agentlair/openai-agents @openai/agents
```

`@openai/agents` is a (optional) peer dependency. Zero runtime dependencies otherwise. Works in Node 18+, Bun, and edge runtimes (Cloudflare Workers, Deno Deploy).

Get a free AgentLair API key at [agentlair.dev](https://agentlair.dev) — no card required.

## Usage

```ts
import { Agent, run, tool } from '@openai/agents';
import { withAgentLair } from '@agentlair/openai-agents';
import { z } from 'zod';

const echo = tool({
  name: 'echo',
  description: 'Echo a string back to the caller',
  parameters: z.object({ msg: z.string() }),
  execute: async ({ msg }) => `you said: ${msg}`,
});

const myAgent = new Agent({
  name: 'demo',
  instructions: 'Echo what the user says.',
  tools: [echo],
});

// Wrap once at startup. The original agent is unchanged.
const governed = withAgentLair(myAgent, {
  apiKey: process.env.AGENTLAIR_API_KEY!,
  audience: 'https://my-mcp.example.com',
  scopes: ['mcp:tools:read'],
  agentName: 'demo',
});

const result = await run(governed, 'echo "hello"');
// On every tool call, AgentLair issued (or reused) an AAT and recorded
// an audit envelope. Inspect at https://agentlair.dev/v1/audit/<jti>.
```

That's it. No changes to your tools or `Agent` shape — `withAgentLair` returns a shallow clone with each tool's `execute` wrapped to issue an AAT and emit an audit envelope.

## What it does

1. **Issues an AAT** before each tool invocation (cached and reused until expiry by default — one issue per run, not one per tool call).
2. **Records an audit envelope** for every tool call — args, result, duration, jti, agent name, audience. Best-effort; failures never block the tool.
3. **Returns a verifiable did:web** — each AAT embeds `did:web:agentlair.dev:agents:<account_id>`, resolvable against AgentLair's JWKS.

## Lower-level API

If you want fine-grained control:

```ts
import { issueAATForAgent, recordAuditEvent, wrapTool } from '@agentlair/openai-agents';

// Issue a token by hand
const aat = await issueAATForAgent({
  apiKey: process.env.AGENTLAIR_API_KEY!,
  audience: 'https://my-mcp.example.com',
  scopes: ['mcp:tools:read', 'mcp:tools:execute'],
  ttl: 3600,
});
console.log(aat.jti);      // aat_xxxxxxxxxxxxxxxx
console.log(aat.did);      // did:web:agentlair.dev:agents:acc_...
console.log(aat.token);    // eyJhbGciOiJFZERTQSIsImtpZCI6...

// Wrap a single tool with a custom audit sink
const wrapped = wrapTool(myTool, {
  apiKey: process.env.AGENTLAIR_API_KEY!,
  audience: 'https://my-mcp.example.com',
  preIssuedAAT: aat,
  onAuditEvent: (e) => myObservabilityPipeline.send(e),
});
```

## Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `apiKey` | string | — | **Required.** `al_live_*` or `al_pod_*` from agentlair.dev. |
| `audience` | string | — | **Required.** Target service URL the AAT will be presented to. |
| `scopes` | string[] | `['mcp:tools:read']` | Each must match `^[a-z][a-z0-9._:-]*$`. |
| `ttl` | number | 3600 | Lifetime in seconds. Max 86400. |
| `agentName` | string | — | `al_name` claim in the AAT. |
| `agentEmail` | string | — | `al_email` claim in the AAT. |
| `agentLairBaseUrl` | string | `https://agentlair.dev` | Override for staging/self-host. |
| `cacheAAT` | boolean | true | Reuse the AAT across tool calls until expiry. |
| `preIssuedAAT` | AAT | — | Skip the issue call entirely. Useful in tests. |
| `onAuditEvent` | function | best-effort POST | Custom audit sink. Failures never block the tool. |
| `fetchImpl` | typeof fetch | global `fetch` | For testing or edge runtimes. |

## Verification

Audit envelopes are signed with AgentLair's Ed25519 audit key. To verify a token or audit entry independently:

```bash
# Token — verify against JWKS
curl https://agentlair.dev/.well-known/jwks.json

# Per-token metadata
curl https://agentlair.dev/v1/audit/<jti>
```

## Errors

`issueAATForAgent` throws `AgentLairError` with a typed `code`:

| Code | Meaning |
| --- | --- |
| `invalid_options` | apiKey or audience missing/malformed |
| `network_error` | fetch threw (DNS, timeout, etc.) |
| `http_error` | non-2xx response from `/v1/tokens/issue` (check `.status`) |
| `invalid_response` | unparseable JSON or unexpected shape |

Tool wrapping (`wrapTool`, `withAgentLair`) never throws on AgentLair-side failures — the original tool error (if any) is rethrown unchanged.

## Reference

- AgentLair: <https://agentlair.dev>
- OpenAI Agents SDK (TypeScript): <https://github.com/openai/openai-agents-js>
- Source: <https://github.com/piiiico/agentlair-primitives>

## License

Apache-2.0
