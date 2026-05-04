# @agentlair/cbp

Slashable capital posted to a smart contract. Active enforcement, on-chain oracle.

This is a placeholder package reserving the npm namespace `@agentlair/cbp`. v0.0.1 contains a marker module only. v1 with the actual primitive ships when the bond contract is audited and deployed on Base mainnet, and the verifier API at /v1/cbp/oracle/<address> is live.

## What is CBP?

Capital Bond Pool.

CBP instantiates the BCC-Capital (active) profile. ETH or USDC is locked in a bond contract for a defined term; predicate violation triggers automatic slashing. The slashing oracle is the contract itself, queryable at /v1/cbp/oracle/<address>. BTC holdings as capital (the BCC-Capital-Holdings sub-profile) live in @agentlair/bcc, not here. CBP is the active variant. Useful when the bond protects against a specific predicate, not generic existence.

## Why this stub exists

The five AgentLair primitives (PoPA, CBP, SCITT, TBRM, BCC) map 1:1 to the BCC schema v1 stake mediums and supporting infrastructure. Squatting these names later costs DMCA cycles; reserving them now costs a publish. See the BCC schema (https://agentlair.dev/specs/bcc) for how the five fit together.

## Roadmap

```ts
import { VERSION, STATUS, PRIMITIVE, SPEC_URL } from "@agentlair/cbp";
// VERSION === "0.0.1"
// STATUS === "reserved"
// PRIMITIVE === "CBP"
```

When v1 lands, this package will ship the typed schema, a verifier client, and helper functions for issuing and consuming CBP credentials against the AgentLair API.

## Reference

- Spec: https://agentlair.dev/specs/cbp
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
