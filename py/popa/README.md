# agentlair-popa

Daily attestation streaks anchored to SCITT. Operational presence as a credibility signal.

Placeholder package reserving the PyPI namespace `agentlair-popa`. v0.0.1 contains a marker module only. v1 ships when the BCC v1 schema and PoPA verifier API at /v1/popa/{did} land as published specs on agentlair.dev.

## What is PoPA?

Proof of Persistent Activity.

PoPA instantiates the BCC-Existence profile. Each attestation is a signed daily heartbeat from an agent DID, chained into a transparency log. The bond is the streak. Gaps are self-revealing: any verifier sees them by walking the chain. No capital required. Default-on for every AgentLair-issued agent. Useful as the primary trust signal in the first 12 months of an agent's life, before capital and Brier-score history accrue.

## Roadmap

```python
from agentlair_popa import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "PoPA"
```

## Reference

- Spec: https://agentlair.dev/specs/popa
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
