# 2 · reviewer · digest-and-briefs

| Field | Value |
|---|---|
| Started | 2026-11-13 12:50:00 (Asia/Bangkok) |
| Finished | 2026-11-13 13:05:00 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only code review) |

## Goal
รีวิว branch `feature/digest-and-briefs` (worktree `C:\Project\WORLDVIEW-worktrees\digest-and-briefs`, 9 commits, ~5k บรรทัด) แบบ read-only โดยเน้น SafeFetch gzip, digest correctness, admin-edit protection, briefs, registry/CLI, conditional GET, utils refactor และความเรียบง่ายของโค้ด

## What I did (in order)
1. 12:50 — `git log --oneline main..HEAD`, `git diff --stat` และอ่าน diff ทีละส่วน (safe-fetch, digest*, repositories, briefs, registry, ingest, adapters, grouping, utils)
2. 12:55 — อ่านไฟล์ที่เกี่ยวข้องเต็มไฟล์ (`event-gate.ts`, `relation-gate.ts`, `admin.ts`, `job-runs.ts`, `client.ts`, `public-read.ts`) เพื่อตรวจ contract ที่ branch พึ่งพา
3. 12:57 — รัน `npx vitest run src/lib/server/jobs src/lib/server/db src/lib/server/news src/lib/utils`
4. 12:59 — เขียน probe (`scratchpad/probe-digest/probe1.mts`) รันด้วย `npx tsx` กับ in-memory DB + mock LLM (ไม่มี network) เพื่อยืนยัน finding A/B/C
5. 13:00 — probe zlib: gzip bomb 512 MB กับ `maxOutputLength` 5 MB, multi-member gzip, trailing junk
6. 13:01 — รัน CLI: `npm run job -- ingest --fixtures --dry-run`, `digest --max-events 0`, `brief_morning --date 2026-02-30`
7. 13:02 — สรุป findings และเขียน log นี้

## Files created / changed
- `docs/agent-logs/20261113-1250_2_reviewer_digest-and-briefs.md` — log นี้ (ไฟล์เดียวที่เขียน; ไม่ได้แก้โค้ดหรือ git)
- probe scripts อยู่นอก repo: `C:\Users\nared\AppData\Local\Temp\claude\fd4f72a0d7f6d3ad\67aca9dd-7e68-47e4-97d6-d3413c86880e\scratchpad\probe-digest\probe1.mts`

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 12:57 | `npx vitest run src/lib/server/jobs src/lib/server/db src/lib/server/news src/lib/utils` | 29 files / 364 tests passed |
| 12:59 | `npx tsx probe1.mts` (probe A/B/C) | A: event ที่ `keep_published` ถูกเรียก extraction+summary ทุก run (3/3) และยังอยู่ใน `listEventsNeedingContent`; B: `runDigest` throw `mergeDraftEvent: cannot merge a draft event into a hidden event` ทำให้ draft อื่นค้าง `draft`; C: draft ที่ admin แก้ title ถูกลบตอน merge, revision กลายเป็น orphan |
| 13:00 | `node -e` zlib probe | bomb → `RangeError ERR_BUFFER_TOO_LARGE` ใน 4 ms, RSS +5.8 MB; multi-member OK; trailing junk → `Z_DATA_ERROR` (parse_error) |
| 13:01 | `npm run job -- ingest --fixtures --dry-run` | succeeded, exit 0, ไม่แตะ DB |
| 13:01 | `npm run job -- digest --max-events 0` / `brief_morning --date 2026-02-30` | usage error พร้อม USAGE (exit 64) |

