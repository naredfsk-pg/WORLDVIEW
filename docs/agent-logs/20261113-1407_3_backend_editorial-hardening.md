# 3 · backend · editorial-hardening

| Field | Value |
|---|---|
| Started | 2026-11-13 14:07:51 (Asia/Bangkok) |
| Finished | 2026-11-13 14:38:30 (Asia/Bangkok) |
| Status | done |
| Agent type | backend |

## Goal
Wave 3 lane "Editorial hardening" บน branch `feature/editorial-hardening` (จาก `main` @ `e074515`): (1) กรอง tag ที่มาจากข้อกล่าวหาต่อบุคคลออกจาก public event tags ตาม owner policy พร้อม prompt guidance, (2) สร้าง `event_updates` (timeline) ตอน re-summary ของ event ที่ publish แล้ว, (3) ปรับ recall/precision ของ clustering, (4) ตัด boilerplate ใน excerpt ก่อน cap 500 ตัวอักษร, (5) ยุบ helper ซ้ำให้ใช้ `#lib/utils`, (6) refresh ARCHITECTURE §1/§2/§14 และบันทึกงานข้อ 1–4

## What I did (in order)
1. 14:07 — อ่าน `AGENT_PLAN.md` ส่วน "Owner decisions carried into Wave 3" (จาก checkout หลัก เพราะยังไม่ commit), `ARCHITECTURE.md` ทั้งไฟล์, และส่วน open issues ของ log Wave 1/2/2.5 ที่กำหนด
2. 14:09 — อ่านโค้ด `server/{jobs,editorial,llm,news,db}` และ `utils` เพื่อหาเส้นทางที่ event tags ถูกเขียน (`deriveEventTaxonomy` → `saveEventContent`), จุดที่ `new_updates: []`, และ logic ของ `mergeAmbiguousDrafts`
3. 14:11 — ตรวจ DB ของ checkout หลัก (read-only): ถูก reset เหลือแต่ demo จึงไม่มีข้อมูล live เดิม; ดึง RSS สาธารณะของ Guardian/BBC/Al Jazeera/UN ด้วย `curl` ลง scratchpad เพื่อดูรูปแบบ excerpt จริงและพาดหัว Nvidia/Pope (ไม่ commit ข้อมูลดิบ)
4. 14:14 — คำนวณ rule score ด้วย `bestEventMatch` บนพาดหัวจริง: Guardian "Nvidia scandal sparks…" เทียบ event Nvidia ได้ 0.045 (ต่ำกว่า ambiguous 0.3 มาก), ข่าว Congress ที่ไม่เกี่ยวได้ 0.23, คู่ Pope ได้ 0.44 (ambiguous) → สรุปว่า miss ของ Nvidia เป็นปัญหาถ้อยคำต่างกัน ไม่ใช่ threshold จึงไม่ลด `ambiguousThreshold` แต่ใช้ shared tags แทน
5. 14:15 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset`
6. 14:16 — Task 5: `llm/provider.ts` ใช้ `backoffDelayMs` (`utils/retry`) และ `bangkokDayRangeUtc(todayBriefDate(now))` (`utils/date`) แทนสำเนาของตัวเอง; `editorial/text.ts` เลิกมี `isHttpUrl` ซ้ำ (ใช้ `utils/url`); ลบ export `backoffDelay`/`bangkokDayStartUtc` ที่ไม่มีใครใช้ → commit `86a27bb`
7. 14:17 — Task 1: เพิ่ม `editorial/tag-filter.ts` (pure denylist ตาม kebab parts: `alleged`, `allegations`, `accused`, `suspected`, `scandal`, `charges`, `indicted`, `affair`, `extramarital`, `adultery`, `misconduct`, `harassment`, `bribery`, `embezzlement` ฯลฯ, คำลงท้าย `spy`/`spies`/`traitor`, และ exact `sexual-assault`/`sexual-abuse`) ใช้ใน `deriveEventTaxonomy` ก่อน cap 10; `tagging@2` prompt guidance; tests: unit (Nvidia case, neutral, 23 deny + 15 keep) และ digest (Nvidia-like publish แต่ tags สะอาด, neutral ไม่เปลี่ยน, admin-set tags ไม่ถูกแตะ) → commit `254ed11`
8. 14:20 — Task 2: `SummaryInput.previous.new_refs`, `SummaryOutput.update_th` (`summary@3` พร้อม guidance เรื่องข้อกล่าวหาต่อบุคคลเป็น claim ที่ระบุผู้กล่าวอ้าง), `EventWithArticles.new_article_ids` (article ที่ link หลัง `summarized_at`), `editorial/event-update.ts` (`buildEventUpdate`: Thai, ไม่มี URL, evidence ต้องเป็น stored article ที่มี http(s) URL; `reported_at` = ใหม่สุดของ `published_at ?? ingested_at`), G3 ครอบ `update_th`, repository ข้าม update ที่ evidence set ซ้ำ (idempotent) → commit `78c6554`
9. 14:24 — Task 3: `EventMatchCandidate.status`; `findAmbiguousPairs` = rule ambiguous band ก่อน, ถ้าไม่มีและ draft มี article เดียว → published event ที่ share tags ≥ 2 (`PUBLISHED_TARGET_MIN_SHARED_TAGS`); `CLUSTERING_MERGE_MIN_CONFIDENCE` 0.7 → 0.8; `clustering@2` (follow-up ของ happening เดียวกัน = same_event, คนละกิจกรรมในทริปเดียวกัน = related); regression tests (Nvidia recall + timeline, 1 shared tag ไม่พอ, guard hidden/demo/admin-edited, Pope precision ที่ 0.75) + คู่ Pope ใน `tests/fixtures/grouping/cases.json`; mutation check (เอา demo filter ออก / ลด threshold กลับ 0.7 → test ที่เกี่ยวข้อง fail ตามคาด แล้วคืนไฟล์) → commit `c0cbf8d`
10. 14:27 — Task 4: `stripFeedBoilerplate` ใน `news/normalize.ts` (excerpt เท่านั้น ก่อน `cleanFeedText`/cap): ตัด link "Continue reading...", `<li>` ที่มีแต่ link + คำนำทาง, `<p>` ที่มีแต่ link หลัง label เช่น "Related:"; regex ทุกตัวจำกัดความยาว (600); tests 8 กรณีรูปแบบ Guardian (paraphrase) + Thai/English ไม่ถูกแตะ + hostile input; ตรวจกับ Guardian feed จริง 45 items: ตัดเฉพาะ "Continue reading...", nav list ของ live blog และ promo newsletter → commit `b53f24e`
11. 14:30 — รัน gates รอบแรก (db:reset, check, lint, test, build, test:e2e) ผ่านทั้งหมด
12. 14:31 — Task 6: เขียน ARCHITECTURE §1 (subpath `#lib`, folder `server/auth/`, ข้อยกเว้น `jobs/registry.ts`, `stores`, utils เป็นแหล่งเดียวของ helpers), §2 (flow ผ่าน `runJobByType` ทั้ง cron และ admin rerun), §14 (ตาราง env ครบตาม `.env.example` + `LLM_BASE_URL`/`LLM_API_KEY` + `CF_ACCESS_TEST_JWKS_URL` + E2E ports พร้อม module ที่อ่าน), §9–§11 (tag filter, timeline, clustering thresholds พร้อมเหตุผล, excerpt boilerplate, prompt versions ปัจจุบัน) → commit `2b9ce03`
13. 14:34 — Live check (optional): `npm run job -- ingest` แล้ว digest ด้วย `.env` จริง `--max-events 2` โดยตั้ง `LLM_DAILY_MAX_REQUESTS=15` ใน process env เป็น hard cap (process env ชนะ `--env-file`) ไม่ได้พิมพ์ค่าใดจาก `.env`
14. 14:36 — รัน gates รอบสุดท้ายหลังแก้ docs และเขียน log นี้

