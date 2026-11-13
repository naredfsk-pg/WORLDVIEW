# 1 · reviewer · news-ingestion

| Field | Value |
|---|---|
| Started | 2026-11-13 11:20:00 (Asia/Bangkok) |
| Finished | 2026-11-13 11:28:00 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only) |

## Goal
รีวิวแบบ read-only ของ branch `feature/news-ingestion` (worktree `C:\Project\WORLDVIEW-worktrees\news-ingestion`) โดยเน้นที่ SSRF/SafeFetch, XML ที่ไม่น่าเชื่อถือ, idempotency/concurrency ของ job, ความถูกต้องของ grouping และความเรียบง่าย (PRD §6.1)

## What I did (in order)
1. 11:20 — อ่าน `git diff main..HEAD` (5 commits, 39 ไฟล์) รวมถึง `safe-fetch.ts`, `feed-parser.ts`, `normalize.ts`, `adapters.ts`, `grouping.ts`, `ingest.ts`, `runner.ts`, `job-slots.ts`, `retry.ts`, `job-runs.ts`, `scripts/job.ts`
2. 11:21 — อ่าน ARCHITECTURE §7–§9 และ PRD §4.2–4.3 กับ §9.1 พร้อมอ่าน repository เดิมที่ ingest เรียกใช้ (`ingest.ts`, `digest.ts`)
3. 11:22 — เขียน probe scripts ไว้ใน scratchpad `probe-news\` (ไม่ได้วางใน repo):
   - `ip.ts`: `isBlockedAddress` และการ parse host ของ URL
   - `xml.ts`: parser, charset และ normalize
   - `fetch.mts`: SafeFetch ด้วย fake transport และ connect-time check ด้วย transport จริงไปยัง `localhost`
   - `group.ts`: false merges
   - `slot.mts`: hour boundary
   - `ts.mts`: timestamps
4. 11:24 — รัน `npx vitest run` ของ news, jobs และ job-runs รวมถึง `npm run job -- ingest --fixtures --dry-run`
5. 11:27 — สรุป findings

## Files created / changed
- `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1120_1_reviewer_news-ingestion.md`: log นี้ (เป็นไฟล์เดียวที่เขียนลง repo)
- probe scripts อยู่ใน scratchpad `...\scratchpad\probe-news\` เท่านั้น

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 11:24 | `npx vitest run src/lib/server/news src/lib/server/jobs src/lib/server/db/repositories/job-runs.test.ts` | 13 files, 179 tests passed |
| 11:24 | `npm run job -- ingest --fixtures --dry-run` | exit 0: sources_ok 3, items_fetched 9, items_dropped 2 |
| 11:22 | probe `group.ts` | ยืนยัน false merge 3 กรณี (ดู findings H1/H2) |
| 11:23 | probe `fetch.mts` | redirect, allowlist, multi-A, body cap, stalled body, slow DNS และ connect-time `EADDRNOTALLOWED` ทำงานถูกต้อง |

## Findings (สรุป)
ระดับ critical: ไม่พบ

High
- H1 `src/lib/server/news/grouping.ts:155,62-65`: feed categories ทั่วไป (เช่น "Business", "World") ถูกใช้เป็น keyword ทำให้ score สูงขึ้นถึง +0.25 จนข่าวคนละเรื่อง join กัน
  - probe: "Thailand central bank holds rate…" กับ "Philippines central bank holds rate…" ได้ 0.694 ซึ่ง join ทั้งที่ถ้าไม่มี category จะได้ 0.44 (ambiguous)
- H2 `grouping.ts:136-141,196-208`: ไม่มีการลงโทษเมื่อ named entities ขัดกัน และตัวเลขแยกเป็น token ทำให้หัวข่าวแบบ template merge กันผิด
  - "Magnitude 6.1 earthquake strikes off Japan coast" กับ "…Chile coast" ได้ 0.861
  - "Bangkok floods: death toll rises" กับ "Bangkok death toll from heatwave rises" ได้ 0.917

Medium
- M1 `src/lib/server/jobs/ingest.ts:78-85`: grouping ทำตอนท้าย ingest ซึ่งเกิดก่อน tagging ขัดกับ ARCHITECTURE §9 และทำให้ digest step 1 (unassigned) ไม่เจอ article ที่จะ tag
  - backend log บันทึกเป็น follow-up แล้ว แต่ยังไม่มีการตัดสินใจ

Low
- L1 `safe-fetch.ts:272-278,361`: SSRF block ตอน connect (`EADDRNOTALLOWED`) และ 204/205 (TypeError ตอนสร้าง Response) ถูกจัดเป็น `network` แบบ retryable จึงถูก retry 3 ครั้ง
- L2 `feed-parser.ts:35`: error จาก fast-xml-parser (เช่น tag `__proto__` หรือ nesting เกิน limit) หลุดออกไปเป็น Error ธรรมดา ไม่ใช่ `parse_error` และข้อความมีชื่อ tag จาก feed ไปอยู่ใน `last_error`
- L3 `feed-parser.ts:32`: `<!DOCTYPE` ที่อยู่ใน CDATA ทำให้ทั้ง feed ถูก reject
- L4 `adapters.ts:83-90`: ไม่ sniff BOM (UTF-8 BOM ร่วมกับ header latin1 ได้ mojibake และ UTF-16 BOM ได้ garbage)
- L5 `normalize.ts:184,204,250`: `source_url` เก็บเป็น raw string และ `guid` ไม่ผ่านการลบ control/bidi; ชุด bidi ยังขาด LRM/RLM/ALM กับ zero-width
- L6 `ingest.ts:50-76`: หลัง abort ที่ 20 นาที source ที่ยังไม่ได้ fetch จะถูกบันทึก `last_error = "network: aborted"`
- L7 `scripts/job.ts:78`: `--fixtures` ใช้ key `ingest:{hour}` ร่วมกับ production และกันไว้ด้วย `NODE_ENV=production` เท่านั้น ซึ่งค่า default คือ development
- L8 `timestamps.ts:329`: "31 Feb 2026" ผ่านการตรวจและถูก roll ไปเป็น 3 มี.ค.

Suspicions (ยังไม่ยืนยัน)
- ถ้าตั้ง `NODE_USE_ENV_PROXY` (Node 24) แล้ว lookup จะเป็นของ proxy ทำให้ connect-time check ไม่ได้ป้องกัน target
- การ block `64:ff9b::/96` ทั้งช่วงทำให้ทุก fetch ล้มเหลวบนโฮสต์ DNS64/IPv6-only (fail-closed)
- feed ที่มี item เก่ามาก (ไม่มี max age) จะกลายเป็น draft event ใหม่ในการ ingest รอบแรก

## Checked and correct
- allowlist ใช้ host แบบ exact (host ถูกทำ lower-case และแปลงเป็น punycode โดย URL)
- trailing dot, port และ userinfo ถูก reject
- redirect แบบ relative และ protocol-relative ถูก resolve แล้วตรวจซ้ำ ส่วน scheme อื่นถูก reject และจำกัดสูงสุด 3 ครั้ง
- IPv4-mapped (ทั้งรูป dotted และ hex), `::/96`, NAT64, 0.0.0.0 และ CGNAT ถูก block
- ถ้า A records มี private ปนอยู่แม้เพียงบางตัว ทั้งชุดจะถูก block
- decimal, hex และ octal host ถูก normalize เป็น IP ซึ่งไม่อยู่ใน allowlist
- connect-time lookup ทำงานจริง (probe ได้ `EADDRNOTALLOWED`)
- timeout ครอบคลุม DNS, headers และ body ที่ stall
- body cap ทำงานแม้ไม่มี Content-Length
- `accept-encoding: identity` และ node:https ไม่ decompress จึงนับ cap จาก raw bytes และไม่มี decompression bomb
- DOCTYPE ถูก reject (ไม่สนตัวพิมพ์) และ undeclared entity ยังเป็น text
- ไม่มี prototype pollution (parser throw)
- attribute 4 MB และ 60k items parse ได้ในเวลาที่รับได้
- windows-874 และ TIS-620 decode ถูกต้อง
- claim อยู่ใน IMMEDIATE transaction และ claim token `finish` ถูกต้อง
- `--force` ไม่สร้าง row หรือ article ซ้ำ
- slot key ถูกต้องที่ hour boundary และข้ามปี และไม่ขึ้นกับ host TZ
- exit codes เป็น 0/2/1/64
- partial failure บันทึก `last_error` และ `last_error_at` และไม่แตะ `last_success_at`
- planGrouping เป็น deterministic (sort ตาม time แล้วตาม id)

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 11:23 | `npx tsx probe-news/fetch.ts` | `Top-level await is currently not supported with the "cjs" output format` | scratchpad ไม่มี package.json แบบ `type: module` | เปลี่ยนนามสกุลเป็น `.mts` |
| 11:23 | probe "stalled body" | process exit พร้อม "unsettled top-level await" | `AbortSignal.timeout` ใช้ timer แบบ unref และ fake stream ไม่ได้ถือ event loop ไว้ (เป็น artifact ของ probe ไม่ใช่ bug) | เพิ่ม `setInterval` เพื่อให้ event loop ยังทำงาน แล้วได้ timeout ที่ 312 ms ตามคาด |

## Open issues / follow-ups for the orchestrator
- ต้องแก้ H1/H2 ก่อนเปิดใช้ source จริง และควรเพิ่ม regression fixtures ของคู่ข่าวที่ merge ผิด
- software-eng ต้องตัดสินใจเรื่อง M1 (grouping ใน ingest หรือใน digest หลัง tagging) และอัปเดต contract
- ก่อน deploy ต้องตั้ง `NODE_ENV=production` บน server หรือแยก key ของ `--fixtures`
