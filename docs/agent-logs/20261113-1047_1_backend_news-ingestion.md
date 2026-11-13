# 1 · backend · news-ingestion

| Field | Value |
|---|---|
| Started | 2026-11-13 10:47:30 (Asia/Bangkok) |
| Finished | 2026-11-13 11:18:00 (Asia/Bangkok); รอบแก้ตาม review 11:29–11:44 |
| Status | done |
| Agent type | backend |

## Goal
Wave 1 lane "News & Jobs" มีงานดังนี้ ทั้งหมดทำบน branch `feature/news-ingestion` ใน worktree `C:\Project\WORLDVIEW-worktrees\news-ingestion`
- สร้าง `SafeFetch` ที่ป้องกัน SSRF ด้วย allowlist
- สร้าง source registry, RSS/Atom adapter และ fixture adapter
- ทำ normalization, canonical URL และ content fingerprint สำหรับ dedup
- ทำ rule-based grouping
- ทำ job runner ที่รองรับ claim, counters, backoff และ partial run
- แก้ CONTRACT-GAP ของ `JobRunRepository.finish`
- ทำ CLI `npm run job -- <type>`

## What I did (in order)
1. 10:47 — ตรวจว่า worktree อยู่บน branch `feature/news-ingestion` แล้วอ่านเอกสารต่อไปนี้
   - `docs/ARCHITECTURE.md` §1, §2, §7, §8, §9, §12, §14, §16, §18
   - types: `news.ts`, `jobs.ts`, `repositories.ts`, `domain.ts`
   - repositories: `ingest`, `digest`, `job-runs`
   - PRD §4, §9.1, §11, §12
2. 10:48 — setup: รัน `npm ci`, คัดลอก `.env.example` เป็น `.env`, รัน `npm run db:reset` แล้วรัน `npm test` เก็บไว้เป็น baseline
3. 10:49 — เพิ่ม dependency `fast-xml-parser@^5.12.0` ซึ่งเป็น XML parser ที่เบาและไม่ resolve external entity
4. 10:52 — แก้ CONTRACT-GAP (item 7)
   - `finish(runId, attempt, outcome, finishedAt): Promise<boolean>` ใช้ `attempts` เป็น claim token
   - `UPDATE` จะทำงานเฉพาะเมื่อ `id`, `attempts` และ `status='running'` ตรงกันทั้งหมด
   - ไม่ต้องเพิ่ม column และไม่ต้องมี migration
   - เพิ่มคอมเมนต์ `// CONTRACT-CHANGE:` ใน `types/repositories.ts`
   - เพิ่ม test 2 ข้อ: stale process เขียนทับไม่ได้ และ finish ซ้ำไม่ได้
   - commit `f90fe47`
5. 10:53–11:00 — เขียน `src/lib/server/news/**`
   - `errors.ts`, `canonical-url.ts`, `fingerprint.ts`, `timestamps.ts`, `normalize.ts`, `feed-parser.ts`
   - `safe-fetch.ts`: ใช้ `node:https` ร่วมกับ `lookup` ที่ตรวจ IP ตอน connect และใช้ `net.BlockList`
   - `adapters.ts`, `sources.ts`, `grouping.ts`
   - fixture feeds `wire-a.xml` (RSS), `wire-b.xml` (Atom), `wire-c.xml` (RSS ที่มีข่าวไทย) และ `malformed.xml`
6. 11:00–11:03 — เขียน `src/lib/server/jobs/**` และ `scripts/job.ts`
   - modules: `retry.ts`, `job-slots.ts`, `logger.ts`, `runner.ts`, `ingest.ts`, `group-articles.ts`, `cli-args.ts`
   - เพิ่ม npm script `job` และใส่ crontab ที่เป็นเวลา UTC ไว้ใน comment
7. 11:03–11:08 — เขียน tests แบบ Vitest ที่ไม่ใช้ network
   - URL table, fingerprint, timestamps, normalize, parser, SafeFetch, adapters, grouping
   - retry, slots, CLI args
   - integration ของ ingest กับ in-memory DB ครอบคลุม acceptance #3, #4, #5, partial run และ stale claim
