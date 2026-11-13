# 3 · backend · security-system

| Field | Value |
|---|---|
| Started | 2026-11-13 16:00:00 (Asia/Bangkok) |
| Finished | 2026-11-13 17:32:00 (Asia/Bangkok) |
| Status | done |
| Agent type | backend (มอบ item 7, 9, 10 ให้ subagent `backend` หนึ่งตัวใน worktree เดียวกัน) |

## Goal
แก้ findings ของ full-system security review (`20261113-1544_3_reviewer_full-system-security.md`) ในเลนของ backend ก่อน production deploy ครั้งแรก บน branch `fix/security-system` (worktree `C:\Project\WORLDVIEW-worktrees\security-system`, จาก `main` @ `7bcb3f0`): item 1–10 (auto-publish switch, G3 hardening, brief ranking, digest race, per-source link hosts, LLM fairness/budget, search cost, relations, job error sanitizer, LLM transport) พร้อมเปลี่ยน probe ของ reviewer ให้เป็น regression tests และอัปเดต ARCHITECTURE §5, §6, §8–§11, §14 กับ `.env.example` ไม่แตะ `scripts/**`, Dockerfile, compose, README (เลน deploy)

## What I did (in order)
1. 16:00 — อ่าน review log, probe 4 ไฟล์ (`race.mts`, `search.mts`, `url.mts`, `redos.mts`), ARCHITECTURE ทั้ง §1–§14 และโค้ด editorial / llm / news / jobs / repositories ที่เกี่ยวข้อง
2. 16:08 — `npm ci`, `cp -n .env.example .env`, `npm run db:reset` (background); รัน probe เดิมบน worktree เป็น baseline: search 107–595 ms ที่ 20k events, race ยืนยันว่า flag หายและ event เป็น `published`
3. 16:10 — หา host ของลิงก์บทความจริงจาก feed snapshots ที่เก็บไว้ใน scratchpad `feeds/*.xml` (ไม่ fetch ใหม่): UN `news.un.org` 30/30, BBC `www.bbc.co.uk` 33/33, Guardian `www.theguardian.com` 45/45, Al Jazeera `www.aljazeera.com` 25/25; DB local มีแต่ demo (`example.com`)
4. 16:12 — เพิ่ม env vars ใน `config.ts` ก่อน (เพื่อไม่ชนกับ subagent) แล้ว spawn subagent `backend` สำหรับ item 7, 9, 10 พร้อม brief เรื่องไฟล์ที่แตะได้และ encoding trap
5. 16:15 — เขียน scan script `sec-scan.cjs` (control และ `\p{Cf}` ในไฟล์ที่เปลี่ยนจาก `7bcb3f0`) ใช้ `\u{…}` + flag `u` ซึ่งรอด Write tool
6. 16:30 — รับงาน subagent (search window 2000 rows + count cap 1001, shared sanitizer `server/errors.ts`, transport `redirect: 'manual'` + body cap 2 MB, https check) ตรวจ diff แล้ว commit 3 commits
7. 16:35 — Item 2: เขียน `editorial/text.ts` ใหม่ (normalize → reveal obfuscated dots → URL / bare domain / Thai IDN, และ contact patterns) ย้าย `normalizeGeneratedText` ไป `utils/text.ts` (llm import editorial ไม่ได้ตาม §1) ใส่ใน `textSchema` ของ LLM output; พบว่า NFKC แยก SARA AM (U+0E33) จึง recompose กลับ; ตาราง test ทั้งสองทาง 94 cases + ReDoS timing
8. 16:50 — Item 1/5/8 ใน gate: `auto_publish` policy (omitted = `off`), `contact_in_generated_text`, `countDistinctSources` (source_id), relation gate เป็น `pending_review` ทุก type; เพิ่ม reasons `contact_in_generated_text`, `auto_publish_disabled`, `new_evidence_pending` + label ไทย
9. 17:00 — Repository/digest: `listEventsNeedingContent(limit, retryFailedBefore)` (backoff + round-robin by first source), `saveEventContent` / `markEventForReview` ตรวจ `listed` (updated_at + status), `flagNewEvidence`, `upsertRelation` คืน boolean และ block คู่ที่ admin reject; digest-content ข้าม LLM สำหรับ published event เมื่อ policy ≠ `all`, หยุด loop เมื่อ `budget_exceeded` (`deferred`); provider มี per-run cap
10. 17:10 — Item 5/6 ingest: `link_hosts` ใน registry, `isAllowedLinkHost` ใน `normalizeFeedItem`, per-source cap `items_capped`; seed map columns ชัดเจน
11. 17:15 — Admin: review queue รวม published + `new_evidence_pending`, `publishEvent` ยืนยันข้อความเดิมได้, ปุ่ม "ยืนยันข้อความที่เผยแพร่อยู่" ใน review card และหน้า event; Item 3 brief ranking: rank 1–3 สำหรับ `source_count ≥ 2`
12. 17:18 — เขียน `jobs/digest-security.test.ts` (policy off/multi_source/all, new evidence, race probe, LLM failure + flag, round-robin, budget, relations) แก้ test เดิมตาม contract ใหม่
13. 17:20 — (หลัง API error ขัดจังหวะ ดู Errors) แก้ 2 tests ที่ยัง fail, normalize CRLF → LF, prettier, lint, เขียน ARCHITECTURE + `.env.example`
14. 17:27 — `db:reset` แล้วรันทุก gate ต่อกัน (background) ระหว่างรอ commit เป็น 7 logical commits
15. 17:30 — ทุก gate exit 0 เขียน log นี้

