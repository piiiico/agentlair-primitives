# @agentlair/openai-agents Changelog

## v0.1.2 (2026-05-06)

**fix:** `recordAuditEvent` now calls the real behavioral event ingestion endpoint.

Previously called `POST /v1/audit/ingest` which does not exist in the AgentLair worker.
The auth gate returned 401 → `r.ok` was false → audit recording silently failed for all
SDK users with no error visible to the integrator.

Real endpoint: `POST /v1/events` (RFC-003 Phase 2a behavioral event ingestion).

The `AuditEvent` envelope is now translated to the `EventSubmission` schema expected by
`/v1/events`: each call emits a single `BehavioralEvent` with `category: 'tool'`,
`action: toolName`, `result: 'success'|'failure'`, `duration_ms`, and optional
`metadata` carrying `agent_name`, `audience`, and `aat_jti` from the audit envelope.

## v0.1.1 (2026-05-06)

Initial release — AgentLair adapter for the OpenAI Agents SDK. Issues per-agent AATs,
attaches Bearer tokens to tool calls, emits audit envelopes per invocation.
