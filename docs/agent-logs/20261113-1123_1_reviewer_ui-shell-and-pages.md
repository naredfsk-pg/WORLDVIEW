# 1 · reviewer · ui-shell-and-pages

| Field | Value |
|---|---|
| Started | 2026-11-13 ~11:15 (Asia/Bangkok, ประมาณการ — ดึงเวลาจริงครั้งแรกตอน 11:23:54) |
| Finished | 2026-11-13 11:26 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only) |

## Goal
Review branch `feature/ui-shell-and-pages` (worktree `C:/Project/WORLDVIEW-worktrees/ui-shell-and-pages`) แบบ read-only โดยเน้น security (XSS ผ่าน lesson Markdown, `{@html}`, meta, theme script, param validation, open redirect, data leak, client bundle), correctness (Bangkok date, 404 vs 500, edition, archive, `/connections` window, search pagination, localStorage), UX contract (ARCHITECTURE §15, UI spec §4–§8, a11y) และ simplicity

## What I did (in order)
1. ~11:15 — `git log` / `git diff main..HEAD --stat` (ไม่รวม package-lock และ screenshots)
2. อ่าน diff ของ `app.html`, `academy.ts` / `academy.server.ts`, `storage.ts`, `progress.svelte.ts`, `format.ts`, `SeoHead`, `LessonArticle`
3. อ่าน `+page.server.ts` / `+layout.server.ts` ทุกไฟล์ และ repository (`search.ts`, `public-read.ts`, `shared.ts`) เพื่อตาม param ไปถึง SQL
4. ทดสอบ SQLite binding ด้วย better-sqlite3 in-memory: `OFFSET` เป็น Infinity / 2e20 → `datatype mismatch`
5. Probe `renderLessonMarkdown` ด้วย XSS payload (title attr injection, `javascript:` autolink/reference, `//evil`, `https:evil`, raw img ใน heading, NUL) ผ่าน `npx tsx` script ใน scratchpad
6. ตรวจ Svelte runtime (`each.js`) ว่า duplicate key throw ใน production ด้วย
7. ตรวจ fixture `demo.ts`: relation `created_at` อยู่ช่วง 2026-11-12/13
8. อ่าน Svelte pages/components ทั้งหมด, ARCHITECTURE §1/§3/§7/§13/§15, UI_DESIGN_SPEC §4–§8
9. grep `build/client` หา secret name / server deps (ไม่พบ)
10. รัน unit tests ของ branch

## Files created / changed
- `C:/Project/WORLDVIEW/docs/agent-logs/20261113-1123_1_reviewer_ui-shell-and-pages.md` — log นี้ (ไฟล์เดียวที่เขียนใน repo)
- scratchpad `md.ts`, `t.txt`, `t2.txt` (temp probe นอก repo)

## Commands run & results
| Time | Command | Result |
|---|---|---|
| ~11:16 | `git diff main..HEAD --stat` | 75 files, +4213/-5 |
| ~11:19 | node + better-sqlite3 `LIMIT ? OFFSET ?` กับ Infinity / 2e20 | `datatype mismatch` (ยืนยัน 500) |
| ~11:20 | grep `build/client` หา OPENAI, API_KEY, DATABASE_URL, better-sqlite3, drizzle, markdown-it, CF_ACCESS, ADMIN_ | ไม่พบ |
| 11:22 | `npx vitest run format.test.ts render.test.ts storage.test.ts` | 3 files, 19 tests passed |
| ~11:23 | `npx tsx md.ts` (XSS probes) | ไม่มี payload ใดหลุด; `HTTPS://` ตัวใหญ่ได้ link แต่ไม่มี target/rel (ไม่อันตราย) |

## Findings (ranked)

