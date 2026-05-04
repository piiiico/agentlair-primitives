# agentlair-bcc

Umbrella W3C VC 2.0 schema covering the three irreducible stake mediums.

Placeholder package reserving the PyPI namespace `agentlair-bcc`. v0.0.1 contains a marker module only. v1 ships when the JSON-LD context at https://agentlair.dev/contexts/bcc/v1.jsonld is published and the verifier API at /v1/bcc/{credential_id} is live.

## What is BCC?

Bonded Credibility Credential.

BCC is the abstract schema that PoPA, CBP, and TBRM instantiate. Three stake mediums (capital, claims, existence) cover the irreducible costly-to-fake commitments an agent can make. The credential carries bcc_profile, stake_amount, stake_unit, commitment_window, slashing_oracle_uri, and an evidence_anchor pointing into SCITT or an on-chain transaction. The BCC-Capital profile has two sub-types: active (CBP, smart-contract slashing) and holdings (BTC at a P2TR address, self-revealing semantics). Verifiers compose the three signals; conflating them under one stake medium loses per-medium enforcement.

## Roadmap

```python
from agentlair_bcc import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "BCC"
```

## Reference

- Spec: https://agentlair.dev/specs/bcc
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
