# 3 · reviewer · full-system-security

| Field | Value |
|---|---|
| Started | 2026-11-13 15:44:15 (Asia/Bangkok) |
| Finished | 2026-11-13 15:58:00 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only, full-system security review) |

## Goal
รีวิว security ของทั้งระบบแบบ integrated ก่อน production deploy ครั้งแรก บน worktree read-only `C:\Project\WORLDVIEW-worktrees\review-main` (`main` @ `7bcb3f0`) โดยไล่ threat model 8 ข้อ: hostile RSS item end-to-end, prompt injection → publishing, AuthN/AuthZ (CF Access, dev bypass, test JWKS, CSRF, rate limit), data exposure (excerpt, pending/hidden/demo, secrets), SSRF, injection/ReDoS/path traversal, ops/deploy readiness และ dependencies แล้วสรุป production env checklist กับ container hardening checklist ห้ามแก้โค้ด (log นี้เป็นไฟล์เดียวที่เขียนใน repo)

## What I did (in order)
1. 15:44 — อ่าน `docs/ARCHITECTURE.md` ทั้งไฟล์, PRD §9, review logs เดิม 5 ไฟล์ (`*reviewer*`), log Wave 3 (security-hardening, editorial-hardening) และ `docs/qa/BUGS.md` เพื่อไม่ report ซ้ำ
2. 15:46 — อ่านโค้ดฝั่ง edge/auth: `hooks.server.ts`, `server/auth/*`, `config.ts`, `vite.config.ts`, `.env.example`, `package.json`, SvelteKit 3.2 `runtime/server/respond.js` + `csrf.js`
3. 15:47 — อ่าน route ทั้งหมด (public loads, `/health`, admin loads/actions, `admin-forms.server.ts`, `manual-ingest.server.ts`) และ component ที่มี `href` / `{@html}` / meta
4. 15:48 — ไล่ data path: SafeFetch → adapters → feed-parser → normalize → ingest repo → grouping → digest (tagging/clustering/content/links) → LLM prompt/transport/tasks → editorial gates → `saveEventContent` → public-read/search
5. 15:48 — `npm ci`, `npm audit --omit=dev`, `npm audit`, รัน unit tests ของ auth/admin/safe-fetch
6. 15:50 — build สองแบบ: `NODE_ENV=development npm run build` (ยืนยันว่า dev bypass ถูก bake ลง bundle) แล้ว `npm run build` ปกติ (ยืนยันว่าเป็น `null`) และสแกน `build/client`
7. 15:51 — เขียน probe ใน scratchpad `probe-system\`: `race.mts`, `search.mts`, `url.mts`, `redos.mts`
8. 15:55 — สรุป findings และเขียน log นี้ (เขียนเป็นหลายส่วนเพราะ heredoc ก้อนเดียวล้ม)

## Files created / changed
- `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1544_3_reviewer_full-system-security.md` — log นี้ (ไฟล์เดียวที่เขียนใน repo)
- worktree: `node_modules/`, `build/`, `.svelte-kit/` ถูกสร้างจาก `npm ci` / `npm run build` (อนุญาตตามกติกา; build สุดท้ายเป็น build ปกติ) ไม่ได้แก้ source หรือ git
- probe scripts (นอก repo): `C:\Users\nared\AppData\Local\Temp\claude\fd4f72a0d7f6d3ad\67aca9dd-7e68-47e4-97d6-d3413c86880e\scratchpad\probe-system\` (`race.mts`, `search.mts`, `url.mts`, `redos.mts`)

## Commands run & results
| Time | Command | Result |
|---|---|---|
| 15:48 | `npm ci --no-audit --no-fund` | ok (install scripts ของ better-sqlite3/esbuild ถูก block โดย allow-scripts แต่ binding โหลดได้) |
| 15:48 | `npm audit --omit=dev` | 0 vulnerabilities |
| 15:48 | `npm audit` | 21 (7 low, 14 moderate) ทั้งหมด dev-only (esbuild, deepmerge ฯลฯ) |
| 15:48 | `npx vitest run src/lib/server/auth src/hooks.server.test.ts src/lib/server/news/safe-fetch.test.ts src/routes/admin` | 7 files, 140 tests passed |
| 15:50 | `NODE_ENV=development npm run build` + grep | `build/server/entries/hooks.server.js:391` มี `devBypassIdentity: { email: "dev@localhost" }` |
| 15:50 | `npm run build` + grep | `devBypassIdentity: null`; `build/client` ไม่มีชื่อ secret, `dev@localhost`, `lib/server/` หรือ sourcemap |
| 15:51 | `npx tsx probe-system/race.mts` | admin flag 4 drafts ระหว่าง summary call → หลัง digest ทั้ง 4 เป็น `published` และ `review_reasons` ว่าง (manual_flag หาย) |
| 15:52 | `npx tsx probe-system/search.mts 20000` | `searchEvents` แบบ sync ใช้ 107–575 ms ต่อ query ที่ 20k events |
| 15:53 | `npx tsx probe-system/url.mts` | `containsUrl` ไม่จับ zero-width, fullwidth dot, ideographic dot, `[.]`, `evil . com`, fullwidth letters, `เว็บ.ไทย`, เบอร์โทร/LINE id |
| 15:54 | `npx tsx probe-system/redos.mts` | regex ทุกตัว ≤ 15 ms บน input 20k (ไม่มี ReDoS) |

## Findings (เรียงตามความรุนแรง)

### Confirmed
1. **[High · owner ต้องตัดสินใจก่อน deploy]** Prompt injection → auto-publish ข้อความใดก็ได้ภายใต้ citation จริง
   - ที่: `src/lib/server/editorial/event-gate.ts:75-115`, `src/lib/server/editorial/text.ts:151-166`, `src/lib/server/jobs/digest-content.ts:101-107`, `src/lib/server/jobs/brief-ranking.ts:84-85`
   - ปัญหา: gate ตรวจแค่โครงสร้าง (มีภาษาไทย, ไม่มี URL, refs resolve) LLM ที่ถูกควบคุมผ่าน excerpt จึง publish ข้อความไทยใดก็ได้ (หมิ่นประมาท, ข่าวปลอม, เบอร์โทรหรือ LINE ของ scam) โดยอ้าง URL ของสำนักข่าวจริง ตั้ง `extraction.sensitive=false` เพื่อข้าม G6 และตั้ง `impact_breadth=3`, `thailand_relevance=3` เพื่อขึ้นอันดับต้นของ brief; G3 bypass ได้ด้วย zero-width/fullwidth/`[.]` (probe)
   - ทำซ้ำ: description ของ feed item มีคำสั่ง injection → summary ทำตาม → `published` ในรอบ digest เดียว; ถ้า title คล้าย event ที่ published อยู่ (rule score ≥ 0.6) item จะ join event เดิม แล้ว re-summary เขียนทับข้อความที่ published อยู่
   - แก้: ช่วงแรกของ production ให้ปิด auto-publish ได้ด้วย config (event ใหม่และ re-summary ของ published → `pending_review`) หรืออย่างน้อยกับ single-source; NFKC และลบ `\p{Cf}` ก่อน G3 และก่อนเก็บ; เพิ่ม pattern เบอร์โทร/LINE/`[.]`; อย่าให้ signals จาก LLM อย่างเดียวกำหนดอันดับ
2. **[Medium · ควรแก้ก่อน deploy]** Race: admin flag ระหว่าง digest ถูกเขียนทับ (probe ยืนยัน)
   - ที่: `src/lib/server/db/repositories/digest.ts:196-231`, `src/lib/server/jobs/digest-content.ts:110-121`
   - ปัญหา: gate ใช้ status และ review_reasons ตอน list แต่ `saveEventContent` เช็กเฉพาะ `hidden` และ field ที่ admin แก้ ไม่ดู `review_reasons` หรือ `updated_at` ปัจจุบัน → admin กด flag ระหว่าง LLM call แล้ว digest เขียน `published` พร้อม reasons ว่าง
   - แก้: ใน transaction ถ้า `before.updated_at` ไม่ตรงกับค่าตอน list หรือ `before.review_reasons` มี `manual_flag`/`possible_duplicate` → ไม่ publish (carry reasons หรือข้ามไปรอบหน้า)
3. **[Medium · blocks deploy]** ไม่มี `academy:sync`; ทางเดียวที่ใส่ Academy catalog ลง DB คือ `db:seed` ซึ่งใส่ demo news ด้วยและไม่มี production guard
   - ที่: `package.json:57-75` (ไม่มี script), `scripts/seed.ts:32-39`, `docs/ARCHITECTURE.md:671` (entrypoint อ้าง `academy:sync`)
   - ผล: ถ้า deploy lane รัน `db:seed` → demo event 12 อันที่ published และ brief 9 อันขึ้นเว็บข่าวจริง; ถ้าไม่รัน → `academy_lessons` ว่าง ค้นหาบทเรียนไม่เจอและไม่มี lesson links
   - แก้: เขียน `scripts/academy-sync.ts` (`replaceLessonCatalog`) พร้อม npm script และให้ `db:seed` ปฏิเสธเมื่อ `NODE_ENV=production`
4. **[Medium · blocks deploy (checklist)]** NODE_ENV posture: default เป็น development และไม่มีอะไรบังคับ
   - ที่: `src/lib/server/config.ts:98`, `src/lib/server/jobs/registry.ts:87`, `scripts/db-reset.ts:10`, `src/hooks.server.ts:25`
   - ปัญหา: build ที่มี `NODE_ENV=development` (หรือ `.env` ใน build context) bake dev bypass ลง bundle (ยืนยันแล้ว); guard ของ `--fixtures` และ `db:reset` เป็น denylist (เทียบกับ production) ซึ่ง default ทำให้ไม่ทำงานเมื่อ container ไม่ตั้ง NODE_ENV
   - แก้: ให้ fixtures/reset/seed ต้องมี NODE_ENV เป็น development หรือ test แบบ explicit (allowlist); ให้ build stage fail ถ้าเจอ `dev@localhost` ใน `build/server`; ตั้ง `ENV NODE_ENV=production` ทั้ง build และ runtime
5. **[Medium]** Feed หนึ่งมีผลกับข้อมูลของ source อื่นได้ (ไม่มี link-host check ต่อ source)
   - ที่: `src/lib/server/news/normalize.ts:30-46`, `src/lib/server/db/repositories/ingest.ts:68-73`
   - ปัญหา: `link` รับทุก http(s) host → feed A ที่ถูก compromise ใส่ URL ของบทความ BBC ก่อน → บทความจริงของ BBC เป็น `duplicate_url` และถูก attribute เป็น A; หรือ cite domain ของ attacker เป็นแหล่งข่าว (G1 ตรวจแค่ scheme); item ของ A join event ของ B แล้วดัน `source_count` เป็น 2 → ผ่าน G6
   - แก้: เพิ่ม `link_hosts` ต่อ source ใน registry และ drop item ที่ host ไม่ตรง
6. **[Medium]** Digest starvation / LLM cap exhaustion
   - ที่: `src/lib/server/db/repositories/digest.ts:176-187` (newest-first, limit 30), `src/lib/server/news/feed-parser.ts:10` (200 items/feed), `src/lib/server/jobs/digest.ts:35`
   - ปัญหา: feed เดียวที่ส่ง item ใหม่จำนวนมากครอง 30 slot ทุกรอบ; injection ที่ทำให้ output invalid ใช้ repair + fallback (ประมาณ 4 requests ต่อ task) → 30 events × 2 tasks × 4 ≈ 240 requests ในรอบเดียวจาก cap 300 ต่อวัน; `llm_failed` ถูก retry ทุกรอบ
   - แก้: cap item ใหม่ต่อ source ต่อ ingest, round-robin ต่อ source ใน `listEventsNeedingContent`, budget ต่อ run (เช่น cap หาร 4)
7. **[Medium]** Public search เป็น O(N) แบบ synchronous ไม่มี rate limit ใน app (probe: 107–575 ms ต่อ query ที่ 20k events และบล็อก event loop ทั้ง process)
   - ที่: `src/lib/server/db/repositories/search.ts:133-154`, `src/routes/search/+page.server.ts:20`
   - แก้: dedupe terms, cap ไม่เกิน 5 terms, จำกัด count (เช่น LIMIT 1000), Cloudflare rate-limit rule ที่ `/search*`
8. **[Medium]** Relation ที่ไม่ใช่ causal publish อัตโนมัติพร้อม explanation ที่ LLM เขียน (อ้างเหตุและผลได้) และการ reject ของ admin ไม่กันคู่เดิมที่มา type อื่น
   - ที่: `src/lib/server/editorial/relation-gate.ts:191-195`, `src/lib/server/db/repositories/digest.ts:490-503`
   - แก้: MVP ให้ทุก relation เป็น `pending_review` หรือเช็ก causal wording; ให้ reject ของ admin ปิดคู่ event นั้นทุก type
9. **[Low]** `sanitizeError` ฝั่ง jobs ไม่ redact SQL/params ของ Drizzle (ต่างจาก `handleError`) → `job_runs.error` และ stdout อาจมี excerpt หรือข้อความ LLM
   - ที่: `src/lib/server/jobs/runner.ts:111-114` → แก้: ย้าย sanitizer ของ hooks เป็น shared module และใช้ทั้งสองที่
10. **[Low]** LLM transport: base URL รับ http, `fetch` follow redirect (307/308 ส่ง body ที่มี prompt และ excerpt ไปยังปลายทางใหม่), `response.text()` ไม่จำกัดขนาด
   - ที่: `src/lib/server/llm/transport.ts:144-154`, `src/lib/server/config.ts:101-103` → แก้: `redirect: "error"`, บังคับ https ยกเว้น host ภายใน, cap body

### Suspicions (ยังไม่ยืนยัน ขึ้นกับ config นอก repo)
- S1: dev bypass เปิดได้ถ้าครบทุกข้อ: build แบบ dev, runtime NODE_ENV=development, ไม่มี `CF_ACCESS_AUD`, `ORIGIN` ไม่ได้ตั้ง และ cloudflared rewrite Host header เป็น localhost (hostname มาจาก Host header) → `/admin` เปิดโดยไม่มี token
- S2: `HTTPS_PROXY` / `NODE_USE_ENV_PROXY` ใน container ทำให้ connect-time guard ของ SafeFetch ไม่มีผล (มีบันทึกใน `safe-fetch.ts:9-11` แล้ว)
- S3: Cloudflare Cache Rule แบบ Cache Everything ที่ override edge TTL อาจ cache HTML หรือ `__data.json` ของ `/admin` แม้ app ส่ง `no-store`
- S4: `npm run job` และ `db:migrate` ใช้ `tsx` ซึ่งเป็น devDependency → runtime image ต้องมี devDependencies (dev-only vulns 21 รายการติดไปด้วย) ถ้าไม่ย้าย `tsx` ไป `dependencies`

## Production env checklist
- `NODE_ENV=production` ทั้งตอน build และ runtime (web และ `docker compose exec` ของ cron)
- `ORIGIN=https://worldview.nared-fu.com` (ตรงทุกตัวอักษร ไม่มี `/` ท้าย); ไม่ตั้ง `PROTOCOL_HEADER` / `HOST_HEADER`
- `ADDRESS_HEADER=CF-Connecting-IP`; ไม่ตั้ง `XFF_DEPTH`
- `PUBLIC_SITE_URL=https://worldview.nared-fu.com` (default เป็น localhost)
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` (AUD ของ application `/admin*`), `ADMIN_ALLOWED_EMAILS` ครบทั้งสามตัว (ขาดตัวใด admin จะ 403)
- `CF_ACCESS_TEST_JWKS_URL` ต้องไม่ตั้ง
- `DATABASE_URL=file:/app/data/worldview.db` (absolute บน volume; ห้าม `:memory:`)
- `LLM_BASE_URL` / `OMNI_API_URL` เป็น https หรือ host ภายในเท่านั้น; key อยู่เฉพาะ container app
- `LLM_DAILY_MAX_REQUESTS` / `LLM_DAILY_MAX_TOKENS` ตั้งไว้ (อย่ายกเลิก cap)
- `BODY_SIZE_LIMIT` ไม่เกิน 1M; `HOST=0.0.0.0`, `PORT=3000` ใช้ภายใน network เท่านั้น
- ไม่มี `TUNNEL_TOKEN`, `HTTP_PROXY` / `HTTPS_PROXY` / `NODE_USE_ENV_PROXY`, หรือ `NODE_OPTIONS` ที่มี `--inspect` ใน app
- แยก env file: `app.env` (ไม่มี TUNNEL_TOKEN) และ `cloudflared.env` (มีแค่ TUNNEL_TOKEN) เพราะ `.env.example` รวมไว้ในไฟล์เดียว

## Container hardening checklist
- Multi-stage: build stage รัน `npm ci` แล้ว `NODE_ENV=production npx vite build` และ fail ถ้า grep เจอ `dev@localhost` ใน `build/server/**/*.js`
- `.dockerignore`: `.env*`, `data/`, `.git`, `node_modules`, `build`, `.svelte-kit`, `tests/`, `worldview-ui-prototype/`, `docs/screenshots` (ไม่มี fixture feeds ใน prod image)
- Runtime base image pin digest (`node:24-slim`), `USER node` (non-root), `WORKDIR /app`
- copy เฉพาะ `build/`, `package*.json`, prod `node_modules` (รวม `tsx` หรือ compile scripts เป็น JS), `src/lib` และ `scripts/` (ถ้าใช้ tsx), `migrations/`, `content/`
- `read_only: true` + `tmpfs: /tmp` (cache ของ tsx); volume `./data:/app/data` เป็นของ uid 1000 สิทธิ์ 700/600
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit`, `mem_limit` (ประมาณ 512m)
- ไม่มี `ports:`; ใช้ `expose: 3000`; network เฉพาะ app + cloudflared (ไม่แชร์กับ project อื่น); ไม่ mount docker socket
- cloudflared: pin version, รับ `TUNNEL_TOKEN` ตัวเดียว, ingress `http://app:3000`, ไม่ rewrite Host header
- Entrypoint: `db:migrate && academy:sync && node build`; ห้าม `db:seed`, `db:reset`, `--fixtures` ใน prod
- Healthcheck `GET http://127.0.0.1:3000/health`; log driver มี rotation (`max-size`, `max-file`)
- Backup: `sqlite3 .backup` รายวันจาก volume พร้อม restore test
- Cloudflare: Access application `/admin*` ครอบทุก hostname ที่ชี้มาที่ app; WAF rate-limit `/search*`; ไม่ใช้ Cache Everything แบบ override บน `/admin*`; (optional) Transform Rule ใส่ static security headers ให้ static files (ห้ามใส่ CSP)

