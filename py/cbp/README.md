# agentlair-cbp

Slashable capital posted to a smart contract. Active enforcement, on-chain oracle.

Placeholder package reserving the PyPI namespace `agentlair-cbp`. v0.0.1 contains a marker module only. v1 ships when the bond contract is audited and deployed on Base mainnet, and the verifier API at /v1/cbp/oracle/<address> is live.

## What is CBP?

Capital Bond Pool.

CBP instantiates the BCC-Capital (active) profile. ETH or USDC is locked in a bond contract for a defined term; predicate violation triggers automatic slashing. The slashing oracle is the contract itself, queryable at /v1/cbp/oracle/<address>. BTC holdings as capital (the BCC-Capital-Holdings sub-profile) live in @agentlair/bcc, not here. CBP is the active variant. Useful when the bond protects against a specific predicate, not generic existence.

## Roadmap

```python
from agentlair_cbp import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "CBP"
```

## Reference

- Spec: https://agentlair.dev/specs/cbp
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
