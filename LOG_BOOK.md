## Fix fuzzer run loop exiting immediately | 2026-02-28
Resolved a stale-state bug that caused the fuzzer run loop to exit before sending any requests by extracting and reusing deterministic run logic that iterates every wordlist entry. Added regression coverage and validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/FuzzerLayout.tsx
  - src-web/components/fuzzer/runFuzzer.ts
  - src-web/components/fuzzer/runFuzzer.test.ts
  - src-web/components/FuzzerLayout.test.tsx
## Fix fuzzer SQL foreign key error during environment resolution | 2026-02-28
Fixed fuzzer request execution to always run in the active workspace context, preventing environment-resolution FK failures caused by stale `workspaceId` values from draft/imported requests. Added regression coverage to verify workspace override behavior and validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/FuzzerLayout.tsx
  - src-web/components/fuzzer/runFuzzer.ts
  - src-web/components/fuzzer/runFuzzer.test.ts

## Add clickable fuzzer results with request/response detail pane | 2026-02-28
Implemented interactive fuzzer results so selecting a row (mouse or arrow keys) shows the rendered request and corresponding response headers/body in a pane below the table, with a close/show control to collapse details when focusing on bulk results. Added snapshot persistence in fuzzer run results and validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/FuzzerLayout.tsx
  - src-web/components/fuzzer/runFuzzer.ts
  - src-web/components/fuzzer/runFuzzer.test.ts

## Improve fuzzer results table readability and session controls | 2026-03-01
Added stronger selected-row highlighting, a numeric incremental ID column, and syntax-highlighted request/response detail sections (start line, headers, body) to improve result inspection. Added a New Request action to reset the fuzzer session state (request + results + markers/wordlist) and validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/FuzzerLayout.tsx
## Fuzzer settings pane: request rate and wordlist encoder | 2026-03-10
Added a Settings section below the wordlist in the fuzzer right pane with two configurable options: Max req/s (rate limiting between requests) and Encoder (URL, Base64, UTF-8, HTML, or None applied to each wordlist word before marker substitution). Settings persist per-request in KV storage and are snapshotted with each run for historical review. Validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` (11/11 passed) and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/fuzzer/FuzzerTab.tsx
  - src-web/components/fuzzer/runFuzzer.ts
  - src-web/components/fuzzer/runFuzzer.test.ts

## Fuzzer run loop request-scoped sessions | 2026-03-02
Moved Fuzzer mode state to be scoped by request id instead of existing globally. Handled fuzzer "Parse from cURL" and "New Request" to create new requests correctly instead of clobbering existing fuzzer runs. Setup cleanup to ensure orphaned state is removed when requests are deleted. Regression testing complete via `runFuzzer.test.ts`.
  - src-web/components/FuzzerLayout.tsx
  - src-web/components/Workspace.tsx
  - src-web/lib/createRequestAndNavigate.tsx
