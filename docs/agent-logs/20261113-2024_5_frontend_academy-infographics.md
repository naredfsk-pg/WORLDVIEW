# 5 · frontend · academy-infographics

| Field      | Value                              |
| ---------- | ---------------------------------- |
| Started    | 2026-11-13 20:24:04 (Asia/Bangkok) |
| Finished   | 2026-11-13 20:58:00 (Asia/Bangkok)         |
| Status     | done                               |
| Agent type | frontend (+ 4 implementer sub-agents for content, one per week) |

## Goal

คำขอของเจ้าของ (2026-11-13): "Roadmap 30 วัน อยากให้มีภาพ Infographic ประกอบด้วย เพราะตัวหนังสือมันเยอะเกินไป" โดยเลือกแบบ **SVG/HTML ในหน้า** (ไม่ใช่รูปภาพ) ให้ครบทั้ง 30 บทเรียน:

1. การ์ด "สรุปใน 30 วินาที" (3–5 ข้อ) ที่หัวบทเรียน
2. infographic หลัก 1 ภาพต่อบท (ภาพที่สองเมื่อช่วยให้เข้าใจจริง) เป็น data spec ที่มี type ใน frontmatter ผ่าน zod/loader เดียวกับบทเรียน (spec ผิดต้องทำให้ `academy:sync` ล้มชัดเจน) และ render ด้วย component ที่ใช้ซ้ำได้
3. ทางอ่านที่สั้นลง: เก็บเนื้อหาเต็มไว้ แต่พับส่วนยาวไว้หลัง "อ่านต่อ"
4. (optional) แผนที่เส้นทาง 30 วันบน `/academy`

ทำงานใน worktree `C:\Project\WORLDVIEW-worktrees\academy-infographics` (branch `feature/academy-infographics` จาก `main` @ `4df019a`) ไม่ push ไม่เปิด PR และไม่แตะไฟล์ editorial/digest/event ของ backend lane (StoryCard, EventDetail, ConnectionList, briefs)

## What I did (in order)