## Verified correct
- ทุก admin load/action เรียก `requireAdmin`; ไม่มี `+server.ts` อื่นนอกจาก `/health` และไม่มี action ใน public route; `isAdminRequest` ครอบ path แบบ decode และ case-insensitive รวมถึง `route.id`; `__data.json` ของ admin ผ่าน guard และได้ `no-store`
- JWT: RS256 only, ตรวจ iss/aud/exp, ตรวจ ASCII email ก่อน lower-case, fail closed (config ขาด 403, JWKS ล่ม 503); team domain regex กัน SSRF; test JWKS ต้อง NODE_ENV=test และ ORIGIN/URL เป็น loopback
- CSRF: SvelteKit origin check ทำงานก่อน `handle` สำหรับ form content-type; content-type อื่นทำให้ `formData()` ล้ม จึงไม่มีการเขียน
- Headers: deny page มี CSP ของตัวเอง; admin `no-store` ทับ `public, max-age=60` ของ root layout; HSTS เฉพาะ https; client bundle ไม่มี secret และไม่มี client sourcemap
- Public data: `isReadableEvent` ใช้ในทุก read (brief items, detail, search, lesson events, relations ทั้งสองปลายพร้อม evidence); DTO ไม่มี excerpt, review_reasons หรือ signals; FTS ไม่ index excerpt; `/health` ไม่มี secret
- `href` จาก data ผ่าน `isHttpUrl` ทุกจุด; ingest ปฏิเสธ URL ที่ไม่ใช่ http(s); `{@html}` มีจุดเดียว (lesson markdown, `html:false`); meta/title ผ่าน attribute escaping
- Prompt: system prompt ไม่มี data, `<data>` escape `</data`, repair message ไม่ echo ref ของ model, input ไม่มี URL; `llm_calls` ไม่เก็บ prompt, key หรือ error text; log ไม่มี prompt หรือ excerpt
- SafeFetch: https และ exact host allowlist จาก registry, redirect ไม่เกิน 3 พร้อมตรวจซ้ำ, block private IP พร้อม connect-time lookup, gzip cap 5 MB, ตรวจ content-type; `feed_url` มาจาก registry (sync ทุกรอบ) ไม่มี admin path ที่แก้ได้; fixture adapter จำกัด dir และ `.xml`
- SQL parametrized ทั้งหมด, FTS quote เป็น phrase, LIKE escape, `json_each` ใช้ค่า bound; ไม่มี ReDoS (probe); lesson ไม่รับ path จาก user
- `npm audit --omit=dev` = 0; fast-xml-parser ปฏิเสธ DOCTYPE