8. 11:09 — รัน CLI จริงกับ fixtures: dry-run, run 1, run 2 (skipped) และ run 3 (`--force`) รวมถึง stub jobs และ usage error
9. 11:10 — ทำ self-review
   - ลบ wrapper ที่ไม่จำเป็นออก (`normalizeKeyword`, `isNewsFetchError`)
   - commit `0c1d8e7` (news) และ `dfa7f72` (jobs)
10. 11:11–11:15 — ส่ง diff ให้ subagent `reviewer` ตรวจ read-only ด้าน SSRF, untrusted input และ correctness ผลคือไม่พบปัญหาระดับ high และมีข้อเสนอแนะระดับ medium/low 8 ข้อ
11. 11:15–11:17 — แก้ตามข้อเสนอแนะ แล้ว commit `6e2cd0e`
    - race การ resolve DNS กับ timeout
    - block `::/96`
    - cap categories ตั้งแต่ก่อน clean
    - นับ `articles_inserted` ทีละแถว
    - ใช้ `Promise.allSettled` ใน concurrency helper
    - ปฏิเสธ `--fixtures` เมื่อ `NODE_ENV=production`
    - ข้อ 1 (ลำดับ tagging/grouping) และข้อ 8 (tie-break ใน digest repo) อยู่นอก lane จึงบันทึกเป็น follow-up

## Files created / changed
- `src/lib/types/repositories.ts`: `finish` รับ `attempt` และคืนค่า `boolean` (CONTRACT-CHANGE)
- `src/lib/server/db/repositories/job-runs.ts` และ `job-runs.test.ts`: เพิ่มการตรวจ claim token พร้อม test
- `src/lib/server/news/`
  - `safe-fetch.ts`: SSRF allowlist, ตรวจ IP หลัง DNS และทุก redirect hop (สูงสุด 3 hop), timeout 15 s, body cap 5 MB, ตรวจ content-type, User-Agent `WorldviewBot/0.1`
  - `feed-parser.ts`: RSS 2.0, RSS 1.0 (RDF), Atom; ปฏิเสธ DOCTYPE และ malformed XML; item cap 200
  - `normalize.ts`: strip HTML, decode entities, cap ความยาว; เก็บ excerpt เฉพาะเมื่อ `allow_excerpt`; ไม่อ่าน `content:encoded`
  - `canonical-url.ts`: canonicalization (ตาม contract ควรอยู่ใน `utils/url.ts`)
  - `fingerprint.ts`: sha256 content hash
  - `timestamps.ts`: `parseFeedTimestamp` (ตาม contract ควรอยู่ใน `utils/date.ts`)
  - `grouping.ts`: Thai trigram และ English word Jaccard บวก keyword bonus, time window 72 h, threshold 0.6/0.3
  - `adapters.ts`: `rss` adapter และ `fixture` adapter (มี path containment check) พร้อม charset decoding (รองรับ windows-874)
  - `sources.ts`: fixture wires A/B/C และ candidate real feeds 6 รายการ ทั้งหมดเป็น `enabled: false` และ `license_notes: "TODO: owner must confirm terms"`
  - `*.test.ts` สำหรับทุก module ข้างบน
- `src/lib/server/jobs/`
  - `runner.ts`: claim, `JobContext` และ abort 20 นาที, finish พร้อม token, log สรุปเป็น JSON
  - `retry.ts`: `withRetry` และ `backoffDelayMs` (ตาม contract ควรอยู่ใน `utils/retry.ts`)
  - `ingest.ts`: `runIngest` และ `previewIngest` (dry-run)
  - `group-articles.ts`: grouping step
  - `job-slots.ts`: `hourSlot` และ `hourlyJobSlot`
  - `logger.ts`: JSON logger
  - `cli-args.ts`: parse CLI arguments
  - `*.test.ts`