## Files created / changed
- `src/lib/server/config.ts`, `config.test.ts`, `src/lib/types/config.ts`, `.env.example` — `EDITORIAL_AUTO_PUBLISH` (default `off`), `LLM_MAX_REQUESTS_PER_RUN` (80), `INGEST_MAX_NEW_ITEMS_PER_SOURCE` (40), https rule ของ `LLM_BASE_URL` / `OMNI_API_URL`
- `src/lib/utils/text.ts` (ใหม่), `src/lib/server/editorial/{text,event-gate,relation-gate,lesson-links,event-update,index}.ts` + tests — G3 hardening, policy, source counting, relations pending
- `src/lib/types/{domain,editorial,news,jobs,repositories}.ts` — reasons, policy enum, `link_hosts`, counters, repository contracts
- `src/lib/server/llm/tasks/shared.ts`, `llm/provider.ts` + tests, `llm/test-fixtures.ts` — normalized output, per-run cap
- `src/lib/server/news/{sources,normalize}.ts` + tests, `jobs/ingest.ts` + tests, `db/fixtures/demo.ts`, `db/seed.ts` — link hosts, cap
- `src/lib/server/db/repositories/{digest,admin}.ts` + tests — race guard, new evidence, round-robin, backoff, rejected pairs, review queue
- `src/lib/server/jobs/{digest,digest-content,digest-links,brief-ranking,registry}.ts` + tests, `jobs/digest-security.test.ts` (ใหม่)
- `src/lib/components/admin/{admin-labels.ts,EventReviewCard.svelte}`, `src/routes/admin/events/[id]/{+page.server.ts,+page.svelte}` — labels, confirm button, contact check ในฟอร์ม
- `tests/pipeline/run-fixture-pipeline.ts` — `autoPublish: 'all'` สำหรับข้อมูล e2e
- โดย subagent: `db/repositories/search.ts` + `search.test.ts`, `types/views.ts`, `routes/search/+page.svelte`, `server/errors.ts` + test, `hooks.server.ts`, `jobs/runner.ts`, `llm/transport.ts` + test
- `docs/ARCHITECTURE.md` — §5 (FTS/search), §6, §8, §9, §10, §11, §14

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 16:08 | `npm ci --no-audit --no-fund`; `npm run db:reset` | exit 0 / exit 0 |
| 16:09 | `npx tsx probe-sec/search.mts 20000` (baseline) | 263 / 107 / 339 / 595 / 386 ms |
| 16:09 | `npx tsx probe-sec/race.mts` (baseline) | 4 flagged drafts → `published`, reasons `[]` |
| 16:30 | subagent: `npx vitest run` (ทั้งชุด) | 59 files, 905 tests passed; search หลังแก้ 17–54 ms |
| 16:45 | `npx vitest run src/lib/server/editorial/text.test.ts` | 94 passed (หลังแก้ ReDoS) |
| 17:05 | `npx svelte-check` | 18 errors (test helpers ตาม contract ใหม่) → แก้ → 0 |
| 17:12 | `npx vitest run` | 993 passed |
| 17:22 | `npx vitest run src/lib/server/jobs src/lib/server/db` | 226 passed (หลังแก้ 2 tests ใหม่) |
| 17:24 | `node sec-scan.cjs` | 63 files, 0 control/invisible characters |
| 17:25 | `npm run lint` | exit 0 |
| 17:27 | `npm run db:reset` | exit 0 |
| 17:28 | `npm run check` | exit 0 (0 errors, 0 warnings) |
| 17:28 | `npm run lint` | exit 0 |
| 17:29 | `npm test` | exit 0 — 60 files, 1007 tests passed |
| 17:29 | `npm run build` | exit 0 |
| 17:30 | `E2E_PORT=4373 npm run test:e2e` | exit 0 — 318 passed |

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 16:13 | Edit tool บน `config.ts` / `editorial.ts` / `config.ts` (types) | "File has not been read yet" | Edit ต้อง Read ก่อนในรอบนี้ | Read (limit 2) แล้ว Edit ซ้ำ |
| 16:36 | Write `text.test.ts` | "File has not been read yet" | ไฟล์มีอยู่แล้ว | Read แล้ว Write ใหม่ |
| 16:40 | `text.test.ts` ReDoS test | 640 ms > 500 ms | e-mail pattern และ `BARE_DOMAIN` เริ่ม match ได้ทุกตำแหน่ง (`000…`, `a.a.a.…`) → O(n²) | เพิ่ม look-behind ให้เริ่มเฉพาะหลังตัวที่ไม่ใช่ label → 0–3 ms; ลด bound เป็น 200 ms |
| 16:52 | python heredoc แก้ `event-gate.test.ts` | `SyntaxError: (unicode error) 'unicodeescape'` | encoding trap: `\u{3002}` ใน string ปกติของ Python; script ไม่ได้เขียนไฟล์ใดเลย | เขียน script เป็นไฟล์ด้วย raw strings แล้วรัน |
| 16:58 | design NFKC | NFKC แยก `ำ` (U+0E33) เป็น U+0E4D U+0E32 | compatibility decomposition ของ SARA AM จะทำให้ค้นหา "น้ำ" ไม่เจอ | `normalizeGeneratedText` recompose คู่นั้นกลับเป็น U+0E33 (มี test) |
| 17:05 | `svelte-check` | 18 errors ใน tests | contract ใหม่ (`listed`, `retryFailedBefore`, `autoPublish`, `markEventForReview`) | helper `saveAsListed` / `markAsListed` / `RETRY_ANY` และใส่ `autoPublish: 'all'` ใน test harness |
| 17:08 | `jobs/digest.test.ts` (4 tests) | สถานะไม่ตรง | ผลที่ตั้งใจ: backoff 11 h, race skip (#7 ตอนนี้ไม่ save แล้วสรุปในรอบถัดไป), source_count นับ source_id | ปรับ clock / expectation และเพิ่ม source `wire-b` ใน repo test |
| 17:10 | ingest tests (5) | items ถูก drop | registry ใน test ใช้ host อื่น (`tz.example`, `real.example`, …) แต่ `link_hosts` เป็นของ fixture | ใส่ `link_hosts` ที่ตรงในแต่ละ test; counters เพิ่ม `items_capped: 0` |
| 17:12 | `seed.test.ts` idempotent | second run เปลี่ยน 3 rows | spread `...source` ใส่ `link_hosts` ลง row ของ `sources` | map columns ทีละตัว |
| 17:13 | แก้ `seed.ts` ด้วย python slice | ลบโค้ด 120 บรรทัดโดยไม่ตั้งใจ | prettier จัดบรรทัดใหม่ จึงหา `}));` แรกผิดตัว | `git checkout` ไฟล์แล้วแก้ด้วย exact replace |
| 17:13 | eslint `seed.ts` | `'link_hosts' is defined but never used` | destructure เพื่อทิ้ง field | map columns ชัดเจนแทน |
| 17:19 | API (ระหว่างดู test ที่ fail ใน `digest-security.test.ts`) | HTTP 403 จาก API, run หยุดกลางคัน | ปัญหาฝั่ง API ไม่เกี่ยวกับโค้ด | coordinator ส่งข้อความให้ทำต่อ; ตรวจ `git status` / diff แล้วทำต่อจากจุดเดิม |
| 17:20 | `digest-security.test.ts` round-robin | ได้ event เดียวกันทุก source | subquery `sql` ที่เขียนเองอ้าง `events.id` แบบไม่ระบุ table จึงไปจับ `articles.id` ใน subquery → `source_id` เป็น null ทุกแถว | สร้าง subquery ด้วย query builder (drizzle ใส่ชื่อ table ให้) |
| 17:20 | `digest-security.test.ts` LLM failure + flag | `manual_flag` ถูกทับด้วย `llm_failed` | `markEventForReview` ตรวจแค่ `updated_at` ซึ่งเท่ากันเพราะ clock ใน test ตายตัว | ส่ง `listed` (updated_at + status) และตรวจ status ด้วย |
| 17:23 | git | CRLF warning ใน `admin-labels.ts`, `event-gate.ts` | python `open(..., 'w')` บน Windows เขียน CRLF | แปลงเป็น LF ทุกไฟล์ที่เปลี่ยน แล้วใช้ `newline='\n'` |
| 17:24 | `npx prettier --check .env.example` | "No parser could be inferred" | prettier ไม่รู้จักไฟล์ `.env` | ไม่ต้องแก้ (`npm run lint` ไม่ตรวจไฟล์นี้, exit 0) |
| 16:30 | subagent (สรุปจาก report) | heredoc ทำ `ESCAPE '\\'` เป็นสองตัวใน scratch, `errors.test.ts` คาด `DrizzleQueryError` แต่ได้ `SqliteError`, slug `sports` ผิด, Edit refusals | encoding trap / sync driver / slug ไม่มี | แก้ใน scratch, test ครอบทั้ง 3 รูปแบบ error จริง, ใช้ `society` |

## Open issues / follow-ups for the orchestrator
- Owner เลือก `EDITORIAL_AUTO_PUBLISH=multi_source` สำหรับ production (coordinator ตั้งใน `.env` จริง) ค่า default ในโค้ดและ `.env.example` คือ `off`
- Deploy lane: เพิ่ม Cloudflare rate-limit rule ที่ `/search*` (เช่น 30 requests / 10 s ต่อ IP แล้ว challenge) และตรวจว่า `OMNI_API_URL` จริงเป็น https หรือ host ภายใน ไม่งั้น config จะ fail ตอน start
- Transport ใช้ `redirect: 'manual'` แทน `'error'` (undici รายงาน `'error'` เป็น network error ที่ retry ได้) ผลเท่ากัน: ไม่ follow redirect, 3xx เป็น error ที่ไม่ retry
- Search events เรียงตาม `last_updated_at` (ไม่ใช้ bm25) และหาได้เฉพาะใน 2000 candidates ใหม่สุด: query กว้างหรือสั้นล้วนจะไม่เจอข่าวเก่ากว่านั้น
- Brief ranking: ถ้าทุก candidate เป็น single-source ลำดับยังตาม score (LLM signals) แต่ใน `off` / `multi_source` event เหล่านั้นผ่าน admin มาแล้ว
- Existing published relations ใน DB ยังเป็น `published` (ไม่มี migration ย้อนหลัง)
- Commit แต่ละตัวแยกตาม item แต่ไม่ได้ตรวจ build ทีละ commit; gate ทั้งหมดผ่านที่ HEAD
