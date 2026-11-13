# 3 · reviewer · editorial-hardening

| Field | Value |
|---|---|
| Started | 2026-11-13 14:40:00 (Asia/Bangkok, โดยประมาณ) |
| Finished | 2026-11-13 14:52:00 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only) |

## Goal
Review branch `feature/editorial-hardening` (worktree `C:\Project\WORLDVIEW-worktrees\editorial-hardening`, 7 commits, `main..HEAD`) แบบ read-only: allegation tag filter, timeline (`event_updates`), clustering ที่ merge เข้า published event, `stripFeedBoilerplate`, prompt bumps, helper dedupe และเทียบกับ ARCHITECTURE §6, §8–§11, AGENT_PLAN "Owner decisions", PRD FR-02/FR-04, §4.3, §9.2

## What I did (in order)
1. 14:40 — `git log --oneline main..HEAD`, `git diff --stat` แล้วอ่าน diff ของ editorial, digest repo, jobs/digest*, types, llm, news
2. 14:42 — อ่านไฟล์เต็ม `jobs/digest.ts`, `db/repositories/digest.ts`, `admin.ts` (publish/hide/flag), `public-read.ts`, `EventDetail.svelte`, `utils/retry.ts`, `utils/date.ts`, `llm/tasks/{summary,tagging,clustering,shared}.ts`
3. 14:45 — รัน vitest (editorial, jobs/digest, repo digest, normalize, llm) ผ่าน PowerShell
4. 14:46 — เขียน probe (`scratchpad/probe-editorial/probe.ts`) รันด้วย `tsx`: ทดสอบ `isAllegationTag` กับ tag ประมาณ 70 แบบ และ `stripFeedBoilerplate` กับ input อันตราย 10 แบบ + เนื้อหาปกติ 9 แบบ
5. 14:48 — ตรวจว่าไม่มี admin tool สำหรับ unlink article หรือลบ timeline row (grep routes + admin repo)
6. 14:49 — สรุป findings และเขียน log นี้

## Files created / changed
- `docs/agent-logs/20261113-1440_3_reviewer_editorial-hardening.md` — log นี้ (ไฟล์เดียวที่เขียนใน repo)
- `C:\Users\nared\AppData\Local\Temp\claude\fd4f72a0d7f6d3ad\67aca9dd-7e68-47e4-97d6-d3413c86880e\scratchpad\probe-editorial\probe.ts` — probe script (นอก repo)

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 14:45 | `npx vitest run src/lib/server/editorial src/lib/server/jobs/digest.test.ts src/lib/server/db/repositories/digest.test.ts src/lib/server/news/normalize.test.ts src/lib/server/llm` | 14 files, 256 tests passed |
| 14:46 | `tsx probe.ts` | ReDoS: ทุก input ใช้เวลาไม่เกิน 2 ms (20k chars); tag filter ดู M4/L6; boilerplate ดู L10 |

## Findings (เรียงตามความรุนแรง)

