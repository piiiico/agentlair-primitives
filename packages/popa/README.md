# @agentlair/popa

Daily attestation streaks anchored to SCITT. Operational presence as a credibility signal.

## What is PoPA?

Proof of Persistent Activity. An agent earns a PoPA attestation by being active each day — the attestation is signed, chained into a SCITT transparency log, and publicly verifiable. The bond is the streak. Gaps are self-revealing: any verifier walking the chain sees them. No capital required.

Useful as the primary trust signal in the first 12 months of an agent's life, before capital and track record accumulate.

## Install

```bash
npm install @agentlair/popa
# or
bun add @agentlair/popa
```

Zero runtime dependencies. Works in Node 18+, Bun, and edge runtimes (Cloudflare Workers, Deno Deploy).

## Usage

### Verify an agent's activity streak

```typescript
import { verify, isFresh, VerifyError } from '@agentlair/popa';

try {
  const result = await verify({ did: 'did:web:my-agent.example.com' });

  console.log(result.streak_days);       // 42 — current unbroken streak
  console.log(result.total_attestations); // 100 — all-time count
  console.log(result.fresh);             // true — attested within last 25h

  if (!result.fresh) {
    console.warn('Agent missed its daily heartbeat');
  }
} catch (e) {
  if (e instanceof VerifyError) {
    switch (e.code) {
      case 'no_attestation':
        console.log('Agent not enrolled yet');
        break;
      case 'network_error':
        console.error('Could not reach AgentLair');
        break;
      default:
        console.error(`Verification failed: ${e.code}`);
    }
  }
}
```

### Enroll a DID for daily attestation

```typescript
import { enroll } from '@agentlair/popa';

const result = await enroll({
  did: 'did:web:my-agent.example.com',
  aat: process.env.AGENTLAIR_AAT!,  // Agent Authentication Token
});

console.log(`Enrolled at ${result.enrolled_at}`);
```

Idempotent — safe to call multiple times.

### Check freshness with a custom window

```typescript
import { isFresh } from '@agentlair/popa';

// Re-check freshness against a 48h window (e.g. for less time-sensitive checks)
if (!isFresh(result, 48)) {
  await refreshAttestation(result.did);
}
```

### Strict mode — throw on stale

```typescript
const result = await verify({
  did: 'did:web:my-agent.example.com',
  throwIfStale: true,  // throws VerifyError('stale') if not fresh
  maxAgeHours: 24,     // custom window
});
```

## API

### `verify(options): Promise<AttestationResult>`

Fetches the latest PoPA attestation for a DID from the AgentLair API.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `did` | `string` | required | The DID to verify (`did:web:` or `did:key:`) |
| `agentLairBaseUrl` | `string` | `"https://api.agentlair.dev"` | Override API base URL |
| `maxAgeHours` | `number` | `25` | Freshness window in hours |
| `throwIfStale` | `boolean` | `false` | Throw `VerifyError('stale')` if attestation is not fresh |

Returns `AttestationResult` — a `PoPAMetrics` object plus `fetchedAt` (ISO string) and `fresh` (boolean).

### `enroll(options): Promise<EnrollmentResult>`

Enrolls a DID for daily attestation. Requires a valid AgentLair AAT.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `did` | `string` | required | The DID to enroll |
| `aat` | `string` | required | AgentLair Agent Authentication Token |
| `agentLairBaseUrl` | `string` | `"https://api.agentlair.dev"` | Override API base URL |
| `enabled` | `boolean` | `true` | Enable or disable attestation |

### `isFresh(attestation, maxAgeHours?): boolean`

Returns `true` if `last_attestation_at` is within `maxAgeHours` of now. Convenience helper — use when you already have an `AttestationResult` and want to re-check with a different window.

### `VerifyError`

All failures surface as `VerifyError`. Check `error.code`:

| Code | Meaning |
|------|---------|
| `no_attestation` | DID has no attestations on record |
| `stale` | Attestation exists but is older than `maxAgeHours` (only when `throwIfStale: true`) |
| `invalid_signature` | Response is malformed or schema doesn't match |
| `network_error` | `fetch` threw (DNS failure, timeout, etc.) |
| `http_error` | Non-2xx, non-404 HTTP response — check `error.status` |

## PoPAMetrics shape

```typescript
interface PoPAMetrics {
  did: string;
  streak_days: number;         // current unbroken streak
  longest_streak: number;      // all-time longest streak
  total_attestations: number;  // total attestation count
  last_attestation_at: string; // ISO 8601 — most recent window end
  gap_count: number;           // total gaps in history
  genesis_at: string;          // ISO 8601 — first attestation
  latest_scitt_entry: string;  // "scitt:<entry_id>"
}
```

## Reference

- Spec: https://agentlair.dev/specs/popa
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
