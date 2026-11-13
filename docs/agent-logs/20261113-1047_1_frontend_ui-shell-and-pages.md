# 1 · frontend · ui-shell-and-pages

| Field | Value |
|---|---|
| Started | 2026-11-13 10:47:30 (Asia/Bangkok) |
| Finished | 2026-11-13 11:16:00 (Asia/Bangkok) |
| Status | done |
| Agent type | frontend |

## Goal
สร้าง UI ของ WORLDVIEW Wave 1 ใน worktree `C:\Project\WORLDVIEW-worktrees\ui-shell-and-pages` (branch `feature/ui-shell-and-pages`): ตั้งค่า shadcn-svelte + map semantic tokens ของ prototype, AppShell (sidebar/bottom nav), ThemeToggle, components ตาม UI spec §6, ทุก public route (`/`, `/brief`, `/brief/[date]`, `/events/[id]`, `/archive`, `/academy`, lesson reader, `/connections`, `/search`), lesson markdown renderer ที่ปลอดภัย, browser storage, unit tests + Playwright e2e และ screenshot เทียบกับ prototype

## What I did (in order)
1. 10:47 — ตรวจ worktree (`git branch --show-current` = `feature/ui-shell-and-pages`, HEAD `af34f9d`) อ่าน UI_DESIGN_SPEC, prototype `index.html` (CSS + JS ทั้งหมด), ARCHITECTURE §1/§3/§7/§13/§15/§18, `types/views.ts`, `types/domain.ts`, `PublicReadRepository` และ demo fixture
2. 10:48 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset` (seed: 13 events, 9 briefs, 7 relations, 30 lessons)
3. 10:49 — ลอง `shadcn-svelte init` (CLI v1.8.1) → init เป็น interactive (ถาม preset) ใช้ใน agent ไม่ได้ จึงเขียน `components.json` เองโดยตั้ง aliases เป็น `#lib/...` แล้วใช้ `shadcn-svelte add button badge dialog separator skeleton --yes --overwrite --no-deps-install` ซึ่งใช้ได้กับ `#lib` aliases (ไฟล์ที่ได้ import `#lib/components/ui/utils.js`)
4. 10:51 — เขียน `src/lib/components/ui/utils.ts` (`cn` + `WithElementRef` ฯลฯ) เองเพราะปกติ `init` เป็นตัวสร้าง; ใช้ `unknown` แทน `any` เพื่อผ่าน lint
5. 10:52 — ติดตั้ง deps: `bits-ui`, `@internationalized/date` (peer ของ bits-ui), `@lucide/svelte`, `tailwind-variants`, `clsx`, `tailwind-merge`, `@fontsource/noto-sans-thai` (dev) และ `markdown-it` (runtime, server). ลอง `@types/markdown-it` แล้วถอนออกเพราะ markdown-it 15 มี types ในตัว
6. 10:53 — tokens: `src/lib/styles/tokens.css` (light/dark ตาม spec §5, ปรับ `--muted`/`--faint`/`--gold` ฝั่ง light ให้ผ่าน contrast 4.5:1) + map เป็นตัวแปร shadcn และ Tailwind `@theme inline` ใน `src/routes/layout.css`; breakpoints เป็น token ตาม spec §4 (431/721/901/1101px); dark variant ผูกกับ `[data-theme=dark]`
7. 10:53 — `src/app.html`: inline script เลือกธีมก่อน paint (localStorage `worldview:theme` → ถ้าไม่มีใช้ `prefers-color-scheme`) ไม่มี flash
8. 10:54 — helpers: `src/lib/components/format.ts` (Thai date/time แบบ Gregorian, Asia/Bangkok, labels หมวด/ภูมิภาค/edition/relation, parse URL params, month grid) และ `src/lib/stores/storage.ts` + `progress.svelte.ts` (ทุก storage access อยู่ใน try/catch)
9. 10:54 — content render API: `ACADEMY_WEEKS`, `renderLessonMarkdown` (markdown-it `html:false`, ปิด image, link ได้เฉพาะ `https://` หรือ `#anchor`, ใส่ `rel="noopener noreferrer"`, heading id `section-{n}` + TOC) ใน `academy.ts`; `loadAllLessons`/`listLessonSummaries`/`getAcademyWeeks`/`getLessonDetail` (memoized) ใน `academy.server.ts`
10. 10:55 — unit tests: `render.test.ts`, `format.test.ts`, `storage.test.ts`
11. 10:57 — commit foundation (2 commits)
12. 10:58 — components ใน `src/lib/components/`: `AppShell` (sidebar ≥901px, bottom nav <901px, skip link, ปุ่มค้นหา + `/` shortcut, progress module, banner stale/demo), `ThemeToggle` (aria-pressed, icon สลับด้วย CSS `dark:` จึงไม่มี hydration mismatch), `SearchDialog` (shadcn Dialog + GET form ไป `/search`), `PageIntro`, `FilterChips` (GET form + `aria-pressed`, ใช้ได้แม้ไม่มี JS, state อยู่ใน URL), `FeaturedStory`, `StoryCard`, `EventLabels` (ป้าย demo/แหล่งข่าวเดียว), `EventDetail` (8 sections ตามลำดับ + claims + corrections + AI-assisted disclosure), `SourceList`, `ConnectionList` (`potential_impact` = "อาจเกี่ยวข้อง/เป็นไปได้" + caveat), `WeekCard`, `LessonCard`, `LessonArticle` (TOC, glossary, คำถาม, อ่านเพิ่มเติม — รายการ `url:null`/`TODO: verify` เป็น plain text), `ArchiveCalendar` (ตารางเดือน, จุดวันที่มี brief, เลือกได้เฉพาะวันที่มีข้อมูล), `EmptyState`, `DemoNotice`, `FreshnessBadge`, `SeoHead` (title/description/canonical/og/twitter)
13. 11:01 — routes: `+layout.server.ts` (freshness, demo_mode, today, site_url, 503 เมื่อ DB ล่ม, `cache-control: public, max-age=60`), `+layout.svelte` (AppShell + skeleton เมื่อ navigate ข้ามหน้าเกิน 250ms), `+error.svelte`, `/`, `/brief` (307 → ล่าสุด), `/brief/[date]` (validate วันที่/edition, สลับ edition, วันก่อน/ถัดไป), `/events/[id]` (404 ถ้าไม่ public), `/archive` (month/date/category/region ใน URL), `/academy` (`?week=`), lesson reader, `/connections`, `/search`
14. 11:03 — `npm run check` เจอ 2 type errors → แก้; `npm run lint` เจอ 30 errors (`svelte/no-navigation-without-resolve` ฯลฯ) → เปลี่ยนลิงก์ภายในทั้งหมดเป็น `resolve()` จาก `$app/paths` (SvelteKit 3 รองรับ `RouteId?query`), ลิงก์ภายนอกใช้ `rel="external noopener noreferrer"`, เพิ่ม `queryString()` helper
15. 11:08 — check/lint/test ผ่าน → commit components และ routes
16. 11:09 — เปิด dev server (port 5173) แล้วถ่าย screenshot ด้วย Playwright script ใน scratchpad ที่ 1440/768/390/375/320 ทั้ง light/dark: ทุก route 200, overflow 0, ไม่มี console error (ยกเว้น Vite 504 ครั้งแรก)
17. 11:10 — แก้ช่องว่างหายใน label หมวด · ภูมิภาคของ StoryCard; เขียน `tests/e2e/ui.e2e.ts` (52 tests) — ผ่านทั้งหมดรอบแรก
18. 11:11 — เทียบกับ prototype (`index.html` ผ่าน file://) ที่ 390/1440: layout, tokens, typography ตรงกัน; เพิ่ม tag bubbles ในกล่องภาพรวม และย่อข้อความ DemoNotice; บันทึก 8 PNG ที่ `docs/screenshots/wave1/`
19. 11:13 — gate สุดท้าย: check, lint, test, build, test:e2e ผ่านทั้งหมด → commit; ปิด dev server

## Files created / changed
- `package.json`, `package-lock.json` — deps: `markdown-it` (runtime); dev: `bits-ui`, `@internationalized/date`, `@lucide/svelte`, `tailwind-variants`, `clsx`, `tailwind-merge`, `@fontsource/noto-sans-thai`
- `components.json` — shadcn-svelte config, aliases `#lib/...`
- `src/app.html` — no-flash theme script, viewport-fit=cover, theme-color
- `src/routes/layout.css`, `src/lib/styles/tokens.css`, `src/lib/styles/lesson-prose.css` — tokens + Tailwind theme + prose
- `src/lib/components/ui/{button,badge,dialog,separator,skeleton}/*`, `src/lib/components/ui/utils.ts` — shadcn-svelte (ปรับ label ปิดเป็นไทย, overlay ใช้ token)
- `src/lib/components/*.svelte` (19 components), `format.ts` + `format.test.ts`
- `src/lib/stores/storage.ts`, `storage.test.ts`, `progress.svelte.ts`
- `src/lib/content/academy.ts` (+`ACADEMY_WEEKS`, `renderLessonMarkdown`), `academy.server.ts` (+`loadAllLessons`, `listLessonSummaries`, `getAcademyWeeks`, `getLessonDetail`), `render.test.ts`
- `src/routes/**` (ยกเว้น `health/`) — layout, error, 9 page routes
- `tests/e2e/ui.e2e.ts`
- `docs/screenshots/wave1/*.png` (8 ไฟล์)

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 10:48 | `npm ci` · `cp .env.example .env` · `npm run db:reset` | ok (seeded) |
| 10:49 | `npx shadcn-svelte@1.8.1 init ...` | ค้างที่ prompt เลือก preset (interactive) → ยกเลิก |
| 10:50 | `npx shadcn-svelte@1.8.1 add button --yes --no-deps-install` | ok |
| 10:50 | `npx shadcn-svelte@1.8.1 add badge dialog separator skeleton --yes --no-deps-install` | exit 1 (prompt overwrite) → rerun ด้วย `--overwrite` ok |
| 10:55 | `npx vitest run` (3 ไฟล์ใหม่) | 1 fail → แก้ test → 29 passed |
| 11:03 | `npm run check` | 2 errors → แก้ → 0 errors |
| 11:04 | `npm run lint` | 30 eslint errors → แก้ → ผ่าน |
| 11:08 | `npm test` | 18 files / 126 tests passed |
| 11:09 | `node shot.mjs ...` (scratchpad) | ทุก route 200, overflow 0 |
| 11:10 | `npm run test:e2e` | 53 passed |
| 11:13 | `npm run check` · `npm run lint` · `npm test` · `npm run build` | ผ่านทั้งหมด (0 errors, 126 tests, build ok) |
| 11:14 | `npm run test:e2e` | 53 passed (25.5s) |
| 11:14 | grep `build/client` หา `OMNI_API`/`LLM_API_KEY`/`TUNNEL_TOKEN`/`markdown-it` | ไม่พบ |

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 10:49 | `shadcn-svelte init` | CLI รอ input "choose a preset" | init ของ v1.8 เป็น interactive และต้องมี preset | เขียน `components.json` เอง (aliases `#lib/...`) + เขียน `ui/utils.ts` เอง แล้วใช้ `add` แบบ non-interactive |
| 10:50 | `shadcn-svelte add badge dialog ...` | exit 1 ที่ prompt "overwrite existing files?" | `dialog` ดึง `button` ซ้ำ ซึ่งมีอยู่แล้ว | rerun ด้วย `--overwrite` |
| 10:55 | `format.test.ts` › month grid | expected `[null]` got `2026-02-01` | test ผิด: 1 ก.พ. 2026 เป็นวันอาทิตย์ | เปลี่ยนไปใช้ ต.ค. 2026 (เริ่มวันพฤหัส) |
| 11:03 | `npm run check` · `src/lib/content/academy.ts` | `startsWith` does not exist on `string \| number` | `Token.attrGet()` ของ markdown-it คืน `string \| number \| null` | เช็ค `typeof href === 'string'` ก่อน |
| 11:03 | `npm run check` · `src/routes/search/+page.svelte` | `ReadonlyURLSearchParams` ไม่ assignable ให้ `URLSearchParams` | `page.url.searchParams` ของ SvelteKit 3 เป็น readonly | สร้างจาก `Object.fromEntries(...)` + `queryString()` |
| 11:04 | `npm run lint` (eslint) | 26× `svelte/no-navigation-without-resolve` | eslint config บังคับ `resolve()` สำหรับลิงก์ภายใน (แก้ config ไม่ได้ เพราะอยู่นอก scope) | ใช้ `resolve()` ทุกลิงก์ภายใน (รองรับ `?query`), ลิงก์ภายนอกใส่ `rel="external"`, ใน shadcn `button.svelte` ใช้ `eslint-disable/enable` รอบ `<a>` เพราะ caller ส่ง href ที่ resolve แล้ว |
| 11:04 | `npm run lint` (eslint) | `svelte/prefer-svelte-reactivity` (URLSearchParams ใน .svelte) ×2 | สร้าง `URLSearchParams` แบบ mutable ใน component | ย้ายไปเป็น `queryString()` ใน `format.ts` (ไฟล์ .ts ธรรมดา) |
| 11:04 | `npm run lint` (eslint) | `svelte/no-at-html-tags` | `{@html lesson.html}` | ใส่ `eslint-disable-next-line` พร้อมเหตุผล (เป็น `{@html}` เดียวของแอป, sanitized โดย `renderLessonMarkdown`) |
| 11:04 | `npm run lint` (eslint) | `svelte/no-useless-mustaches` ใน `PageIntro` | ใช้ `{' '}` | เปลี่ยนเป็น `{stacked ? '' : ' '}` |
| 11:04 | `npm run lint` (eslint) | `no-navigation-without-resolve` ยังเหลือใน `button.svelte` | `eslint-disable-next-line` ใน HTML comment ครอบได้แค่บรรทัดเปิด tag ไม่ใช่ attribute `href` | ใช้ block `eslint-disable` / `eslint-enable` |
| 11:09 | screenshot script (Git Bash) | Playwright: invalid URL `http://localhost:5173C:/Program Files/Git/` | Git Bash แปลง argument `/` เป็น Windows path | รันด้วย `MSYS_NO_PATHCONV=1` |
| 11:09 | dev server (ครั้งแรก) | console: 504 Outdated Optimize Dep | Vite optimize deps รอบแรก | ไม่ต้องแก้ (หายเองหลัง reload; ไม่เกิดใน build) |
| 11:10 | visual check · `StoryCard` | label "ภูมิรัฐศาสตร์· อเมริกา" ช่องว่างหาย | Svelte ตัด whitespace ต้น `{#if}` block | render เป็น `{label} <span>{regions ? '· …' : ''}</span>` |
| 11:15 | bash heredoc ตอนอัปเดต log | `unexpected EOF while looking for matching '` | quoting ของ heredoc ใน Git Bash กับข้อความยาว | เขียน script ลงไฟล์ใน scratchpad แล้วรันแทน |

## Open issues / follow-ups for the orchestrator
- **CONTRACT-GAP** (`src/lib/components/format.ts`): ARCHITECTURE §7 กำหนด `isBriefDate`, `isYearMonth`, `monthOf`, `formatThaiDate`, `formatThaiTime` ไว้ใน `#lib/utils/date.ts` (backend #1) แต่ยังไม่มี และ `utils/` อยู่นอก scope ของ frontend จึงทำสำเนาไว้ใน `format.ts` (มี unit test) — ควรสลับไปใช้ของ utils เมื่อ backend เพิ่มแล้ว
- ไม่มี `src/error.html`: ถ้า root layout load ล้ม (DB ล่ม → 503) SvelteKit จะใช้ fallback error page ของมันเอง ไม่ใช่ `+error.svelte` ภาษาไทย (`src/error.html` ไม่อยู่ในรายการไฟล์ที่ให้แก้)
- banner "ข้อมูลอาจไม่เป็นปัจจุบัน" แสดงตลอดใน demo เพราะ `job_runs` ว่าง (ยังไม่มี ingest สำเร็จ) — ถูกต้องตาม §15
- `/connections` ใช้ช่วง 30 วันจากเวลาปัจจุบัน; ถ้านาฬิกาเลยจาก fixture (พ.ย. 2026) ไปเกิน 30 วัน หน้านี้และ e2e ข้อ connections จะว่าง
- ต่างจาก prototype: DemoNotice/stale banner อยู่บนสุดของทุกหน้า (prototype อยู่ใต้ intro), ปุ่ม icon 44px บนมือถือ (prototype 38px), Connections เป็นรายการไม่ใช่ graph (ตาม spec MVP), event detail เป็นหน้า route ไม่ใช่ modal, ปรับสี `--muted`/`--faint`/`--gold` ฝั่ง light ให้ผ่าน contrast AA
- ยังไม่ได้ทดสอบกับ screen reader จริง (VoiceOver/NVDA) — ทดสอบเฉพาะ semantic/ARIA ผ่าน Playwright roles

---

## รอบแก้ตาม review

| Field | Value |
|---|---|
| Started | 2026-11-13 11:27:39 (Asia/Bangkok) |
| Finished | 2026-11-13 11:36:30 (Asia/Bangkok) |
| Status | done |
| Input | `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1123_1_reviewer_ui-shell-and-pages.md` + ข้อความจาก orchestrator (findings 1–13, defer 14) |

### ขั้นตอน (ตามเวลา)
1. 11:27 — อ่าน review log ตรวจว่า worktree สะอาดและอยู่บน branch `feature/ui-shell-and-pages`
2. 11:28 — ตรวจ source ของ SvelteKit ว่า `%sveltekit.error.message%` ใน `src/error.html` ถูก `escape_html` (`runtime/server/page/respond_with_error.js`) และ `%sveltekit.status%` เป็นตัวเลข → ใส่ใน template ได้อย่างปลอดภัย
3. 11:29 — `format.ts`: เพิ่ม `parsePageNumber`, `isHttpUrl`, `MIN_YEAR = 1970` และ comment `TODO(wave2)`
4. 11:29 — สร้าง `EvidenceLinks.svelte` (dedupe + `isHttpUrl`) ใช้แทน evidence links ที่ซ้ำกันใน `EventDetail` (claims, updates) และ `ConnectionList`; เปลี่ยน key ของ corrections/learning objectives/glossary/key questions/further reading เป็น index; `SourceList` และ further reading ใช้ `isHttpUrl`
5. 11:30 — wording (#5, #6), `FreshnessBadge` แสดงตลอด (#7), progress (#11), lesson route canonical (#10), search clamp + redirect (#1, #8), `connections/window.ts` (#2), archive state (#12), `src/error.html` (#4)
6. 11:32 — unit tests: เพิ่ม `format.test.ts` (page, URL scheme, ปี < 1970), `storage.test.ts` (known ids), `progress.test.ts` (save ล้มเหลว), `EvidenceLinks.test.ts` (SSR render ด้วย `svelte/server`: URL ซ้ำ, `javascript:`), `connections/window.test.ts` (นาฬิกาปี 2031 + seed DB ใน memory) → 21 files / 137 tests ผ่าน
7. 11:33 — e2e: เพิ่ม describe `review fixes` (search page ใหญ่/เกินช่วง, `/day/01` = 404, archive เก็บ region/category, freshness แสดงตลอด) → 1 fail (ดูตาราง error) → แก้ test → 57 passed
8. 11:34 — gate: check 0 errors, lint ผ่าน (exit 0), test 137 passed, build ok, e2e 57 passed
9. 11:34 — ทดสอบ `src/error.html` จริง: `DATABASE_URL=file:./no-such-dir/missing.db PORT=4173 node build` แล้ว `curl /` → 503 พร้อม title ภาษาไทย, ข้อความ escaped, ปุ่ม "ลองใหม่" (server ปิดเองด้วย `timeout 15`)
10. 11:35 — commit 8 commits (fix ×6, feat ×1, test ×1) แล้วเขียน log นี้

### ผลต่อ finding แต่ละข้อ
| # | ระดับ | การแก้ |
|---|---|---|
| 1 | high | `parsePageNumber()` รับเฉพาะ `Number.isSafeInteger` ≥ 1 และ clamp ที่ `MAX_PAGE = 50` (ค่าแปลก → 1); หลัง query ถ้า `page > lastPage` → `redirect(307)` ไปหน้าสุดท้าย; unit test (ค่า 1e18, 400 หลัก, 2.5, ติดลบ) + e2e (ทุกค่าได้ 200 และไปจบหน้าที่มีผลลัพธ์) |
| 2 | high | `src/routes/connections/window.ts` `relationWindowStart(latestBriefDate, now)` = เที่ยงคืนเวลาไทย 30 วันก่อน brief ล่าสุด (ไม่มี brief → 30 วันก่อน now); load ใช้ `getLatestPublishedBriefDate()`; test ฉีดนาฬิกาปี 2031 กับ seed DB in-memory แล้วยังได้ relation (รวม `potential_impact`) |
| 3 | medium | `EvidenceLinks` dedupe URL ก่อน `{#each}` (key ไม่ซ้ำ), corrections และรายการจากไฟล์บทเรียนใช้ key เป็น index; SSR test ด้วย URL ซ้ำ 3 ครั้ง → แสดง 2 ลิงก์. ไม่ได้แก้ `evidenceUrls()` ใน `server/db/repositories/shared.ts` เพราะอยู่นอก lane (แก้ที่ call site ตามที่อนุญาต) |
| 4 | medium | เพิ่ม `src/error.html` ภาษาไทย inline CSS (token light/dark ผ่าน `prefers-color-scheme`), ไม่มี script/asset ภายนอก, แสดง status + message (escaped โดย SvelteKit), ปุ่ม "ลองใหม่" (`href=""`) และ "กลับหน้าแรก"; ทดสอบจริงด้วย DB path ที่เปิดไม่ได้ → 503 |
| 5 | medium | DemoNotice: "มีข้อมูลตัวอย่าง (สมมติ) ปะปนอยู่ — รายการที่เป็นข้อมูลตัวอย่างมีป้ายกำกับ"; ป้ายต่อ card ยังเป็นตัวกำกับหลัก |
| 6 | low-med | `/connections`: "ความเชื่อมโยงที่เผยแพร่ใน 30 วันล่าสุดของข้อมูล" + อธิบายว่าป้าย "ตรวจโดยบรรณาธิการแล้ว" แสดงเฉพาะรายการที่ `reviewed`; `EventDetail`: "ยังไม่มีความเชื่อมโยงที่เผยแพร่" |
| 7 | low | `AppShell` แสดง `FreshnessBadge` ทุกหน้าเสมอ: ปกติ = แบบย่อ "อัปเดตล่าสุด 13 พ.ย. 2026 · 07:00 น. (GMT+7)" สีเรียบ, stale = ข้อความเต็มตาม §15 สี gold |
| 8 | low | `/search`: มี `EmptyState` เมื่อ total > 0 แต่หน้าปัจจุบันไม่มีรายการ (กันไว้อีกชั้นแม้มี redirect ใน #1) |
| 9 | low | `isBriefDate`/`isYearMonth` ปฏิเสธปี < 1970; unit test `0050-01-01`, `1969-12-31`, `0050-01` |
| 10 | low | lesson route รับ day เฉพาะ `/^[1-9]\d?$/` และ week ต้องตรงตัว → `/day/01`, `/week/01` = 404 (URL เดียวต่อบท); e2e |
| 11 | low | `KNOWN_LESSON_IDS` (30 id จาก split 7/7/7/9) ใน `storage.ts`; `readProgress()` เก็บเฉพาะ id ที่รู้จัก → count ≤ 30; `toggle()` เขียนก่อน ถ้าเขียนไม่ได้จะไม่เปลี่ยน state และตั้ง `saveFailed` → หน้าเรียนแสดง `role="alert"` "บันทึกความคืบหน้าไม่ได้ …"; unit tests |
| 12 | low | `ArchiveCalendar` รับ `region` และส่ง category+region ในลิงก์เดือน/วัน; date form ส่ง hidden `region`; FilterChips keep `month`+`date`+`region`; "กลับไปวันล่าสุด" เก็บ category+region; ลิงก์ล้างภูมิภาคเก็บ month; e2e |
| 13 | medium | `isHttpUrl()` (ใช้ `new URL()` ตรวจ protocol http/https) ใช้ทุก href ภายนอกจากข้อมูล: sources, evidence (claims/updates/relations ผ่าน `EvidenceLinks`), further reading; ค่าอื่นแสดงเป็นข้อความ; unit test (`javascript:` หลายแบบ, `data:`, `//evil`, relative) + SSR test. ตรวจตอน ingest เป็นงานของ backend |
| 14 | low | Defer ตามสั่ง: เพิ่ม `// TODO(wave2): move the date helpers to #lib/utils/date.ts` ใน `format.ts` |

### Commands run & results
| Time | Command | Result |
|---|---|---|
| 11:32 | `npm test` | 21 files / 137 tests passed |
| 11:33 | `npm run check` · `npm run lint` | 0 errors · Prettier + ESLint ผ่าน |
| 11:33 | `npm run test:e2e` | 56 passed, 1 failed (test สมมติจำนวนผลลัพธ์ผิด) |
| 11:34 | `npm run check` · `lint` · `test` · `build` · `test:e2e` | ผ่านทั้งหมด: 0 errors, lint exit 0, 137 tests, build ok, 57 e2e passed |
| 11:34 | `DATABASE_URL=file:./no-such-dir/missing.db node build` + `curl /` | 503, หน้า `error.html` ภาษาไทย |

### Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 11:29–11:31 | python edit scripts ผ่าน bash heredoc | `SyntaxWarning: invalid escape sequence "\d"` / `"\/"` | regex ใน string Python ที่ไม่ใช่ raw string | ไม่กระทบผล (Python คง `\d` ตามตัวอักษร); ตรวจไฟล์ผลลัพธ์แล้วถูกต้อง |
| 11:30 | Edit `ConnectionList.svelte` | Edit tool ปฏิเสธ: file has not been read yet | ไฟล์ถูกแก้ด้วย script ก่อนหน้า | ลบบรรทัด label ซ้ำด้วย `sed` |
| 11:33 | e2e `review fixes › search …` | expected `page=1` got `page=2` | test สมมติว่า "AI" มีผลลัพธ์ไม่เกิน 20 รายการ แต่จริงมีมากกว่า (หน้าสุดท้าย = 2) | เปลี่ยน test ให้ตรวจว่า redirect มาหน้าที่ 1 ≤ page < 999 และมีผลลัพธ์แสดง ไม่ขึ้นกับจำนวน |

### Open issues หลังรอบนี้
- #3: `evidenceUrls()` ใน `server/db/repositories/shared.ts` ยังไม่ dedupe (นอก lane) — UI dedupe แล้ว; backend อาจ dedupe ซ้ำอีกชั้น
- #13: ควร validate scheme ของ `canonical_url` ตอน ingest (`server/news`) ด้วย
- #14 และ `hooks.server.ts`/`handleError`: Wave 2
