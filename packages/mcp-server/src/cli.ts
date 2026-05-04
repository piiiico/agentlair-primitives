#!/usr/bin/env node
/**
 * @agentlair/mcp-server — stdio entry point.
 *
 * Wired into package.json `bin` so `npx @agentlair/mcp-server` Just Works
 * for Claude desktop config. No flags. Configuration is via env:
 *   AGENTLAIR_AAT       — Bearer token, optional
 *   AGENTLAIR_BASE_URL  — override API base, default https://api.agentlair.dev
 */

import { runStdio } from './index.js';

runStdio().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
