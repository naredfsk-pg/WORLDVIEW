# 3 · qa · acceptance-suite

| Field | Value |
|---|---|
| Started | 2026-11-13 14:07:49 (Asia/Bangkok) |
| Finished | 2026-11-13 14:56:00 (Asia/Bangkok) |
| Status | done |
| Agent type | qa-tester |

## Goal
ตรวจ product เทียบกับ PRD §11 acceptance tests 1–12 (worktree `C:\Project\WORLDVIEW-worktrees\acceptance-suite`, branch `test/acceptance-suite` จาก `main` @ `e074515`) แล้วปิด gap ด้วย test: เขียน acceptance matrix (`docs/qa/ACCEPTANCE.md`), รัน axe บน public/admin ทั้งสอง theme, วัด performance baseline (Lighthouse mobile, build size, job runtime/RSS → `docs/qa/BASELINE.md`), ทำ exploratory checks และเขียน bug report (`docs/qa/BUGS.md`). ห้ามแก้ product code: lane นี้แตะได้เฉพาะ `tests/**`, `*.test.ts`, `playwright.config.ts` (additive) และ `docs/qa/**`

## What I did (in order)
1. 14:07 — อ่าน PRD §1.4/§8/§9/§11, ARCHITECTURE §16, e2e/unit tests ที่มีอยู่ และ "Open issues" ของ reviewer logs ทุกไฟล์ (เพื่อหา known risks)
2. 14:08 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset` (background)
3. 14:09 — baseline gates บน `main`: `npm test` 667 passed, `npm run check` 0 errors, `npm run lint` ผ่าน; `E2E_PORT=4373` e2e 70 passed (41 s)
4. 14:10 — `npm install --save-dev @axe-core/playwright` (4.14.0)
5. 14:11 — เขียน spec สำรวจชั่วคราว (`zz-explore.e2e.ts`, ไม่ commit, ลบแล้ว) เก็บ axe JSON ของ 16 routes × 2 themes, screenshot full-page ที่ 360 px และลำดับ focus ของปุ่ม Tab ลง scratchpad; ดู screenshot ด้วยตา (Thai line-breaking, layout)
6. 14:14 — unit: `src/lib/utils/date.acceptance.test.ts` (#5, 24 tests) — chain `parseFeedTimestamp` → `toBriefDate` ทุก zone format รอบเที่ยงคืนไทย, ขอบเดือน/ปี/leap day, brief windows ข้ามปี
7. 14:15 — unit: `src/lib/server/db/repositories/public-read.acceptance.test.ts` (#7/#8) ตั้งสมมติฐานแบบ adversarial ว่า read layer เชื่อ write-side gates อย่างเดียว → ยืนยันได้ 2 ข้อ (BUG-QA-005, BUG-QA-006) เขียนเป็น `it.todo` + repro test ที่ pin พฤติกรรมปัจจุบัน
8. 14:16 — `tests/pipeline/run-fixture-pipeline.ts`: รัน job จริงผ่าน `runJob` (ingest fixtures → digest ด้วย mock LLM → brief เช้า/เย็น → archive snapshot → brief วันว่าง → rerun แบบ force) ทดลองบน `data/qa-scratch.db` ก่อน: ผ่านทุก step, Kessel 3 แหล่ง = 1 event
9. 14:18 — แก้ fixture ของ e2e: `admin-auth.ts` เพิ่ม `llmSentinelEnv()` (LLM URL = `127.0.0.1:9` port ปิด + sentinel key) ใส่ทั้ง build env (`admin-e2e-server.ts`) และ preview env; `playwright.config.ts` เพิ่ม project `pipeline` (depends on `admin`) และ ignore `pipeline*.e2e.ts` ใน `chromium`
10. 14:19–14:24 — เขียน e2e: `qa-helpers.ts`, `responsive.e2e.ts`, `admin-responsive.e2e.ts`, `academy-lessons.e2e.ts`, `citations-relations.e2e.ts`, `security-resilience.e2e.ts`, `a11y-helpers.ts`, `a11y.e2e.ts`, `admin-a11y.e2e.ts`, `admin-flows.e2e.ts`, `pipeline.e2e.ts`, `exploratory.e2e.ts` — ระหว่างเขียนพบว่า Playwright โหลด spec ก่อน webServer reset `data/e2e.db` จึงย้ายการอ่าน DB ไปไว้ใน `beforeAll` และวน loop ด้วย `expect.soft` แทนการสร้าง test ต่อ event ตอน load
11. 14:22 — probe dev server (port 5373) ด้วย curl: archive month/date boundaries, future date, invalid input, leap Feb, brief/event/lesson 404s → พบ BUG-QA-007 (future date)
12. 14:25 — e2e รอบแรก 3 failed (ดู Errors E2) → แก้ test → 14:27 รอบสอง 280 passed / 5 skipped (fixme)
13. 14:28 — `prettier --write`, `npm run check` พบ type error (E3) → แก้ → check/lint/test ผ่าน (699 passed + 2 todo)
14. 14:29 — scan invisible/control characters ในไฟล์ใหม่ทั้งหมด: ไม่พบ; commit 4 commits
15. 14:29 — `npm run build` (10 s) + วัด client bundle (raw/gzip) ด้วย script ใน scratchpad
16. 14:30–14:44 — Lighthouse: chrome-launcher กับ chromium ของ Playwright ล้ม (E5), attach ผ่าน `--port` ค้าง (E6, E8), full chromium ของ Playwright crash (E7) → สำเร็จด้วย chrome-launcher + Google Chrome 157 ที่ติดตั้งในเครื่อง
17. 14:44 — Lighthouse 12/12 รอบสำเร็จ; วิเคราะห์ audit ที่เสียคะแนน: `/archive` CLS 0.175 และ `font-size` (best practices) บน 3 routes → ยืนยันซ้ำด้วย Playwright (CLS ภายใต้ CDP throttling = 0.32; legible text 0.49–0.59) แล้วเขียน `tests/e2e/lighthouse-findings.e2e.ts` (fixme 2 ข้อ, BUG-QA-009/010)
18. 14:48 — วัด job runtime/RSS: fixture ingest CLI × 3, fixture pipeline (mock digest) × 3, real-feed dry-run 1 ครั้ง และ real ingest ลง scratch DB 1 ครั้ง (เพื่อได้ `fetch_duration_ms` ต่อ source)
19. 14:50 — เขียน `docs/qa/BASELINE.md`, เพิ่ม BUG-QA-009/010 ใน `BUGS.md`, อัปเดต `ACCEPTANCE.md` (#12, จำนวน test)
20. 14:51 — gates ครบชุดผ่านทั้งหมด (ดูตาราง)
21. 14:55 — scan invisible characters, commit docs + spec + log นี้

## Files created / changed
- `docs/qa/ACCEPTANCE.md` — matrix #1–#12 + วิธีรัน + a11y + exploratory + จำนวน test
- `docs/qa/BASELINE.md` — Lighthouse, build size, job runtime/RSS, เครื่องและเงื่อนไข
- `docs/qa/BUGS.md` — BUG-QA-001…008 + ข้อสังเกตที่ไม่ใช่ bug
- `src/lib/utils/date.acceptance.test.ts` — #5 edge cases (ใหม่)
- `src/lib/server/db/repositories/public-read.acceptance.test.ts` — #7/#8 read layer + BUG-QA-005/006 (ใหม่)
- `tests/pipeline/run-fixture-pipeline.ts` — fixture pipeline end to end (ใหม่)
- `tests/e2e/{qa-helpers,a11y-helpers}.ts` — helpers (ใหม่)
- `tests/e2e/{responsive,academy-lessons,citations-relations,security-resilience,a11y,exploratory,lighthouse-findings}.e2e.ts` — project `chromium` (ใหม่)
- `tests/e2e/{admin-responsive,admin-a11y,admin-flows}.e2e.ts` — project `admin` (ใหม่)
- `tests/e2e/pipeline.e2e.ts` — project `pipeline` (ใหม่)
- `tests/e2e/admin-auth.ts` — `llmSentinelEnv()` และใส่ใน `previewEnv()`
- `tests/e2e/admin-e2e-server.ts` — build ด้วย sentinel env
- `playwright.config.ts` — project `pipeline` + `testIgnore` ของ `chromium` (additive)
- `package.json`, `package-lock.json` — devDependency `@axe-core/playwright`
- `docs/agent-logs/20261113-1407_3_qa_acceptance-suite.md` — log นี้

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 14:08 | `npm ci` · `cp .env.example .env` · `npm run db:reset` | exit 0 (มี warning `allow-scripts` ของ npm แต่ better-sqlite3 ใช้ได้) |
| 14:09 | `npm test` · `npm run check` · `npm run lint` (baseline) | 52 files / 667 passed · 0 errors · exit 0 |
| 14:10 | `E2E_PORT=4373 npx playwright test` (baseline) | 70 passed (41 s) |
| 14:10 | `npm install --save-dev @axe-core/playwright` | 4.14.0 |
| 14:12 | `npx playwright test tests/e2e/zz-explore.e2e.ts --project=chromium` | 4 passed (ข้อมูลสำรวจ) |
| 14:14 | `npx vitest run src/lib/utils/date.acceptance.test.ts` | 24 passed |
| 14:15 | `npx vitest run …/public-read.acceptance.test.ts` | 8 passed, 2 todo |
| 14:16 | `DATABASE_URL=file:./data/qa-scratch.db npm run db:reset` + `npx tsx tests/pipeline/run-fixture-pipeline.ts` | ทุก step succeeded; rerun ไม่เพิ่มแถว |
| 14:22 | `npx vite dev --port 5373` + curl 16 boundary URLs | ไม่มี 500; future date ถูกรับ (BUG-QA-007) |
| 14:25 | `E2E_PORT=4373 npx playwright test` | 244 passed, 3 failed, 33 did not run → แก้ test |
| 14:27 | `E2E_PORT=4373 npx playwright test` | 280 passed, 5 skipped (fixme) (1.2 min) |
| 14:28 | `npm run check` | 1 error → แก้ → 0 errors |
| 14:28 | `npm run lint` · `npm test` | exit 0 · 54 files / 699 passed + 2 todo |
| 14:29 | `git commit` × 4 | `6e8a6d2`, `ad4c831`, `355c317`, `7d59bd1` |
| 14:29 | `npm run build` | exit 0 (10.2 s) |
| 14:30 | `npx lighthouse@12.8.2 … --chrome-flags=…` (chrome-launcher) | 6/6 failed (E5) |
| 14:33 | `node lh.mjs` (Playwright headless shell + `--port`) | ค้าง > 5 นาที (E6) |
| 14:39 | `node lh.mjs` (`channel: 'chromium'`) | launch crash (E7) |
| 14:40 | `node lh.mjs` (`channel: 'chrome'`) | ETIMEDOUT ที่ URL แรก (E8) |
| 14:43 | `npx lighthouse@12.8.2 http://localhost:5373/ --verbose` (chrome-launcher + `CHROME_PATH` = Chrome 157) | สำเร็จ |
| 14:44 | Lighthouse 4 routes × 3 รอบ (PowerShell loop) | 12/12 ok; median perf 95/95/88/96 |
| 14:46 | Playwright + `PerformanceObserver` (ไม่ throttle / CDP slow-4G + CPU 4×) | `/archive` CLS 0.000 → 0.323 (BUG-QA-010) |
| 14:47 | วัด legible text share (≥ 12 px) | 0.54 / 0.49 / 0.59 / 0.96 (BUG-QA-009) |
| 14:48 | `npm run job -- ingest --fixtures` × 3 และ `npx tsx tests/pipeline/run-fixture-pipeline.ts` × 3 (DB scratch reset ทุกรอบ) | ingest 38–41 ms; digest (mock) 40–44 ms; peak RSS 231–232 MB |
| 14:49 | `npm run job -- ingest --dry-run` (real feeds, ไม่เขียน DB) | 4 sources ok, 133 items, wall 1458 ms |
| 14:50 | `npm run job -- ingest` (real feeds → `data/qa-scratch.db`) | 548 ms; fetch 92/118/154/289 ms |
| 14:51 | gates สุดท้าย: `npm run lint` · `npm run check` · `npm test` · `npm run build` · `E2E_PORT=4373 npm run test:e2e` | exit 0 · 0 errors · 54 files / 699 passed + 2 todo · exit 0 · 280 passed + 7 skipped (fixme) (1.0 min) |

