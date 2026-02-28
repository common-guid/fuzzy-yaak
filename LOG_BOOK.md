## Fix fuzzer run loop exiting immediately | 2026-02-28
Resolved a stale-state bug that caused the fuzzer run loop to exit before sending any requests by extracting and reusing deterministic run logic that iterates every wordlist entry. Added regression coverage and validated with `npx vitest run src-web/components/fuzzer/runFuzzer.test.ts` and `npm --workspace @yaakapp/app run lint`.
  - src-web/components/FuzzerLayout.tsx
  - src-web/components/fuzzer/runFuzzer.ts
  - src-web/components/fuzzer/runFuzzer.test.ts
  - src-web/components/FuzzerLayout.test.tsx