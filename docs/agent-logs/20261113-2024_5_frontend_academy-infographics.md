# 5 · frontend · academy-infographics

| Field      | Value                              |
| ---------- | ---------------------------------- |
| Started    | 2026-11-13 20:24:04 (Asia/Bangkok) |
| Finished   | 2026-11-13 21:28:00 (Asia/Bangkok)         |
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

## Review fixes (2026-11-13 21:07–21:28)

orchestrator ส่งผล review อิสระกลับมา (ไม่พบ bug ด้าน security/correctness ในโค้ด) โดยมีข้อที่ต้องแก้ 3 ข้อ (MUST), ข้อที่ควรแก้ 7 ข้อ (SHOULD) และ nit ที่เป็น optional ทำครบทุกข้อ

1. 21:07 — **MUST 1** day 4 timeline `พ.ค.–ก.ย. 1945`: detail เดิมอ่านแล้วเหมือนเยอรมนียอมแพ้หลังระเบิดปรมาณู เปลี่ยนเป็น "เยอรมนียอมแพ้ พ.ค. ส่วนญี่ปุ่นยอมแพ้ ส.ค.–ก.ย. หลังระเบิดปรมาณูและโซเวียตประกาศสงคราม" (label เดิมถูกอยู่แล้ว) **MUST 2** takeaway ปี 1939 ใส่ "ในยุโรป" กลับเข้าไป **MUST 3** source ของ stats วันที่ 25 เปลี่ยนเป็น "ตัวเลขโดยประมาณตามเนื้อหาบทเรียน (ช่วงทศวรรษ 1960 ถึงต้นทศวรรษ 2020)" เพราะในบทเรียนไม่ได้อ้าง UN WPP ส่วนเอกสารกับ schema ให้ตรงกันโดย**เอาคำว่า "with a year" ออก** (comment ของ `statsSchema` และ ARCHITECTURE §13) แทนการบังคับปี 4 หลัก เพราะบทเรียนส่วนใหญ่ไม่มีปีให้ และการบังคับจะทำให้ต้องแต่งปีขึ้นมาเอง
2. 21:10–21:16 — **SHOULD 6** (orchestrator ตัดสินใจแทนเจ้าของ) ลบ `## สรุปสั้น` ออกจากทั้ง 30 บท เพราะซ้ำกับ takeaways แบ่งให้ implementer 2 ตัวรันขนาน (สัปดาห์ 1–2 และ 3–4) โดยใช้กติกาว่า bullet ไหนมีข้อเท็จจริงที่ takeaways ไม่มี ให้รวมเข้า takeaways (ยังคง 3–5 ข้อ ≤140 ตัวอักษร) แล้วลบ section ไม่มีเนื้อหาหาย ทุกบทยังมี 5 ข้อ ยาวสุด 139 ตัวอักษร (วันที่ 19) และ diff เนื้อหาคือ +66/−323 บรรทัด
   - **บทที่รวมเนื้อหาเข้า takeaways:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30
     - เช่น วันที่ 1: เพิ่มคลองสุเอซ/ปานามา และนิยามขั้วอำนาจ
     - วันที่ 6: รวม takeaway เรื่อง NATO สองข้อเป็นข้อเดียว และเพิ่มข้อเรื่องข้อจำกัดขององค์การ
     - วันที่ 11: เพิ่มนิยามอัตราแลกเปลี่ยน สาเหตุวิกฤต 1997 และบทบาทดอลลาร์
     - วันที่ 19: เพิ่มท่อ/LNG จุดคอขวดที่ขาดไป และกองทุนน้ำมัน
     - วันที่ 20: รวมสองข้อแรกเข้าด้วยกัน และเพิ่มแร่สำคัญอื่น
     - วันที่ 30: แก้ทั้ง 5 ข้อ
   - **บทที่ไม่ต้องรวม:** 15 (ต่างกันแค่ถ้อยคำ)
   - **คำที่ตัดออกเพื่อให้ไม่เกิน 140 ตัวอักษร:** ยังอยู่ในเนื้อหาครบ ได้แก่ "ทางยุทธศาสตร์" (วันที่ 19) และ "เสมอ" (วันที่ 30)
