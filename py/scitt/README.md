# agentlair-scitt

Append-only transparency log for agent-signed statements. RFC 9711-aligned.

Placeholder package reserving the PyPI namespace `agentlair-scitt`. v0.0.1 contains a marker module only. v1 ships when the AAT-as-EAT-issuer profile is published and the SCITT receipt verifier is extracted from agentlair-worker.

## What is SCITT?

Supply Chain Integrity, Transparency, and Trust.

SCITT is the substrate every other BCC primitive anchors into. Agent-issued Signed Statements (AAT-EdDSA) are submitted as COSE_Sign1 to /v1/scitt/entries; receipts are cryptographically verifiable against the issuer DID. PoPA streaks, BCC bindings, behavioral attestations, and credential revocations all flow through this log. AgentLair's SCITT integration follows the IETF SCITT architecture (RFC 9711) and exposes its receipts publicly. This package will host the verifier client and a typed Signed-Statement builder.

## Roadmap

```python
from agentlair_scitt import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "SCITT"
```

## Reference

- Spec: https://agentlair.dev/specs/scitt
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
