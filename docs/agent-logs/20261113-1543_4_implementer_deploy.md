# 4 · implementer · deploy (containerization + ops)

| Field | Value |
|---|---|
| Started | 2026-11-13 15:43:59 (Asia/Bangkok) |
| Finished | 2026-11-13 16:22 (Asia/Bangkok) |
| Status | done (go-live เป็นการตัดสินใจของ owner; ยังไม่ได้เปิด tunnel จริง) |
| Agent type | implementer |
| Branch / worktree | `feature/deploy` @ `C:\Project\WORLDVIEW-worktrees\deploy` (จาก `main` @ `7bcb3f0`) |

## Goal

ทำให้ WORLDVIEW deploy ได้บน Windows 11 + Docker Desktop ตาม pattern ของเครื่องนี้ (Compose stack, app ไม่ publish port, `cloudflared` ใช้ token) งานที่ต้องส่ง: `academy:sync` สำหรับ production, Dockerfile แบบ multi-stage, `docker-compose.yml` (app + scheduler + cloudflared), backup/restore พร้อม restore test (ปิด acceptance #11), README ภาษาไทยสำหรับ owner และปรับ ARCHITECTURE §17 ระหว่างทาง coordinator ส่งรายการจาก full-system security review มาเพิ่ม 9 ข้อ (allowlist ของ NODE_ENV, build guard, ไม่มี dev deps, env isolation, network, digest pin, `.dockerignore`, README checklist, Cloudflare) ทั้งหมดรวมไว้ใน branch นี้

## What I did (in order)

1. 15:44 อ่าน ARCHITECTURE §4/§8/§14/§17, AGENT_PLAN Wave 4, `.env.example`, scripts ทั้งหมด, `registry.ts`, `academy.server.ts`, ACCEPTANCE #11, BASELINE และ compose ของ shopee (อ่านแบบ redact ค่า secret ด้วย `sed` ไม่ได้พิมพ์ค่าจริง) ไม่ได้เปิด `C:\Project\WORLDVIEW\.env`
2. 15:44 `cp .env.example .env` และ `npm ci` ใน worktree (cwd `C:\Project\...` ตัวใหญ่)
3. 15:46 `scripts/academy-sync.ts`: ใช้ strict loader `loadAllLessons()` (ต้องครบ 30 บท ไม่อย่างนั้น exit 1 โดยไม่เขียนอะไร) และ `AcademyCatalogRepository.replaceLessonCatalog` ที่มีอยู่แล้ว (upsert ตาม id, ลบ id ที่หายไป, trigger ดูแล FTS) ไม่แตะตารางข่าว เลือก strict เพราะ loader แบบ lenient จะลบบทเรียนที่ไฟล์เสีย พร้อม event links ของบทนั้น
4. 15:48 `src/lib/server/db/backup.ts`: `backupDatabase` (online `.backup()` ไปที่ `.partial` → `journal_mode=DELETE` → `integrity_check` → rename → prune ให้เหลือ N ไฟล์ล่าสุด), `restoreDatabase` (ตรวจ source → stage ข้าง target → safety copy ของ DB เดิมด้วย `.backup()` → ลบ `-wal`/`-shm` → rename → `integrity_check` → migrate), `tableRowCounts` และเพิ่ม `BACKUP_DIR`/`BACKUP_KEEP` ใน `config.ts` + `ENV_VAR_NAMES` + test
5. 15:50 `scripts/backup.ts` และ `scripts/restore.ts` (`--yes` บังคับ, `--to` สำหรับ restore ลง path ทดสอบ) กับ `backup.test.ts` 9 tests และ `scripts/academy-sync.test.ts` ที่รัน CLI จริงผ่าน tsx (เพิ่ม `scripts/**/*.test.ts` ใน vitest include)
6. 15:52 **ตัดสินใจเรื่อง CLI jobs ใน production: bundle ไม่ใช้ tsx** `vite.scripts.config.ts` (Vite 8 SSR build, rolldown) bundle `job, migrate, academy-sync, backup, restore` เป็น `build/scripts/*.js` code ของเรา (`#lib/*`) ถูก inline ส่วน npm packages เป็น external ตรวจแล้วว่า external ทั้งหมด (`better-sqlite3`, `drizzle-orm`, `zod`, `yaml`, `markdown-it`, `fast-xml-parser` และ `node:*`) อยู่ใน `dependencies` เหตุผล: (ก) image ไม่ต้องมี `tsx`/esbuild/TypeScript และไม่ต้องมี `src/` (ข) RSS ของ job ลดจากประมาณ 230 MB (tsx, BASELINE §3) เหลือ 92–96 MB (วัดใน container) (ค) start เร็วกว่า (ง) script dev-only (`seed`, `db-reset`, `llm-smoke`) ไม่อยู่ใน image เลย ข้อเสียคือมีขั้น build เพิ่ม (`npm run build:scripts` ประมาณ 50 ms) ทางเลือก "ย้าย tsx ไป dependencies" ยังต้องพก esbuild binary, `src/` และ compile ทุกครั้งที่รัน job จึงไม่เลือก
7. 15:53 ทดสอบ bundle บนเครื่อง: migrate → academy-sync ×2 → backup → restore (ไม่มี `--yes` exit 64, มี `--yes` ได้ 30 lessons) → `ingest --fixtures` ใน production exit 64 ผ่านหมด
8. 15:54 ตรวจ version: supercronic ล่าสุด v0.2.51 (2026-10-21) ดาวน์โหลดลง scratchpad แล้วคำนวณ sha256 `cc232108…0aa123` ตรงกับ asset digest ของ GitHub และ SHA1 ใน release notes cloudflared บนเครื่องเป็น `latest` ที่ digest `0aa26e28…` ตรงกับ tag `2026.8.2` บน Docker Hub (ล่าสุดคือ 2026.11.0 ออกเมื่อ 2026-11-12) จึง pin `2026.8.2` ตัวที่พิสูจน์แล้วบนเครื่องนี้ ส่วน node ใช้ `24.22.3-bookworm-slim`
9. 15:55 เขียน `docker/crontab`, `docker/start-app.sh`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`
10. 15:55 **Env isolation:** ไม่ใช้ `env_file` ใน service ใดเลย ทุกตัวแปรระบุแบบ explicit ด้วย interpolation จาก `.env` ไฟล์เดียว (`x-app-environment` สำหรับ app/scheduler, `TUNNEL_TOKEN: ${TUNNEL_TOKEN:?…}` สำหรับ cloudflared) แบบเดียวกับ shopee compose owner ไม่ต้องแยกไฟล์ ทดสอบด้วย `docker compose --env-file <scratch>/test.env --profile tunnel config` (test.env = `.env.example` + `TUNNEL_TOKEN=dummy-token-for-config-test`): ค่า dummy ปรากฏ **1 ครั้ง** ในผลทั้งไฟล์ อยู่ใต้ `cloudflared`; app/scheduler ไม่มี key `TUNNEL_TOKEN`
11. 15:56 `scripts/deploy-config.test.ts`: ตรวจ compose (token เฉพาะ cloudflared, ไม่มี env_file, hardening, ทุกชื่อใน `.env.example` ถูกส่งต่อ, ชื่อทั้งหมดอยู่ใน config contract) และ crontab เทียบกับ §8
12. 15:57–15:59 `docker compose build` (error #1 แก้ด้วย `--ignore-scripts`) build ผ่านใน 1m18s: `better-sqlite3 ok, sqlite 3.54.1`, `crontab is valid`
13. 15:59 `docker compose up -d app scheduler` (ไม่มี cloudflared) แล้วตรวจ: healthy, `/health`, non-root, read-only root, caps = 0, `NoNewPrivs: 1`, ไม่มี port binding, `/academy` 200, DB ไม่มี demo news, security headers ครบ, `/admin` 403 + `no-store` + `noindex`, ไม่มี `TUNNEL_TOKEN` ใน env ของ app/scheduler
14. 16:01 ใน scheduler: `ingest --fixtures` → exit 64 (ถูกต้อง), `ingest --dry-run` → 4 sources, 133 items (RSS 95.9 MB), `brief_morning` → partial (0 events เพราะ DB ว่าง, RSS 92.6 MB), `backup.js` → `/backups/worldview-20261113T090122Z.db` 3.0 MB บน host `./backups`
15. 16:02 restore ลง `/tmp/restore-test.db` (error #5: path conversion ของ Git Bash) → integrity ok, จำนวนแถวตรงกัน; `docker compose down`
16. 16:03 **รับข้อความจาก coordinator (security review)** แล้วปรับงานที่ทำไปแล้วโดยไม่เริ่มใหม่:
    - allowlist: `config.devToolsAllowed` = NODE_ENV ดิบเป็น `development`/`test` เท่านั้น (ค่า default ของ schema ซ่อนกรณี unset จึงคำนวณจากค่าดิบใน `parseConfig`) ใช้ใน `db:seed`, `db:reset` (`scripts/db-reset.ts:10`) และ `--fixtures` ใน `registry.ts:87` เพื่อไม่ให้ dev flow และ e2e harness (`db:reset` ที่ลบ NODE_ENV ออก) พัง npm scripts dev-only โหลด `scripts/dev-tools.env` (`NODE_ENV=development`) ก่อน `.env` ค่า environment จริงชนะเสมอ (ทดสอบแล้ว: unset → development, `NODE_ENV=production` → production) และ `scripts/dev-guards.test.ts` (unset/production → refuse ทั้งสามคำสั่ง, development → db:reset ทำงาน)
    - `scripts/verify-prod-build.ts` (npm `verify:prod-build`): สแกน `build/server`, `build/client`, `build/scripts` (ข้าม `*.map` เพราะ source map ฝัง source เดิมที่มี string นี้) ทดสอบกับ dev build จริง (`NODE_ENV=development vite build --mode development`) → fail และชี้ `build/server/entries/hooks.server.js` แล้ว build production ใหม่ → ok ใน Dockerfile: ลบ `*.map`, รัน `verify:prod-build` แล้ว `grep -rl dev@localhost build/server build/client build/scripts` ถ้าเจอจะ exit 1
    - digest pin: node `24.22.3-bookworm-slim@sha256:dc26ae92…` (index digest จาก `docker buildx imagetools inspect`) และ cloudflared `2026.8.2@sha256:0aa26e28…`
    - compose: network `tunnel` (app + cloudflared) และ `jobs` (scheduler, egress เท่านั้น) ใช้ `mem_limit`/`pids_limit`/`cpus` ระดับ service, log rotation json-file 10m×5 ทุก service, proxy vars + `NODE_OPTIONS` บังคับเป็นค่าว่าง, cloudflared เพิ่ม `cap_drop: ALL` + `no-new-privileges` + limits
    - `.dockerignore`: `**/.env*`, `scripts/dev-tools.env`, `docs/screenshots` (เดิมตัด `tests`, `.git`, prototype และ `docs` ทั้งโฟลเดอร์ไว้แล้ว)
    - `/data` mode 700 ใน image + `umask 077` ใน start script และใน command ของ scheduler
17. 16:07–16:10 build ใหม่ 2 รอบ (1m09s) `verify:prod-build: ok (283 files scanned…)` ทุกรอบ แล้ว up อีกครั้ง ตรวจซ้ำ: lesson ทั้ง 30 หน้า 200, proxy vars ว่าง, `/data` = `drwx------ node`, networks ถูกต้อง, log config ถูกต้อง, supercronic เป็น PID 7 ใต้ docker-init (PID 1)
18. 16:09 รัน cloudflared ครั้งเดียวด้วย dummy token ที่ไม่ valid (`docker compose --profile tunnel run --rm --no-deps cloudflared`) → `Provided Tunnel token is not valid.` ซึ่ง reject ในเครื่อง ไม่ได้เปิด tunnel ยืนยันว่า binary รันได้ภายใต้ `cap_drop: ALL` + `no-new-privileges`
19. 16:10 backup + restore รอบสุดท้ายบน image สุดท้าย ได้ JSON ของ live และ restored เท่ากันทุกตาราง (`EQUAL true`) แล้ว `docker compose --profile tunnel down` (0 containers เหลือ)
20. 16:11 ARCHITECTURE §17 เขียนใหม่ และแก้ §8 (CLI/schedule), §14 (`BACKUP_*`, `devToolsAllowed`), §16 #11 กับ `.env.example` (`BACKUP_KEEP`, คำแนะนำ `COMPOSE_PROFILES`) และ header ของ `scripts/job.ts`
21. 16:12 README ภาษาไทยเขียนใหม่ทั้งไฟล์ (ข้อ 1–10 ตาม brief + checklist ของ reviewer + Cloudflare) และ ACCEPTANCE #11 เป็น Covered
22. 16:14–16:18 gates: check, lint, test, build, build:scripts, verify, e2e (ผลด้านล่าง) สแกน control characters ใน 33 ไฟล์ที่เปลี่ยน (0) แล้ว commit 3 commits ต่อด้วย log นี้

## Files created / changed

- `scripts/academy-sync.ts` (ใหม่): npm `academy:sync`
- `scripts/backup.ts`, `scripts/restore.ts` (ใหม่): `db:backup`, `db:restore`
- `src/lib/server/db/backup.ts` + `backup.test.ts` (ใหม่): logic และ restore test
- `scripts/verify-prod-build.ts` (ใหม่): `verify:prod-build`
- `scripts/dev-tools.env` (ใหม่): `NODE_ENV=development` สำหรับ npm scripts dev-only
- `scripts/academy-sync.test.ts`, `scripts/dev-guards.test.ts`, `scripts/deploy-config.test.ts` (ใหม่)
- `vite.scripts.config.ts` (ใหม่): bundle CLI → `build/scripts/*.js`
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/start-app.sh`, `docker/crontab` (ใหม่)
- `src/lib/server/config.ts` (+test): `BACKUP_DIR`, `BACKUP_KEEP`, `devToolsAllowed`; `src/lib/types/config.ts`: ชื่อใหม่ใน `ENV_VAR_NAMES`
- `src/lib/server/jobs/registry.ts`: guard `--fixtures` เป็น allowlist
- `scripts/seed.ts`, `scripts/db-reset.ts`: allowlist guard; `scripts/job.ts`: header comment
- `package.json`: `build:scripts`, `verify:prod-build`, `academy:sync`, `db:backup`, `db:restore` และให้ dev scripts ใช้ `dev-tools.env`
- `vite.config.ts` (vitest include `scripts/**/*.test.ts`), `tsconfig.json` (include `vite.scripts.config.ts`)
- `.env.example` (`BACKUP_KEEP`, `COMPOSE_PROFILES` comment), `.gitignore` (`backups/`, `cloudflared.env`)
- `README.md` (เขียนใหม่), `docs/ARCHITECTURE.md` (§8, §14, §16, §17), `docs/qa/ACCEPTANCE.md` (#11)

## Commands run & results

| Time | Command | Result |
|---|---|---|
| 15:44 | `npm ci` | ok (มี warning allow-scripts ของ npm 11.17 เรื่อง better-sqlite3/esbuild) |
| 15:50 | `npx vitest run src/lib/server/db/backup.test.ts src/lib/server/config.test.ts` | 32 passed |
| 15:51 | `npx vitest run scripts/academy-sync.test.ts` | 3 passed |
| 15:52 | `npm run build && npm run build:scripts` | ok; `job.js` 225 KB, รวม 8 ไฟล์ |
| 15:53 | `node build/scripts/{migrate,academy-sync,backup,restore,job}.js` (scratch DB) | ทุกขั้นตามคาด; `--fixtures` exit 64 |
| 15:55 | `docker compose config` (`.env` ที่ token ว่าง) | fail ตามคาด: `required variable TUNNEL_TOKEN is missing` (error #3) |
| 15:55 | `docker compose --env-file test.env --profile tunnel config` | ok; token 1 ครั้ง ใต้ cloudflared |
| 15:57 | `docker compose build` | fail: node-gyp (error #1) |
| 15:58 | `docker compose build` (`--ignore-scripts`) | ok 1m18s; image 413 MB disk / 98.3 MB content |
| 15:59 | `docker compose up -d app scheduler` | app healthy ใน 7 s |
| 15:59 | `docker compose exec app node -e "fetch('http://localhost:3000/health')…"` | `{"status":"degraded","db":"ok","stale":true,…}` (HTTP 200 เพราะยังไม่เคย ingest) |
| 16:00 | ตรวจ `/academy`, DB, headers, `/admin`, env | ดูหัวข้อ "Container verification" |
| 16:01 | `exec scheduler node build/scripts/job.js ingest --fixtures` | exit 64 `--fixtures is refused when NODE_ENV=production` |
| 16:01 | `exec scheduler … job.js ingest --dry-run` | succeeded, 4 sources, 133 items, rss 95.9 MB |
| 16:01 | `exec scheduler … job.js brief_morning` | partial (0 events, DB ว่าง) rss 92.6 MB |
| 16:01 | `exec scheduler node build/scripts/backup.js` | `/backups/worldview-20261113T090122Z.db` 3,014,656 bytes |
| 16:02 | `exec scheduler … restore.js --from /backups/… --to file:/tmp/restore-test.db --yes` | ok; live = restored (30 lessons, 1 job_run, 1 brief, integrity ok) |
| 16:04 | `npx vitest run scripts/ src/lib/server/config.test.ts src/lib/server/jobs/registry.test.ts` | 54 passed |
| 16:05 | `npm run verify:prod-build` (prod build / dev build) | ok / fail ที่ `build\server\entries\hooks.server.js` (ถูกต้อง) |
| 16:06 | `docker buildx imagetools inspect node:24.22.3-bookworm-slim` / `cloudflare/cloudflared:2026.8.2` | `sha256:dc26ae92…` / `sha256:0aa26e28…` |
| 16:07 | `docker compose build` (hardened) | ok 1m09s; `verify:prod-build: ok (283 files…)`; 409 MB disk / 97.6 MB content |
| 16:08 | up + ตรวจซ้ำ | 30/30 lesson pages 200; proxy vars ว่าง; networks `tunnel`/`jobs` |
| 16:09 | `docker compose --profile tunnel run --rm --no-deps cloudflared` (dummy token) | `Provided Tunnel token is not valid.` (ไม่มี tunnel) |
| 16:10 | backup → restore → compare (image สุดท้าย) | `EQUAL true`, integrity ok ทั้งสองไฟล์ |
| 16:10 | `job.js archive_snapshot` | partial (0 events) ทำงานได้ |
| 16:11 | `docker compose --profile tunnel down` | containers 0 |
| 16:14 | `npm run check` | 0 errors, 0 warnings (1766 files) |
| 16:14 | `npm run lint` | ok (prettier + eslint) |
| 16:15 | `npm test` | **61 files, 892 tests passed** |
| 16:15 | `npm run build` / `build:scripts` / `verify:prod-build` | ok / ok / ok |
| 16:16 | `E2E_PORT=4573 CI=1 npx playwright test …` (dependencies ดึงทั้ง suite) | **318 passed (1.2 m)**: harness (`db:reset` ผ่าน `dev-tools.env`) ยังทำงาน |

## Image size, memory

- `worldview-app:local`: **409 MB** บน disk (Docker Desktop "disk usage") / **97.6 MB** content (compressed) layer ของเรา: `node_modules` 41.8 MB (prod deps; ตัด better-sqlite3 deps/src และ prebuild ที่ไม่ใช่ linux ออกแล้ว), supercronic 15.5 MB, `build/` 6.4 MB, content 1 MB, migrations 0.3 MB ที่เหลือเป็น base node slim
- วัดจริง: app idle 47.7–51.5 MiB, scheduler idle 5.7–11.7 MiB, job ใน container 92–96 MB RSS
- Limits: app `mem_limit: 512m` (เผื่อ admin rerun ที่รัน job ใน process ของเว็บ) / scheduler `384m` / cloudflared `256m`; `cpus: 1.0`; `pids_limit` 256/256/128

## Container verification (หลักฐาน)

- `docker compose ps`: `worldview_app … Up (healthy) 3000/tcp` (expose เท่านั้น ไม่มี host binding, `PortBindings={}`)
- `/health`: `{"status":"degraded","db":"ok","stale":true,"last_ingest_succeeded_at":null,…}` HTTP 200
- `/academy` 200 และ `/academy/week/{w}/day/{d}` ทั้ง 30 หน้า 200
- DB: `academy_lessons 30`, `lessons_fts 30`, `events 0`, `articles 0`, `sources 0`, `events where is_demo=1` = 0, journal `wal`
- Headers ของ `/`: CSP (`default-src 'self'; …`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `Strict-Transport-Security: max-age=15552000` (ORIGIN เป็น https); `/admin` → 403, `private, no-store`, `noindex, nofollow`
- `id` = `uid=1000(node)` ทั้ง app และ scheduler; `CapEff/CapPrm/CapBnd = 0`; `NoNewPrivs: 1`
- Read-only: `touch /app/probe` และ `touch /probe` ได้ `Read-only file system`; `/tmp` และ `/data` เขียนได้
- `docker inspect`: `ro=true capdrop=[ALL] secopt=[no-new-privileges:true] init=true`, log `json-file max-size:10m max-file:5`, network app=`worldview_tunnel`, scheduler=`worldview_jobs`
- env: `TUNNEL_TOKEN`/`CF_ACCESS_TEST_JWKS_URL` ไม่มีใน app และ scheduler (count 0); `NODE_ENV=production`; proxy vars และ `NODE_OPTIONS` ว่าง

## Backup/restore test

- Unit (`backup.test.ts`, 9 tests): file DB ที่ seed แล้ว (30 lessons + demo news) → backup → restore ลง path ใหม่ → `tableRowCounts` เท่ากันทุกตาราง, `integrity_check = ok`, FTS ค้น "ภูมิรัฐศาสตร์" เจอ, backup มีข้อมูลใน WAL ที่ยังไม่ checkpoint, retention, safety copy, ปฏิเสธไฟล์เสียโดยไม่แตะ target, ปฏิเสธ restore ทับไฟล์ตัวเอง
- Container: backup ไปที่ host `./backups` แล้ว restore ลง `/tmp` ได้ผล live = restored (`EQUAL true`)

## Errors & problems

| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 15:47 | Edit tool, `config.ts`/`types/config.ts`/`config.test.ts` | "File has not been read yet" | Edit ก่อน Read | Read ก่อน แล้ว Edit ใหม่ |
| 15:49 | Bash `python3` (แก้ backup.ts) | `Python was not found` | เครื่องไม่มี Python | ใช้ Edit tool |
| 15:55 | `docker compose config` | `can't set distinct values on 'pids_limit' and 'deploy.resources.limits.pids'` | merge anchor มี `pids_limit` แต่ service มี `deploy.resources.limits` ด้วย | ย้ายไป `deploy` ตอนแรก แล้วรอบ security ใช้ `mem_limit`/`pids_limit`/`cpus` ระดับ service ทั้งหมด |
| 15:55 | `docker compose config` / `up` โดยไม่มี token | `required variable TUNNEL_TOKEN is missing a value` แม้ไม่เปิด profile `tunnel` | compose interpolate ทั้งไฟล์ก่อนกรอง profile | คง guard `:?` ไว้ (owner มี token ใน `.env` อยู่แล้ว) ทดสอบด้วย `--env-file` ที่มี dummy token และเขียนไว้ใน README |
| 15:56 | `scripts/deploy-config.test.ts` | test "never seeds" fail | regex `seed` ไปเจอ comment `db:seed is dev-only` | ตรวจเฉพาะบรรทัดคำสั่ง (ข้าม comment) และ assert ลำดับใน start script |
| 15:57 | `docker compose build`, `npm ci` | `gyp ERR! … better-sqlite3 … not ok` | npm 11.19 ใน image รัน `node-gyp rebuild` ให้ better-sqlite3 ทั้งที่ package มี `gypfile:false` และ prebuilds; image ไม่มี python/make/g++ | `npm ci --include=dev --ignore-scripts` (และ `npm prune --ignore-scripts`) ยืนยันว่า binding โหลดได้ใน `RUN` (`better-sqlite3 ok, sqlite 3.54.1`) |
| 16:00 | Bash: ตรวจ read-only (`sh -c 'touch …; rm …'`) | ถูก safety check ปฏิเสธ (shell -c ที่มี rm) | probe ใช้ `rm` | เปลี่ยนเป็น `test -w` ไม่ลบไฟล์ |
| 16:02 | `docker compose exec scheduler … restore.js --from /backups/…` | `backup file not found: /app/C:/Program Files/Git/backups/…` | Git Bash (MSYS) แปลง argument ที่ขึ้นต้นด้วย `/` เป็น Windows path | `MSYS_NO_PATHCONV=1`, เพิ่มใน README troubleshooting (PowerShell ไม่เป็น) |
| 16:06 | node edit script (heredoc) ของ `deploy-config.test.ts` | replacement สุดท้ายไม่ match | escape ของ regex ใน template literal ผ่าน heredoc | ใช้ Edit tool กับ block นั้น |
| 16:06 | `deploy-config.test.ts` | regex กลายเป็น `/^d+m$/` (test fail) | **encoding trap**: heredoc → JS template literal กิน backslash | แก้ด้วย Edit tool และไล่ดูทุก `toMatch`/`split` ในไฟล์ |
| 16:08 | Bash `docker volume rm worldview_worldview-data` (รวมใน command ยาว) | ถูก safety check ปฏิเสธ | การลบ volume ต้องให้คนอนุมัติ | ไม่ลบ ใช้ volume เดิมทดสอบต่อ **volume ยังค้างอยู่ ดู open issues** |
| 16:08 | `/data` ใน volume ที่ใช้ซ้ำ | `drwxr-xr-x` แทน 700 | volume ถูกสร้างก่อนเพิ่ม `chmod 700` ใน image (Docker copy owner/mode ตอนสร้าง volume ครั้งแรกเท่านั้น) | `umask 077` + `chmod 700 /data` ใน `start-app.sh` และ `umask 077` ใน command ของ scheduler ยืนยันแล้ว `drwx------ node` |
| 16:09 | `sed` แก้ command ของ scheduler | `unknown option to 's'` | ใช้ `#` เป็น delimiter แต่ข้อความแทนที่มี `#` | ใช้ Edit tool |
| 16:08 | Write `README.md` | "File has not been read yet" | Write ทับไฟล์เดิมก่อน Read | Read แล้ว Write ใหม่ |

รวม 14 รายการ ทุกข้อแก้แล้ว ยกเว้นการลบ test volume ซึ่งต้องให้คนทำ

## Security review items (coordinator, 9 ข้อ)

1. allowlist `NODE_ENV` สำหรับ `db:seed`, `db:reset`, `--fixtures` + test: **done**; `academy:sync`: **done**
2. build guard (`verify:prod-build` + grep ใน Dockerfile, build ด้วย `NODE_ENV=production`): **done**
3. ไม่มี dev deps ใน runtime (bundle scripts เป็น JS): **done**
4. `TUNNEL_TOKEN` ถึงเฉพาะ cloudflared (explicit environment, ไม่มี `env_file`, ตรวจด้วย `docker compose config` + unit test): **done**, ใช้ `.env` ไฟล์เดียวต่อได้ README บอกวิธีแยก `cloudflared.env` ไว้ถ้าต้องการ
5. network เฉพาะ app + cloudflared, `pids_limit`, `mem_limit`, log rotation, `expose: 3000` เท่านั้น, ไม่มี docker socket: **done**
6. digest pin ของ node และ cloudflared: **done**
7. `.dockerignore` (`tests/`, `.git`, prototype, `docs/screenshots`): **done**
8. README production env checklist: **done**
9. README Cloudflare (Access ทุก hostname, WAF `/search*`, ห้าม cache override `/admin*`/`__data.json`, Transform Rule ไม่มี CSP, URL Normalization): **done**

## Open issues / follow-ups for the orchestrator

- **ต้องลบ test volume ก่อน go live:** `docker volume rm worldview_worldview-data` (safety check ไม่ให้ agent ลบ) ชื่อ volume ผูกกับชื่อ project `worldview` ไม่ได้ผูกกับโฟลเดอร์ ถ้าไม่ลบ production ใน `C:\Project\WORLDVIEW` จะใช้ volume นี้ต่อ ซึ่งมี job_runs `partial` ของ `brief_morning:2026-11-13` และ `archive_snapshot:2026-11-12` และ archive ของ 2026-11-12 คืนนี้จะถูกข้าม (partial ข้ามได้เฉพาะเมื่อ `--force`) ข้อมูลอื่นเป็นแค่บทเรียน 30 บท ไม่มี demo news
- `./backups` ใน worktree มี backup ทดสอบ 2 ไฟล์ (gitignored) ลบได้เมื่อไม่ใช้ worktree แล้ว
- supercronic pin เฉพาะ `linux-amd64` (เครื่องนี้เป็น x64) ถ้าย้ายไป arm64 ต้องเปลี่ยน URL + sha256 (`4ae22576…` สำหรับ v0.2.51 arm64)
- cloudflared 2026.11.0 ออกแล้ว (2026-11-12) ตอนนี้คง 2026.8.2 ตามเครื่องนี้ อัปเกรดทีหลังได้ด้วย tag + digest ใหม่
- `read_only` ยังไม่ได้ใส่ให้ cloudflared (ทดสอบ live ไม่ได้เพราะห้ามใช้ token จริง) ใส่ได้หลัง go live ถ้า tunnel ยังเชื่อมต่อได้
- ต้องเพิ่ม WAF rate limit `/search*` และ URL Normalization ใน Cloudflare dashboard เอง (README §9)
- หาก owner ตั้ง Docker Desktop proxy ไว้ compose บังคับ proxy vars ให้ว่างแล้ว แต่ถ้าเครื่องต้องใช้ proxy ออก internet จริง ingest จะต่อตรงไม่ผ่าน proxy ซึ่งเป็นพฤติกรรมที่ตั้งใจ (SafeFetch)
- Findings 1, 2, 5–10 ของ security review ไม่ได้อยู่ใน lane นี้ (ไปที่ `fix/security-system`)
