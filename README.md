# WORLDVIEW

WORLDVIEW คือเว็บข่าวโลกภาษาไทยพร้อมคอร์สเรียน ระบบดึงข่าวจาก RSS ของสำนักข่าวที่อนุมัติไว้ จัดกลุ่มเป็นเหตุการณ์ (event) ให้ LLM สรุปเป็นภาษาไทยโดยทุกข้อความต้องอ้างแหล่งข่าวจริง แล้วออก brief เช้าและเย็นทุกวัน มี Academy 30 บทเรียน (4 สัปดาห์) ที่เชื่อมกับข่าว และมีหน้า `/admin` สำหรับตรวจและแก้เนื้อหา ซึ่ง Cloudflare Access ป้องกันไว้

- Stack: SvelteKit 3 + Svelte 5 (`adapter-node`), Node 24, SQLite (better-sqlite3 + Drizzle), Tailwind 4
- เอกสารหลัก: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (§8 jobs, §14 env, §17 deploy) และ [`docs/qa/ACCEPTANCE.md`](docs/qa/ACCEPTANCE.md)

## สารบัญ

1. [Local dev](#1-local-dev)
2. [Environment variables](#2-environment-variables)
3. [Production env checklist](#3-production-env-checklist)
4. [Deploy ด้วย Docker Compose](#4-deploy-ด้วย-docker-compose)
5. [Logs](#5-logs)
6. [Job schedule และการรัน job เอง](#6-job-schedule-และการรัน-job-เอง)
7. [Backup และ restore](#7-backup-และ-restore)
8. [Upgrade และ rollback](#8-upgrade-และ-rollback)
9. [Cloudflare](#9-cloudflare)
10. [Troubleshooting](#10-troubleshooting)

## 1. Local dev

ต้องมี Node 24 ขึ้นไป (`.npmrc` เปิด `engine-strict`)

```powershell
cd C:\Project\WORLDVIEW          # ใช้ C: ตัวใหญ่ (ดู Troubleshooting)
npm ci
copy .env.example .env           # ค่า LLM ว่างได้ หน้าเว็บยังทำงาน
npm run db:reset                 # ลบ DB dev แล้ว migrate และ seed (บทเรียน + ข่าวตัวอย่าง)
npm run dev                      # http://localhost:5173
```

| Command                                                         | ใช้เมื่อ                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run check` / `npm run lint` / `npm test` / `npm run build` | gate ก่อนเปิด PR                                                                                                              |
| `npm run test:e2e`                                              | Playwright (ตั้ง `E2E_PORT` ได้ เช่น `E2E_PORT=4573`)                                                                           |
| `npm run db:migrate`                                            | apply `migrations/*.sql` ด้วย runtime migrator ของ Drizzle (ไม่ต้องมี drizzle-kit)                                              |
| `npm run db:generate`                                           | หลังแก้ `src/lib/server/db/schema.ts` (dev เท่านั้น); FTS5 อยู่ใน `migrations/0001_fts.sql`                                        |
| `npm run db:seed`                                               | **dev เท่านั้น**: บทเรียน 30 บท + ข่าวตัวอย่าง (`is_demo = true`) idempotent                                                       |
| `npm run db:reset`                                              | **dev เท่านั้น**: ลบไฟล์ DB (+ `-wal`/`-shm`) แล้ว migrate และ seed ให้หยุด `npm run dev` ก่อน (Windows ล็อกไฟล์)                     |
| `npm run academy:sync`                                          | โหลดบทเรียน 30 บทจาก `content/academy/**` ลง `academy_lessons` + FTS ไม่แตะตารางข่าว (production ใช้ตัวนี้แทน `db:seed`)           |
| `npm run job -- <type>`                                         | รัน job (`ingest`, `digest`, `brief_morning`, `brief_evening`, `archive_snapshot`) ดู ARCHITECTURE §8                         |
| `npm run db:backup` / `npm run db:restore`                      | backup และ restore (ดู [ข้อ 7](#7-backup-และ-restore))                                                                        |
| `npm run build:scripts`                                         | bundle `scripts/{job,migrate,academy-sync,backup,restore}.ts` เป็น `build/scripts/*.js` (image ใช้ไฟล์นี้) รันหลัง `npm run build` |
| `npm run verify:prod-build`                                     | fail ถ้า `build/` มี `dev@localhost` (dev bypass ของ admin) ซึ่งแปลว่าไม่ใช่ production build                                      |

**Dev-only tools:** `db:seed`, `db:reset` และ `job -- ingest --fixtures` รันได้เฉพาะเมื่อ `NODE_ENV` เป็น `development` หรือ `test` แบบตั้งไว้ชัดเจน (allowlist) ถ้าไม่ได้ตั้ง `NODE_ENV` หรือเป็น `production` จะปฏิเสธ npm scripts ตั้ง `development` ให้ผ่าน `scripts/dev-tools.env` แต่ค่า `NODE_ENV` จริงใน environment จะชนะเสมอ ภายใน container ทั้งสามคำสั่งนี้จึงรันไม่ได้

## 2. Environment variables

- Template: [`.env.example`](.env.example) คัดลอกเป็น `.env` (ไฟล์นี้ gitignored ห้าม commit)
- ตารางชื่อ ชนิด ค่า default และผู้อ่านของทุกตัวแปรอยู่ที่ ARCHITECTURE §14 ค่าว่าง (`KEY=`) นับว่าไม่ได้ตั้ง
- Production ใช้ `.env` ไฟล์เดียวในโฟลเดอร์ project แต่ `docker-compose.yml` **ไม่ส่งทั้งไฟล์เข้า container** (ไม่มี `env_file`) Compose อ่าน `.env` เพื่อเติมค่า `${...}` เท่านั้น แต่ละ service จึงได้เฉพาะตัวแปรที่ระบุไว้:
  - `app` และ `scheduler`: รายการ `x-app-environment` (LLM, Cloudflare Access, ค่า app) โดย `NODE_ENV=production`, `ORIGIN`, `ADDRESS_HEADER`, `DATABASE_URL` ถูก fix ไว้ใน compose ส่วน `HTTP(S)_PROXY`, `NODE_USE_ENV_PROXY` และ `NODE_OPTIONS` ถูกบังคับให้ว่าง
  - `cloudflared`: `TUNNEL_TOKEN` ตัวเดียว
  - ถ้าเพิ่มตัวแปรใหม่ให้ app ต้องเพิ่มใน `x-app-environment` ด้วย (`scripts/deploy-config.test.ts` ตรวจว่าทุกตัวใน `.env.example` ถูกส่งต่อ)
  - ตรวจได้ด้วย `docker compose config` ซึ่งต้องเห็น `TUNNEL_TOKEN` เฉพาะใต้ `cloudflared` (คำสั่งนี้พิมพ์ค่า secret ออกจอ อย่า copy ผลไปที่อื่น)

## 3. Production env checklist

ตรวจก่อน go live ทุกครั้ง (มาจาก security review รอบ full-system):

- [ ] `NODE_ENV=production` ทั้งตอน **build** และ **runtime** รวมถึงคำสั่ง `docker compose exec` (Dockerfile ตั้งไว้ทั้งสอง stage และ compose fix ไว้ `exec` รับ env ของ container จึงเป็น production ด้วย) Vite ใช้ `NODE_ENV` ตอน build ตัด dev bypass ของ admin ออก และ build จะ fail ถ้ายังเจอ `dev@localhost`
- [ ] `ORIGIN=https://worldview.nared-fu.com` ตรงทุกตัวอักษร ไม่มี `/` ท้าย (compose fix ไว้) และ**ไม่ตั้ง** `PROTOCOL_HEADER` / `HOST_HEADER`
- [ ] `ADDRESS_HEADER=CF-Connecting-IP` (compose fix ไว้) และ**ไม่ตั้ง** `XFF_DEPTH`
- [ ] `PUBLIC_SITE_URL=https://worldview.nared-fu.com` (ถ้าไม่ตั้ง default คือ localhost)
- [ ] `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` (AUD ของ Access application `/admin*`) และ `ADMIN_ALLOWED_EMAILS` **ครบทั้งสามตัว** ถ้าขาดตัวใด `/admin` จะตอบ 403 กับทุกคน (fail closed)
- [ ] `CF_ACCESS_TEST_JWKS_URL` **ต้องไม่ตั้ง** (test-only; compose ไม่ส่งตัวนี้เข้า container อยู่แล้ว)
- [ ] `DATABASE_URL` เป็น absolute path บน volume: `file:/data/worldview.db` (compose fix ไว้ ห้ามใช้ `:memory:`)
- [ ] ไม่มี proxy env (`HTTP_PROXY`, `HTTPS_PROXY`, `NODE_USE_ENV_PROXY`) ใน app/scheduler เพราะจะปิดการตรวจ IP ตอน connect ของ SafeFetch และไม่มี `NODE_OPTIONS` ที่มี `--inspect` (compose บังคับเป็นค่าว่าง)
- [ ] `BODY_SIZE_LIMIT` ไม่เกิน `1M`
- [ ] `OMNI_API_URL` / `LLM_BASE_URL` เป็น https (หรือ host ภายใน) และตั้ง `LLM_DAILY_MAX_REQUESTS` / `LLM_DAILY_MAX_TOKENS` ไว้ (อย่ายกเลิก cap) ส่วน `LLM_MAX_REQUESTS_PER_RUN` (default 80 ต่อ job) ปล่อยว่างได้
- [ ] `EDITORIAL_AUTO_PUBLISH=multi_source` (ตามที่เจ้าของเลือก: เผยแพร่อัตโนมัติเฉพาะข่าวที่มี ≥2 แหล่ง) ถ้าไม่ตั้ง จะได้ `off` ทุกข่าวจะเข้า `/admin/review` ทั้ง `off` และ `multi_source` ไม่เขียนทับข้อความของข่าวที่เผยแพร่แล้ว หลักฐานใหม่จะขึ้นเป็น `new_evidence_pending` ให้ admin ยืนยัน (อย่าใช้ `all` ใน production)
- [ ] `TUNNEL_TOKEN` ตั้งใน `.env` (ถึงแค่ `cloudflared`) และ public hostname ของ tunnel ชี้ไป `http://app:3000`

ถ้าอยากแยก secret ของ tunnel ออกจากไฟล์ของ app ในภายหลัง ให้ย้ายบรรทัด `TUNNEL_TOKEN=...` ไปไว้ในไฟล์ `cloudflared.env` (อยู่ใน `.gitignore` แล้ว) แล้วเปลี่ยน service `cloudflared` ให้ใช้ `env_file: cloudflared.env` แทน `environment:` ตอนนี้ยังไม่จำเป็น เพราะ app ไม่ได้รับไฟล์ `.env` ทั้งไฟล์อยู่แล้ว

## 4. Deploy ด้วย Docker Compose

ทำตาม pattern เดียวกับ project อื่นในเครื่องนี้ ทุกอย่างเป็น Compose stack (`name: worldview`):

| Service       | ทำอะไร                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app`         | เว็บ (`node build`) port 3000 ภายใน network `tunnel` เท่านั้น **ไม่ publish port** ตอน start: migrate → academy:sync → serve         |
| `scheduler`   | image เดียวกัน รัน [supercronic](https://github.com/aptible/supercronic) ตาม `docker/crontab` (jobs + backup รายวัน) network `jobs` |
| `cloudflared` | `cloudflare/cloudflared:2026.8.2` (pin digest) อยู่หลัง profile `tunnel` เปิดเมื่อสั่งเท่านั้น                                             |

Hardening ของ app/scheduler: รันเป็น user `node` (non-root), `read_only` root filesystem (+ tmpfs `/tmp`), `cap_drop: ALL`, `no-new-privileges`, `mem_limit` (app 512m, scheduler 384m), `pids_limit`, `cpus: 1.0`, log rotation และไม่ mount docker socket ข้อมูลอยู่ใน named volume `worldview-data` (`/data`) ส่วน backup อยู่ที่โฟลเดอร์ `./backups` บนเครื่อง

### 4.1 ครั้งแรก

```powershell
cd C:\Project\WORLDVIEW
copy .env.example .env      # แล้วกรอกค่าจริงตาม checklist ข้อ 3 (ทำครั้งเดียว)
docker compose build        # image worldview-app:local (~410 MB บน disk)
```

### 4.2 ตรวจในเครื่องก่อน (ยังไม่ public)

ถ้าไม่ใส่ `--profile tunnel` จะไม่เปิด `cloudflared` เว็บจึงยังไม่ออก internet (ต้องมี `TUNNEL_TOKEN` ใน `.env` เพราะ compose ตรวจค่านี้ทุกครั้ง แต่จะไม่ถูกใช้)

```powershell
docker compose up -d                 # app + scheduler
docker compose ps                    # app ต้องเป็น (healthy)
docker compose exec app node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log)"
docker compose exec app node -e "fetch('http://localhost:3000/academy').then(r=>console.log(r.status))"
```

`/health` ตอบ `"status":"degraded"` (HTTP 200) ได้ตามปกติจนกว่า ingest รอบแรกจะสำเร็จ

### 4.3 Go live

```powershell
docker compose --profile tunnel up -d
docker compose --profile tunnel ps   # cloudflared ต้อง Up
docker compose logs cloudflared      # ต้องเห็น "Registered tunnel connection"
```

แล้วเปิด `https://worldview.nared-fu.com` และ `https://worldview.nared-fu.com/admin` (ต้องเจอหน้า login ของ Cloudflare Access)

หลัง go live แนะนำให้เปิดบรรทัด `COMPOSE_PROFILES=tunnel` ใน `.env` แล้วคำสั่ง `docker compose up/down/ps` ทุกคำสั่งจะรวม `cloudflared` เองโดยไม่ต้องพิมพ์ `--profile tunnel`

ปิดเว็บจาก internet ชั่วคราวโดยไม่หยุดระบบ: `docker compose stop cloudflared`

## 5. Logs

```powershell
docker compose logs -f app              # เว็บ: migrate, academy:sync, error ของ request
docker compose logs -f scheduler        # job เป็น JSON บรรทัดละ event ("job finished" มี counters + rss_bytes)
docker compose logs --since 24h scheduler
docker compose logs -f cloudflared
```

Log rotation: json-file ไม่เกิน 10 MB × 5 ไฟล์ต่อ container สถานะ job ย้อนหลังดูที่ `/admin/jobs` ได้ด้วย (ตาราง `job_runs`)

## 6. Job schedule และการรัน job เอง

`docker/crontab` ใช้เวลา UTC (ICT = UTC+7 ไม่มี DST) ตาม ARCHITECTURE §8:

| ICT   | Job                                     | UTC cron      |
| ----- | --------------------------------------- | ------------- |
| 06:00 | `ingest; digest`                        | `0 23 * * *`  |
| 07:00 | `brief_morning`                         | `0 0 * * *`   |
| 12:00 | `ingest; digest`                        | `0 5 * * *`   |
| 18:00 | `ingest; digest`                        | `0 11 * * *`  |
| 19:00 | `brief_evening`                         | `0 12 * * *`  |
| 23:00 | `ingest; digest`                        | `0 16 * * *`  |
| 01:00 | `archive_snapshot` (วันก่อนหน้าตามเวลาไทย) | `0 18 * * *`  |
| 02:30 | `db:backup` → `./backups`               | `30 19 * * *` |

supercronic ไม่เริ่ม job บรรทัดเดิมซ้ำถ้ารอบก่อนยังไม่จบ และ idempotency key ของแต่ละ job กันการทำซ้ำอยู่แล้ว (รันซ้ำในช่วงเวลาเดียวกันจะได้ `skipped`) job หยุดตัวเองเมื่อเกิน 20 นาที

**รันเองผ่าน CLI** (ใน container ใช้ `node build/scripts/*.js` ไม่มี `npm`/`tsx`):

```powershell
docker compose exec scheduler node build/scripts/job.js ingest
docker compose exec scheduler node build/scripts/job.js digest
docker compose exec scheduler node build/scripts/job.js ingest --dry-run      # ดึง feed อย่างเดียว ไม่เขียน DB
docker compose exec scheduler node build/scripts/job.js brief_morning --date 2026-11-13 --force
docker compose exec scheduler node build/scripts/job.js archive_snapshot --date 2026-11-12 --force
```

Exit code: `0` สำเร็จ/ข้าม · `2` partial · `1` failed · `64` ใช้คำสั่งผิด (`--fixtures` ถูกปฏิเสธใน production เป็นเรื่องปกติ)

**รันผ่านหน้าเว็บ:** `/admin/jobs` (ผ่าน Cloudflare Access) กด rerun ได้ job จะรันใน container `app` ซึ่งได้ค่า LLM เหมือน scheduler

## 7. Backup และ restore

- อัตโนมัติ: ทุกวันเวลา 02:30 ICT `scheduler` ใช้ online backup API ของ SQLite (ปลอดภัยแม้ app กำลังเขียนแบบ WAL) เขียนไฟล์ `./backups/worldview-YYYYMMDDTHHMMSSZ.db` (เวลา UTC) ตรวจ `PRAGMA integrity_check` แล้วเก็บไว้ล่าสุด `BACKUP_KEEP` ไฟล์ (default 14)
- สั่งเอง: `docker compose exec scheduler node build/scripts/backup.js` (หรือ `--keep 30`)
- **คัดลอกออกนอกเครื่อง:** `./backups` เป็นโฟลเดอร์ปกติบน Windows (gitignored) copy ไฟล์ `.db` ไป OneDrive, NAS หรือ external drive ได้เลย แต่ละไฟล์ใช้ได้ด้วยตัวเอง (ไม่มี `-wal`/`-shm`) เช่น `robocopy C:\Project\WORLDVIEW\backups D:\worldview-backups *.db`

**ทดสอบ backup โดยไม่แตะ DB จริง** (restore ลง path ชั่วคราวใน container):

```powershell
docker compose exec scheduler node build/scripts/restore.js --from /backups/worldview-20261113T193000Z.db --to file:/tmp/restore-test.db --yes
```

**Restore จริง** (ต้องหยุด app และ scheduler ก่อน):

```powershell
docker compose stop cloudflared app scheduler
docker compose run --rm --no-deps scheduler node build/scripts/restore.js --from /backups/worldview-20261113T193000Z.db --yes
docker compose --profile tunnel up -d
```

ขั้นตอนของ `restore`: ตรวจ `integrity_check` ของไฟล์ backup (ถ้าไม่ผ่านจะหยุดโดยไม่แตะ DB) → เก็บ DB เดิมไว้เป็น `/data/worldview.db.pre-restore-<เวลา>` → สลับไฟล์ (ลบ `-wal`/`-shm` เก่า) → `integrity_check` อีกรอบ → รัน migrations → พิมพ์จำนวนแถวของแต่ละตาราง ถ้าไม่ใส่ `--yes` จะไม่ทำอะไรเลย Test อัตโนมัติอยู่ที่ `src/lib/server/db/backup.test.ts` (seed → backup → restore ลง path ใหม่ → จำนวนแถวเท่ากัน และ `integrity_check` ผ่าน)

## 8. Upgrade และ rollback

**Upgrade:**

```powershell
cd C:\Project\WORLDVIEW
git pull
docker compose exec scheduler node build/scripts/backup.js     # backup ก่อนทุกครั้ง
docker compose build
docker compose --profile tunnel up -d                          # recreate เฉพาะ service ที่ image เปลี่ยน
```

Migrations และ `academy:sync` รันเองตอน `app` start ส่วน scheduler รอให้ app healthy ก่อน

**Rollback:**

1. กลับไป commit ก่อนหน้า: `git checkout <commit-ที่ใช้ได้>` (หรือ `git revert`)
2. `docker compose build` แล้ว `docker compose --profile tunnel up -d`
3. ถ้า release ใหม่มี migration ที่ code เก่าไม่รู้จัก ให้ restore backup ที่ทำไว้ก่อน upgrade (ข้อ 7) เพราะ migrations เดินหน้าอย่างเดียว ไม่มี down migration

## 9. Cloudflare

- **Tunnel** `worldview` (token-based): public hostname `worldview.nared-fu.com` → `http://app:3000` ห้าม rewrite Host header
- **Access:** application แบบ self-hosted ครอบ `/admin` และ `/admin/*` และต้องครอบ**ทุก hostname ที่ route มาที่ app** (ถ้าเพิ่ม hostname ใหม่ในภายหลัง ต้องเพิ่มใน Access ด้วย) ใส่ AUD tag ใน `CF_ACCESS_AUD` app ตรวจ JWT ซ้ำอีกชั้น
- **WAF rate limiting:** เพิ่ม rule ที่ `/search*` (การค้นหาใช้ CPU และ app ไม่ได้ rate-limit หน้า public เอง) เช่น 30 requests ต่อนาทีต่อ IP
- **Cache:** **ห้าม**ตั้ง Cache Rule override หรือ "Cache Everything" ที่ครอบ `/admin*` หรือ `__data.json` (app ส่ง `no-store` แต่ edge TTL override ทำให้ cache หน้า admin ได้)
- **URL Normalization** (Rules → Settings): แนะนำให้เปิด "Normalize incoming URLs" เพื่อให้ path แบบ `%61dmin` หรือ `//admin` ถูก normalize ก่อนถึง Access
- **Transform Rule (optional):** Response Header Transform Rule เพิ่ม static security headers ให้ไฟล์ static ที่ไม่ผ่าน `handle` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security: max-age=15552000`) **ห้ามใส่ `Content-Security-Policy`** เพราะจะทับ CSP แบบ hash ต่อหน้าของ app (ARCHITECTURE §4)

## 10. Troubleshooting

| อาการ                                                       | สาเหตุ / วิธีแก้                                                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest หา test ไม่เจอหรือ import ซ้ำสองรอบ                     | รัน `npm` จาก path ที่ขึ้นต้นด้วย `C:\` ตัวใหญ่ (ไม่ใช่ `c:\`) ใน VS Code ให้เปิดโฟลเดอร์ด้วย `C:\Project\WORLDVIEW`                                           |
| Cloudflare error **1033**                                   | tunnel ไม่ได้เชื่อมต่อ: `cloudflared` ไม่ได้รัน (ลืม `--profile tunnel`), token ผิด หรือ container ล่ม ดู `docker compose logs cloudflared`                  |
| Cloudflare error **530**                                    | ไปถึง origin ผ่าน tunnel ไม่ได้ มักมาคู่กับ 1033 หรือ public hostname ใน tunnel ชี้ผิด (ต้องเป็น `http://app:3000`)                                           |
| 502 Bad Gateway                                             | `app` ไม่ healthy หรือกำลัง restart: `docker compose ps`, `docker compose logs app`                                                                |
| `required variable TUNNEL_TOKEN is missing a value`         | `.env` ยังไม่มี `TUNNEL_TOKEN` (compose ตรวจทุกคำสั่ง แม้ไม่เปิด profile `tunnel`)                                                                       |
| `/admin` ตอบ 403 ทั้งที่ login แล้ว                              | ขาด `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` / `ADMIN_ALLOWED_EMAILS`, email ไม่อยู่ในรายการ หรือ AUD ไม่ตรงกับ Access application                   |
| `app` ไม่ขึ้น, log `academy:sync: … expected 30 valid lessons` | ไฟล์บทเรียนใน `content/academy` เสีย: แก้ไฟล์แล้ว build ใหม่ (sync จะไม่เขียนอะไรถ้าไม่ครบ 30 บท)                                                          |
| `/health` เป็น `degraded`                                    | ยังไม่มี ingest ที่สำเร็จใน 9 ชั่วโมง: ดู `docker compose logs scheduler` หรือ `/admin/jobs`                                                              |
| Git Bash แปลง `/backups/...` เป็น `C:/Program Files/Git/...` | ตั้ง `MSYS_NO_PATHCONV=1` ก่อนคำสั่ง `docker compose exec` (PowerShell ไม่มีปัญหานี้)                                                                     |
| `docker compose build` fail ที่ `verify:prod-build`           | build ไม่ใช่ production (`NODE_ENV` ไม่ใช่ production หรือมี `.env*` หลุดเข้า build context) ตรวจ `.dockerignore` และอย่าแก้ `ENV NODE_ENV` ใน Dockerfile |
