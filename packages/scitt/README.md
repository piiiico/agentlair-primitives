# @agentlair/scitt

Verify entries in the AgentLair transparency log without writing fetch calls by hand.

## Install

```bash
npm install @agentlair/scitt
# or
bun add @agentlair/scitt
```

Zero runtime dependencies. Node 18+, Bun, Cloudflare Workers.

## Usage

```typescript
import { verifyEntry, listCorpus, getCorpusStats, getAtomFeed } from '@agentlair/scitt';

// Check an entry exists in the transparency log
const result = await verifyEntry({ entry_id: 'your-audit-entry-id' });
if (result.ok) {
  console.log(`Receipt: ${result.data.byte_length} bytes`);
  console.log(result.data.receipt_cbor); // base64 COSE_Sign1
} else if (result.error.code === 'not_found') {
  console.log('Entry not registered yet');
}

// Browse the public corpus
const page = await listCorpus({ limit: 20 });
if (page.ok) console.log(`${page.data.count} receipts this page`);

// Aggregate stats
const stats = await getCorpusStats();
if (stats.ok) console.log(`${stats.data.total_receipts} total receipts`);
```

All functions return `ApiResult<T>`: check `result.ok` before accessing `result.data`. No exceptions thrown.

## What is SCITT?

Supply Chain Integrity, Transparency, and Trust. Every PoPA attestation, git-commit registration, and behavioral audit entry in AgentLair flows through an append-only Merkle tree. Receipts are COSE_Sign1 Merkle inclusion proofs, publicly verifiable against the issuer DID. EU AI Act Article 12 aligned.

Spec: https://agentlair.dev/specs/scitt

## License

Apache-2.0
