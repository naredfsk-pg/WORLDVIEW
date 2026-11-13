# 2 · backend · digest-and-briefs

| Field | Value |
|---|---|
| Started | 2026-11-13 12:01:52 (Asia/Bangkok) |
| Finished | 2026-11-13 12:52:00 (Asia/Bangkok) |
| Status | done |
| Agent type | backend (Wave 2, lane "Digest & Briefs") |

## Goal

เชื่อม pipeline ingest → digest → briefs ให้หน้า public แสดงเนื้อหาภาษาไทยที่ LLM เขียนและผ่าน editorial gates แล้ว: รวม helper เข้า `#lib/utils`, แก้ carry-over จาก Wave 1 (evidence dedupe, http(s) guard, tie-break, ETag/Last-Modified + conditional GET), เปิดใช้ source ที่ owner อนุมัติ, สร้าง digest job, brief jobs (morning/evening) พร้อม region quota และ `selection_reason`, `archive_snapshot`, job registry (`runJobByType`) + CLI แบบบาง, อัปเดต ARCHITECTURE §8/§9, และรัน live smoke แบบจำกัดจำนวน LLM request

## What I did (in order)

1. 12:01 — ตรวจ worktree (`feature/digest-and-briefs` ที่ `df27f9a`), อ่าน ARCHITECTURE ทั้งไฟล์, AGENT_PLAN (Wave 2 decisions), log ของ Wave 1 (llm-provider, news-ingestion, reviewer ทั้งสาม), types, repositories, jobs, news, llm, editorial
2. 12:02 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset`; baseline `npm test` ผ่าน 471 tests
3. 12:03–12:11 — **utils consolidation** (commit `db39a16`): ย้าย `canonicalizeUrl` (+ `isHttpUrl`) → `utils/url.ts`, `parseFeedTimestamp` + `hourSlot` → `utils/date.ts`, `withRetry`/`backoffDelayMs` → `utils/retry.ts` ด้วย `git mv` (เก็บประวัติ test); เพิ่ม helper ตาม §7 (`todayBriefDate`, `isBriefDate`, `isYearMonth`, `monthOf`, `addDays`, `bangkokDateTimeToUtc`, `bangkokDayRangeUtc`, `formatThaiDate`, `formatThaiTime`) และ `utils/params.ts` (`parseCategory`, `parseEdition`, `parsePageNumber`); `components/format.ts` ลบสำเนาซ้ำแล้ว re-export จาก utils เพื่อให้ไฟล์ `.svelte` ไม่ต้องแก้; route `+page.server.ts` ทั้งสี่ import parser จาก utils โดยตรง; `job-slots.ts` สร้าง slot ทั้งหมดบน utils (เพิ่ม `briefJobSlot`, `archiveJobSlot`)
4. 12:11–12:16 — **carry-overs** (commit `a2099a9`): `evidenceUrls()` dedupe, `insertArticleIfNew` ปฏิเสธ URL ที่ไม่ใช่ http(s), `listMatchableEvents` เรียง `last_updated_at desc, id asc`, คอลัมน์ `sources.etag/last_modified` (migration `0002_source_validators.sql` จาก `drizzle-kit generate --name source_validators` ซึ่งเป็นคำสั่งเดียวกับ `npm run db:generate`), RSS adapter ส่ง `If-None-Match`/`If-Modified-Since` และเก็บ validator หลัง insert สำเร็จเท่านั้น; ระหว่างอ่านโค้ดพบว่า seed demo events ลงวันที่วันนี้ จึงเพิ่มการแยก real/demo ใน grouping และ relation candidates (ไม่ให้ข่าวจริงไปรวมกับ event สมมติ)
5. 12:16–12:24 — **sources** (commit `c572b09`): เปิด `enabled: true` ทั้ง 6 ตัวพร้อม `license_notes: "Owner approved 2026-11-13: headline + link only"`; `ingest --dry-run` จริงครั้งแรกพบปัญหา 3 feeds (ดู Errors) → แก้ SafeFetch ให้คลาย gzip แบบจำกัดขนาด (UN News ใช้ได้), ปิด WHO (feed ค้าง) และ IMF (404) แล้ว dry-run ซ้ำผ่าน 4/4
6. 12:24–12:31 — **digest job** (commit `16f341d`): `jobs/digest.ts` (orchestrator, tagging, ambiguous clustering), `digest-content.ts` (extraction → summary → gate → save), `digest-links.ts` (relations + academy), `digest-llm.ts` (ส่ง `{job_run_id, signal}` ทุก call และนับ counter); เพิ่ม `bestEventMatch` ใน `news/grouping.ts`, `DigestRepository.mergeDraftEvent`, เปลี่ยน relation candidates เป็น "tag หรือ region ที่ไม่ใช่ global"; tests 8 ข้อ + repo tests 2 ข้อ
7. 12:31–12:35 — **brief jobs + archive_snapshot** (commit `27a0a00`): `jobs/briefs.ts` (`runBrief`, `briefWindow`), `jobs/brief-ranking.ts` (pure ranking + region quota 40% + `selection_reason` ภาษาไทย), `listCandidateEvents({ include_briefs_of })` สำหรับ snapshot merge; tests 11 ข้อ
8. 12:35–12:38 — **registry + CLI** (commit `b847e2e`): `jobs/registry.ts` (`runJobByType`), `scripts/job.ts` เหลือเป็น CLI บาง ๆ, ลบ `--strict` และ branch "not implemented", เพิ่ม `--max-events`, `runJob` รับ `signal` จากผู้เรียก; registry test ใช้ DB ไฟล์ชั่วคราวและบังคับ LLM เป็น not configured (ไม่มี network)
9. 12:39–12:43 — **live smoke** (รายละเอียดด้านล่าง): `db:reset` → ingest จริง → digest จริง `--max-events 3` (cap 40 requests) → `brief_morning` → dev server + screenshot → ปิด dev server
10. 12:42 — อัปเดต ARCHITECTURE §8/§9 (commit `86d4150`)
11. 12:43–12:45 — gates ทั้งหมด: check, lint, test (543), build, test:e2e (57 ผ่านบน DB ที่ seed ใหม่ ดู Errors #15)
12. 12:45 — เขียน log นี้
13. 12:46–12:51 — **requirement เพิ่มจาก coordinator** (ผล security review ของ admin lane): pipeline เขียนทับการแก้ไขของ admin ได้ → `saveEventContent` ป้องกัน field ที่ admin แก้ (ดูหัวข้อ Decisions) + tests 3 ข้อ + ARCHITECTURE §9 digest order ข้อ 4; รัน gates ทั้งหมดซ้ำแล้ว commit

## Files created / changed

- `src/lib/utils/{date,url,retry,params}.ts` + tests (`date.test.ts`, `url.test.ts`, `retry.test.ts`, `feed-timestamp.test.ts`) — helper กลาง
- `src/lib/components/format.ts` — ลบสำเนาซ้ำ, re-export จาก utils (พฤติกรรมเดิม, `format.test.ts` ผ่านทุกข้อ)
- `src/routes/{archive,brief/[date],connections,search}/+page.server.ts` — เปลี่ยนเฉพาะ import path
- `src/lib/types/{domain,news,repositories}.ts` — CONTRACT-CHANGE (ดูหัวข้อด้านล่าง)
- `src/lib/server/db/schema.ts`, `migrations/0002_source_validators.sql`, `migrations/meta/*` — คอลัมน์ `etag`, `last_modified`
- `src/lib/server/db/repositories/{ingest,digest,briefs,shared}.ts` + tests (`shared.test.ts` ใหม่)
- `src/lib/server/news/{adapters,safe-fetch,grouping,sources,normalize}.ts` + tests (`sources.test.ts` ใหม่); ลบ `news/canonical-url.ts`, `news/timestamps.ts`
- `src/lib/server/jobs/{digest,digest-content,digest-links,digest-llm,briefs,brief-ranking,registry}.ts` + tests (`digest.test.ts`, `briefs.test.ts`, `registry.test.ts`)
- `src/lib/server/jobs/{ingest,group-articles,job-slots,cli-args,runner}.ts` + tests ที่เกี่ยวข้อง
- `scripts/job.ts` — CLI บางบน registry, crontab comment อัปเดต
- `docs/ARCHITECTURE.md` — §8, §9 เท่านั้น
- `docs/screenshots/wave2/event-390.png`, `event-1440.png`
- `docs/agent-logs/20261113-1201_2_backend_digest-and-briefs.md` — log นี้
- (requirement เพิ่ม) `db/repositories/digest.ts` (`adminEditedContentFields`, `SYSTEM_ACTOR`), `jobs/digest-content.ts`, `jobs/digest.test.ts`, `types/repositories.ts`, `docs/ARCHITECTURE.md` §9

ไม่ได้แก้ `src/lib/server/llm/**`, `src/lib/server/editorial/**`, `hooks.server.ts`, `src/routes/admin/**`, `docs/AGENT_LOG.md`

## Commands run & results

| Time | Command | Result |
|---|---|---|
| 12:02 | `npm ci` · `cp .env.example .env` · `npm run db:reset` | ok (warning `allow-scripts` เดิม) |
| 12:02 | `npm test` (baseline) | 41 files, 471 passed |
| 12:10 | `npm run check` · `npx vitest run` (หลัง refactor) | 0 errors · 498 passed |
| 12:13 | `npx drizzle-kit generate --name source_validators` | `0002_source_validators.sql` (ADD COLUMN ×2) |
| 12:16 | `npx vitest run` | 507 passed |
| 12:17 | `npm run job -- ingest --dry-run` (จริง ครั้งที่ 1) | exit 2: 4 ok, un-news parse_error, imf-news 404, who-news 83/83 dropped |
| 12:19–12:20 | probe ผ่าน SafeFetch (1 request ต่อ URL): un-news, who-news, IMF `/en/News/RSS`, IMF `/en/Publications/RSS`, un-news (หลังแก้ gzip) | ดูตาราง feed ด้านล่าง |
| 12:21 | `npm run job -- ingest --dry-run` (จริง ครั้งที่ 2) | exit 0: sources_ok 4, items_fetched 133, items_dropped 17 |
| 12:30 | `npx vitest run src/lib/server/jobs/digest.test.ts` | 8 passed (หลังแก้ Errors #9–#11) |
| 12:34 | `npx vitest run src/lib/server/jobs/briefs.test.ts` | 11 passed |
| 12:37 | `npm run job -- scrape` · `digest --max-events 0` | exit 64 ทั้งคู่ |
| 12:39 | `npm run db:reset` | ok; digest จะไม่หยิบ seed event (`listEventsNeedingContent` = []) |
| 12:39 | `npm run job -- ingest` (จริง) | exit 0 (counters ด้านล่าง) |
| 12:39 | `npx tsx --env-file=C:\Project\WORLDVIEW\.env scripts/job.ts digest --max-events 3` (env: `LLM_DAILY_MAX_REQUESTS=40`, `DATABASE_URL=file:./data/worldview.db`) | exit 0, succeeded (ดูด้านล่าง) |
| 12:41 | `npm run job -- brief_morning` | exit 0, 1 event (ต่ำกว่า target, log warn) |
| 12:41 | `npx vite dev --port 5173` + curl `/`, `/brief/2026-11-13`, `/events/<id>` ×2 | 200 ทุกหน้า มีหัวข้อภาษาไทยจริง |
| 12:41 | Playwright screenshot 390/1440 ของ `/events/6b97f38d-…` | ไม่มี horizontal overflow; ปิด dev server แล้ว |
| 12:43 | `npm run check` · `npm run lint` · `npm test` · `npm run build` | 0 errors · exit 0 · 46 files / 543 passed · exit 0 |
| 12:44 | `npm run test:e2e` (dev DB ที่มีข้อมูล smoke) | 56 passed, 1 failed (Errors #15) |
| 12:45 | `DATABASE_URL=file:./data/e2e.db npm run db:reset` + `npm run test:e2e` | 57 passed |
| 12:51 | หลังแก้ admin protection: `check` · `lint` · `test` · `build` · `test:e2e` (e2e DB) | 0 errors · exit 0 · 46 files / 546 passed · exit 0 · 57 passed |

## Feed verification (2026-11-13, ผ่าน SafeFetch, 1 request ต่อ URL)

| Source | URL | Result | Action |
|---|---|---|---|
| UN News | `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | 200 แต่ body เป็น gzip ทั้งที่ขอ `identity` → malformed XML; หลังแก้ SafeFetch: 30 items, 19 ภายใน 72 ชม. | enabled |
| WHO | `https://www.who.int/rss-feeds/news-english.xml` | 200, 83 items แต่ล่าสุด 2026-10-10 และส่วนใหญ่เป็นข่าวปี 2020 ที่ถูกเปลี่ยน pubDate | disabled (จะทำให้ข่าวเก่าดูเหมือนข่าวใหม่) |
| IMF | `https://www.imf.org/en/News/rss?language=eng` | HTTP 404; ลอง `/en/News/RSS?language=eng` และ `/en/Publications/RSS?language=eng` ก็ 404; หน้า Social Hub ของ imf.org ไม่มีลิงก์ RSS แล้ว | disabled |
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | 200, 33 items | enabled |
| Guardian World | `https://www.theguardian.com/world/rss` | 200, 45 items | enabled |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 200, 25 items | enabled |

## Live smoke results (ไม่มี secret)

**Ingest** (`ingest:2026-11-13T12`, succeeded): sources_ok 4, sources_failed 0, items_fetched 133, items_dropped 17, articles_inserted 116, duplicates_url 0, duplicates_content 0, articles_grouped 116, events_created 114, events_updated 0 (ambiguous → new 14)

**Digest** (`digest:2026-11-13T12`, `--max-events 3`, succeeded, ~66 วินาที): events_published 3, events_pending_review 0, events_updated 2 (clustering merge 2 คู่), relations 0 (published/pending/dropped = 0), lesson_links 5, llm_requests 14, llm_cache_hits 0, llm_failures 0, llm_tokens 33,458

`llm_calls` ตามจริง: tagging 2 (`cx/gpt-5.6-luna`), clustering 1 (`cx/gpt-5.6-luna`), extraction 3, summary 3, relations 2, academy_linking 3 (`cc/claude-sonnet-5-5`) = 14 requests, error 0, ไม่มี repair/fallback (ต่ำกว่า cap 40 มาก)

**Brief** (`brief_morning:2026-11-13`): brief_candidates 1, brief_events 1 — อีกสอง event เผยแพร่หลัง 07:00 ICT จึงอยู่นอก window ของรอบเช้าอย่างถูกต้อง

**หน้าเว็บ**: `/`, `/brief/2026-11-13`, `/events/6b97f38d-…`, `/events/30ac288d-…` ตอบ 200 และแสดงสรุปภาษาไทยจริง; screenshots `docs/screenshots/wave2/event-390.png`, `event-1440.png`

**ประเมินคุณภาพ (event Nvidia `6b97f38d-…`)**
- หัวข้อ: "เจนเซน หวง อดีตซีอีโอ Nvidia ถูกระบุว่าจะให้ปากคำต่อสภาคองเกรสสหรัฐฯ"; แหล่งข่าว 2 แห่ง (BBC News, The Guardian) ทั้งสองลิงก์ไปที่ article ที่เก็บไว้จริง
- สรุปบอกตรง ๆ ว่ามีเพียงพาดหัวข่าว และแยกว่าแต่ละสำนักพูดอะไร (BBC ใช้คำว่า "ถูกเรียกตัว", Guardian ใช้ "คาดว่าจะให้ปากคำ")
- ส่วน "สิ่งที่ยังไม่ชัดเจน" ระบุความขัดแย้งเรื่องตำแหน่ง ("อดีต" ซีอีโอ) และที่มาของข้อกล่าวหาเรื่องสายลับ ไม่พบข้อมูลที่แต่งขึ้นเอง
- จุดอ่อน: หัวข้อใช้คำว่า "อดีตซีอีโอ" ตามพาดหัว BBC เหมือนเป็นข้อเท็จจริง แม้ส่วน uncertain จะบอกว่าไม่แน่ชัด (ควรให้ prompt ของ summary ใส่การอ้างที่มาในหัวข้อด้วย)
- event อื่น: claims มีผู้กล่าวอ้างชัดเจน (เช่น "พระสันตะปาปาลีโอ", "The Guardian (ตามพาดหัวข่าวของบทความ)") และ evidence ชี้ไปที่ article จริง; การ merge ข่าว Nvidia (BBC + Guardian) ถูกต้อง ส่วนข่าวพระสันตะปาปา (เรียกร้องให้ชดเชย + พบผู้รอดชีวิตในเปรู) เป็นสองเหตุการณ์ในทริปเดียวกัน ถือว่าก้ำกึ่ง

## Errors & problems

| # | Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|---|
| 1 | 12:15 | `news/adapters.ts` `singleLine` (แก้ผ่าน Python heredoc) | regex `/[\r\n]/` กลายเป็นตัว CR/LF จริงในไฟล์ | Python ตีความ `\r\n` ใน string ที่ไม่ใช่ raw (กับดัก encoding ที่ทีมเตือนไว้) | แก้ด้วย Edit tool แล้วตรวจ byte ด้วย `od -c`; หลังจากนั้นใช้ Edit tool กับโค้ดที่มี backslash |
| 2 | 12:16 | `adapters.test.ts` "sends the stored validators…" | `NewsFetchError: RSS feed has no channel` | `<channel></channel>` ว่าง fast-xml-parser แปลงเป็นค่าว่าง | ใส่ `<title>` ใน channel ของ test |
| 3 | 12:17 | `ingest --dry-run` จริง → un-news | `parse_error: malformed XML` | server ส่ง body เป็น gzip แม้ขอ `accept-encoding: identity` | SafeFetch คลาย gzip (ดูจาก header หรือ magic bytes) โดยจำกัดขนาดหลังคลายที่ 5 MB (bomb → `too_large`), encoding อื่นถูกปฏิเสธ; test ใหม่ |
| 4 | 12:17 | `ingest --dry-run` จริง → who-news | 83 items ถูก drop ทั้งหมด | feed ค้าง (ล่าสุด 2026-10-10, ส่วนใหญ่ข่าวปี 2020 ที่เปลี่ยนวันที่) | ปิดใช้งานและรายงาน owner |
| 5 | 12:17 | `ingest --dry-run` จริง → imf-news | HTTP 404 | URL เดิมไม่มีแล้ว; URL ทางเลือก 2 แบบก็ 404 | ปิดใช้งานและรายงาน owner |
| 6 | 12:18 | probe script ใน scratchpad | `Top-level await … "cjs"`, แล้ว `ERR_UNSUPPORTED_ESM_URL_SCHEME`, แล้ว `allowedHosts.map is not a function` | ไฟล์ `.ts` ถูก transform เป็น CJS, path Windows ต้องเป็น `file:///`, `allowedHosts` ต้องเป็น array | เปลี่ยนเป็น `.mts`, ใช้ `file:///C:/…`, ส่ง array (ทั้งสามครั้งล้มก่อนส่ง request ใด ๆ) |
| 7 | 12:20 | `safe-fetch.test.ts` gzip test | กรณี `content-encoding: br` ไม่ throw | ตรวจ magic bytes ก่อนตรวจ header จึงคลาย gzip ทั้งที่ header บอก br | เรียงลำดับใหม่: ปฏิเสธ encoding ที่ไม่รู้จักก่อน แล้วจึงดู magic bytes |
| 8 | 12:21 | `ingest.test.ts` "fails … when no source is enabled" | ได้ "4 of 4 sources failed" แทน "no enabled sources" | production registry มี source เปิดใช้แล้ว | test ปิดทุก source ใน registry ที่ส่งเข้าไปเอง |
| 9 | 12:27 | `digest.test.ts` (เขียนด้วย Write tool) | `\u0E00-\u0E7F` กลายเป็นตัวอักษรจริงในไฟล์ | กับดัก encoding ของ Write tool | เปลี่ยนเป็น `/\p{Script=Thai}/u` ด้วย Edit tool; สแกนไฟล์ก่อน commit ทุกครั้ง (0 hits) |
| 10 | 12:28 | `digest.test.ts` acceptance #9 | `createDraftEvent: all articles are already linked` | helper `addArticle` อ่าน counter หลัง `await` ภายใต้ `Promise.all` ทำให้สอง article ได้ URL เดียวกัน | เก็บค่า counter ไว้ก่อน `await` |
| 11 | 12:29 | `npm run check` → `digest.test.ts` | `Spread types may only be created from object types` | cast เป็น `never` แล้ว spread | เพิ่ม helper `defaultSummary(): SummaryOutput` |
| 12 | 12:33 | `briefs.test.ts` ranking 2 ข้อ | reason "ครอบคลุมข่าวจากเอเชีย" โผล่ทั้งที่ไม่มีข่าว US/EU ถูกกัน; test 40% คาดผิดสำหรับ max 5 | quota cap ของ target เล็กกระทบทุก region และ test ตั้งค่าคาดหวังผิด | ใส่ reason เรื่อง region เฉพาะเมื่อมีข่าว americas/europe ถูก defer จริง; test ใช้ 15 candidates / 10 slots |
| 13 | 12:34 | chain `eslint && … && git commit` | commit ไม่เกิดขึ้น | eslint: import `eq` ไม่ได้ใช้ใน `briefs.test.ts` | ลบ import แล้ว commit ใหม่ |
| 14 | 12:42 | แก้ ARCHITECTURE ผ่าน bash heredoc | `unexpected EOF while looking for matching '` | bash parse เนื้อหา heredoc ยาวที่มีอักขระพิเศษไม่ผ่าน | เขียน Python script เป็นไฟล์ใน scratchpad แล้วรัน |
| 15 | 12:44 | `npm run test:e2e` | "category chips filter Today…" ไม่พบ card | e2e เขียนไว้กับข้อมูล demo seed แต่ dev DB ตอนนี้มี brief จริงของวันนี้ (1 event หมวด society) | ไม่ใช่ bug ของโค้ด; รัน e2e กับ `DATABASE_URL=file:./data/e2e.db` ที่ seed ใหม่ → 57/57 ผ่าน; dev DB เก็บข้อมูล smoke ไว้ตามที่สั่ง |
| 16 | 12:46 | `db/repositories/digest.ts` `saveEventContent` (พบโดย security review ของ admin lane ส่งต่อผ่าน coordinator) | การแก้ไขของ admin ถูกเขียนทับเมื่อ digest re-summary | repository ไม่ตรวจ `content_revisions` ของ admin ก่อนเขียน `*_th` | option (a) ตามหัวข้อ Decisions; tests: admin-edited published event + article ใหม่ → ข้อความ admin อยู่รอด (รวมถึงรอบที่สอง), event ที่ไม่มี admin edit ยัง re-summary ตามเดิม, event ที่ยังไม่ published แต่ admin แก้แล้ว → `pending_review [manual_flag]` |

## Decisions

- **Admin corrections ชนะ pipeline (PRD FR-06 / §9.2) — เลือก option (a)**
  - ตรวจใน transaction เดียวกับการเขียนใน `saveEventContent`: field ที่ admin เคยแก้คือ key ใน `before_after.after` ของทุก `content_revisions` ของ event ที่ `changed_by` ไม่ใช่ `system` (admin lane เขียน email ของ admin ลงช่องนี้ ส่วน pipeline เขียน `system`)
  - ใช้ revision ของ admin **ทั้งหมด** ไม่ใช่เฉพาะที่ใหม่กว่า `summarized_at` เพราะหลัง re-summary ครั้งแรก `summarized_at` จะเลยเวลาที่ admin แก้ไปแล้ว ถ้าใช้เงื่อนไข "ใหม่กว่า" การ re-summary ครั้งถัดไปจะเขียนทับข้อความของ admin
  - field ที่ admin ไม่ได้แตะยังอัปเดตตามหลักฐานใหม่; event ที่ published ยังคง published; `system` revision ระบุว่า "admin-edited fields kept" และ digest log `admin_fields_kept`
  - event ที่ยังไม่ published แต่ admin แก้แล้วจะไม่ถูก auto-publish: คงเป็น `pending_review` พร้อม `manual_flag` จนกว่า admin จะกด publish เอง
  - ไม่เลือก (b) เพราะ review queue แสดงเฉพาะ event `pending_review` และห้าม auto-demote event ที่ published แล้ว (§6) จึงไม่มีทางนำ event ที่ published เข้า queue ได้โดยไม่ผิดกฎ
- เลือก **merge draft เข้า event อีกฝั่งเสมอ** หลัง clustering ตอบ `same_event` (ตัด heuristic ทิศทาง merge ที่เปราะบางออก เพราะ derived fields คำนวณใหม่จาก article อยู่แล้ว)
- **ข่าวจริงกับ demo ไม่ปนกัน** ทั้งใน grouping, relation candidates และ brief (demo ใช้เมื่อไม่มี event จริงเท่านั้น)

## CONTRACT-CHANGEs

1. `types/domain.ts` — `Source.etag`, `Source.last_modified` (nullable)
2. `types/news.ts` — `SourceDefinition` omit `etag`/`last_modified`; ใหม่ `FeedValidators`; `FetchContext.conditional?`; `FetchResult.not_modified` + `validators`; `EventMatchCandidate.is_demo`
3. `types/repositories.ts` — `IngestRepository.recordSourceFetch` ok variant รับ `validators?`; `DigestRepository.mergeDraftEvent(source, target, confidence, now)` ใหม่; `listRelationCandidates` จับคู่ด้วย tag หรือ region ที่ไม่ใช่ `global` (เดิม tag หรือ category) และ `is_demo` เดียวกัน; `BriefRepository.listCandidateEvents` รับ `include_briefs_of?`
4. ARCHITECTURE §8 เดิมวาง `rankBriefCandidates` ไว้ใน `editorial` แต่ editorial อยู่นอก lane จึงอยู่ที่ `server/jobs/brief-ranking.ts` (pure เหมือนเดิม)
5. `jobs/registry.ts` เป็น composition root ใน `server/jobs` ที่ import db/config ตรง (ข้อยกเว้นของกฎ §1 "jobs must not import concrete db") — §1 อยู่นอก lane จึงบันทึกใน §8 แทน
6. CLI: ลบ `--strict`, เพิ่ม `--max-events N`
7. `DigestRepository.saveEventContent` คืน `{ status, admin_fields_kept }` (เดิม `Promise<void>`) และไม่เขียนทับ field ที่ admin แก้; event ที่ยังไม่ published แต่ admin แก้แล้วจะถูกเก็บเป็น `pending_review` + `manual_flag` แทน `published`

## Open issues / follow-ups for the orchestrator

- **WHO และ IMF ปิดอยู่**: ต้องให้ owner ยืนยัน URL ใหม่ (IMF ไม่มีลิงก์ RSS บน imf.org แล้ว; WHO feed ค้าง)
- `canonicalizeUrl` ยังไม่ตัด tracking params `traffic_source` (Al Jazeera) และ `at_campaign`/`at_medium` (BBC) — URL เดียวกันจากคนละ feed อาจไม่ dedupe; เสนอเพิ่มใน `TRACKING_PARAMS`
- คุณภาพ summary: หัวข้ออาจยกถ้อยคำจากพาดหัวมาเป็นข้อเท็จจริง (เช่น "อดีตซีอีโอ") — lane LLM อาจปรับ prompt ให้ attribute ในหัวข้อ; clustering merge คู่ Pope ก้ำกึ่ง (threshold 0.7 อาจต้องจูน)
- digest ยังไม่สร้าง `event_updates` ตอน re-summary (`new_updates: []`) จึงยังไม่มี timeline
- ไม่มี circuit breaker เมื่อ LLM ล่ม: event ที่เหลือจะยังเป็น draft จนหมดเวลา 20 นาที (ถูก retry รอบถัดไป)
- `llm/provider.ts` ยังมี `backoffDelay`/`bangkokDayStartUtc` และ `editorial/text.ts` มี `isHttpUrl` ซ้ำกับ utils (นอก lane, ไม่ได้แก้)
- ARCHITECTURE §6 ยังไม่มี `llm_request_rejected` (ค้างจาก Wave 1, นอก lane)
- e2e ผูกกับข้อมูล demo seed: Wave 3 ควรรัน e2e กับ DB ที่ seed แยก หรือทำ test ให้ไม่ขึ้นกับข้อมูล
- screenshot full-page ที่ 1440 พื้นหลัง sidebar สิ้นสุดที่ความสูง viewport (frontend)
- Admin lane: เรียก `runJobByType(type, { date, force: true, manual: true, signal })` ได้โดยตรง; ฟังก์ชันไม่ throw และเปิด/ปิด DB connection ของตัวเอง; log เป็น JSON บน stdout
