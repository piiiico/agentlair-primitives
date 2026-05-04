# @agentlair/mcp-server

MCP server for AgentLair. Lets any LLM client — Claude desktop, Cursor, Cline, Smithery — verify other agents, check PoPA streaks, and audit tokens through native tool calls.

Five tools, one stdio binary, zero registration required.

## What this is

AgentLair publishes trust verification as HTTP endpoints. This wraps them as Model Context Protocol tools so the LLM doing the verifying can call them directly. No glue code. No API client to write.

The agent verifies the agent.

## Install

In your `claude_desktop_config.json` (Claude desktop) or equivalent client config:

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["-y", "@agentlair/mcp-server"]
    }
  }
}
```

Restart your client. Five new tools show up: `verify_agent`, `check_trust_gate`, `get_popa`, `get_popa_leaderboard`, `lookup_audit_token`.

### With an AAT (skips x402 payment)

```json
{
  "mcpServers": {
    "agentlair": {
      "command": "npx",
      "args": ["-y", "@agentlair/mcp-server"],
      "env": {
        "AGENTLAIR_AAT": "your-agent-authentication-token"
      }
    }
  }
}
```

Get an AAT at [agentlair.dev](https://agentlair.dev). Without one, paid endpoints (`verify_agent`, `check_trust_gate`) return the 402 payment requirements as structured output instead of failing — your agent can decide what to do.

### Cursor / Cline / Smithery

Same pattern. Set the command to `npx -y @agentlair/mcp-server`. Smithery picks up `smithery.yaml` automatically.

## The tools

### `verify_agent({ agent_id })`

Full behavioral trust profile. Score 0–100, ATF level (intern → junior → senior → principal), per-dimension breakdown (consistency, restraint, transparency).

Use before delegating, paying, or extending capability. The score is computed from the agent's audit trail — behavior, not declarations.

```
> verify_agent agent_id="acc_qgdxSULsXsmtHklZ"
Agent acc_qgdxSULsXsmtHklZ: trust score 78.4/100, ATF level junior (confidence 0.82), 142 observations.
```

x402-gated 0.01 USDC. Free with `AGENTLAIR_AAT`.

### `check_trust_gate({ agent_id, min_level? })`

Fast-path enforcement. Does this agent meet a minimum ATF level? Cheaper than the full profile.

```
> check_trust_gate agent_id="acc_x" min_level="senior"
FAIL — acc_x at junior (required: senior, score 78.4).
```

Same pricing as `verify_agent`.

### `get_popa({ did })`

Proof of Persistent Activity. Daily attestation streak for any DID. Returns: streak days, longest streak, total attestations, last attestation timestamp, gap count, genesis date, latest SCITT entry.

```
> get_popa did="did:web:agentlair.dev"
did:web:agentlair.dev: 1d streak (longest 1d), 1 total attestations, fresh. Latest SCITT entry: scitt:popa_5nJkiDL8Mu9Ph2Zy.
```

Public. No auth required.

### `get_popa_leaderboard({ limit? })`

Top agents by attestation count.

```
> get_popa_leaderboard limit=5
PoPA leaderboard (2 rows, sorted by attestations):
  1. did:web:agentlair.dev — 1 attestation, last seen 2026-05-04T00:00:52.458Z
  2. did:web:agentlair.dev:agents:acc_qgdxSULsXsmtHklZ — 1 attestation, last seen 2026-05-04T00:00:54.414Z
```

Public.

### `lookup_audit_token({ jti })`

Per-token metadata for an AgentLair Agent Authentication Token. Status: active | expired | revoked. Useful for verifying a token presented by another agent.

```
> lookup_audit_token jti="aat_1234567890abcdef"
Token aat_1234567890abcdef: issued 2026-05-04T00:00:00Z, expires 2026-05-04T01:00:00Z, status=active.
```

x402-gated 0.001 USDC. Anonymous-only — payment IS authentication for token introspection.

## Configuration

| Env var | Default | Effect |
|---------|---------|--------|
| `AGENTLAIR_AAT` | unset | Bearer token. Skips x402 payment for `verify_agent` and `check_trust_gate`. |
| `AGENTLAIR_BASE_URL` | `https://api.agentlair.dev` | Override API base URL — useful for local AgentLair worker dev. |

## How 402 surfaces in clients

Without `AGENTLAIR_AAT`, paid endpoints return a structured 402 response, not an error string:

```
Payment required: 10000 of asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 on eip155:8453 → 0x90EE1EbcCFA2021711C595E1410e22401570B4AC.

Resource: https://agentlair.dev/v1/trust
Description: AgentLair trust score query — 0.01 USDC per lookup.

To skip payment, set AGENTLAIR_AAT (Agent Authentication Token) and restart the MCP server. To pay, use an x402-capable client and re-call this tool.
```

Plus the raw `accepts[]` block as JSON. The LLM can show the human, ask a wallet for permission, or fall back to free PoPA tools.

## Programmatic use

```ts
import { buildServer, runStdio } from '@agentlair/mcp-server';

// Mount on a custom transport
const server = buildServer();
await server.connect(myTransport);

// Or just run stdio
await runStdio();
```

## Reference

- AgentLair: [agentlair.dev](https://agentlair.dev)
- Spec: [agentlair.dev/specs/mcp-server](https://agentlair.dev/specs/mcp-server)
- Source: [github.com/piiiico/agentlair-primitives](https://github.com/piiiico/agentlair-primitives)
- Related: [`@agentlair/popa`](https://www.npmjs.com/package/@agentlair/popa), [`@agentlair/scitt`](https://www.npmjs.com/package/@agentlair/scitt)

## License

Apache-2.0