3. 21:17 — ตรวจซ้ำ: validator 30 OK, ไม่เหลือ `## สรุปสั้น`, ไม่พบ character แปลกปลอม และตัวเลขทุกตัวใน takeaways/infographic ยังอยู่ในเนื้อหา (ยกเว้น "2026" ใน source วันที่ 6 เหมือนเดิม) **SHOULD 8** วันที่ 14 เอา "1."–"5." ออกจาก label ของ layers และให้ layers แบบ `stack` แสดงเลขลำดับเป็น badge แทน (pyramid ไม่มีเลข) จากนั้น commit เนื้อหา
4. 21:18–21:21 — โค้ด
   - **SHOULD 5:** `hashchange` ที่เปิด section ที่พับอยู่จะ scroll ไปที่เป้าหมายด้วย (ใช้ helper `scrollToHashTarget` ร่วมกับตอนโหลด)
   - **SHOULD 7:** stats ที่ค่าขึ้นต้นด้วย `~`/`<`/`>` ให้ตัวเลขที่เห็นเป็น `aria-hidden` และมี sr-only "ประมาณ / น้อยกว่า / มากกว่า N"
   - **SHOULD 9:** hub ใช้ `<ul>` เดียว วางซ้าย/ขวาด้วย grid (`--row` + `@xl:[grid-row:var(--row)]`) โดย list กับ centre ใช้คอลัมน์ชุดเดียวกัน
   - **SHOULD 10:** ปุ่ม open-all มี `aria-expanded`
   - **Nit (folded flag):** `renderLessonMarkdown` คืน `folded` ซึ่งไปเป็น `LessonDetail.has_folded_sections` แทนการ sniff HTML
   - **Nit (type check):** ยังคงเขียน type `Infographic` เองเพื่อให้อ่านง่าย และไม่ให้ `types/` ต้อง import จาก `content/` แต่เพิ่ม `SCHEMA_MATCHES_TYPE` ที่ทำให้ `npm run check` fail เมื่อ type กับ zod output ไม่ตรงกัน ทดสอบแล้วว่าทำงานจริง (ลองเพิ่ม variant `funnel` ให้ type ได้ 2 errors) ส่วน `INFOGRAPHIC_TYPES` ย้ายไปอยู่ใน fixtures (`Object.keys(VALID_SPECS)` โดย fixtures ถูกบังคับให้ครบทุก type)
   - เพิ่ม unit test ของ hub (list เดียว), stats (คำอ่าน), เลขของ stack และ flag `folded`
5. 21:19–21:22 — **SHOULD 4** e2e deep link ไปที่ `/academy` ก่อน แล้วโหลด `/academy/week/1/day/1#id` (เป็นการโหลด document จริง ไม่ใช่ hash nav ในหน้าเดิม) และ assert `toBeInViewport()` นอกจากนี้เพิ่ม test hashchange ที่เปลี่ยน `location.hash` แล้ว assert ว่าเห็นและอยู่ใน viewport และ assert `aria-expanded` ของปุ่ม open-all
6. 21:21–21:24 — e2e ของ academy รอบแรก 4 failed (ดู Error #10) แก้แล้วผ่าน 41/41 พร้อม regenerate screenshot ทั้ง 12 ภาพของบทเรียน (roadmap ไม่เปลี่ยน) และเปิดดู `w1-d1-1280-light.png` เพื่อยืนยัน layout ของ hub
7. 21:24–21:26 — gate ทั้งหมด: check 0 errors, lint ผ่าน, `npm test` 66 files / 1086 tests, build / build:scripts exit 0, verify:prod-build ok, academy:sync 30 lessons และ `E2E_PORT=4973 npm run test:e2e` **359 passed** จากนั้น commit `7385358` (content), `b427ea1` (code), `cc15e54` (tests + docs + screenshots)

### Errors (review fixes)

10. e2e: 768 px ล้นแนวนอนบนวันที่ 1 และ 4 (hub) โดย `<li>` ฝั่งขวาไปอยู่ที่ x=869 สาเหตุคือ `<ul>` ใช้ `col-span-3 row-start-1` แต่ไม่ได้ระบุคอลัมน์เริ่ม ช่องที่ 2 ของแถว 1 มี centre อยู่แล้ว auto-placement จึงสร้างคอลัมน์ implicit ต่อไปทางขวา → แก้ด้วย `@xl:col-start-1` ส่วนที่ซ้อนกับ centre ตั้งใจให้ซ้อน เพราะคอลัมน์กลางของ list ว่าง (debug ด้วย spec ชั่วคราว `zz-debug.e2e.ts` ซึ่งลบแล้ว)
11. svelte-check: `{@const}` ต้องเป็นลูกโดยตรงของ `{#each}` → ย้ายขึ้นไปไว้หัว each
12. `python` ใน Git Bash ไม่มี `yaml` module และ stdout เป็น cp1252 → ใช้ regex แทน และตั้ง `PYTHONIOENCODING=utf-8`
