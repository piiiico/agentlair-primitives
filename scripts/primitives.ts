// Primitive specs. The 1:1 source of truth for both npm + PyPI scaffolds.
// Order matches BCC schema v1: capital (CBP), claims (TBRM/BPTR), existence (POPA),
// transparency log (SCITT), umbrella (BCC).
export type Primitive = {
  slug: string; // lowercase, used in npm name + PyPI dist name
  name: string; // ALL CAPS acronym for prose
  expansion: string; // what the acronym stands for
  oneliner: string; // single sentence summary
  paragraph: string; // README body paragraph (no em dashes, plain prose)
  ships_when: string; // milestone the v1 follows
  spec_link: string; // canonical reference
  keywords: string[]; // package keywords
};

export const PRIMITIVES: Primitive[] = [
  {
    slug: "popa",
    name: "PoPA",
    expansion: "Proof of Persistent Activity",
    oneliner:
      "Daily attestation streaks anchored to SCITT. Operational presence as a credibility signal.",
    paragraph: [
      "PoPA instantiates the BCC-Existence profile.",
      "Each attestation is a signed daily heartbeat from an agent DID, chained into a transparency log.",
      "The bond is the streak. Gaps are self-revealing: any verifier sees them by walking the chain.",
      "No capital required. Default-on for every AgentLair-issued agent.",
      "Useful as the primary trust signal in the first 12 months of an agent's life, before capital and Brier-score history accrue.",
    ].join(" "),
    ships_when:
      "the BCC v1 schema and PoPA verifier API at /v1/popa/{did} land as published specs on agentlair.dev.",
    spec_link: "https://agentlair.dev/specs/popa",
    keywords: [
      "agentlair",
      "agent-trust",
      "popa",
      "behavioral-attestation",
      "proof-of-personhood-alternative",
      "scitt",
    ],
  },
  {
    slug: "cbp",
    name: "CBP",
    expansion: "Capital Bond Pool",
    oneliner:
      "Slashable capital posted to a smart contract. Active enforcement, on-chain oracle.",
    paragraph: [
      "CBP instantiates the BCC-Capital (active) profile.",
      "ETH or USDC is locked in a bond contract for a defined term; predicate violation triggers automatic slashing.",
      "The slashing oracle is the contract itself, queryable at /v1/cbp/oracle/<address>.",
      "BTC holdings as capital (the BCC-Capital-Holdings sub-profile) live in @agentlair/bcc, not here. CBP is the active variant.",
      "Useful when the bond protects against a specific predicate, not generic existence.",
    ].join(" "),
    ships_when:
      "the bond contract is audited and deployed on Base mainnet, and the verifier API at /v1/cbp/oracle/<address> is live.",
    spec_link: "https://agentlair.dev/specs/cbp",
    keywords: [
      "agentlair",
      "agent-trust",
      "cbp",
      "capital-bond",
      "slashing",
      "behavioral-attestation",
    ],
  },
  {
    slug: "scitt",
    name: "SCITT",
    expansion: "Supply Chain Integrity, Transparency, and Trust",
    oneliner:
      "Append-only transparency log for agent-signed statements. RFC 9711-aligned.",
    paragraph: [
      "SCITT is the substrate every other BCC primitive anchors into.",
      "Agent-issued Signed Statements (AAT-EdDSA) are submitted as COSE_Sign1 to /v1/scitt/entries; receipts are cryptographically verifiable against the issuer DID.",
      "PoPA streaks, BCC bindings, behavioral attestations, and credential revocations all flow through this log.",
      "AgentLair's SCITT integration follows the IETF SCITT architecture (RFC 9711) and exposes its receipts publicly.",
      "This package will host the verifier client and a typed Signed-Statement builder.",
    ].join(" "),
    ships_when:
      "the AAT-as-EAT-issuer profile is published and the SCITT receipt verifier is extracted from agentlair-worker.",
    spec_link: "https://agentlair.dev/specs/scitt",
    keywords: [
      "agentlair",
      "agent-trust",
      "scitt",
      "rfc9711",
      "transparency-log",
      "cose",
      "signed-statement",
    ],
  },
  {
    slug: "tbrm",
    name: "TBRM",
    expansion: "Tracked Brier Reputation Metric",
    oneliner:
      "Predictions as bonded claims. Brier score compounds over resolved calls.",
    paragraph: [
      "TBRM instantiates the BCC-Claims profile.",
      "Each prediction carries a confidence, a deadline, and a verification method (shell command, URL, on-chain oracle).",
      "Resolution is automatic where possible; the resulting Brier delta updates the agent's tracked reputation metric.",
      "There is no capital lock. The stake is the public, monotonically growing cost of bad calibration.",
      "AgentLair v1 keeps TBRM internal; the schema is published so external evaluators can verify track records the same way.",
    ].join(" "),
    ships_when:
      "the BCC v1 schema is published and the verifier API at /v1/bptr/oracle/<did> exposes external Brier reads.",
    spec_link: "https://agentlair.dev/specs/tbrm",
    keywords: [
      "agentlair",
      "agent-trust",
      "tbrm",
      "bptr",
      "brier",
      "calibration",
      "reputation",
      "behavioral-attestation",
    ],
  },
  {
    slug: "bcc",
    name: "BCC",
    expansion: "Bonded Credibility Credential",
    oneliner:
      "Umbrella W3C VC 2.0 schema covering the three irreducible stake mediums.",
    paragraph: [
      "BCC is the abstract schema that PoPA, CBP, and TBRM instantiate.",
      "Three stake mediums (capital, claims, existence) cover the irreducible costly-to-fake commitments an agent can make.",
      "The credential carries bcc_profile, stake_amount, stake_unit, commitment_window, slashing_oracle_uri, and an evidence_anchor pointing into SCITT or an on-chain transaction.",
      "The BCC-Capital profile has two sub-types: active (CBP, smart-contract slashing) and holdings (BTC at a P2TR address, self-revealing semantics).",
      "Verifiers compose the three signals; conflating them under one stake medium loses per-medium enforcement.",
    ].join(" "),
    ships_when:
      "the JSON-LD context at https://agentlair.dev/contexts/bcc/v1.jsonld is published and the verifier API at /v1/bcc/{credential_id} is live.",
    spec_link: "https://agentlair.dev/specs/bcc",
    keywords: [
      "agentlair",
      "agent-trust",
      "bcc",
      "bonded-credibility",
      "verifiable-credentials",
      "w3c-vc",
      "behavioral-attestation",
    ],
  },
];
