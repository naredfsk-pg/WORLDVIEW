# 3 · frontend · qa-fixes

| Field      | Value                              |
| ---------- | ---------------------------------- |
| Started    | 2026-11-13 15:05:58 (Asia/Bangkok) |
| Finished   | 2026-11-13 15:36:00 (Asia/Bangkok) |
| Status     | done                               |
| Agent type | frontend                           |

## Goal

แก้ bug ระดับ P3 ทั้ง 10 ข้อที่ QA รายงานไว้ใน `docs/qa/BUGS.md` (BUG-QA-001…010) บน branch `fix/qa-wave3` (worktree `C:/Project/WORLDVIEW-worktrees/qa-wave3`, แตกจาก `main` @ `0760f39`) แล้วเปิด `test.fixme` / `it.todo` ทุกตัวให้รันและผ่าน ลบ per-node exclusion ของ axe ออก ให้ gate ทุกตัว (check, lint, test, build, e2e บน `E2E_PORT=4373` รวมถึง CSP-violation e2e) ผ่าน วัด Lighthouse mobile ของ `/` และ `/archive` ซ้ำ ถ่าย screenshot เพื่อเทียบกับ prototype และอัปเดต `BUGS.md` / `BASELINE.md` ห้าม push, merge หรือแตะ `main` และสำหรับ 005/006 ให้แก้เฉพาะ read layer เท่านั้น

## What I did (in order)

