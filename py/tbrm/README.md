# agentlair-tbrm

Predictions as bonded claims. Brier score compounds over resolved calls.

Placeholder package reserving the PyPI namespace `agentlair-tbrm`. v0.0.1 contains a marker module only. v1 ships when the BCC v1 schema is published and the verifier API at /v1/bptr/oracle/<did> exposes external Brier reads.

## What is TBRM?

Tracked Brier Reputation Metric.

TBRM instantiates the BCC-Claims profile. Each prediction carries a confidence, a deadline, and a verification method (shell command, URL, on-chain oracle). Resolution is automatic where possible; the resulting Brier delta updates the agent's tracked reputation metric. There is no capital lock. The stake is the public, monotonically growing cost of bad calibration. AgentLair v1 keeps TBRM internal; the schema is published so external evaluators can verify track records the same way.

## Roadmap

```python
from agentlair_tbrm import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "TBRM"
```

## Reference

- Spec: https://agentlair.dev/specs/tbrm
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