1. 20:24 — ตรวจ worktree (clean) แล้วอ่าน `academy.ts`, `academy.server.ts`, `academy-sync.ts` และ test ของมัน, `LessonArticle.svelte`, route บทเรียนและ `/academy`, `tokens.css`, `lesson-prose.css`, `layout.css`, UI spec, `csp.ts`, e2e `academy-lessons` / `a11y` / `responsive` / helpers และ `BASELINE.md` จากนั้นรัน `npm ci` + `npm run db:reset` ใน background
2. 20:26 — ออกแบบ schema `src/lib/content/infographic.ts` เป็น zod discriminated union 7 type (`flow`, `cycle`, `timeline`, `compare`, `hub`, `stats`, `layers`) ใช้ strict object (key สะกดผิดจะ fail) กำหนดความยาวให้อ่านได้ที่ 320 px และบังคับ `source` สำหรับ `stats` ส่วน `takeaways` (3–5 ข้อ, ≤140) กับ `infographics` (1–2 ภาพ) เป็น field บังคับใน `lessonFrontmatterSchema` เพิ่ม type `Infographic` / `InfographicNode` ใน `types/domain.ts` และเพิ่ม field ใน `LessonFrontmatter` กับ `LessonDetail` จากนั้นต่อ field เข้า `getLessonDetail` และเพิ่ม takeaways + ข้อความ infographic ลงใน `search_text` (`lessons_fts`)
3. 20:30 — เขียน validator ใน scratchpad (`validate-lessons.mts`) ที่เรียก `parseLessonFile` ตัวจริงและตรวจ CRLF/control character ด้วย (ดู Errors #1, #2)
4. 20:31 — แบ่งงานเนื้อหาให้ implementer 4 ตัวรันขนาน (1 ตัวต่อสัปดาห์) โดยให้อ่านบทเรียนเต็มก่อน, ห้ามเพิ่มข้อเท็จจริง/ตัวเลขที่บทเรียนไม่มี, คง hedge, แทรกเฉพาะหลัง `last_reviewed_at`, ห้าม commit และต้องผ่าน validator ทุกไฟล์ ทั้ง 4 ตัวรายงานกลับพร้อมตารางเหตุผลและจุดที่ไม่แน่ใจ (20:33–20:36)
5. 20:36 — ตรวจเนื้อหาที่เพิ่ม: สแกน character นอก Thai/ASCII (ไม่พบ), validator OK ทั้ง 30 ไฟล์ และใส่ปีให้ `source` ของ stats วันที่ 6 ("ณ ปี 2026") จากนั้น commit เนื้อหาแยกตามสัปดาห์ 4 commit (ดู Deviations #1)
6. 20:37–20:41 — unit test: fixture ใน `academy.test.ts` (+ กรณี takeaways ไม่ครบ, infographics ว่าง, type ไม่รู้จัก), `infographic.test.ts` (valid 1 spec ต่อ type, invalid 12 กรณี, takeaways/infographics, `infographicText`), `infographic.fixtures.ts` (spec ตัวอย่างที่ใช้ร่วมกับ render test)
7. 20:38–20:42 — ทางอ่านแบบ skim ใน `renderLessonMarkdown`: แบ่ง token เป็น top-level block แล้วจัดกลุ่มตาม `##` แต่ละ section แสดงหัวข้อ + block แรก ส่วนที่เหลือถ้ามีข้อความ ≥280 ตัวจะห่อด้วย `<details class="lesson-more">` (summary "อ่านต่อ"/"ย่อเนื้อหา" + sr-only ชื่อหัวข้อที่ escape แล้ว) โดยไม่ตัดเนื้อหาออก ผลคือข้อความที่เห็นก่อนกดเหลือ 23–70% ต่อบท (ส่วนใหญ่ 25–45%) และเพิ่ม render test (ดู Errors #3, #4)
8. 20:42–20:44 — component ใน `src/lib/components/infographic/`: `Infographic.svelte` (`<figure>` ที่มี `aria-labelledby` ชื่อ, `aria-describedby` คำอธิบาย และ figcaption แหล่งที่มา), `FlowDiagram`, `CycleDiagram`, `TimelineDiagram`, `CompareDiagram`, `HubDiagram`, `StatsDiagram`, `LayersDiagram`, `NodeText`, `Arrow` เป็น HTML list + CSS grid + container query ส่วน SVG ใช้เฉพาะลูกศรตกแต่ง (`aria-hidden`) ข้อความไทยจึงตัดบรรทัดเองได้และ screen reader ได้เป็น list นอกจากนี้ยังเพิ่ม `LessonTakeaways.svelte`
9. 20:44–20:45 — `LessonArticle`: ลำดับใหม่คือ header → สรุปใน 30 วินาที → infographic → คุณจะได้เรียนรู้ → สารบัญ → แถบ "เปิดอ่านทุกหัวข้อ/ย่อทุกหัวข้อ" → เนื้อหา และเพิ่ม `$effect` ที่เปิด `<details>` ซึ่งครอบเป้าหมายของ anchor (คลิก TOC, `hashchange`, deep link ตอนโหลด) ฝั่ง route ใช้ `{#key data.lesson.id}` เพื่อให้ state เริ่มใหม่เมื่อกด prev/next
10. 20:45 — `AcademyRoadmap.svelte` บน `/academy`: แสดงแต่ละสัปดาห์เป็นแถววงกลมเลขวัน 44 px ที่ลิงก์ไปบทเรียน บทที่เรียนแล้วจะทึบและมี badge ✓ (ไม่ใช้สีอย่างเดียว) และมีชื่อสำหรับ screen reader "วันที่ N: ชื่อบท (เรียนแล้ว)"
11. 20:43–20:44 — render test (`Infographic.test.ts`): ครบทุก type (figure มีชื่อ/คำอธิบาย, list ถูกชนิด, ทุก string ของ spec เป็นข้อความจริง, svg ทุกตัว aria-hidden), escape `<script>`/`<img>`, pyramid inset, ข้อความวนของ cycle, takeaways และ render spec ของทั้ง 30 บท จากนั้น `npm run check` 0 error, lint ผ่าน (ดู Errors #5) และ `npm test` ผ่าน 1082 แล้ว commit framework 2 commit
12. 20:45–20:52 — e2e `tests/e2e/academy-infographics.e2e.ts` ครอบ 6 บท (ทุก type) × 320/768/1280 × light/dark: takeaways, figure มีชื่อและคำอธิบาย, ไม่ล้นแนวนอน, ข้อความใน diagram ≥14 px และ axe ไม่มี serious/critical รวมถึงการพับ/เปิดทั้งหมด, TOC/deep link เข้า section ที่พับ และ roadmap 30 ลิงก์ (ดู Errors #6–#9) ถ่าย screenshot แล้วเปิดดูเองทุกภาพเพื่อเช็กการตัดบรรทัดไทยและการซ้อนทับ
13. 20:53 — gate: check / lint / test (1083) / build / build:scripts / verify:prod-build / academy:sync ผ่านทั้งหมด จากนั้น commit fix + e2e + screenshot
14. 20:54 — ตรวจว่าตัวเลขทุกตัวใน takeaways/infographic ปรากฏในเนื้อหาบทเรียน (script ใน scratchpad): ไม่มีตัวเลขเกินมา ยกเว้น "2026" ที่ผมใส่ใน source ของวันที่ 6 อัปเดต `docs/ARCHITECTURE.md` §13 แล้วรัน e2e เต็มชุดใน background
15. 20:55–20:56 — e2e เต็มชุด `E2E_PORT=4973 npm run test:e2e`: 358 passed (chromium + admin + pipeline), exit 0
16. 20:57 — เขียน log นี้แล้ว commit

## Files created / changed

- `content/academy/week-{1..4}/*.md` (30 ไฟล์): เพิ่ม `takeaways` + `infographics` ใน frontmatter โดยไม่แก้ส่วนอื่น
- `src/lib/content/infographic.ts` (ใหม่): schema, `INFOGRAPHIC_TYPES`, `infographicText`
- `src/lib/content/infographic.fixtures.ts` (ใหม่): spec ตัวอย่าง 1 ต่อ type (ใช้ใน test)
- `src/lib/content/infographic.test.ts` (ใหม่)
- `src/lib/content/academy.ts`: field ใหม่ใน schema, พับ section (`renderWithCollapsedSections` + helper), table `tabindex="0"`
- `src/lib/content/academy.server.ts`: ส่ง field ใหม่ออกไป และ `lessonSearchText`
- `src/lib/content/academy.test.ts`, `src/lib/content/render.test.ts`: test ใหม่
- `src/lib/types/domain.ts`, `src/lib/types/views.ts`: `Infographic`, `InfographicNode`, field ใหม่
- `src/lib/components/infographic/*.svelte` (ใหม่ 10 ไฟล์) + `Infographic.test.ts`
- `src/lib/components/LessonTakeaways.svelte`, `src/lib/components/AcademyRoadmap.svelte` (ใหม่)
- `src/lib/components/LessonArticle.svelte`, `src/routes/academy/week/[week]/day/[day]/+page.svelte`, `src/routes/academy/+page.svelte`
- `src/lib/styles/lesson-prose.css`: style ของ `.lesson-more`
- `tests/e2e/academy-infographics.e2e.ts` (ใหม่)
- `docs/qa/screenshots/academy-infographics/*.png` (14 ภาพ, ~1.9 MB): บท 1, 4, 9, 12 × (320 light, 320 dark, 1280 light) + roadmap 320/1280
- `docs/ARCHITECTURE.md` §13: schema ของ takeaways/infographics, ตาราง type, การ render และทางอ่านแบบพับ

## Infographic per lesson

| Day | Type(s) |
| --- | --- |
| 1 | hub + compare |
| 2 | flow + hub |
| 3 | flow |
| 4 | timeline + hub |
| 5 | compare |
| 6 | compare (3 คอลัมน์) + stats |
| 7 | hub |
| 8 | hub |
| 9 | compare + cycle |
| 10 | flow |
| 11 | compare + flow |
| 12 | layers (pyramid) |
| 13 | timeline |
| 14 | layers (stack) + flow |
| 15 | hub + cycle |
| 16 | timeline |
| 17 | timeline |
| 18 | flow + compare |
| 19 | flow |
| 20 | flow + compare |
| 21 | hub |
| 22 | hub |
| 23 | compare |
| 24 | flow + timeline |
| 25 | stats + flow |
| 26 | hub + flow |
| 27 | compare + hub |
| 28 | flow + compare |
| 29 | cycle + layers (pyramid) |
| 30 | layers (stack) + flow |

รวม 47 ภาพ (30 ภาพหลัก + 17 ภาพรอง): flow 13, hub 10, compare 10, timeline 5, layers 4, cycle 3, stats 2

## Commands & results

| Command | Result |
| --- | --- |
| `npm ci` + `npm run db:reset` | ok (lessons_fts 30) |
| `npx tsx …/validate-lessons.mts content/academy/*/*.md` | 30 OK |
| `npm run check` | 0 errors, 0 warnings (1788 files) |
| `npm run lint` | prettier + eslint ผ่าน |
| `npm test` | 66 files, 1083 tests passed |
| `npm run build` / `npm run build:scripts` | exit 0 / exit 0 |
| `npm run verify:prod-build` | ok (284 files scanned, no dev bypass) |
| `npm run academy:sync` | 30 lessons synced (academy_lessons=30, lessons_fts=30) |
| `E2E_PORT=4973 npx playwright test tests/e2e/academy-infographics.e2e.ts --project=chromium` | 40 passed |
| `E2E_PORT=4973 npm run test:e2e` | 358 passed (1.6m), exit 0 |

## Errors (cause → fix)

1. validator `.ts` รอบแรก: `Unterminated string literal` เพราะ `'\\'` ใน heredoc ถูกแปลงเป็นตัวอักษรจริง (กับดัก encoding ที่ brief เตือนไว้) → เขียนใหม่โดยไม่ใช้ backslash (`String.fromCharCode(92)` และตรวจ control character ด้วย char code)
2. validator: `Top-level await is currently not supported with the "cjs" output format` → เปลี่ยนนามสกุลเป็น `.mts`
3. โค้ดที่แทรกผ่าน python ใน `academy.ts` มี `'\n'` กลายเป็นขึ้นบรรทัดจริงใน string literal → เขียน `renderWithCollapsedSections` ใหม่ทั้งก้อนโดยไม่ใช้ newline escape (ซึ่งทำให้โค้ดเรียบขึ้นด้วย เพราะแยกเป็น `topLevelBlocks` / `groupSections` / `leadBlockCount`) และตรวจด้วย `cat -A`
4. `render.test.ts`: เกิดปัญหาเดียวกัน (Transform failed) → ใช้ template literal ที่ขึ้นบรรทัดจริง และ assert ด้วยตำแหน่งของ `</details>` แทน string ที่มี `\n`
5. eslint: `'_omitted' is assigned a value but never used` ใน test → สร้าง spec ที่ไม่มี `variant` ตรง ๆ
6. e2e: axe `scrollable-region-focusable` (serious) ที่ `.lesson-prose > table` บนวันที่ 6 และ 14 ที่ 320 px ตารางที่ scroll แนวนอนในตัวเองโฟกัสด้วยคีย์บอร์ดไม่ได้ ปัญหานี้มีอยู่ก่อนแล้ว แต่ไม่เคยถูกสแกนที่ 320 px → ให้ renderer ใส่ `tabindex="0"` ให้ `<table>` พร้อม unit test
7. screenshot 1280: compare 3 คอลัมน์ตกเป็น 2+1 และ hub ไม่กางซ้ายขวา เพราะ container query `@2xl` (42rem) กว้างกว่าคอลัมน์จริงของ figure (~636 px) → เปลี่ยนเป็น `@xl` (36rem), compare 3 คอลัมน์ข้ามขั้น 2 คอลัมน์ และ stats ใช้ 3 คอลัมน์เฉพาะเมื่อมี 3/5/6 ช่อง
8. screenshot มือถือ: tab bar แบบ fixed บังกลางภาพ และ option `style` ของ Playwright ไม่มีผลเพราะมันแทรก `<style>` ซึ่ง CSP บล็อก → ซ่อนผ่าน DOM (`element.style.visibility`) ใน helper `hideTabBar`
9. `rm -f docs/qa/screenshots/academy-infographics/*` ถูก safety check ของ Claude Code บล็อก (ไม่ได้รัน) → ลบเฉพาะ 6 ไฟล์ที่ไม่ต้องการทีละไฟล์ด้วยชื่อเต็ม

## Deviations

1. ลำดับ commit: commit เนื้อหา 4 สัปดาห์ **ก่อน** framework ไม่ใช่หลัง เพราะ schema เดิม (`z.object`) ตัด key ที่ไม่รู้จักทิ้ง เนื้อหาใหม่จึงผ่าน test ของ commit ก่อนหน้า ส่วน schema ใหม่บังคับ field ทำให้ทุก commit ผ่าน test ได้ และเนื้อหาถูกเก็บไว้เร็วที่สุด
2. มี 17 บทที่มี infographic 2 ภาพ (brief บอกว่าภาพที่สองเป็น optional) ทุกภาพที่สองผ่าน validator และตรงกับเนื้อหา ถ้าเจ้าของอยากให้หน้าสั้นลง ภาพที่ตัดได้ง่ายที่สุดคือภาพรองของวันที่ 2, 4, 25–28 และ 30
3. `stats` วันที่ 25 มี `source` เป็น "ตัวเลขโดยประมาณตามบทเรียน (UN World Population Prospects และหน่วยงานด้านประชากรไทย)" ไม่มีปี เพราะในบทเรียนเองก็ไม่มีปี ส่วนวันที่ 6 ผมใส่ "ณ ปี 2026" (ปีที่ตรวจทานเนื้อหา)
4. Cycle แสดงเป็นแนวตั้ง + เส้นวนกลับด้านซ้ายทุกความกว้าง ไม่ใช่วงกลม เพราะข้อความไทยในวงกลมอ่านยากที่ 320 px ข้อความ "ขั้นสุดท้ายวนกลับไปขั้นที่ 1" ทำให้ไม่ต้องพึ่งรูปทรง
5. Roadmap เป็นวงกลมเลขวันต่อสัปดาห์ ไม่มีเส้นเชื่อมระหว่างวงกลม เพราะเส้นจะขาดเมื่อขึ้นบรรทัดใหม่ที่ 320 px
6. การพับใช้ `<details>` แบบ native: Chrome เปิดเองเมื่อใช้ find-in-page ส่วน anchor link เปิดด้วย JS ของ `LessonArticle` ถ้าไม่มี JS การพับยังใช้งานได้ แต่ปุ่ม "เปิดอ่านทุกหัวข้อ" จะไม่ทำงาน และตอนพิมพ์ section ที่พับจะไม่ถูกพิมพ์

## Follow-ups

- เจ้าของ/บรรณาธิการควรอ่านทวน takeaways และ infographic ทั้ง 47 ภาพ ซึ่ง sub-agent เขียนจากเนื้อหาบทเรียน และผมสุ่มตรวจตัวเลขทุกตัวด้วย script แล้ว จุดที่ sub-agent ระบุว่าตีความเพิ่มเล็กน้อย:
  - day 4: timeline รวมเหตุการณ์ ธ.ค. 1941 และ พ.ค.–ก.ย. 1945 เป็นช่วงเดียว
  - day 9, 15: การปิดวงของ cycle อนุมานจากคำว่า spiral / arms race
  - day 14: ตัดห่วงโซ่น้ำมัน 8 ขั้นเหลือ 6 ขั้น
  - day 23: map ถ่านหินว่า "มีแหล่งในประเทศ" เข้ากับมิติความมั่นคง
- วัด Lighthouse หลัง merge เพื่อยืนยัน CLS ของหน้าบทเรียน (baseline 0.007) ตอนนี้ทุกอย่าง render ฝั่ง server ไม่มีอะไรโหลดทีหลัง และ roadmap/progress เปลี่ยนแค่สี ไม่เปลี่ยนขนาด
- ถ้าต้องการให้พิมพ์บทเรียนได้ครบ ให้เพิ่ม `beforeprint` handler ที่เปิด `<details>` ทุกอัน