## Errors & problems
| # | Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|---|
| E1 | 14:18 | Edit tool บน `tests/e2e/admin-auth.ts`, `admin-e2e-server.ts` | "File has not been read yet" | เคยอ่านด้วย `cat` ใน Bash ไม่ใช่ Read tool | Read ไฟล์ก่อนแล้ว Edit ซ้ำ |
| E2 | 14:25 | `E2E_PORT=4373 npx playwright test` | 3 failed: (a) `academy-lessons` index href เป็น `./academy/week/1/day/1`, (b) `citations-relations` brief 2026-11-13 morning หา `a[href^="/events/"]` ไม่เจอ, (c) `exploratory` Thai 360 px รายงาน "Featured explainer" ถูก clip | (a)(b) SSR ของ SvelteKit render href แบบ relative (`./`, `../`) จนกว่า hydration จะเสร็จ test อ่าน attribute เร็วเกินไป; (c) การ์ด featured เป็น `<a>` ที่ `overflow:hidden` ตัดภาพตกแต่งโดยตั้งใจ ไม่ใช่ข้อความถูกตัด (false positive) | (a)(b) เทียบ `new URL(anchor.href).pathname` แทน attribute และย้าย helper `eventPathsIn` ไป `qa-helpers.ts` (ไม่ export จาก spec); (c) ตรวจเฉพาะ `h1–h4, p` |
| E3 | 14:28 | `npm run check` → `security-resilience.e2e.ts:100` | form type เป็น union ที่มี `undefined` ไม่เข้ากับ `{[key]: string}` | TS infer ชนิดของ array literal ที่ object มี key ต่างกัน | ระบุ type `{ path: string; form: Record<string, string> }[]` |
| E4 | 14:29 | heredoc สร้าง `scratchpad/perf/sizes.mjs` | `SyntaxError: missing ) after argument list` | encoding trap: heredoc เปลี่ยน regex `/\\/g` เป็น `/\/g` | ใช้ `split(sep).join('/')` ไม่มี backslash escape |
| E5 | 14:30 | `npx lighthouse@12.8.2` (chrome-launcher, `CHROME_PATH` = Playwright chromium) | "waiting for dynamic debugging port in chrome-err.log" ทั้ง 6 รอบ | chrome.exe ของ Playwright crash ตอน launch บนเครื่องนี้ (ดู E7) chrome-launcher จึงไม่เห็น debugging port | หยุด loop (TaskStop) แล้วเปลี่ยนเป็น launch ผ่าน Playwright + `lighthouse --port` |
| E6 | 14:33 | `lh.mjs` กับ Playwright headless shell (default) | Lighthouse ค้างที่ URL แรก > 5 นาที ไม่มี JSON | ตอนแรกสงสัย headless shell แต่ E8 แสดงว่าค้างแบบเดียวกันกับ Chrome stable → สาเหตุคือโหมด attach ผ่าน `--port` ไปยัง browser ที่ Playwright เปิด | TaskStop + kill process ค้าง; ใส่ `timeout: 150_000` ต่อรอบ; แก้จริงที่ E8 |
| E7 | 14:39 | `lh.mjs` กับ `channel: 'chromium'` (+ `chromiumSandbox: false`) | `browserType.launch` exitCode 3236495362 (0xC0E90002) | full `chrome.exe` build 1254 ของ Playwright crash ตอนเริ่มบนเครื่องนี้ (ทั้งมีและไม่มี sandbox) | ทดสอบ `msedge`/`chrome` channel: ใช้ได้ทั้งคู่ → ใช้ Google Chrome stable 157 (`channel: 'chrome'`) |
| E8 | 14:42 | `lh.mjs` กับ `channel: 'chrome'` + `lighthouse --port=9333` | `spawnSync … ETIMEDOUT` (150 s) ที่ URL แรก | Lighthouse 12.8.2 ค้างเมื่อ attach กับ browser ที่ Playwright launch ไว้ (ไม่ขึ้นกับตัว browser) | ทดสอบ 1 รอบแบบ `--verbose` ให้ chrome-launcher เปิด Google Chrome ที่ติดตั้งเอง (`CHROME_PATH`) → เสร็จใน < 1 นาที จึงรันทั้ง 12 รอบด้วยวิธีนี้ผ่าน PowerShell `Start-Process` + timeout 150 s: 12/12 สำเร็จ |

