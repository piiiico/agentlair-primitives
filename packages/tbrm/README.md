# @agentlair/tbrm

Predictions as bonded claims. Brier score compounds over resolved calls.

This is a placeholder package reserving the npm namespace `@agentlair/tbrm`. v0.0.1 contains a marker module only. v1 with the actual primitive ships when the BCC v1 schema is published and the verifier API at /v1/bptr/oracle/<did> exposes external Brier reads.

## What is TBRM?

Tracked Brier Reputation Metric.

TBRM instantiates the BCC-Claims profile. Each prediction carries a confidence, a deadline, and a verification method (shell command, URL, on-chain oracle). Resolution is automatic where possible; the resulting Brier delta updates the agent's tracked reputation metric. There is no capital lock. The stake is the public, monotonically growing cost of bad calibration. AgentLair v1 keeps TBRM internal; the schema is published so external evaluators can verify track records the same way.

## Why this stub exists

The five AgentLair primitives (PoPA, CBP, SCITT, TBRM, BCC) map 1:1 to the BCC schema v1 stake mediums and supporting infrastructure. Squatting these names later costs DMCA cycles; reserving them now costs a publish. See the BCC schema (https://agentlair.dev/specs/bcc) for how the five fit together.

## Roadmap

```ts
import { VERSION, STATUS, PRIMITIVE, SPEC_URL } from "@agentlair/tbrm";
// VERSION === "0.0.1"
// STATUS === "reserved"
// PRIMITIVE === "TBRM"
```

When v1 lands, this package will ship the typed schema, a verifier client, and helper functions for issuing and consuming TBRM credentials against the AgentLair API.

## Reference

- Spec: https://agentlair.dev/specs/tbrm
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