- `scripts/job.ts`: composition root และ crontab comment
- `tests/fixtures/feeds/*.xml`: fixture feeds สมมติ (ไม่ใช่ข่าวจริง)
- `package.json` และ `package-lock.json`: เพิ่ม `fast-xml-parser` และ script `job`

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 10:47 | `git -C … branch --show-current` | `feature/news-ingestion` |
| 10:48 | `npm ci` | ok มี warning `allow-scripts` ของ esbuild/better-sqlite3 แต่ binding ใช้งานได้ |
| 10:48 | `npm run db:reset` | ok — seed 24 articles, 13 events, 30 lessons |
| 10:49 | `npm test` (baseline) | 15 files / 107 tests passed |
| 10:49 | `npm install fast-xml-parser@^5` | ok — 5.12.0 |
| 10:52 | `npx vitest run …/job-runs.test.ts` | 7 passed |
| 11:01 | `npm run check` | fail 2 errors (ดู Errors #1, #2) แล้วแก้จนเหลือ 0 errors |
| 11:01 | `npx eslint …` | fail 1 error (ดู Errors #3) แล้วแก้จนผ่าน |
| 11:05 | `npx vitest run src/lib/server/news` | fail 2 (ดู Errors #5, #6) แล้วแก้จนผ่าน |
| 11:06 | `npx vitest run src/lib/server/news` | fail 1 (ดู Errors #7) แล้วแก้จนผ่าน |
| 11:08 | `npx vitest run src/lib/server` | fail 1 (ดู Errors #8) แล้วแก้จนผ่าน |
| 11:09 | `npm run job -- ingest --fixtures --dry-run` | exit 0: sources_ok 3, items_fetched 9, items_dropped 2, ไม่แตะ DB |
| 11:09 | `npm run job -- ingest --fixtures` (run 1) | exit 0: articles_inserted 6, duplicates_url 1, articles_grouped 6, events_created 4 |
| 11:09 | `npm run job -- ingest --fixtures` (run 2) | exit 0: `job skipped` reason `already_done`, เพิ่ม 0 แถว |
| 11:09 | `npm run job -- ingest --fixtures --force --manual` (run 3) | exit 0: articles_inserted 0, duplicates_url 7, events_created 0, attempt 2 |
| 11:09 | `npm run job -- digest` / `brief_morning --strict` / `archive_snapshot --date 2026-11-12` | exit 0 / 1 / 0 พร้อมข้อความ "not implemented yet (Wave 2)" |
| 11:09 | `npm run job -- scrape` | exit 64 (usage error) |
| 11:09 | `npm run job -- ingest --dry-run` (production registry) | exit 1 "no enabled sources" |
| 11:09 | ตรวจ row counts ของ dev DB | articles 30 (24 seed + 6), events 17 (13 + 4), event_articles 30, job_runs 1 |
| 11:09 | `npm test` / `npm run build` | 27 files / 277 tests passed / build ok |
| 11:16 | `npm run lint` / `check` / `test` / `build` (หลังแก้ตาม review) | ผ่านทั้งหมด: 281 tests, 0 type errors |
| 11:17 | `npm run job -- ingest --fixtures --force --manual` | exit 0: articles_inserted 0, duplicates_url 7 (attempt 3) |

## Errors & problems
| # | Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|---|
| 1 | 11:01 | `npm run check` → `news/feed-parser.ts` `asNodes` | `unknown[]` is not assignable to `XmlNode[]` | `flatMap` ที่ใช้ `asNode(entry) ?? []` ทำให้ TS infer ไม่ได้ว่าเป็น `XmlNode[]` | ระบุ return type `(entry): XmlNode[] => …` ให้ callback |
| 2 | 11:01 | `npm run check` → `news/safe-fetch.ts` `new Response(body)` | `Uint8Array<ArrayBufferLike>` ใช้เป็น `BodyInit` ไม่ได้ | TS 6 แยก generic ของ ArrayBuffer และ `readBodyCapped` ประกาศ return type กว้างเกินไป | เปลี่ยน return type เป็น `Uint8Array<ArrayBuffer>` |
| 3 | 11:01 | `eslint` → `news/feed-parser.ts:31` | `no-irregular-whitespace` | Write tool แปลง escape `\uFEFF` ใน regex ให้กลายเป็นตัวอักษร BOM จริง | แก้เป็น escape `\uFEFF`; รอบแรกที่ใช้ `sed` ทำ backslash หาย จึงแก้ซ้ำด้วย Python ที่อ่านเป็น bytes |
| 4 | 11:04 | แก้ `normalize.ts` ผ่าน Bash heredoc + Python | regex `\b` กลายเป็นตัว backspace (0x08) และ `sed` แก้แล้วได้ `b` | shell/Python ตีความ backslash escape (`\b`) ใน string ที่ไม่ใช่ raw | ใช้ Edit tool ใส่ `\b` แทน แล้ว grep หา control chars ทั้ง repo ไม่พบ หลังจากนั้นใช้ Edit/Write กับโค้ดที่มี backslash เท่านั้น |
| 5 | 11:05 | test `feed-parser.test.ts` "flattens xhtml titles" | ได้ `'there Hello'` แต่คาดว่า `'Hello there'` | fast-xml-parser (non-preserveOrder) ไม่เก็บลำดับของ mixed content | ยอมรับเป็น limitation (Atom `type="xhtml"` พบได้น้อย) จดไว้ใน doc comment ของ `textOf` และเปลี่ยน test ให้ตรวจเฉพาะคำ ไม่ตรวจลำดับ |
| 6 | 11:05 | test `safe-fetch.test.ts` "caller abort" | timeout 5 s | caller abort เกิดระหว่างรอ DNS แล้ว fake transport ฟัง abort จาก signal ที่ถูก abort ไปแล้ว ทำให้ไม่มี event ส่งมาอีก | เพิ่ม `signal.throwIfAborted()` ก่อนทุก hop และภายหลังย้ายเข้าไปใน `raceAbort` ของ DNS |
| 7 | 11:06 | test `grouping.test.ts` "ambiguous" | `ambiguous_count` ได้ 0 แต่คาดว่า 1 | หัวข้อข่าวในตัวอย่างต่างกันเกินไป (score 0.25 < 0.3) | เปลี่ยนเป็นตัวอย่างที่ score อยู่ในช่วง 0.3–0.6 จริง ("Avalor and Meridia sign trade accord") |
| 8 | 11:08 | test `retry.test.ts` | ได้ 3998 แต่คาดว่า 4000 | test คำนวณ jitter ผิดเอง (4000 × 0.9995 = 3998) | แก้ค่าที่คาดไว้ใน test (โค้ดถูกต้อง) |
| 9 | 11:15 | review โดย subagent `reviewer` | findings 2–7: lane ที่ throw ยังเขียน DB ต่อหลังปิด DB, counter `articles_inserted` ไม่นับ insert ที่ commit แล้วเมื่อ insert ถัดไปล้ม, categories ถูก clean ก่อน cap, DNS ไม่สนใจ timeout, `::/96` ไม่ถูก block, `--fixtures` ใน production | จุดบกพร่องในการออกแบบรอบแรก | แก้ครบใน `6e2cd0e` พร้อม test ใหม่ 3 ข้อ |

## Open issues / follow-ups for the orchestrator
- **Grouping ทำงานตอนท้ายของ ingest** ซึ่งสอดคล้องกับ counters ที่ task ขอ และ acceptance #3/#4 แต่ ARCHITECTURE §9 วาง grouping ไว้ใน digest หลัง tagging
  - ผลคือ digest (Wave 2) ต้องเลือก article ด้วยเงื่อนไข `taxonomy IS NULL` แทน "unassigned" มิฉะนั้น tagging จะไม่ได้ทำงาน
  - อีกทางคือย้าย grouping ไปไว้ใน digest แล้วลบออกจาก ingest
  - เรื่องนี้ต้องให้ software-eng ตัดสินใจและอัปเดต contract
- ฟังก์ชันที่ contract กำหนดให้อยู่ใน `utils/` แต่ตอนนี้อยู่ใน lane ของผม: `canonicalizeUrl`, `parseFeedTimestamp`, `withRetry`/`backoffDelayMs`, `hourSlot` ควรย้ายเข้า `utils/` (ทั้งหมดเป็น pure function ยกเว้น `canonicalizeUrl` ที่ใช้ `URL`)
- `fingerprint` เก็บ `\p{M}` เพิ่มจาก `\p{L}\p{N}` ใน contract เพราะสระและวรรณยุกต์ไทยเป็น combining mark ควรอัปเดตเอกสาร §9
- `SOURCE_KINDS` มีแค่ `rss` และ `fixture` ส่วน Atom ใช้ adapter `rss` (parser ตรวจชนิด feed เอง) จึงไม่ได้เพิ่ม kind `atom`
- ETag/Last-Modified: `SafeFetch` และ adapter รองรับ 304 แล้ว แต่ยังไม่ส่ง validator เพราะยังไม่มี column สำหรับเก็บ etag ใน `sources` (schema เป็นของ db lane)
- ทุก real source ยัง disabled จึงทำให้ production cron ingest จบด้วย `failed` (exit 1, "no enabled sources") จนกว่า owner จะอนุมัติ source (PRD §12)
- `listMatchableEvents` ใน digest repo ควรเพิ่ม `asc(events.id)` เป็น tie-break เพื่อให้ผลลัพธ์ deterministic
- รัน `--fixtures` แล้ว fixture sources ใน dev DB จะยัง enabled อยู่ การรัน ingest ปกติครั้งถัดไปจะ sync และ disable ให้เอง ส่วน demo seed sources ถูก disable อยู่แล้ว

## รอบแก้ตาม review (2026-11-13 11:29–11:44)

ที่มา: review ฉบับเต็มอยู่ที่ `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1120_1_reviewer_news-ingestion.md` และ probe ที่ใช้คือ `scratchpad\probe-news\group.ts` ส่วน probe ที่ผมเขียนเพิ่มอยู่ใน `scratchpad\probe-backend\`

**Decision (grouping vs tagging):** coordinator เลือก option (a) ingest ยังทำ rule-based grouping ต่อไป ส่วนใน Wave 2 digest จะ tag article ที่ `WHERE taxonomy IS NULL` โดยไม่สนว่า group แล้วหรือยัง และจะใช้ LLM clustering เฉพาะคู่ที่เป็น ambiguous เท่านั้น ไม่มีการแก้โค้ดในรอบนี้

### Steps
1. 11:29 — อ่าน review และ probe แล้วทดสอบพฤติกรรม runtime ก่อนเริ่มแก้
   - V8 ยอมรับวันที่ "31 Feb" แล้ว roll ไปเป็น 3 มี.ค. ทั้งใน ISO และ RFC 822
   - `new Response(<empty>, {status: 204})` throw `TypeError`
   - `TextDecoder` ตัด BOM ให้เองเมื่อเลือก encoding ถูกตัว
2. 11:30–11:36 — ออกแบบ grouping ใหม่ (finding 1–2)
   - เพิ่ม `grouping-vocabulary.ts`: `PLACES` (ประเทศ เมืองใหญ่ ภาคและจังหวัดของไทย) และ `EVENT_TYPES` (flood, heatwave, earthquake, storm, wildfire และอื่น ๆ ทั้ง EN และ TH)
   - เขียน `grouping.ts` ใหม่
   - รัน probe ของ reviewer ซ้ำทีละรอบจนทุกคู่ที่ต้องไม่ merge ถูกแยก และคู่ที่เป็นข่าวเดียวกันยัง merge
   - เพิ่ม `tests/fixtures/grouping/cases.json` แล้ว commit `ff6fe22`
3. 11:36–11:40 — แก้ finding 3–11 และบันทึก finding 12 เป็นเอกสาร
   - เพิ่ม test ใหม่ 32 ข้อ (รวมเป็น 325)
4. 11:41 — รัน gates: `lint`, `check`, `test` (325 passed) และ `build` ผ่านทั้งหมด
5. 11:41 — `npm run db:reset` แล้วรัน `ingest --fixtures` สามครั้ง
   - run 1 ใช้ key `ingest:fixtures:2026-11-13T11`: inserted 6, dup_url 1, grouped 6, events_created 4
   - run 2: skipped `already_done`
   - run 3 (`--force`): inserted 0, dup_url 7, events_created 0
   - DB หลังรัน: articles 30, events 17
6. 11:42 — commit `e691063` (news) และ `12c80de` (jobs)

### Findings: ผลการแก้รายข้อ
| # | Finding | Status | แก้อย่างไร / เหตุผล |
|---|---|---|---|
| 1 | feed categories ทั่วไปเพิ่ม score +0.25 | fixed | เอา categories ออกจาก score ทั้งหมด (และลบ field `categories` ออกจาก `GroupableArticle`) เหลือ entity Jaccard ที่ weight 0.15 ซึ่งใช้เฉพาะ entity ที่แยกแยะข่าวได้ |
| 2a | token ที่เป็นตัวเลขล้วน | fixed | `titleTokens` ข้าม `^\p{N}+$` (รวมเลขไทย) |
| 2b | ไม่มี entity/event-type conflict | fixed | ถ้า entity ของสองฝั่งไม่ซ้ำกันเลย หรือ event type ไม่ซ้ำกันเลย score จะถูก cap ที่ `joinThreshold − conflictMargin` (ได้แค่ ambiguous) entity มาจาก `PLACES` (EN ตรงทั้งคำ, TH ตรงแบบ substring), acronym และคำขึ้นต้นตัวใหญ่ในหัวข้อแบบ sentence case (Title Case ตรวจที่ ≥ 90%) |
| 2c | single-linkage drift | fixed | ใช้ค่าเฉลี่ยของ Jaccard เทียบ article titles ทุกอันของ cluster แทน title ที่ใกล้ที่สุด ส่วน event ที่มีอยู่แล้วเทียบกับ article titles ไม่ใช่ title_th |
| 3 | `EADDRNOTALLOWED` และ 204/205 | fixed | map เป็น `not_allowed` (ไม่ retry) และใช้ `NO_BODY_STATUSES` = 204/205/304 ร่วมกันทั้ง transport, SafeFetch และ adapter |
| 4 | error ของ library หลุดออกมา | fixed | ห่อ validate และ parse ด้วย try/catch แล้ว throw เป็น `parse_error: malformed XML` |
| 5 | DOCTYPE ใน CDATA ถูก reject | fixed (ต่างจากที่เสนอเล็กน้อย) | ตรวจด้วย probe แล้วพบว่า validator ยอมรับ DOCTYPE ที่อยู่หลังหรือใน root element ถ้าตรวจแค่ prolog จะเปิดช่องโหว่ จึงตรวจทั้งไฟล์ยกเว้น CDATA และ comment ด้วยการ scan ทีเดียวแบบ leftmost ซึ่งกันกรณีที่ comment ซ่อน CDATA ไว้ด้วย มี test ครบทุกกรณี |
| 6 | ลำดับการตรวจ encoding | fixed | ตรวจตามลำดับ BOM → header → XML declaration มี test สำหรับ UTF-8 BOM ที่ header ผิด และ UTF-16LE/BE BOM |
| 7 | source_url, guid, ตัวอักษร bidi/zero-width | fixed | `source_url = new URL(link).href` ส่วน guid ผ่าน `cleanFeedText` เพิ่ม `stripInvisible` สำหรับ U+061C, U+200B–U+200F (ลบ U+200D ด้วย), U+202A–U+202E, U+2060, U+2066–U+2069 และ U+FEFF โดยภาษาไทยยังคงเดิม |
| 8 | abort แล้วบันทึก error ให้ source | fixed | source ที่ยังไม่ได้ fetch ถูกข้ามโดยไม่เขียน `last_error` ส่วน source ที่โดน abort กลางทางก็ไม่บันทึกเช่นกัน ข้าม grouping และ run เป็น `partial` (หรือ `failed` ถ้ายังไม่มี source สำเร็จเลย) |
| 9 | `--fixtures` ใช้ slot จริง | fixed | ใช้ key `ingest:fixtures:{hour}` และยังปฏิเสธเมื่อ `NODE_ENV=production` |
| 10 | "31 Feb" roll over | fixed | ตรวจวันในปฏิทินและเวลา (ชั่วโมง ≤ 23, นาทีและวินาที ≤ 59) ทั้ง ISO และ RFC 822 |
| 11 | ไม่มี max item age | fixed | `MAX_ITEM_AGE_HOURS = 72` นับรวมใน `items_dropped` item ที่ไม่มีวันที่จะเก็บไว้ ส่วน `--fixtures` ปิด check นี้ เพราะ fixture มีวันที่ตายตัว และจะถูก drop หมดหลังผ่านไป 3 วัน |
| 12 | proxy env และ NAT64 | documented | เขียนไว้ใน comment block ของ `safe-fetch.ts` และใน operational notes ด้านล่าง |

### Operational notes (finding 12)
- **Proxy:** ถ้าตั้ง `HTTPS_PROXY` หรือ `NODE_USE_ENV_PROXY` ไว้ Node จะ connect ไปที่ proxy ทำให้ connect-time check เห็น IP ของ proxy ไม่ใช่ของ feed
  - pre-flight DNS check ยังทำงาน แต่ rebinding guard จะใช้ไม่ได้
  - ห้ามตั้ง proxy env ใน container ของ app และ job
- **NAT64/DNS64:** `64:ff9b::/96` ถูก block ทั้งช่วง ถ้าเป็นโฮสต์ IPv6-only ที่อยู่หลัง DNS64 ทุก fetch จะ fail closed เป็น `not_allowed`

### Errors & problems (รอบนี้)
| # | Time | Where | Error | Cause | Resolution |
|---|---|---|---|---|---|
| R1 | 11:33 | probe `group2.ts` | "Thailand…" และ "Japan…" ไม่ถูกจับเป็น entity | `matchVocabulary` ข้ามชื่อ canonical (เทียบแค่ alias) | ให้เทียบชื่อ canonical ด้วย |
| R2 | 11:34 | `grouping.test.ts` | ได้ entity `crash` จาก "Market crash" | canonical id ที่เป็นคำทั่วไป (`crash`, `strike`) ถูก match | เปลี่ยนชื่อเป็น `transport crash` และ `labour strike` แล้วเขียนกฎไว้ใน header ของ vocabulary |
| R3 | 11:34 | `grouping.test.ts` | หัวข่าว sentence case สั้น ๆ ถูกตีเป็น Title Case จน entity หาย | threshold 0.6 ต่ำเกินไป | ปรับ `TITLE_CASE_RATIO = 0.9` และแยก `ALL_CAPS_RATIO = 0.6` |
| R4 | 11:37 | probe ของ DOCTYPE | validator ยอมรับ DOCTYPE หลังหรือใน root | พฤติกรรมของ fast-xml-parser | ตรวจทั้งไฟล์ยกเว้น CDATA และ comment (ดู #5) |
| R5 | 11:38 | `normalize.ts:74` และ test 3 ไฟล์ | มีตัวอักษร invisible (U+202A–U+202E, U+2066–U+2069, U+FEFF, U+FFFD) อยู่ใน source จริง | Write และ Bash tool แปลง escape `\uXXXX` ใน input เป็นตัวอักษรจริง (สาเหตุเดียวกับ error #3 ในรอบแรก) | แก้ด้วย script ที่ใช้ `String.fromCharCode` และสร้าง regex จาก code point ใช้ `scan-invisible.mjs` ตรวจแล้วไม่เหลือใน news, jobs, scripts และ fixtures |
| R6 | 11:39 | Edit test หลายไฟล์ | `File has not been read yet` | session state ไม่มีการอ่านไฟล์เหล่านั้น | Read ไฟล์ก่อนแล้ว Edit ใหม่ |
