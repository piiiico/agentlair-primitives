"""agentlair_bcc — reserved namespace stub.

BCC (Bonded Credibility Credential). v1 ships when the JSON-LD context at https://agentlair.dev/contexts/bcc/v1.jsonld is published and the verifier API at /v1/bcc/{credential_id} is live.
Spec: https://agentlair.dev/specs/bcc
"""

VERSION = "0.0.1"
STATUS = "reserved"
PRIMITIVE = "BCC"
EXPANSION = "Bonded Credibility Credential"
SPEC_URL = "https://agentlair.dev/specs/bcc"

__version__ = VERSION
__all__ = ["VERSION", "STATUS", "PRIMITIVE", "EXPANSION", "SPEC_URL"]
