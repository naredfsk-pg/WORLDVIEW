# 1 · backend · llm-provider

| Field | Value |
|---|---|
| Started | 2026-11-13 10:47:30 (Asia/Bangkok) |
| Finished | 2026-11-13 11:06:00 (Asia/Bangkok) |
| Status | done |
| Agent type | backend (Wave 1, lane "LLM & Editorial") |

## Goal

สร้าง `LLMProvider` + `ChatTransport` แบบ OpenAI-compatible ตาม ARCHITECTURE §10 (per-task routing, cross-vendor fallback, `LLM_OMIT_TEMPERATURE_FOR`, schema-repair turn หนึ่งครั้ง, retry/backoff, concurrency limit, daily caps, cache ใน `llm_calls`), task schemas + prompts แยกโมดูลละ task พร้อม `PROMPT_VERSION`, mock provider/transport, editorial gates G1–G6 แบบ pure ตาม §11, live smoke script และชุด test ที่ไม่แตะ network ทั้งหมดอยู่บน branch `feature/llm-provider`

## What I did (in order)

1. 10:47 — ตรวจ worktree ว่าอยู่บน branch `feature/llm-provider` (`git branch --show-current`) และ HEAD = `af34f9d`
2. 10:48 — อ่าน `docs/ARCHITECTURE.md` ทั้งไฟล์ (เน้น §1, §10, §11, §15, §18), `src/lib/types/{llm,editorial,domain,repositories,news}.ts`, `src/lib/server/config.ts`, repository `llm-calls.ts` และ PRD §4.3, §5, FR-02, §9
3. 10:48 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset` (รันใน background) แล้วรัน baseline `npm test` ผ่าน 107 tests
4. 10:50 — แก้ contract ใน `types/editorial.ts` แบบ minimal พร้อม `// CONTRACT-CHANGE:` สองจุด (ดูหัวข้อด้านล่าง)
5. 10:51 — เขียน `server/llm`: `transport.ts`, `routing.ts`, `cache-key.ts`, `json.ts`, `prompt.ts`, `tasks/*` (6 tasks + `shared.ts` + registry), `provider.ts`, `mock.ts`, `index.ts`
6. 10:55 — เขียน `server/editorial`: `text.ts`, `event-gate.ts`, `relation-gate.ts`, `lesson-links.ts`, `index.ts`
7. 10:56 — `npm run check` ผ่าน (0 errors) และ sanity run ด้วย `tsx` เพื่อดูว่า `z.toJSONSchema` สร้าง system prompt ได้ทุก task และ Zod normalization (tag → kebab-case, country → upper case, ISO offset → `toISOString`) ทำงานถูก
8. 10:58 — เขียน tests: `routing.test.ts`, `transport.test.ts`, `provider.test.ts`, `mock.test.ts`, `editorial/event-gate.test.ts`, `editorial/relation-gate.test.ts`, `editorial/llm-down.test.ts` + `llm/test-fixtures.ts` (ข้อมูลสมมุติทั้งหมด)
9. 11:01 — รัน tests ครั้งแรก fail 1 ข้อ (FK ของ `job_run_id`, ดู Errors) แก้แล้วผ่าน 78/78
10. 11:02 — `prettier --write` + `eslint` บนไฟล์ของ lane แล้วปรับ `if` หลายบรรทัดที่ไม่มีวงเล็บปีกกา (ผลจาก Prettier) ให้มีปีกกาเพื่อความอ่านง่าย
11. 11:03 — เขียน `scripts/llm-smoke.ts` แล้ว commit เป็น 4 commits ย่อย
12. 11:03 — รัน live smoke กับ endpoint จริง (3 requests จาก cap 6) ผ่านทุก model
13. 11:04 — รัน done criteria ครบ: `npm run lint`, `npm test` (185 tests), `npm run build`, `npm run check` ผ่านทั้งหมด
14. 11:05 — เขียน log นี้และ commit

## Files created / changed

