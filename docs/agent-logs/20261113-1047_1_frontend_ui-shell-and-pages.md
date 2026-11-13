# 1 · frontend · ui-shell-and-pages

| Field | Value |
|---|---|
| Started | 2026-11-13 10:47:30 (Asia/Bangkok) |
| Finished | (in progress) |
| Status | in progress |
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

## Files created / changed
- (ดูรายการเต็มตอนจบ)

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 10:48 | `npm ci` · `cp .env.example .env` · `npm run db:reset` | ok (seeded) |
| 10:49 | `npx shadcn-svelte@1.8.1 init ...` | ค้างที่ prompt เลือก preset (interactive) → ยกเลิก |
| 10:50 | `npx shadcn-svelte@1.8.1 add button --yes --no-deps-install` | ok |
| 10:50 | `npx shadcn-svelte@1.8.1 add badge dialog separator skeleton --yes --no-deps-install` | exit 1 (prompt overwrite) → rerun ด้วย `--overwrite` ok |
| 10:55 | `npx vitest run` (3 ไฟล์ใหม่) | 1 fail → แก้ test → 29 passed |

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 10:49 | `shadcn-svelte init` | CLI รอ input "choose a preset" | init ของ v1.8 เป็น interactive และต้องมี preset | เขียน `components.json` เอง (aliases `#lib/...`) + เขียน `ui/utils.ts` เอง แล้วใช้ `add` แบบ non-interactive |
| 10:50 | `shadcn-svelte add badge dialog ...` | exit 1 ที่ prompt "overwrite existing files?" | `dialog` ดึง `button` ซ้ำ ซึ่งมีอยู่แล้ว | rerun ด้วย `--overwrite` |
| 10:55 | `format.test.ts` › month grid | expected `[null]` got `2026-02-01` | test ผิด: 1 ก.พ. 2026 เป็นวันอาทิตย์ | เปลี่ยนไปใช้ ต.ค. 2026 (เริ่มวันพฤหัส) |

## Open issues / follow-ups for the orchestrator
- (เติมตอนจบ)