## Findings (สรุป; รายละเอียดอยู่ในรายงานถึง orchestrator)
**Confirmed**
1. **High** — `src/lib/server/jobs/digest.ts:51,57,58,218`: ขั้น grouping / tagging / merge อยู่นอก try/catch ถ้า `mergeDraftEvent` throw (admin hide target ระหว่าง run, หรือมี digest/ingest อื่นรันพร้อมกัน) ทั้ง run จะ `failed` และไม่มี event ไหนได้ content (probe B)
2. **Medium** — `digest-content.ts:104` + `repositories/digest.ts:156-180`: ถ้าผลคือ `keep_published` จะไม่มีการเขียนอะไรลง DB `summarized_at` จึงไม่ขยับ event เลยถูกประมวลผลซ้ำทุก run รวมถึง published event ที่ติด `manual_flag` ซึ่งรู้ผลอยู่แล้ว ทำให้เปลืองทั้ง LLM call และโควตา 30 / `--max-events` (probe A)
3. **Medium** — `repositories/digest.ts:276-302`: `mergeDraftEvent` ลบ draft ที่ admin แก้ไปแล้ว ทำให้งานแก้ของ admin หายและ `content_revisions` กลายเป็น orphan นอกจากนี้ repo ไม่ได้ตรวจ `is_demo` ซ้ำเป็นชั้นป้องกันที่สอง (probe C)
4. **Medium** — `registry.ts:167` + `job-slots.ts`: ถ้ารัน brief_morning/evening ก่อนช่วงเวลาปิด (ก่อน 07:00/19:00 ICT) slot `brief_*:{date}` จะถูก claim ไปพร้อมข้อมูลไม่ครบ แล้ว cron รอบจริงจะ `already_done`
5. **Medium** — `briefs.ts:39` + `brief-ranking.ts:46`: daily_snapshot ถูกตัดที่ MAX (15) ทั้งที่ morning+evening อาจมีข่าวรวมได้ถึง 30 รายการ และเมื่อสั่ง `--force` ข่าวที่มาช้าอาจดันข่าวที่เคยแสดงไปแล้วออก (เสี่ยงต่อ FR-03 เรื่องลำดับเวลา)
6. **Medium** — `digest.ts:77-80`: ขั้น links ใช้ `result.content` ซึ่งเป็นค่าที่ LLM เขียน ไม่ใช่แถวที่บันทึกจริง ถ้า admin แก้ category/tags/title ไว้ lesson links และ relations จะอิงค่าที่ถูกทิ้งไปแล้ว
7. **Low** — `digest-content.ts:137`: ตั้ง `summarized_at = now` ตอน save ทำให้บทความที่ ingest มา link ระหว่างที่ LLM กำลังทำงานไม่ถูก re-summary
8. **Low** — `digest.ts:157`: `taggingErrorKind` เก็บค่าเดียวทั้ง run ถ้า batch ใด batch หนึ่งได้ invalid_output event อื่นอาจได้ `invalid_llm_output` ผิดตัวแล้วไม่ถูก retry อัตโนมัติอีก
9. **Low** — `digest.ts:104`: `usageSince` นับรวม llm_calls ทุก process (ควร filter ด้วย `job_run_id`)
10. **Low** — `repositories/ingest.ts:31`: `syncSources` ไม่ล้าง etag/last_modified เมื่อ `feed_url` เปลี่ยน
11. **Low** — `safe-fetch.ts:108`: หลัง inflate แล้วยังคง `content-length` ของขนาดที่บีบอัดไว้
12. **Low** — `briefs.ts:52`: brief ที่มี 0 item ยังคืน `succeeded` และถ้ารันซ้ำได้ 0 item brief ที่เคย published จะถูกเปลี่ยนเป็น draft

**Suspicions**
- `admin.ts:68`: `updateEvent` บันทึกทุก key ที่ไม่ใช่ undefined ถ้า admin UI ส่งทั้งฟอร์มมา ทุก field จะถูก freeze ถาวร
- แหล่งข่าวจริงทั้งหมดตั้ง `allow_excerpt: false` LLM จึงสรุปจาก headline อย่างเดียว gate G5 ตรวจได้แค่ว่า ref มีอยู่จริง แต่ตรวจไม่ได้ว่าเนื้อหาที่ LLM ขยายความมีหลักฐานรองรับหรือไม่

**Verified correct**: gzip cap ใช้กับขนาดหลัง inflate (`maxOutputLength`) และตรวจหลัง SSRF/redirect/timeout ครบ ไม่มี request ใหม่; encoding อื่น fail closed; causal relation (`potential_impact`, `response_to`) เป็น pending เสมอ; evidence มาจาก stored article เท่านั้น; แยก real/demo ครบใน grouping/clustering/relations/briefs; `keep_hidden`/`manual_flag` ไม่เขียนอะไร; admin check อยู่ใน IMMEDIATE transaction เดียวกัน; brief เป็น deterministic และไม่เลือก hidden/pending; registry ไม่ throw และปิด DB ใน finally; date utils พฤติกรรมเหมือนเดิม; conditional GET เก็บ validators หลัง insert และคงค่าเดิมเมื่อได้ 304

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 12:59 | `npx tsx probe1.ts` | `Top-level await is currently not supported with the "cjs" output format` | ไฟล์ .ts ใน scratchpad ไม่มี package.json (type module) | เปลี่ยนชื่อเป็น `.mts` |
| 12:59 | `npx tsx probe1.mts` | `ERR_MODULE_NOT_FOUND: drizzle-orm` | probe อยู่นอก repo จึงหา node_modules ไม่เจอ | import ด้วย absolute file URL ไปที่ `node_modules/drizzle-orm/index.js` ของ worktree |

## Open issues / follow-ups for the orchestrator
- แก้ข้อ 1 (ครอบ grouping/tagging/merge ต่อ pair ด้วย try/catch) ก่อนเปิดให้ admin lane เรียก `runJobByType` ระหว่างที่ cron กำลังรัน
- ตัดสินใจเรื่อง spec ของ daily_snapshot (ข้อ 5): ข่าวจาก brief ของวันนั้นต้องอยู่ใน snapshot ครบเสมอหรือไม่
- ประสานกับ admin lane เรื่อง `updateEvent` ให้บันทึกเฉพาะ field ที่เปลี่ยนจริง และให้ `mergeDraftEvent` ปฏิเสธ draft ที่ admin แก้ไปแล้ว