- `src/lib/types/editorial.ts` — CONTRACT-CHANGE: `EventGateInput.llm_error_kind?` และ `RelationGateInput.confidence`
- `src/lib/server/llm/transport.ts` — `createOpenAiCompatibleTransport`, `LlmTransportError` (error classes: auth, rate_limit, server, timeout, bad_request, invalid_json, network, aborted), `chatCompletionsUrl`, `parseRetryAfter`
- `src/lib/server/llm/routing.ts` — `resolveModelRoute`, `shouldOmitTemperature`, `LlmModelSettings`
- `src/lib/server/llm/cache-key.ts` — `computeCacheKey`, `canonicalJson` (sha256 ของ canonical JSON)
- `src/lib/server/llm/json.ts` — `extractJsonObject` (strip ```json fences, outermost `{…}`)
- `src/lib/server/llm/prompt.ts` — common rules, `buildSystemPrompt`, `wrapUntrustedData` (`<data>` + escape `<data`/`</data` เป็น `\u003c`), `buildRepairMessages`, `estimateTokens`
- `src/lib/server/llm/tasks/{shared,tagging,clustering,extraction,summary,relations,academy-linking,index}.ts` — Zod schema, ref check, instructions, `PROMPT_VERSION` ต่อ task, `TASK_DEFINITIONS`, `PROMPT_VERSIONS`
- `src/lib/server/llm/provider.ts` — `createLlmProvider`, `LlmSettings`, `backoffDelay`, `bangkokDayStartUtc`
- `src/lib/server/llm/mock.ts` — `createMockLlmProvider`, `createDefaultMockHandlers`, `mockLlmError`, `createMockTransport`
- `src/lib/server/llm/index.ts` — public surface + `createLlmProviderFromConfig`
- `src/lib/server/editorial/{text,event-gate,relation-gate,lesson-links,index}.ts` — gates แบบ pure
- `src/lib/server/llm/*.test.ts`, `src/lib/server/llm/test-fixtures.ts`, `src/lib/server/editorial/*.test.ts` — tests
- `scripts/llm-smoke.ts` — live smoke script
- `docs/agent-logs/20261113-1047_1_backend_llm-provider.md` — log นี้

ไม่ได้แก้ `llm-calls.ts` repository, `package.json` หรือ lockfile (ไม่ต้องเพิ่ม dependency)

## Commands run & results

| Time | Command | Result |
|---|---|---|
| 10:47 | `git -C … branch --show-current` | `feature/llm-provider` |
| 10:48 | `npm ci` | ok (มี warning `allow-scripts` ของ better-sqlite3/esbuild แต่ native module ใช้งานได้) |
| 10:48 | `cp .env.example .env` · `npm run db:reset` | ok, seed ครบ (`llm_calls` 0 rows) |
| 10:50 | `npm test` (baseline) | 15 files, 107 tests passed |
| 10:56 | `npm run check` | 0 errors, 0 warnings |
| 10:57 | `npx tsx sanity-tmp.ts` (ไฟล์ชั่วคราว ลบแล้ว) | system prompt 1.6k–3.4k chars ต่อ task; Zod normalization ถูก |
| 11:01 | `npx vitest run src/lib/server/llm src/lib/server/editorial` | 1 failed / 77 passed (FK error) |
| 11:01 | (หลังแก้) เดิม | 7 files, 78 tests passed |
| 11:02 | `npx prettier --write …` · `npx eslint …` · `npm run check` | ok, 0 errors |
| 11:03 | `git commit` ×4 | `945ba50`, `0477213`, `7a79847`, `462fd05` |
| 11:03 | `npx tsx --env-file=C:\Project\WORLDVIEW\.env scripts/llm-smoke.ts` | 3/3 ok, schema pass ทั้งหมด (ตารางด้านล่าง) |
| 11:04 | `npm run lint` | exit 0 |
| 11:04 | `npm test` | 22 files, 185 tests passed |
| 11:05 | `npm run build` | exit 0 (warning `NO_COLOR`/`FORCE_COLOR` มาจาก environment ไม่เกี่ยวกับโค้ด) |
| 11:05 | `npm run check` | 0 errors |

## Live smoke results (ไม่มี secret)

ใช้ temp DB (`os.tmpdir()`, ลบเมื่อจบ), `maxRetries = 0`, ปิด fallback, `dailyMaxRequests = 6` เป็น hard cap ข้อมูลเป็นข่าวสมมุติภาษาอังกฤษหนึ่งย่อหน้า

| Task | Model | Result | Latency | Tokens in/out | Schema | Calls |
|---|---|---|---|---|---|---|
| summary | `cc/claude-sonnet-5-5` (LLM_MODEL_SUMMARY) | ok | 5057 ms | 347 / 710 | pass | 1 (ไม่ต้อง repair) |
| tagging | `cx/gpt-5.6-luna` (LLM_MODEL_TAGGING) | ok | 4434 ms | 702 / 170 | pass | 1 |
| tagging | `cc/claude-haiku-5-5` (exact id แรกใน LLM_OMIT_TEMPERATURE_FOR) | ok | 2612 ms | 175 / 378 | pass | 1 — ไม่ได้ HTTP 400 แปลว่าการ omit `temperature` ทำงาน |

รวม 3 network requests (cap 6)

ข้อสังเกต: `usage.prompt_tokens` ที่ endpoint รายงานสำหรับ `cc/*` ต่ำกว่าที่ประมาณจากขนาด prompt มาก (system prompt summary ~3.4k chars แต่รายงาน 347 input tokens) อาจเป็นเพราะ prompt caching หรือการนับของ proxy ทำให้ daily token cap นับต่ำกว่าจริง แต่ request cap ยังคุมอยู่

## Errors & problems

| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 11:01 | `src/lib/server/llm/provider.test.ts` › "routes each task to its model and records the call…" | `SqliteError: FOREIGN KEY constraint failed` ตอน `llm_calls.record` | `llm_calls.job_run_id` มี FK ไปที่ `job_runs` แต่ test ส่ง id ปลอม `'job-1'` | ใน test สร้าง job run จริงด้วย `createJobRunRepository(db).claim(...)` แล้วใช้ `run.id` |

(ปัญหาย่อยที่ไม่ใช่ error: Prettier จัดรูป `if (...) return …` ยาวๆ ให้เป็นสองบรรทัดโดยไม่มีปีกกา จึงเพิ่มปีกกาเองใน 5 จุดเพื่อความอ่านง่าย)

## CONTRACT-CHANGEs

1. `EventGateInput.llm_error_kind?: LlmErrorKind | null` (optional) — ให้ G4 แยก `llm_failed` (digest retry อัตโนมัติ) ออกจาก `invalid_llm_output` (ต้องให้คนตรวจ) ได้ ถ้าไม่ส่งมาและไม่มี output → `llm_failed`
2. `RelationGateInput.confidence: number` (required) — §11 กำหนดให้ publish relation ที่ไม่ใช่ causal เมื่อ confidence ≥ 0.6 แต่ type เดิมไม่มี field นี้

## Open issues / follow-ups for the orchestrator

- Token accounting ของ `cc/*` ผ่าน omniroute ดูเหมือนนับ input ต่ำกว่าจริง (ดู smoke) ถ้าต้องการให้ token cap เข้มขึ้น อาจใช้ `max(reported, estimate)` ตอนบันทึก (ต้องตัดสินใจเชิง policy)
- Budget check กันการเกิน cap ภายใน process เดียว (มี in-flight reservation) แต่ถ้ามีหลาย process รันพร้อมกันอาจเกินได้เล็กน้อย; ตาม §8 jobs รันทีละตัวจึงยอมรับได้
- ยังไม่ได้ทำ `utils/retry.ts` กลางตาม §8 (backend #1 ดูแล `utils`) provider จึงมี `backoffDelay` ของตัวเองตามสูตรเดียวกัน (base 2 s, max 30 s, jitter 0.5–1, Retry-After capped)
- Wave 2 (digest) ใช้งานตามสรุปใน handoff: extraction → summary → `evaluateEventForPublish` → `saveEventContent` / `markEventForReview`; relations → `mapRefsToArticleIds` → `evaluateRelation`; academy_linking → `selectLessonLinks`

## รอบแก้ตาม review

| Field | Value |
|---|---|
| Started | 2026-11-13 11:15:32 (Asia/Bangkok) |
| Finished | 2026-11-13 11:29:00 (Asia/Bangkok) |
| Input | `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1108_1_reviewer_llm-provider.md` + ข้อความจาก coordinator (findings 1–13 + optional cleanup) |
| Status | done — แก้ครบทั้ง 13 ข้อ + optional cleanup ทั้งสองข้อ |

### ขั้นตอน (ตามเวลา)

1. 11:15 — อ่าน review log, ตรวจ branch (`feature/llm-provider`, working tree clean)
2. 11:16 — grep หา usage ของ `ReviewReason` / `LlmErrorKind` ใน lane อื่น (`news-ingestion`, `ui-shell-and-pages`, อ่านอย่างเดียว) ไม่พบ และ migration ไม่มี CHECK constraint บน `review_reasons` / `error_kind` จึงเพิ่มค่า enum ได้อย่างปลอดภัย
3. 11:16 — แก้ contract ใน `types/llm.ts`, `types/domain.ts`, `types/editorial.ts` (ดู CONTRACT-CHANGEs รอบนี้)
4. 11:17 — แก้ `transport.ts` (class `internal`, auth/400 → kind `invalid_request`, ส่ง `response_format` ตาม request)
5. 11:18 — เขียน `provider.ts` ใหม่ในส่วน budget/record/retry/deadline, แก้ `tasks/*`, `routing.ts`, `mock.ts`
6. 11:20 — แก้ `editorial/event-gate.ts`, `lesson-links.ts`, `text.ts`
7. 11:21 — `npm run check` เหลือ error เฉพาะใน test ที่คาดไว้ (field `default` ที่ถูกลบ, signature ใหม่ของ `selectLessonLinks`)
8. 11:22 — อัปเดต tests เดิมและเพิ่ม tests ใหม่ (`provider.test.ts`, `transport.test.ts`, `event-gate.test.ts`, `relation-gate.test.ts`, `text.test.ts` ใหม่)
9. 11:24 — รัน lane tests: fail 3 ข้อ (ดู Errors) แก้แล้วผ่าน 116/116
10. 11:25 — `prettier --write`, `npm run check` 0 errors
11. 11:26 — done criteria: `npm run lint` exit 0, `npm test` 23 files / 223 tests ผ่าน, `npm run build` exit 0, `npm run check` 0 errors
12. 11:27 — รัน live smoke ซ้ำ (3 requests, ดูตาราง) แล้ว commit `f2a3fe2`, `8d837bc`
13. 11:28 — เขียน section นี้และ commit

### ผลต่อ finding

| # | ระดับ | สถานะ | แก้อย่างไร |
|---|---|---|---|
| 1 | high | fixed | auto mode: `current_status = 'hidden'` → outcome ใหม่ `keep_hidden` (caller ไม่เขียนอะไร); `current_review_reasons` มี `manual_flag` → เพิ่ม `manual_flag` เข้า reasons เสมอ จึงไม่มีทาง `published` และไม่เข้าเงื่อนไข retry `[llm_failed]`; admin mode ไม่เปลี่ยน; tests: hidden ×2, manual_flag ×3 + reasons อื่นไม่ถูก carry |
| 2 | medium | fixed | `(signals?.sensitive ?? false) \|\| extraction.sensitive`; test: signals เก่า false + extraction true + publisher เดียว → `sensitive_single_source` |
| 3 | medium | fixed | ทุก request ที่ส่งจริง (รวม timeout/error) บันทึก `tokens_in = max(reported ?? 0, estimate)`, `tokens_out = reported ?? 0`; cap check ใช้ `usage.tokens + inFlight.tokens + estimate > LLM_DAILY_MAX_TOKENS`; tests: timeout 3 ครั้ง → usage = 3×estimate, cap 1.5×estimate กับ 2 calls พร้อมกัน → ส่ง 1 |
| 4 | medium | fixed | budget check ย้ายเข้าไปใน `limit()` ก่อน `sendRequest`; check+reserve และ record+release ทำผ่าน serial queue เดียวกัน (`withBudgetLock`) จึงไม่นับซ้ำและไม่พลาด call ระหว่างทาง; ลบ `reservedRequests` แทนด้วย `inFlight {requests, tokens}` (≤ `maxConcurrency`); test `it.each([1, 3])`: cap N, 2N calls, concurrency 2 → ส่งพอดี N, อีก N เป็น `budget_exceeded` |
| 5 | low | fixed | throwable ที่ไม่ใช่ `LlmTransportError` → class `internal` (kind `http_error`, ไม่ retry); test: 1 request, ไม่ sleep, log `error_class: 'internal'` |
| 6 | low | fixed | หลังได้ slot ตรวจ `signal.aborted` อีกครั้ง → `notSent(aborted)` ไม่ส่งและไม่บันทึก row; test: concurrency 1, abort ตอน call ที่สองรอคิว → transport ถูกเรียก 1 ครั้ง, 1 row |
| 7 | low | fixed | ลบ test เดิมที่ vacuous แล้วทดสอบ `mapRefsToArticleIds(['constructor' / 'toString' / '__proto__'], {})` → `null` โดยตรง (ถ้าไม่มี `Object.hasOwn` จะ resolve เป็น function) |
| 8 | low | fixed | `selectLessonLinks(links, allowedLessonIds: ReadonlySet<string>)` ทิ้ง id ที่ไม่อยู่ใน set; test เพิ่ม `w9-d99`, `constructor` ถูกทิ้ง |
| 9 | medium | fixed | `ChatRequest.response_format` (CONTRACT-CHANGE) ส่งเป็น default; ถ้าได้ `bad_request` ขณะเปิด JSON mode → retry model เดิมทันทีหนึ่งครั้งโดยไม่ส่ง `response_format` (ไม่นับเป็น backoff retry, budget-check และบันทึกตามปกติ) และจำ model นั้นไว้ใน process; tests: default ส่ง, 400 → retry ไม่มี `response_format` แล้วจำ, 400 ทั้งสองแบบ → `invalid_request` หลัง fallback |
| 10 | low | fixed | เพิ่ม regex bare domain `\b(label\.)+[a-z]{2,63}\b` (case-insensitive) ใน `containsUrl`; ไม่จับ `U.S.`, `e.g.`, `2.5`, `3.14`, `1.2.3`, `10.30 น.`, `J.P. Morgan`; ข้อแลกเปลี่ยน: ชื่อแบบ `Node.js` จะถูกจับ (แค่ส่งให้คนตรวจ); `text.test.ts` ใหม่ 8 positive + 8 negative |
| 11 | low | fixed | `unknownRefIssues` คืน `"<path>: N unknown ref(s)"` เท่านั้น ไม่ใส่ค่า ref ที่ model สร้าง; relations candidate ก็เช่นกัน; test ยืนยันว่า repair message ไม่มี `a9` |
| 12 | low | fixed | kind ใหม่ `invalid_request` (auth 401/403, 400, articles ว่าง) และ `input_too_large` → ReviewReason ใหม่ `llm_request_rejected` (ไม่มี reason เดิมที่ตรงความหมาย จึงทำ CONTRACT-CHANGE แบบ minimal); tests ใน gate และ `reviewReasonForLlmError` |
| 13 | low | fixed | `maxArticles` ต่อ task: extraction/summary 12 (§10), tagging 20 (§9 digest order ขัดกับ §10 จึงใช้ค่าของ §9 สำหรับ tagging); articles ว่าง → `invalid_request` ไม่มี request/row; เกิน → `input_too_large`; ทุก `run` มี deadline รวม 10 นาที (`AbortSignal.any` กับ signal ของ job จึงได้ `min(job remaining, 10 min)`), หมดเวลา → `timeout` "run deadline exceeded" ไม่ fallback; tests: ว่าง, 13 articles (summary + extraction), tagging 20 ผ่าน / 21 ไม่ผ่าน, deadline 20 ms |
| opt | — | done | `PROMPT_VERSIONS` derive จาก `TASK_DEFINITIONS`; ลบ `?? models.default` และ field `default` ออกจาก `LlmModelSettings` (config.ts เติมค่า default ให้ทุก task อยู่แล้ว) |

prompt versions ไม่เปลี่ยน (system prompt และ output schema เหมือนเดิม; repair message ไม่อยู่ใน cache key)

### CONTRACT-CHANGEs รอบนี้

1. `types/llm.ts` — `LLM_ERROR_KINDS` เพิ่ม `invalid_request`
2. `types/llm.ts` — `ChatRequest.response_format?: { type: 'json_object' }`
3. `types/domain.ts` — `REVIEW_REASONS` เพิ่ม `llm_request_rejected` (ต่อจาก `invalid_llm_output`)
4. `types/editorial.ts` — `EventGateInput.current_review_reasons?: ReviewReason[]`
5. `types/editorial.ts` — `EventGateDecision` เพิ่ม `{ status: 'keep_hidden'; review_reasons }`

หมายเหตุ: ตาราง enum ใน `docs/ARCHITECTURE.md` §6 ยังไม่ได้อัปเดต (อยู่นอก lane) ควรให้ owner ของเอกสารเพิ่ม `llm_request_rejected`

### Live smoke ซ้ำ (11:27, ไม่มี secret)

| Task | Model | Result | Latency | Tokens in/out (recorded) | Schema |
|---|---|---|---|---|---|
| summary | `cc/claude-sonnet-5-5` | ok | 5388 ms | 1701 / 737 | pass |
| tagging | `cx/gpt-5.6-luna` | ok | 4066 ms | 923 / 171 | pass |
| tagging | `cc/claude-haiku-5-5` (no temperature) | ok | 3029 ms | 1127 / 337 | pass |

รวม 3 requests (cap 6) ค่า tokens_in ตอนนี้ไม่ต่ำกว่า estimate แล้ว (รอบแรก summary รายงาน 347)

### Commands run & results (รอบนี้)

| Time | Command | Result |
|---|---|---|
| 11:21 | `npm run check` | 3 errors เฉพาะใน test (คาดไว้) |
| 11:24 | `npx vitest run src/lib/server/llm src/lib/server/editorial` | 3 failed / 113 passed |
| 11:25 | (หลังแก้) เดิม | 8 files, 116 passed |
| 11:26 | `npm run lint` · `npm test` · `npm run build` · `npm run check` | exit 0 ทั้งหมด; 23 files, 223 tests |
| 11:27 | `npx tsx --env-file=C:\Project\WORLDVIEW\.env scripts/llm-smoke.ts` | 3/3 ok |
| 11:27 | `git commit` ×2 | `f2a3fe2`, `8d837bc` |

### Errors & problems (รอบนี้)

| Time | Where | Error | Cause | Resolution |
|---|---|---|---|---|
| 11:17 | `transport.ts` แก้ด้วย PowerShell `Set-Content -Encoding utf8` | ไฟล์ได้ UTF-8 BOM (`EF BB BF`) | Windows PowerShell 5.1 เขียน BOM เสมอกับ `-Encoding utf8` | ตรวจ byte แรกแล้วตัด BOM ด้วย `[IO.File]::WriteAllBytes`; หลังจากนั้นแก้ไฟล์ด้วย Edit/Write tool เท่านั้น |
| 11:24 | `provider.test.ts` › timeout charges budget / unknown throwable | ได้ 6 rows / 2 requests แทน 3 / 1 | helper `noFallback()` ปิดแค่ `fallback` แต่ tagging เป็น `cx/*` จึงใช้ `fallbackSecondary` | ปิดทั้ง `fallback` และ `fallbackSecondary` ใน helper |
| 11:24 | `provider.test.ts` › >12 articles | extraction ได้ `not_configured` แทน `input_too_large` | test settings ไม่มี model ของ extraction (หลังลบ `?? models.default`) | ตั้ง `extraction: 'cc/model-a'` ใน test settings |