## Open issues / follow-ups for the orchestrator
- **Backup/restore (#11) เป็น gap**: ยังไม่มี script/เอกสาร/restore test — Wave 4 ต้องทำ (`VACUUM INTO` หรือ `.backup` + restore ลง DB ใหม่ + `db:migrate` + `/health`)
- **CSP lane**: theme ถูกเลือกก่อน paint ด้วย inline `<script>` ใน `src/app.html`; ถ้า CSP ใหม่ตั้ง `script-src` แบบ strict โดยไม่มี hash/nonce ของ script นี้ theme persistence จะพัง (`ui.e2e.ts` › "theme choice persists across a reload" และ `exploratory.e2e.ts` › "theme" จะจับได้)
- **การเปลี่ยน e2e env**: ทั้ง e2e suite รันโดยตั้ง `LLM_BASE_URL=http://127.0.0.1:9/v1` + sentinel key แล้ว (admin-auth.ts) — lane อื่นที่เพิ่ม e2e ที่ต้องเรียก LLM จริงต้องรู้เรื่องนี้ (ไม่มี test ใดเรียก LLM อยู่แล้ว)
- **Project `pipeline` เขียนลง `data/e2e.db`** (event fixture `is_demo=1` เข้า brief 2026-11-13) และรันหลัง `admin` เสมอ — test ใหม่ที่พึ่งข้อมูล seed ของ 2026-11-13 ต้องอยู่ใน `chromium`/`admin`
- Bugs ส่งต่อ frontend: BUG-QA-001/002/003/004/007/008/009/010; backend: BUG-QA-005/006 (P3 ทั้งหมด, ไม่มี P1/P2)
- `vite preview` ใช้ `.env` (plugin ใน `vite.config.ts` ทำงานตอน command `serve` ซึ่งรวม preview) — ค่าใน `.env` จึงมีผลกับ e2e ด้วย ยกเว้นที่ `previewEnv()` ทับไว้