### Confirmed
- **H1 [high] Merge เข้า published event เปลี่ยน public content ทันที และ admin แก้กลับไม่ได้** — `src/lib/server/jobs/digest.ts:342-359` (`publishedTagMatch`) + `src/lib/server/db/repositories/digest.ts:299-336` (`mergeDraftEvent`). Article ย้ายเข้า published event, `recomputeDerivedFields` เปลี่ยน `source_count` (ป้าย single-source / G6 หายได้), `last_updated_at` และ sources list บนหน้า public ก่อน re-summary; ถ้า re-summary ได้ `keep_published` ก็ค้างอย่างนั้น. ไม่มี `content_revisions` สำหรับการ link, ไม่มี admin action สำหรับ detach article หรือลบ `event_updates` row — admin ทำได้แค่ hide ทั้ง event. ขัด PRD §9.2. Fix: published target ส่งเข้า review แทน auto-merge หรืออย่างน้อยเขียน system revision + เพิ่ม admin detach / timeline-delete และใช้ confidence สูงกว่าสำหรับ published target
- **M2 [medium] `clustering@2` นิยาม same_event รวม "reactions or consequences"** — `src/lib/server/llm/tasks/clustering.ts:24`. ขัด FR-04 ที่แยก `follow_up` / `response_to` / `potential_impact` เป็น relation; รวมกับ published-target path ทำให้ follow-up story ถูก merge เข้า event เดิม. Fix: same_event = happening เดียวกันเท่านั้น
- **M3 [medium] Tag-path pairs แย่ง 20 slots กับ rule-band pairs** — `src/lib/server/jobs/digest.ts:238`: เรียงตามลำดับ drafts; draft ที่ตกหล่นถูก publish เป็น duplicate และไม่ถูกพิจารณาอีก. Fix: rule-band pairs ก่อน แล้วค่อยเติม tag pairs
- **M4 [medium] Tag filter bypass (probe ยืนยัน)** — `src/lib/server/editorial/tag-filter.ts:391-433`: ไม่ถูกตัด `spying`, `chinese-spying`, `spy-case`, `spy-trial`, `espionage-case`, `love-affairs`, `secret-affairs`, `mistresses`, `accuses`, `accusing`, `fraud-charge`, `bribe`, `bribes`, `kickback`, `rapist`, `sex-crimes`, `philandering`, `sex-tape`. (Thai / camelCase / underscore เกิดไม่ได้ เพราะ `tagSchema` บังคับ kebab-case ASCII.) Fix: เพิ่ม inflection/stem และ allowlist สำหรับ `affairs`
- **M5 [low-medium] `update_th` ที่ไม่ผ่านไป block main content** — `src/lib/server/editorial/event-gate.ts:136`, `src/lib/server/llm/tasks/summary.ts:35`: URL ใน `update_th` ของ draft (ซึ่งไม่ได้ใช้) ทำให้เป็น `pending_review`; ยาวเกิน 300 ทำให้ทั้ง summary เป็น `invalid_output`. Fix: ไม่นับใน G3 สำหรับ draft; schema `.catch(null)`
- **L6 [low] False positives (probe ยืนยัน)** — `service-charges`, `bank-charges`, `police-misconduct`, `workplace-harassment`, `sexual-harassment-law`, `rape-law`, `suspected-outbreak`, `suspected-cholera` ถูกตัด (ทิศทางปลอดภัย)
- **L7 [low] ข้อความ timeline ไม่ผูกกับ evidence** — `src/lib/server/jobs/digest-content.ts:146-152`: evidence = new refs ทั้งหมด. Fix: ให้ LLM คืน `update_refs` ที่เป็น subset ของ `new_refs`
- **L8 [low] `reported_at` อาจเก่ากว่า update ก่อนหน้า** — `src/lib/server/editorial/event-update.ts:270-273`: article ที่ merge เข้ามา (published ภายใน 72 ชม.) ทำให้ timeline เรียงผิด
- **L9 [low] Tags ก่อน branch** — pending_review ที่ save ก่อน branch แล้ว admin publish (`admin.ts` `publishEvent`) ไม่กรอง allegation tags; published เดิมค้างจน re-summary (ไม่ต้อง backfill ตาม brief)
- **L10 [low] `stripFeedBoilerplate` ตัด `<li>` ที่เป็น link ล้วนไม่ว่าข้อความอะไร** — `src/lib/server/news/normalize.ts:302,315-324`: `<li><a>Thailand floods kill 12 in Chiang Mai</a></li>`, `<li><a>สรุปข่าว</a></li>`, `<p>Analysis: <a>The ceasefire held overnight, officials said</a></p>` ถูกลบ; ใช้กับทุก source (excerpt เป็น internal-only)

### Suspicions (ยังไม่ยืนยัน)
- Transitive merge ตามลำดับ decision (D2 เข้า D1 แล้ว D1 เข้า P ผ่าน tag path ที่ตัดสินจาก article เดียวของ D1) — `removed` เก็บแค่ source. Fix: track ทั้ง source และ target
- Published target หลัง merge อาจไม่อยู่ใน listing รอบสอง (limit 30): sources เปลี่ยนแต่ text เก่าจนรอบหน้า

### Verified correct
- `filterAllegationTags` อยู่ก่อน cap ใน `deriveEventTaxonomy`; `foreign-affairs`, `cyber-espionage`, `corruption`, `chargers`, `espionage-law`, `public-affairs` ถูกเก็บ
- `mergeDraftEvent` guards อยู่ใน immediate transaction; ล้มทีละ pair ไม่ล้ม run
- `flagEvent` ย้าย published ไป pending_review จึง tag path ไม่เลือก flagged event
- Draft ที่ถูก merge ไม่มี relations / lesson links / brief entries / updates
- Timeline render เป็น plain text, evidence URL มาจาก stored articles, `reported_at` ไม่ null, อนาคตถูกจำกัดโดย `parseFeedTimestamp`
- Dedupe แบบ set ถูกต้อง; `new_article_ids` + `summarized_at = listedAt` ถูกต้อง
- Cache key รวม prompt version
- Helper dedupe เทียบเท่าของเดิม (ต่างแค่ `Math.round` และ clamp Retry-After ติดลบ)
- ReDoS ไม่พบ

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 14:46 | probe แบบ vitest test file ใน scratchpad | ไม่ได้รัน | ไฟล์อยู่นอก vitest root และ relative import เปราะ | ลบไฟล์แล้วใช้ `tsx` + absolute import แทน: สำเร็จ |
| 14:50 | เขียน log ด้วย heredoc ครั้งแรก | `unexpected EOF while looking for matching quote` | bash parse heredoc ยาวครั้งเดียวไม่ผ่าน | แบ่งเขียนเป็น 2 ส่วนด้วย delimiter อื่น: สำเร็จ |

## Open issues / follow-ups for the orchestrator
- ตัดสินใจเรื่อง auto-merge เข้า published event (H1) ก่อน merge branch
- ปรับนิยาม `clustering@2` (M2) และ priority ของ pairs (M3)
- ขยาย denylist (M4)
