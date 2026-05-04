# @agentlair/scitt

Append-only transparency log for agent-signed statements. RFC 9711-aligned.

This is a placeholder package reserving the npm namespace `@agentlair/scitt`. v0.0.1 contains a marker module only. v1 with the actual primitive ships when the AAT-as-EAT-issuer profile is published and the SCITT receipt verifier is extracted from agentlair-worker.

## What is SCITT?

Supply Chain Integrity, Transparency, and Trust.

SCITT is the substrate every other BCC primitive anchors into. Agent-issued Signed Statements (AAT-EdDSA) are submitted as COSE_Sign1 to /v1/scitt/entries; receipts are cryptographically verifiable against the issuer DID. PoPA streaks, BCC bindings, behavioral attestations, and credential revocations all flow through this log. AgentLair's SCITT integration follows the IETF SCITT architecture (RFC 9711) and exposes its receipts publicly. This package will host the verifier client and a typed Signed-Statement builder.

## Why this stub exists

The five AgentLair primitives (PoPA, CBP, SCITT, TBRM, BCC) map 1:1 to the BCC schema v1 stake mediums and supporting infrastructure. Squatting these names later costs DMCA cycles; reserving them now costs a publish. See the BCC schema (https://agentlair.dev/specs/bcc) for how the five fit together.

## Roadmap

```ts
import { VERSION, STATUS, PRIMITIVE, SPEC_URL } from "@agentlair/scitt";
// VERSION === "0.0.1"
// STATUS === "reserved"
// PRIMITIVE === "SCITT"
```

When v1 lands, this package will ship the typed schema, a verifier client, and helper functions for issuing and consuming SCITT credentials against the AgentLair API.

## Reference

- Spec: https://agentlair.dev/specs/scitt
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