1. 15:05 — ตรวจ worktree (clean, อยู่ที่ `0760f39`) อ่าน `BUGS.md` และ grep หา `fixme|todo|BUG-QA` ใน `tests/` และ `src/` อ่าน `a11y-helpers.ts`, `a11y.e2e.ts`, `lighthouse-findings.e2e.ts`, `exploratory.e2e.ts`, `public-read.acceptance.test.ts`, `public-read.ts`, `shared.ts`, `search.ts`, `tokens.css`, `layout.css`, `app.html`, `csp.ts`, route `/archive` และ `/brief/[date]` รวมถึง component ที่เกี่ยวข้อง
2. 15:06 — setup ใน background: `npm ci`, `cp .env.example .env`, `npm run db:reset` (รันจาก PowerShell ที่ `C:\` ตัวใหญ่)
3. 15:07 — **BUG-QA-007 (garbled heading)**: เปิด `vite dev --port 5373` แล้วตรวจ `/archive?date=2099-01-01` สามชั้น คือ byte ของ SSR (`od -c` ได้ `E0 B8 82 E0 B9 88 …` = "ข่าว" ถูกต้อง), `innerText` ใน Chromium (code point ถูกต้อง) และ pixel ใน screenshot ทั้ง 412px และ 1440px (ถูกต้อง) จึงยังไม่เจอ "ข่Wาว" ทั้งใน source, docs และ test-results ของ main
4. 15:08 — วัดสัดส่วน legible text ด้วย script ใน scratchpad ที่จำลอง `legibleTextShare` และแยกตาม class ได้ `/` 0.541, `/archive` 0.487 และ event 0.590 โดยตัวการหลักคือ `text-[10px]`/`text-[11px]` ในข้อความไทย
5. 15:09 — คำนวณ contrast ของ token ด้วย node script (สูตร WCAG relative luminance) เพื่อหา `--faint` ที่ผ่าน 4.5:1 บนทุก surface ที่ใช้งาน (bg, surface, surface-2 และ hero ที่ใช้กับตัวคั่น `·` ใน FeaturedStory)
6. 15:10–15:14 — **BUG-QA-005/006** (read layer): เพิ่ม `isReadableEvent` ใน `shared.ts` (= `isPublicEvent` + `EXISTS` ใน `event_articles ⋈ articles`) แล้วใช้กับทุก public read ใน `public-read.ts` และ `search.ts` โดยไม่แตะ `briefs.ts`/`digest.ts` (write side) และเพิ่ม `hasResolvableEvidence` ใน `selectPublishedRelations` (`json_each(evidence_refs)` ⋈ `articles`) เป็น SQL เพื่อให้ `limit` นับเฉพาะ relation ที่แสดงได้ จากนั้นแปลง `it.todo` ให้เป็น test จริง พร้อมเพิ่มกรณี partial evidence และเช็กว่า search เจอ event ก่อนลบ source เพื่อไม่ให้ assertion "ไม่อยู่ใน search" ว่างเปล่า ผลคือ 9/9 ผ่าน แล้ว commit `74bbe10` + `203c2c5`
7. 15:11–15:16 — **a11y**: 001 ใส่ `aria-hidden` ให้ tagline, 003 เปลี่ยน `--faint`, 002 ให้วันที่ไม่มี brief ใช้ `text-faint`, 004 ย้าย note ออกจาก `<dl>` ไปไว้ใน `<div>` กรอบเดียวกัน, 008 เพิ่ม `<h2 class="sr-only">` บน `/brief/[date]` จากนั้นทำให้ `KNOWN_A11Y_BUGS` ว่าง และแปลง fixme เป็น regression test (เพิ่ม dark theme ให้ 003 และ test ของ 008)
8. 15:12–15:17 — **BUG-QA-007**: `+page.server.ts` ถือว่า `date > today` และ `month > เดือนปัจจุบัน` (Bangkok) เป็น invalid param แบบเดียวกับ `2026-02-30` คือ fallback ไป brief ล่าสุดและตอบ 200 ส่วน load คืน `max_month` และปฏิทินไม่แสดงลิงก์เดือนถัดไปเมื่อถึงเดือนปัจจุบัน (ใส่ spacer ขนาดเท่ากันไว้ให้ชื่อเดือนยังอยู่กลาง) แก้ exploratory test ที่ใช้เดือนในอนาคตให้ใช้เดือนในอดีตแทน เปิด fixme ของ 007 และใช้ `currentBangkokMonth()` เพื่อให้ test ไม่พังเมื่อข้ามเดือน
9. 15:16–15:18 — **BUG-QA-009**: เพิ่ม theme size `--text-meta: 0.75rem` (line-height 1.6) ใน `layout.css` แล้วแทน `text-[10px]`/`text-[11px]` ที่เป็นข้อความไทย 31 จุดด้วย script ที่ต้อง match ครั้งเดียวต่อจุด ส่วน eyebrow ภาษาอังกฤษตัวพิมพ์ใหญ่และ mobile nav ยังคง 10px ไว้ ผลคือ share เป็น 0.94 / 0.95 / 0.97
10. 15:17–15:18 — แยก commit ของไฟล์ที่มีหลาย bug ปนกัน (ArchiveCalendar, EventDetail, AppShell) ด้วย script `stage.mjs` (`git hash-object -w` + `git update-index --cacheinfo`) เพื่อ stage เฉพาะ hunk ของแต่ละ bug เพราะ `git add -p` ใช้ไม่ได้ แล้ว commit `c938697`, `420f511` และ `d650d52`
11. 15:19 — **BUG-QA-010 (วัดก่อน)**: `npm run build` + `vite preview --port 5373` แล้วรัน script ที่ใช้ CDP throttling แบบเดียวกับ test พร้อม layout-shift attribution ได้ CLS 0.307 จากสอง shift ของ `main > div.grid` (+56px แล้วกลับ) ณ ตอนที่ font โหลดแค่ subset Latin (Thai ยังไม่มา) แถบ date-form ขึ้นบรรทัดใหม่ และกลับมาเป็นบรรทัดเดียวเมื่อ Thai subset โหลดเสร็จ
12. 15:20 — เพิ่ม `<link rel="preload">` ให้ Thai/Latin 400/700 ใน `+layout.svelte` (import `?url` จึงได้ไฟล์ hash เดียวกับ CSS) แล้ววัดซ้ำ: `/archive` 0.001, `/` 0.009, event 0.001
13. 15:21 — **ต้นเหตุ garbled text**: เห็นจาก curl ว่า page ส่ง `content-type: text/html` โดยไม่มี charset ทดสอบด้วย PowerShell 5.1 `Invoke-WebRequest` แล้วได้ "à¸à¹à¸²à¸§…" (UTF-8 ถูก decode เป็น ISO-8859-1) ส่วน browser ไม่เป็นเพราะอ่าน `<meta charset>` จึงแก้ `withSecurityHeaders` ให้ระบุ `text/html; charset=utf-8` พร้อม unit test และให้ e2e ของ 007 assert header ด้วย แล้ว commit `3eaf2a3` และ commit preload เป็น `c67cec8`
14. 15:23 — gate รอบแรก: `npm run check` (0 error), `npm run lint` และ `npm test` (711 passed) ผ่านทั้งหมด
15. 15:23–15:25 — `E2E_PORT=4373 npx playwright test` รอบแรกได้ **25 failed** (ดู Errors #7–#9)
16. 15:25–15:26 — แก้ 001 ใหม่ (เอา `aria-label` ออก ใช้ชื่อจาก content "worldview" + sr-only "หน้าหลัก"), ให้ clip check ข้าม `.sr-only` และเขียน `src/lib/styles/fonts.css` ที่ประกาศไฟล์ @fontsource เดิมด้วย `font-display: optional` แทนการ import CSS ของ @fontsource วัดได้ CLS 0.000 ทั้งแบบ sequential 2 รอบและ parallel 4 รอบ แล้ว commit `28a3771`, `ab6ea7d`
17. 15:27–15:28 — e2e รอบสองผ่าน **318/318** (ไม่มี fixme เหลือ และ CSP-violation e2e ผ่านทั้ง light/dark)
18. 15:29–15:30 — build ใหม่ + preview แล้วรัน Lighthouse 12.8.2 mobile (`CHROME_PATH` = Chrome ที่ติดตั้งไว้) URL ละ 3 รอบ ได้ `/archive` 88 → 97 (CLS 0.175 → 0.000, A11y 100, BP 100) และ `/` 95 → 94 (อยู่ในช่วง noise, CLS 0.000, BP 100)
19. 15:30 — ถ่าย screenshot 6 ภาพ (`/`, `/archive`, event × 390/1440 × light/dark สลับกัน) แล้วเทียบกับ `preview-mobile-light.png` ของ prototype: layout, สี และลำดับชั้นเหมือนเดิม ต่างกันแค่ข้อความเล็กที่ใหญ่ขึ้น (notice สองอันบนมือถือขึ้นสองบรรทัด)
20. 15:31–15:33 — อัปเดต `BUGS.md` (status column, status line ของแต่ละ bug), `BASELINE.md` (section "After the Wave 3 fixes") และ `ACCEPTANCE.md` (update note) จากนั้นรัน gate ซ้ำ (check/lint/test ผ่าน) แล้ว commit `c42f787`, `7e62fb0`
21. 15:33–15:36 — เขียน log นี้

## Files created / changed

- `src/lib/server/db/repositories/shared.ts`: เพิ่ม `isReadableEvent`
- `src/lib/server/db/repositories/public-read.ts`: ใช้ `isReadableEvent` ทุก query และเพิ่ม `hasResolvableEvidence` ใน `selectPublishedRelations`
- `src/lib/server/db/repositories/search.ts`: เปลี่ยนไปใช้ `isReadableEvent`
- `src/lib/server/db/repositories/public-read.acceptance.test.ts`: เปลี่ยน todo เป็น test ของ 005 (2 ข้อ) และ 006
- `src/lib/components/AppShell.svelte`: logo ของ sidebar ไม่มี `aria-label` แล้ว (ใช้ sr-only "หน้าหลัก" + tagline `aria-hidden`) และใช้ `text-meta`
- `src/lib/components/ArchiveCalendar.svelte`: เพิ่ม `maxMonth`, ซ่อนลิงก์เดือนถัดไป, วันที่ไม่มี brief ใช้ `text-faint` และใช้ `text-meta`
- `src/lib/components/EventDetail.svelte`: แก้โครง `<dl>` และใช้ `text-meta`
- `src/lib/components/{ConnectionList,DemoNotice,EventLabels,EvidenceLinks,FeaturedStory,FreshnessBadge,LessonArticle,LessonCard,SourceList,StoryCard,WeekCard}.svelte`, `src/routes/+page.svelte`, `src/routes/academy/week/[week]/day/[day]/+page.svelte`, `src/routes/connections/+page.svelte`: เปลี่ยนเป็น `text-meta`
- `src/lib/styles/tokens.css`: `--faint` light/dark พร้อม comment ค่า contrast
- `src/lib/styles/fonts.css` (ใหม่): @font-face ของ Noto Sans Thai 9 face ที่ใช้ `font-display: optional`
- `src/routes/layout.css`: import `fonts.css` แทน @fontsource CSS และเพิ่ม `--text-meta`
- `src/routes/+layout.svelte`: preload font 4 ไฟล์
- `src/routes/archive/+page.server.ts`, `src/routes/archive/+page.svelte`, `src/lib/types/views.ts`: นโยบาย out-of-range และ `max_month`
- `src/routes/brief/[date]/+page.svelte`: sr-only `<h2>`
- `src/lib/server/auth/security-headers.ts` (+ `.test.ts`): `text/html; charset=utf-8`
- `tests/e2e/a11y-helpers.ts`, `a11y.e2e.ts`, `admin-a11y.e2e.ts`, `exploratory.e2e.ts`, `lighthouse-findings.e2e.ts`: เปิด fixme ทั้งหมด, ลบ exclusion และเพิ่ม regression test
- `docs/qa/BUGS.md`, `docs/qa/BASELINE.md`, `docs/qa/ACCEPTANCE.md`, `docs/screenshots/wave3/*.png` (6 ไฟล์)

## Token changes (contrast)

| Token / element                | Before                                                           | After                                                                       |
| ------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| light `--faint`                | #67766f: bg 4.48, surface 4.78, surface-2 4.30, hero 4.18        | #61706a: bg 4.88, surface 5.21, surface-2 4.69, hero 4.55                   |
| dark `--faint`                 | #83968c: bg 5.71, surface 5.05, surface-2 4.65, hero 4.06        | #8c9f95: bg 6.40, surface 5.65, surface-2 5.20, hero 4.55                   |
| วันในปฏิทินที่ไม่มี brief (on card) | `muted-foreground/40`: light 1.77, dark 2.36                     | `text-faint`: light 5.21, dark 5.65 (+ ไม่มีจุด/ลิงก์ เป็น non-colour cue) |
| `--text-meta` (ใหม่)            | ข้อความไทย 10–11px                                                | 12px, line-height 1.6                                                       |

## Commands run & results

| Time  | Command                                                          | Result                                                                   |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 15:06 | `npm ci`; `npm run db:reset`                                     | ok (มี warning `allow-scripts` แต่ better-sqlite3 ใช้งานได้)             |
| 15:13 | `npx vitest run src/lib/server/db/repositories/`                 | 10 files, 79 passed                                                      |
| 15:14 | `npx vitest run …public-read.acceptance.test.ts`                 | 9 passed                                                                 |
| 15:19 | `npm run build`                                                  | ok                                                                       |
| 15:19 | `cls.mjs /archive` (CDP slow 4G + 4× CPU, ก่อนแก้)                 | CLS 0.3073 ×2                                                            |
| 15:21 | `cls.mjs` หลัง preload                                            | `/archive` 0.0012, `/` 0.0088, event 0.0010                              |
| 15:21 | `Invoke-WebRequest /archive?date=2026-11-12` (PowerShell 5.1)    | headline เป็น mojibake "à¸à¹à¸²à¸§…" (ก่อนแก้ charset)                    |
| 15:22 | `npx vitest run src/lib/server/auth`                             | 56 passed                                                                |
| 15:23 | `npm run check` / `npm run lint` / `npm test`                    | 0 errors / clean / 711 passed (55 files)                                 |
| 15:23 | `E2E_PORT=4373 npx playwright test` (รอบ 1)                       | 25 failed, 36 did not run, 257 passed                                    |
| 15:26 | `cls.mjs /archive` หลัง `font-display: optional`                  | 0.0000 (2 sequential + 4 parallel)                                       |
| 15:27 | `E2E_PORT=4373 npx playwright test` (รอบ 2)                       | **318 passed**                                                           |
| 15:29 | `npm run build`                                                  | ok                                                                       |
| 15:29 | `lighthouse@12.8.2` × 3 บน `/archive` และ `/`                     | `/archive` 97/96/97, CLS 0.000; `/` 94/95/94, CLS 0.000; BP 100, A11y 100 |
| 15:31 | `cls.mjs` บน `/`, event, `/archive`                              | 0.0000 ทั้งหมด                                                            |
| 15:32 | `npm run check` / `npm run lint` / `npm test` (รอบสุดท้าย)         | 0 errors / clean / 711 passed                                            |

## Errors & problems

| Time  | Where (file/command/step)                               | Error                                                                  | Cause                                                                                                                                           | Resolution                                                                                                                                    |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:07 | `node scratchpad/probe.mjs`                             | `ERR_MODULE_NOT_FOUND '@playwright/test'`                              | script อยู่นอก project จึง resolve `node_modules` ไม่เจอ                                                                                          | import ด้วย absolute `file:///C:/Project/WORLDVIEW-worktrees/qa-wave3/node_modules/@playwright/test/index.mjs`                              |
| 15:07 | `probe2.mjs` (ตรวจ CSR navigation)                       | `page.waitForURL: Timeout 30000ms`                                     | ตั้ง input เป็น 2099 ซึ่งเกิน `max={today}` ทำให้ `requestSubmit()` ไม่ submit (constraint validation) ซึ่งเป็นพฤติกรรมที่ถูกต้อง                       | ตัดส่วน CSR ออก ใช้หลักฐานจาก SSR + DOM + screenshot แทน                                                                                       |
| 15:08 | `node fontshare.mjs http://… / /archive`                | `Cannot navigate to invalid URL "…5373C:/Program Files/Git/"`          | Git Bash (MSYS) แปลง argument `/` เป็น path ของ Windows                                                                                          | ใช้ `MSYS_NO_PATHCONV=1`                                                                                                                       |
| 15:08 | `grep -P "[\x{0E00}-\x{0E7F}]…"`                        | `character value in \x{} or \o{} is too large`                          | grep -P ที่ build มาไม่รองรับ code point ระดับนี้ (ไม่มี UTF mode)                                                                                  | ใช้ node regex แทน                                                                                                                              |
| 15:11 | Edit tool (AppShell, shared.ts, layout.css ฯลฯ)          | `File has not been read yet`                                           | Edit ต้อง Read ไฟล์ใน session ก่อน (อ่านผ่าน bash ไม่นับ)                                                                                          | Read ก่อนแล้วจึง Edit                                                                                                                          |
| 15:31 | `ACCEPTANCE.md` (Edit ก่อน commit docs)                  | `File has not been read yet` แต่ commit `c42f787` ออกไปโดยไม่มีไฟล์นี้    | สั่ง Edit กับ commit ใน message เดียวกัน                                                                                                          | Read + Edit ใหม่แล้ว commit แยกเป็น `7e62fb0`                                                                                                   |
| 15:23 | e2e รอบ 1: `a11y.e2e.ts` 22 test (axe ทุก route) + 001    | `label-content-name-mismatch` บน `a[aria-label="Worldview หน้าหลัก"]`  | `aria-hidden` บน tagline ไม่พอ เพราะ rule เทียบ `aria-label` กับ visible text และข้อความที่ `aria-hidden` ก็ยังมองเห็นได้                                | เอา `aria-label` ออก ให้ชื่อมาจาก content "worldview" + sr-only "หน้าหลัก" (`28a3771`)                                                           |
| 15:23 | e2e รอบ 1: `exploratory.e2e.ts` › Thai text at 360 px    | `/brief/2026-11-12` clipped: "ข่าวในสรุปฉบับนี้"                       | `<h2 class="sr-only">` ใหม่ของ 008 เป็นกล่อง 1px ที่ clip ตามตั้งใจ                                                                                | ให้ check ข้าม `.sr-only` แบบเดียวกับ `legibleTextShare` (`28a3771`)                                                                            |
| 15:23 | e2e รอบ 1: `lighthouse-findings.e2e.ts` › BUG-QA-010     | CLS 0.309 (ต้อง < 0.1)                                                 | preload อย่างเดียวขึ้นกับ timing: ตอนรันเดี่ยวผ่าน แต่เมื่อมี parallel worker แย่ CPU ทำให้ Latin subset ยังมาก่อน Thai และ swap ทีละ subset เหมือนเดิม | ประกาศ @font-face เองด้วย `font-display: optional` (`ab6ea7d`) แล้ววัดซ้ำได้ 0.000 ทั้งแบบเดี่ยว แบบ parallel และใน e2e เต็มชุด                   |
| 15:31 | script แก้ status ใน `BUGS.md` (regex)                    | ไม่มีอะไรเปลี่ยน (ไม่ error)                                              | escape ของ regex ใน heredoc/template ทำให้ pattern ไม่ match                                                                                     | เขียนใหม่เป็นแบบอ่านทีละบรรทัด (`bugstatus.cjs`)                                                                                                 |
| 15:28 | Monitor tool                                            | สร้าง monitor ซ้ำสองครั้ง                                                 | สั่ง monitor ใหม่ทั้งที่ตัวเดิมยังทำงานอยู่                                                                                                          | `TaskStop` ตัวที่ซ้ำ                                                                                                                           |

## Open issues / follow-ups for the orchestrator

- **BUG-QA-007 "ข่Wาว"**: ข้อความที่มีตัว W แทรกแบบนี้ reproduce ไม่ได้ทั้งใน SSR, DOM และ pixel และไม่มีใน repo ด้วย สิ่งที่พิสูจน์ได้คือ encoding fault ที่ header ขาด charset ทำให้ client ที่อ่านแค่ header แสดงภาษาไทยเพี้ยน (แก้แล้ว) ถ้า "ข่Wาว" มาจากเครื่องมือตัวอื่น ขอดูต้นทาง
- **`font-display: optional`**: การเข้าเว็บครั้งแรกบนเน็ตช้าอาจได้ fallback font (Tahoma/Segoe UI/system Thai) สำหรับหน้านั้น หน้าถัดไปจะใช้ Noto จาก cache ซึ่ง spec §5 อนุญาต fallback นี้ไว้ ถ้าต้องการให้ Noto ขึ้นเสมอ ต้องยอมรับ CLS หรือใช้ layout ที่ไม่ reflow แทน
- **Mobile bottom nav และ eyebrow ภาษาอังกฤษ** ยังเป็น 10px ตาม prototype (share ผ่าน 94–97% แล้ว) ถ้าต้องการให้ข้อความไทยทุกจุด ≥ 12px ให้เปลี่ยน nav เป็น `text-meta`
- **Admin pages** ยังมี `text-[11px]` อยู่ ไม่ได้อยู่ใน scope ของ audit แต่ใช้ `text-meta` ได้ใน wave ถัดไป
- `security-headers.ts` เป็นไฟล์ของ security lane ส่วนที่เปลี่ยนมีแค่การเติม `charset=utf-8` ให้ `text/html` ที่ไม่มี charset ควรแจ้ง lane นั้น
- `/` Lighthouse performance 95 → 94 (median) มาจาก TBT 138–141 ms ใน 2 จาก 3 รอบ (อีกรอบเป็น 0) ส่วน LCP ไม่เปลี่ยน ดูเป็น noise แต่ควรวัดซ้ำบน production
