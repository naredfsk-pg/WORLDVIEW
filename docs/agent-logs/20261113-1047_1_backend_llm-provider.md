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