### Confirmed bugs
1. **[high]** `src/routes/search/+page.server.ts:16` — `page` ไม่มี upper bound: `?q=abc&page=1000000000000000000` (หรือ 400 หลัก → Infinity) ทำให้ offset เกิน int64 → SQLite `datatype mismatch` → 500. Fix: clamp `page` (เช่น ≤ 500) และใช้ `Number.isSafeInteger`
2. **[high]** `src/routes/connections/+page.server.ts:12` — window 30 วันคิดจาก `Date.now()` แต่ fixture relation `created_at` = 2026-11-12/13 → หลัง ~2026-12-12 `/connections` ว่างเปล่าใน demo และ e2e `tests/e2e/ui.e2e.ts:251` จะ fail. Fix: anchor window กับ latest published relation/brief date หรือทำ fixture แบบ relative-to-now
3. **[medium]** `EventDetail.svelte:33`, `ConnectionList.svelte:392` key `(url)`; `EventDetail.svelte:88` key `(correction.changed_at)` — Svelte 5 throw `each_key_duplicate` ใน production ด้วย; `evidenceUrls()` (`shared.ts`) ไม่ dedupe → evidence_refs 2 อันที่ชี้ article เดียวกันทำให้ hydration พัง. Fix: key ด้วย index หรือ dedupe ใน `evidenceUrls`
4. **[medium]** `src/routes/+layout.server.ts:25` + ไม่มี `src/error.html` — DB ล่ม → root layout error → SvelteKit ใช้ fallback page ภาษาอังกฤษ ไม่มี retry link / shell (§15 ต้องมี retry). Fix: เพิ่ม `src/error.html` ภาษาไทยพร้อม retry
5. **[medium]** `DemoNotice.svelte:8` — ข้อความ "ข่าวทั้งหมดเป็นข้อมูลสมมติ" แสดงเมื่อมี demo event อย่างน้อยหนึ่ง (`hasPublishedDemoContent`) → ถ้ามีข่าวจริงปน จะติดป้ายข่าวจริงว่าปลอม (PRD §9.2). Fix: เปลี่ยน wording หรือให้ `demo_mode` หมายถึง all-demo
6. **[low-medium]** `connections/+page.svelte:307`, `EventDetail.svelte:187` — "ความเชื่อมโยงที่ตรวจสอบแล้ว" ใช้กับทุก relation ที่ published แม้ reviewed=false (badge "ตรวจโดยบรรณาธิการแล้ว" แสดงเฉพาะ reviewed) → overclaim. Fix: ใช้ "ที่เผยแพร่แล้ว"
7. **[low]** `AppShell.svelte:235` — แสดง "อัปเดตล่าสุด" เฉพาะตอน stale; UI spec §8 Today ต้องมี last-updated เสมอ; branch non-stale ใน `FreshnessBadge` เป็น dead code
8. **[low]** `search/+page.svelte:97` — page เกินช่วง (totals > 0, items ว่าง) ไม่มี EmptyState มีแค่ count + ปุ่มหน้าก่อน
9. **[low]** `format.ts:340/349/414` — `isYearMonth` รับปี 0000–0099 แต่ `Date.UTC` map เป็น 1900+ → `?month=0050-01` ลิงก์เดือนก่อนไป 1949-12, weekday ของ grid ผิด. Fix: บังคับปี ≥ 1970
10. **[low]** `academy/week/[week]/day/[day]/+page.server.ts:14` — `day=01` และ `day=1` ได้ 200 ทั้งคู่ (canonical = pathname → duplicate URL); `week=01` กลับ 404
11. **[low]** `progress.svelte.ts:13` — `count` ไม่กรอง id ที่ไม่อยู่ใน 30 บท → "เรียนแล้ว 31 จาก 30", aria-valuenow > max; `writeProgress` fail เงียบ (UI บอกว่าบันทึกแล้วแต่ reload หาย)
12. **[low]** archive filter state หาย: date form ไม่ส่ง region, calendar month nav ไม่ส่ง region, FilterChips ไม่ keep month เมื่อ selected_date เป็น null

### Suspicions / defense-in-depth
13. **[medium]** `EventDetail.svelte:35`, `ConnectionList.svelte:394` — evidence href ไม่ตรวจ scheme ขณะที่ `SourceList.svelte:309` ตรวจ `^https?://`; `articles.canonical_url` ไม่มี scheme check ใน repo/schema และ ingest ยังไม่ถูกเขียน → feed ที่ส่ง `javascript:` link จะกลายเป็น clickable XSS. Fix: shared `isHttpUrl()` ทุกจุด + validate ตอน ingest
14. **[low]** `format.ts` ซ้ำกับ contract ของ `utils/date.ts`; route servers import param parsers จาก `#lib/components/format.js` (layering); `FreshnessBadge` ใช้ `utils/date` ส่วนที่อื่นใช้ `format.ts`

### Checked and correct
- `renderLessonMarkdown`: `html:false`, image disabled, `validateLink` = https หรือ #anchor → probe ทุกแบบไม่หลุด; heading id เป็น section-N คงที่; `{@html}` มีจุดเดียว
- SEO title/meta ผ่าน Svelte attribute escaping, ไม่มี JSON-LD; inline theme script ใช้แค่ค่า literal light/dark
- `/brief` redirect ใช้ค่าจาก DB; search dialog action `/search` คงที่ → ไม่มี open redirect
- params: date (`isBriefDate` ตรวจวันจริง), edition (unknown → 404), week/day, category/region/scope (allow-list), from/to; FTS quote + LIKE escape; parametrized SQL
- pending/hidden: ทุก read ผ่าน `isPublicEvent` + relation status published ทั้งสองปลาย
- `build/client` ไม่มี secret name, better-sqlite3, drizzle, markdown-it; fonts ใช้ unicode-range subset
- Bangkok date: `toBriefDate`, BriefDate อ่านเป็น noon +07:00, `monthGrid` ใช้ UTC math; breakpoints 901px ตรง spec
- 404: bad date / edition / missing brief / unpublished event / day-week mismatch
- storage: ทุก read/write อยู่ใน try/catch, malformed JSON → []
- a11y: skip link, landmarks, aria-current nav, aria-pressed chips/theme/mark-complete, ปุ่ม / ไม่ทำงานใน input/textarea/select และเมื่อกด modifier, bits-ui Dialog จัดการ focus trap/Esc
- Event-detail section order ตรง spec: facts → why → background → uncertain → sources → timeline → related → lessons

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| ~11:21 | `grep -rnE` บน content/academy | Unmatched paren | regex escaping ใน bash | ใช้ Grep tool แทน |
| ~11:21 | `cat svelte.config.js` | ไม่พบไฟล์ | config อยู่ใน `vite.config.ts` | อ่าน `vite.config.ts` แทน |
| 11:24–11:25 | เขียน log ด้วย heredoc ก้อนเดียว | `unexpected EOF while looking for matching quote` (2 ครั้ง) | shell wrapper กับ heredoc ยาว/มี quote | แบ่งเขียนเป็น 3 ส่วน |

## Open issues / follow-ups for the orchestrator
- ไม่ได้รัน e2e / `svelte-check` (ตามข้อห้ามเรื่อง port); `build/` (11:17) ใหม่กว่า commit ล่าสุด (11:16) จึงถือว่าตรงกับ HEAD
- `hooks.server.ts` (`handleError` ตาม §3) ยังไม่มีใน branch — น่าจะอยู่นอก scope frontend แต่ควรติดตาม
- Finding #13 ต้องประสานกับ backend ingest (`server/news` normalization)
