// @agentlair/bcc — reserved namespace stub.
// BCC (Bonded Credibility Credential). v1 with the actual primitive ships when the JSON-LD context at https://agentlair.dev/contexts/bcc/v1.jsonld is published and the verifier API at /v1/bcc/{credential_id} is live.
// Spec: https://agentlair.dev/specs/bcc

export const VERSION = "0.0.1";
export const STATUS = "reserved" as const;
export const PRIMITIVE = "BCC" as const;
export const EXPANSION = "Bonded Credibility Credential" as const;
export const SPEC_URL = "https://agentlair.dev/specs/bcc" as const;