## Files created / changed
- `src/lib/server/editorial/tag-filter.ts` (+ test) — allegation tag denylist (pure)
- `src/lib/server/editorial/event-update.ts` (+ test) — timeline entry builder (pure, G2/G3/G5 checks)
- `src/lib/server/editorial/event-gate.ts` (+ test) — G3 ครอบ `update_th`; ใช้ `isHttpUrl` จาก utils
- `src/lib/server/editorial/text.ts`, `index.ts` — ลบ `isHttpUrl` ซ้ำ; export ใหม่
- `src/lib/server/jobs/digest-content.ts` — กรอง tags, ส่ง `previous.new_refs`, สร้าง `new_updates`
- `src/lib/server/jobs/digest.ts` — published targets ด้วย shared tags, threshold 0.8
- `src/lib/server/jobs/digest.test.ts` — tests ของ tag policy, timeline, clustering regressions
- `src/lib/server/db/repositories/digest.ts` (+ test) — `new_article_ids`, `status` ใน candidates, update idempotency
- `src/lib/server/llm/provider.ts`, `index.ts` — ใช้ utils retry/date
- `src/lib/server/llm/tasks/{tagging,summary,clustering}.ts`, `summary.test.ts`, `mock.ts`, `test-fixtures.ts`, `provider.test.ts` — prompt versions และ `update_th`
- `src/lib/server/news/normalize.ts` (+ test) — `stripFeedBoilerplate`
- `src/lib/server/news/grouping.ts`, `grouping.test.ts`, `tests/fixtures/grouping/cases.json` — บันทึกการ review threshold, fixture Pope
- `src/lib/types/{llm,domain,repositories,news}.ts` — CONTRACT-CHANGE ตามด้านล่าง
- `src/routes/admin/admin-forms.server.ts` — `update_th: null` และ gate รับ `Pick<EventWithArticles,…>`
- `docs/ARCHITECTURE.md` — §1, §2, §4 (pointer), §9, §10, §11, §14

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 14:15 | `npm ci`; `cp .env.example .env`; `npm run db:reset` | ok (มี warning allow-scripts ของ npm แต่ better-sqlite3 ใช้งานได้) |
| 14:16 | `npx vitest run src/lib/server/llm src/lib/server/editorial src/lib/utils` | 216 passed |
| 14:17 | `npx vitest run …digest.test.ts …` | 1 failed (ดู error #3) → แก้แล้ว 532 passed |
| 14:22 | `npx vitest run src/lib/server/jobs/digest.test.ts` ×3 | 31 passed ทุกครั้ง (หลังแก้ error #4) |
| 14:26 | mutation check (ลบ demo filter / threshold 0.7) | test ที่ตั้งใจ fail 1 ตัวต่อกรณี; คืนไฟล์จาก backup แล้ว `git diff` ตรงกับก่อน mutation |
| 14:28 | `npx tsx check-excerpts.ts guardian.xml` (scratchpad) | 45 items; ตัดเฉพาะ boilerplate |
| 14:30 | `db:reset` → `check` → `lint` → `test` → `build` → `test:e2e` | exit 0 ทั้งหมด; check 0 errors 0 warnings; test 739 passed |
| 14:34 | `npm run job -- ingest` | succeeded: sources_ok 4, items_fetched 133, articles_inserted 115, events_created 113 |
| 14:35 | `npx tsx --env-file=<real .env> scripts/job.ts digest --max-events 2` (cap 15) | succeeded; 6 LLM requests, 14,646 tokens; events_pending_review 2 |
| 14:36 | `db:reset` → `check` → `lint` → `test` → `build` → `test:e2e` | exit 0 ทั้งหมด: check 1733 files 0 errors 0 warnings; prettier + eslint ผ่าน; vitest 54 files / 739 passed; build ok; Playwright 70 passed (port 4173) |

### Live check
- `llm_calls`: tagging 1 (`tagging@2`), clustering 1 (`clustering@2`), extraction 2, summary 2 (`summary@3`); error 0; รวม 6 requests (≤ 15)
- Tags สะอาด: event Megaspeed/Nvidia ได้ `semiconductors`, `nvidia`, `corporate-structure`, `cross-border-business`; event Al Jazeera ได้ `gulf`, `regional-security`, `security-architecture`, `war` — ไม่มี allegation tag ทั้งระดับ article taxonomy และ event
- clustering ตอบ `related` 0.62 สำหรับคู่เดียวที่ส่ง → ไม่ merge
- ทั้งสอง event เป็น `pending_review [sensitive_single_source]` (แหล่งเดียว + sensitive) ตาม gate G6
- Timeline: ไม่มี `event_updates` ของ event จริง เพราะ DB ถูก reset และยังไม่มี event จริงที่ publish มาก่อน (timeline เกิดได้เฉพาะตอน re-summary ของ event ที่ publish แล้ว) ทดสอบครอบคลุมใน unit/digest tests แทน
- excerpt ที่ ingest จริง: Guardian 38 แถว ไม่มี "Continue reading", "latest updates", "Get our" เหลือ

## Errors & problems
| # | Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|---|
| 1 | 14:12 | python ใน scratchpad (ดู Guardian feed) | `UnicodeEncodeError: 'charmap' codec` | console Windows ใช้ cp1252 | รันด้วย `PYTHONIOENCODING=utf-8` |
| 2 | 14:17 | PowerShell `Set-Content -Encoding utf8` บน `digest.test.ts` | ไฟล์ได้ BOM (EF BB BF) | PowerShell 5.1 ใส่ BOM กับ utf8 | ลบ BOM ด้วย `sed`, ตรวจด้วย `od -c`; หลังจากนั้นใช้ Edit tool / python ที่เขียน `newline='\n'` |
| 3 | 14:17 | test "Nvidia-like event" ใน `digest.test.ts` | assertion ว่า public detail ไม่มีคำ affair/alleged/scandal fail | พาดหัวของ source มีคำเหล่านี้อย่างถูกต้อง (title เป็น public อยู่แล้ว) | เปลี่ยนเป็น assert `detail.tags` เท่านั้น (Edit tool ปฏิเสธครั้งแรกเพราะยังไม่ Read ไฟล์ → Read ก่อนแล้วแก้) |
| 4 | 14:22 | test เดียวกัน | ลำดับ tags สลับ (flaky) | สอง article มี `published_at` เท่ากัน ลำดับจึงตัดสินด้วย UUID สุ่ม | ให้ article มีเวลาต่างกัน; รันซ้ำ 3 รอบผ่าน |
| 5 | 14:26 | `news/normalize.ts` (เขียนผ่าน python heredoc) | `\b` ใน regex 6 จุดกลายเป็นอักขระ backspace (0x08) | กับดัก encoding ที่ทีมเตือนไว้: tool/heredoc แปลง `\b` | แทน `chr(8)` ด้วย `chr(92)+'b'` ผ่าน `python -c`; `grep -c $'\x08'` = 0 ในทุกไฟล์ที่แตะ |
| 6 | 14:27 | `CONTINUE_READING_AT_END` (self-review ก่อนรัน test) | replace ด้วย `''` จะลบ `>` ที่ capture ไว้ ทำให้ tag ขาด (`<p` เหลือเป็นข้อความ) | ออกแบบ capture group พลาด | เปลี่ยนเป็น `'$1'` และเพิ่ม test `'<p>Continue reading…</p>'` |
| 7 | 14:27 | test guard ใน clustering regressions (self-review) | ส่วน demo/real ของ test รวมไม่ได้ทดสอบอะไรจริง (toggle `is_demo` ไปกลับแล้ว assert ของเดิม) | เขียน test รวมหลาย scenario ที่มี state ต่อกัน | แยกเป็น 3 tests อิสระ (hidden, demo/real, admin-edited) และยืนยันด้วย mutation check |
| 8 | 14:28 | แก้สคริปต์ `check-excerpts.ts` ใน scratchpad ด้วย python replace | replace ไม่ติด | escaping ซ้อนหลายชั้น | เขียนไฟล์ใหม่ด้วย Write tool |
| 9 | 14:32 | gate run รอบแรก, log ของ `test:e2e` | อ่านไฟล์ log ไม่ได้ (exit 0 ถูกบันทึก) | ชื่อไฟล์มี `:` → Windows เขียนลง NTFS alternate data stream | รอบสุดท้ายใช้ชื่อไฟล์ `test-e2e`; รัน e2e ใหม่และอ่านผลได้ |
| 10 | 14:33 | bash heredoc ของสคริปต์แก้ ARCHITECTURE | `unexpected EOF while looking for matching '` | heredoc ยาวที่มี backtick/quote จำนวนมากถูก shell wrapper ตีความ | เขียนสคริปต์เป็นไฟล์ด้วย Write tool แล้วรัน `python <file>` |

## CONTRACT-CHANGEs / migrations / prompt versions
- CONTRACT-CHANGE: `SummaryInput.previous.new_refs: string[]`, `SummaryOutput.update_th: string | null`, `EventWithArticles.new_article_ids: string[]` (admin publish gate รับ `Pick<EventWithArticles, 'event' | 'articles'>`), `EventMatchCandidate.status: EventStatus`
- Prompt versions: `tagging@1 → @2`, `summary@2 → @3`, `clustering@1 → @2` (cache เก่าไม่ถูกใช้ซ้ำ)
- Migrations: ไม่มี (`event_updates` มีอยู่แล้ว)

## Open issues / follow-ups for the orchestrator
- Event ที่ publish ก่อน Wave 3 (เช่น event Nvidia ใน production ที่มี `extramarital-affair`, `alleged-spy`) ยังเก็บ tags เดิมจนกว่าจะถูก re-summary; ถ้าต้องการล้างทันทีต้องมี one-off cleanup (เสนอให้ owner ตัดสินใจ; ไม่ได้ทำเพราะเป็นการแก้ข้อมูล production)
- Draft ที่ merge เข้า published event ที่ admin flag (`manual_flag`) ไว้ได้ (guard เดิมไม่ได้กันกรณีนี้): article ใหม่จะถูก link แต่ event จะไม่ถูก re-summary เพราะ `listEventsNeedingContent` ข้าม event ที่ flag ไว้ — admin เห็น source เพิ่มในหน้า admin
- Shared-tag candidates อาจส่งคู่ที่ไม่เกี่ยวเข้า LLM มากขึ้นเมื่อ tags กว้าง (เช่น `us-politics` + `donald-trump`); จำกัดไว้ 1 คู่ต่อ draft, 20 คู่ต่อ call, 1 call ต่อรอบ และต้อง `same_event` ≥ 0.8 จึง merge — data-scientist ควรวัดบน live data
- `stripFeedBoilerplate` ทำงานกับ HTML เท่านั้น ข้อความนำทางที่มาเป็น plain text (ไม่มี `<li>`/`<a>`) จะไม่ถูกตัด
- QA: ตรวจ `/events/[id]` ส่วน timeline เมื่อมี `event_updates` จริง (ต้องรัน digest สองรอบโดยมี article ใหม่ link กับ event ที่ publish แล้ว)
