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
