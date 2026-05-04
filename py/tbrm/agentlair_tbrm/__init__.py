"""agentlair_tbrm — reserved namespace stub.

TBRM (Tracked Brier Reputation Metric). v1 ships when the BCC v1 schema is published and the verifier API at /v1/bptr/oracle/<did> exposes external Brier reads.
Spec: https://agentlair.dev/specs/tbrm
"""

VERSION = "0.0.1"
STATUS = "reserved"
PRIMITIVE = "TBRM"
EXPANSION = "Tracked Brier Reputation Metric"
SPEC_URL = "https://agentlair.dev/specs/tbrm"

__version__ = VERSION
__all__ = ["VERSION", "STATUS", "PRIMITIVE", "EXPANSION", "SPEC_URL"]