## Errors & problems
| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 15:48 | `npm ci` | `npm warn allow-scripts` (install scripts ของ better-sqlite3, esbuild ไม่รัน) | npm allow-scripts policy ของเครื่อง | ตรวจว่า `require("better-sqlite3")` ใช้ได้ (ok) จึงไม่ต้อง approve |
| 15:52 | `npx tsx probe-system/search.mts` | `SqliteError: table event_articles has no column named confidence` | เดาชื่อ column ผิดใน probe | อ่าน column จาก row จริงแล้ว insert ใหม่ |
| 15:57 | เขียน log ด้วย heredoc ก้อนเดียว | `unexpected EOF while looking for matching quote` | shell wrapper กับ heredoc ยาวที่มี quote | แบ่งเขียนเป็น 3 ส่วนใน scratchpad แล้วรวมด้วย `cat` |

## Open issues / follow-ups for the orchestrator
- Owner ต้องตัดสินใจ finding 1 (auto-publish ใน production ช่วงแรก) ก่อน deploy
- Deploy lane (Wave 4) ต้องมี `academy:sync` และ guard ของ `db:seed` ก่อนเขียน entrypoint (finding 3)
- แก้ race ใน `saveEventContent` (finding 2) และเปลี่ยน NODE_ENV guard เป็น allowlist (finding 4) ซึ่งเป็นงานเล็ก
- ไม่ได้ตรวจ config ของ Cloudflare (Access path, cache rules, cloudflared ingress) เพราะอยู่นอก repo
