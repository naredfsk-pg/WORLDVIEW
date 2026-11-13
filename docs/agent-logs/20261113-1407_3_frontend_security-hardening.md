# 3 · frontend · security-hardening

| Field      | Value                                |
| ---------- | ------------------------------------ |
| Started    | 2026-11-13 14:07:49 (Asia/Bangkok)   |
| Finished   | 2026-11-13 14:31:00 (Asia/Bangkok)   |
| Status     | done                                 |
| Agent type | frontend (security hardening lane)   |

## Goal

ทำ security hardening ของ Wave 3 บน branch `feature/security-hardening` (worktree `C:/Project/WORLDVIEW-worktrees/security-hardening`) ตาม PRD §9.1 โดยไม่ push/merge มีงานดังนี้: (1) CSP ที่มี `script-src` แบบ hash/nonce โดยไม่ใช้ `'unsafe-inline'` กับ script และต้องไม่ทำให้ theme script ใน `app.html` หรือ `src/error.html` พัง (2) audit security headers ว่าครอบคลุม page, `__data.json`, 404/error และ static asset พร้อมเพิ่ม HSTS (เฉพาะ HTTPS ที่ผ่าน Cloudflare), COOP และ CORP (3) dependency hygiene (`npm audit` ทั้ง prod และ dev) (4) ตรวจว่า client bundle ไม่มี secret หรือ server code รั่ว และเพิ่มเป็น test (5) อัปเดต ARCHITECTURE §4

## What I did (in order)

1. 14:07 — อ่าน `hooks.server.ts`, `security-headers.ts` (+test), `vite.config.ts`, `app.html`, `error.html`, ARCHITECTURE §4/§17, PRD §9.1, log ของ admin backend และ reviewer (admin, ui-shell) ส่วน security note ที่ยังเปิดอยู่คือ "CSP ยังไม่มี `script-src` ต้องตั้ง `kit.csp` hash mode และ hash theme script ใน `app.html`"
2. 14:08 — setup: `npm ci`, `cp .env.example .env`, `npm run db:reset` (รันจาก PowerShell ที่ `C:/` ตัวใหญ่)
3. 14:09 — `npm audit --omit=dev` ได้ 0 vulnerabilities, `npm audit` (full) ได้ 21 (7 low, 14 moderate) ซึ่งเป็น dev-only ทั้งหมด จากนั้นใช้ `npm audit fix --dry-run`, `npm ls` และ `npm view` ตรวจว่าไม่มี fix ภายใน semver range (รายละเอียดอยู่ในหัวข้อ Open issues)
4. 14:10 — อ่าน source ของ SvelteKit 3.2 (`runtime/server/page/csp.js`, `render.js`, `respond.js`) พบว่า: hash mode hash เฉพาะ init script ของ kit และ inline `<style>` ที่ kit render เอง ไม่ได้ hash script ใน `app.html`; ถ้า directive มี `'unsafe-inline'` kit จะไม่เติม hash ให้ directive นั้น; ใน dev kit จะเติม `'unsafe-inline'` ให้ style เอง; response ที่ส่งก่อน `handle` (CSRF 403, reserved query 400, `/_app/*` 404, reroute 500, fatal error ของ `handle`) จะไม่มี header ของเรา พบด้วยว่า **hook เดิมเขียนทับ `content-security-policy` ทุก response** ถ้าเปิด `kit.csp` ไว้ policy ที่มี hash ของ kit จะหายไป
5. 14:12 — ตัดสินใจใช้ **hash mode** แทน nonce เพราะไม่มี load ไหน stream promise (ตรวจ `+page.server.ts` แล้ว ทุกตัว await หมด) และ hash ทำให้ HTML ยัง cache ได้และ ETag คงที่ ส่วน theme script ใน `app.html` ใช้ค่าคงที่ `APP_THEME_SCRIPT_HASH` ที่ unit test คำนวณใหม่จากไฟล์จริงทุกครั้ง (fold CRLF เป็น LF แบบเดียวกับ HTML parser) ถ้ามีคนแก้ script โดยไม่อัปเดต hash `npm test` จะ fail และแสดง hash ใหม่ให้ แทนที่จะไปพังเงียบๆ ใน browser ใช้วิธีเดียวกันกับ `ERROR_PAGE_STYLE_HASH` ของ `src/error.html`
6. 14:12–14:16 — เขียน `src/lib/server/auth/csp.ts` (`CSP_DIRECTIVES` เป็นแหล่งเดียวของ policy, `FALLBACK_CSP`) พร้อม `csp.test.ts` แก้ `security-headers.ts` ให้เก็บ policy ของ kit ไว้ (ถ้ายังไม่มีจึงใส่ `FALLBACK_CSP`) และเพิ่ม COOP/CORP `same-origin` กับ `isHttpsRequest` ที่เปิด HSTS และ `upgrade-insecure-requests` เฉพาะตอน HTTPS เพิ่ม `csp: { mode: 'hash', directives: CSP_DIRECTIVES }` ใน `vite.config.ts` และแก้ `hooks.server.ts` ให้ส่ง `https: isHttpsRequest(event)`
7. 14:16 — พบว่า deny page ของ admin (403/429/503) มี inline `<style>` ซึ่ง fallback CSP จะ block จึงให้ deny page ส่ง CSP ของตัวเอง (`default-src 'none'; style-src 'sha256-…'`) โดย hash จาก constant `DENY_PAGE_STYLE` ตอน module load และเพิ่ม unit test
8. 14:17 — build แล้วเปิด `vite preview` ชั่วคราวที่ port 4273 เพื่อใช้ curl ตรวจ header ของ `/`, `/academy/__data.json`, `/nope`, `/health`, `/robots.txt`, `/admin`, `/?x-sveltekit-foo=1`, static asset, `/_app` 404 และกรณี `X-Forwarded-Proto: https` ผลเป็นไปตามที่คาด (ดูหัวข้อ header coverage) ตรวจเสร็จแล้วปิด server ทันทีเพื่อไม่ให้ Playwright `reuseExistingServer` ไปหยิบ server ที่ env ผิด
9. 14:18 — ใช้ grep ตรวจ client bundle ว่าไม่มีชื่อ env หรือ `dev@localhost`, `CF_ACCESS`, `OMNI`, `LLM_`, `TUNNEL`, `lib/server`, `sourceMappingURL` และไม่มีไฟล์ `.map` ทั้งใน `build/client` และ `.svelte-kit/output/client` (ไม่รั่ว) คำว่า `node:` ที่ grep เจอเป็น false positive จาก `server_data_node:` ภายใน kit ส่วน server source map 158 ไฟล์อยู่ใน `build/server` ซึ่ง sirv ไม่ serve จึงเก็บไว้ (ใช้อ่าน stack trace ฝั่ง server ได้)
10. 14:18–14:20 — เขียน e2e ได้แก่ `tests/e2e/csp-watch.ts` (collector ที่รวม `securitypolicyviolation` event กับ console error ของ Chrome และใช้ MutationObserver บันทึกว่า `data-theme` ถูกตั้งก่อนที่ `<body>` จะมีหรือไม่ ซึ่งพิสูจน์ได้ว่าไม่มี flash), `security.e2e.ts` (public routes × light/dark, saved theme, interactive widgets, `error.html` ภายใต้ `FALLBACK_CSP` ผ่าน `page.route`, headers, HSTS, bundle leak scan) และ `admin-security.e2e.ts` (admin pages ทุกหน้าที่ sign in ด้วย test JWKS และ deny page)
11. 14:20 — รัน e2e รอบแรก: test ของ public route fail 22 ข้อจาก `style-src-attr` violation ซึ่งแสดงว่า collector ใช้งานได้จริง ต้นเหตุคือ `style="…"` ใน SSR markup และ Svelte runtime ตัดสินใจเพิ่ม `style-src-attr 'unsafe-inline'` (ใช้กับ attribute เท่านั้น ส่วน `<style>` element ยังต้องมี hash) และแก้ leak test ให้อ่านชื่อ env จาก config schema ด้วย
12. 14:22 — รัน e2e รอบสอง (เฉพาะ spec ใหม่ พร้อม dependency project) ผ่าน 87/87
13. 14:23 — ตรวจ `vite dev --port 5273` ด้วย Playwright script ใน scratchpad: เปิด `/`, `/academy`, `/archive`, `/admin`, `/admin/jobs` ทั้ง light และ dark ทุกหน้าได้ 200, `data-theme` ถูกต้อง และไม่มี CSP error (dev bypass ของ admin ยังใช้ได้) จากนั้นปิด dev server
14. 14:24 — เขียน ARCHITECTURE §4 ข้อ 11 ใหม่ และเพิ่ม subsection "Security headers & CSP" (policy สุดท้าย, เหตุผลที่เลือก hash แทน nonce, เหตุผลของ `style-src-attr`, วิธีตรวจ HSTS, coverage และ gap, tests)
15. 14:26–14:28 — รัน gate ครบทุกตัว (ผ่านทั้งหมด) สแกนหา control/invisible character ในไฟล์ที่เปลี่ยน (สะอาด) แล้ว commit 3 ครั้ง
16. 14:29 — เขียน log นี้และ commit

## Files created / changed

- `src/lib/server/auth/csp.ts` — ใหม่: `CSP_DIRECTIVES`, `APP_THEME_SCRIPT_HASH`, `ERROR_PAGE_STYLE_HASH`, `FALLBACK_CSP`
- `src/lib/server/auth/csp.test.ts` — ใหม่: คำนวณ hash ใหม่จาก `src/app.html`/`src/error.html` และตรวจ serialization กับการใช้ `unsafe-*` ที่อนุญาต
- `src/lib/server/auth/security-headers.ts` — เก็บ CSP ของ kit ไว้ / ใส่ fallback, เพิ่ม COOP, CORP, HSTS และ `upgrade-insecure-requests` เฉพาะตอน HTTPS, เพิ่ม `isHttpsRequest`
- `src/lib/server/auth/security-headers.test.ts` — test ใหม่สำหรับพฤติกรรมข้างต้น
- `src/lib/server/auth/admin-guard.ts` (+test) — deny page มี CSP ของตัวเอง
- `src/hooks.server.ts` — ส่ง `https: isHttpsRequest(event)` และอัปเดต header comment
- `vite.config.ts` — `csp: { mode: 'hash', directives: CSP_DIRECTIVES }`
- `tests/e2e/csp-watch.ts`, `tests/e2e/security.e2e.ts`, `tests/e2e/admin-security.e2e.ts` — ใหม่
- `docs/ARCHITECTURE.md` — §4 ข้อ 11 และ subsection "Security headers & CSP"
- `docs/agent-logs/20261113-1407_3_frontend_security-hardening.md` — log นี้

## CSP สุดท้าย (production page)

```
default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none';
script-src 'self' 'sha256-vUOaFql8+jbGG5+p4XpFrzzJLwYlz4YgWHVGMcQMs6I=' 'sha256-<hydration script ของหน้านี้>';
style-src 'self' 'sha256-6r+QyF5I6era/ZjzBWLrwLEeH4gDpE6+DltrUZ3Y4h4='; style-src-attr 'unsafe-inline';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

(เมื่อเป็น HTTPS จะต่อท้ายด้วย `; upgrade-insecure-requests`) ส่วน response อื่นๆ ได้ `FALLBACK_CSP` ซึ่งใช้ directive ชุดเดียวกันแต่ไม่มี hash ของหน้า และ admin deny page ใช้ `default-src 'none'; style-src 'sha256-0qppNrzYknFiHyXky7OTnV2M3E1qvmLSLPBMGkm2CyY='; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

เหตุผลที่ใช้ `style-src-attr 'unsafe-inline'`: มี `style="…"` อยู่ใน SSR markup (div `display: contents` ใน `app.html`, `style:width` ใน `AppShell.svelte`, props ของ bits-ui) และ Svelte runtime ก็ตั้ง style ด้วยค่าที่เปลี่ยนตลอด hash จึงครอบคลุมไม่ได้ (hash ใช้กับ attribute ได้ก็ต่อเมื่อมี `'unsafe-hashes'` และค่าต้องคงที่) attribute ใส่ selector หรือ script ไม่ได้ และ `url()` ยังถูกจำกัดด้วย `img-src`/`font-src 'self'` ส่วน `<style>` element ยังต้องมี hash ทุกตัว browser ที่ไม่รองรับ `style-src-attr` (Safari < 15.4, Firefox < 108) จะ fallback ไปใช้ `style-src` และ style attribute จะหายไป ผลกระทบมีแค่หน้าตา

## HSTS approach

Cloudflare terminate TLS แล้ว cloudflared ส่ง request เข้า app ด้วย HTTP ธรรมดา ดังนั้น `isHttpsRequest` จะ return true เมื่อ `X-Forwarded-Proto` ตัวแรกเป็น `https` หรือ `event.url.protocol === 'https:'` (กรณี `ORIGIN=https://…`) ถ้าเป็น true จะส่ง `Strict-Transport-Security: max-age=15552000` (180 วัน ไม่มี `includeSubDomains`/`preload`) และ `upgrade-insecure-requests` header นี้ปลอมแล้วไม่มีผลเสีย เพราะ container ไม่มี published port (มีแค่ cloudflared ที่เข้าถึงได้) และ browser ไม่สนใจ HSTS ที่มากับ HTTP ธรรมดา local dev, preview และ e2e จึงไม่ได้ header เหล่านี้

## Header coverage

| Response                                             | Headers                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Page 200 และ 404 page (kit render)                   | ครบ + CSP ของ kit (hash)                                                 |
| `__data.json`, `/health`, redirect, `src/error.html` | ครบ + `FALLBACK_CSP`                                                     |
| admin deny 403/429/503                               | ครบ + CSP ของ deny page + `no-store`                                     |
| static file (`/_app/immutable/*`, `robots.txt`, fonts) | **ไม่มี** (sirv ของ adapter-node/preview ไม่ผ่าน `handle`)            |
| CSRF 403, reserved query 400, `/_app/*` 404, reroute 500, `handle` throw | **ไม่มี** (kit ตอบก่อน/นอก `handle`)               |

ทางแก้ gap ที่เสนอ: ใช้ Cloudflare Response Header Transform Rule เติม header แบบ static (nosniff, XFO, Referrer-Policy, COOP, CORP, HSTS) ที่ edge แต่ห้ามตั้ง CSP ที่ edge เพราะจะไปทับ policy ที่มี hash ของแต่ละหน้า

## Commands run & results

| Time  | Command                                                            | Result                                                                              |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 14:08 | `npm ci`                                                           | ok (warning ของ allow-scripts สำหรับ esbuild/better-sqlite3 เป็นของเดิม)           |
| 14:08 | `npm run db:reset`                                                 | ok, seed ครบ                                                                        |
| 14:09 | `npm audit --omit=dev`                                             | found 0 vulnerabilities                                                             |
| 14:09 | `npm audit`                                                        | 21 (7 low, 14 moderate), dev-only                                                   |
| 14:10 | `npm audit fix --dry-run`, `npm outdated`                          | ไม่มี fix ภายใน semver; dev deps อยู่ที่ wanted แล้ว (outdated มีแต่ major)         |
| 14:16 | `npx vitest run src/lib/server/auth`                               | 55 passed (หลังแก้ hash)                                                            |
| 14:16 | `npm run check`                                                    | 2 errors → แก้แล้ว 0                                                                |
| 14:17 | `npm run build` + `vite preview --port 4273` + curl                | headers ตามตาราง coverage                                                           |
| 14:20 | `E2E_PORT=4273 npx playwright test security.e2e.ts admin-security.e2e.ts` | รอบแรก 23 failed (style-src-attr, leak test)                                 |
| 14:22 | (รันซ้ำ)                                                           | 87 passed                                                                           |
| 14:23 | `vite dev --port 5273` + Playwright script                         | 200 ทุกหน้า ไม่มี CSP error                                                         |
| 14:26 | `npm run check`                                                    | 0 errors, 0 warnings                                                                |
| 14:26 | `npm run lint`                                                     | pass                                                                                |
| 14:27 | `npm test`                                                         | 53 files, 677 tests passed                                                          |
| 14:27 | `npm run build`                                                    | ok                                                                                  |
| 14:28 | `E2E_PORT=4273 npm run test:e2e`                                   | 100 passed                                                                          |

## Errors & problems

| Time  | Where (file/command/step)                                     | Error                                                                                     | Cause                                                                                                              | Resolution                                                                                         |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 14:11 | Bash `node -e` สำหรับคำนวณ hash                               | ไม่มี output                                                                              | การ escape regex ใน `node -e` ซ้อนอยู่ใน bash double quote ทำให้ pattern เพี้ยน                                    | ให้ `csp.test.ts` คำนวณ hash แทน (ทางนี้ทดสอบได้ด้วย)                                             |
| 14:13 | grep -P สแกน control char                                     | `character value in \x{} or \o{} is too large`                                            | grep ไม่ได้อยู่ใน UTF-8 locale                                                                                     | ใช้ `LC_ALL=C.UTF-8` แล้วเขียน `scan.mjs` (Node) ใน scratchpad                                     |
| 14:15 | Write/Edit `security-headers.ts`, `hooks.server.ts`           | `File has not been read yet`                                                              | อ่านไฟล์ด้วย `cat` ผ่าน Bash แต่ tool ต้องการ Read ก่อน                                                           | ใช้ Read ก่อนแล้วจึงแก้                                                                            |
| 14:16 | Write `security-headers.test.ts`                              | `File has not been read yet`                                                              | สาเหตุเดียวกัน                                                                                                     | Read ก่อนแล้ว Write                                                                                |
| 14:16 | `csp.test.ts`                                                 | 2 tests failed (`sha256-PLACEHOLDER`)                                                     | ตั้งใจใส่ placeholder เพื่อให้ test แสดง hash จริง                                                                 | ใส่ hash ที่ test รายงาน                                                                           |
| 14:16 | `npm run check`                                               | `Object is possibly 'undefined'` ที่ `security-headers.ts:62`, `csp.test.ts:55`           | `noUncheckedIndexedAccess` กับ `split(',')[0]` และ regex group                                                     | ใช้ `?.split(',')[0] ?? ''` และ default `content = ''`                                             |
| 14:16 | `vite build` (config loader)                                  | warning: import `./src/lib/server/auth/csp` without a file extension                     | `configLoader: 'native'` ในอนาคตต้องการนามสกุลไฟล์                                                                 | เปลี่ยนเป็น `./src/lib/server/auth/csp.ts` (tsconfig มี `allowImportingTsExtensions`)              |
| 14:20 | e2e `security.e2e.ts` public routes/interactive               | CSP violation: `style-src-attr blocked inline` (SSR HTML บรรทัด 49 และ chunk `Benb6lgt.js`) | style attribute ใน SSR markup และใน Svelte runtime (`style.cssText`/attribute) ถูก `style-src` ที่ไม่มี unsafe-inline block | เพิ่ม `style-src-attr 'unsafe-inline'` (ใช้กับ attribute เท่านั้น) พร้อมเหตุผลใน csp.ts/ARCHITECTURE |
| 14:20 | e2e bundle leak test                                          | `expected [...] to contain "LLM_API_KEY"`                                                 | `LLM_API_KEY` ไม่มีใน `.env.example` แต่มีใน config schema                                                          | อ่านชื่อ env จากทั้ง `.env.example` และ `src/lib/server/config.ts`                                |

หมายเหตุ (ไม่ใช่ error ของงาน): background `vite preview`/`vite dev` จบด้วย exit 127 เพราะผม kill process เอง ส่วน `504 (Outdated Optimize Dep)` ใน dev เป็นการ optimize dependency ครั้งแรกของ Vite ไม่เกี่ยวกับ CSP และ `npm audit` ที่ exit 1 เป็นเพราะมี dev vulnerability ซึ่งรายงานไว้ด้านล่าง

## Open issues / follow-ups for the orchestrator

- **npm audit (dev-only, 21: 7 low / 14 moderate)** ไม่มี fix ภายใน semver และงานนี้ห้ามทำ major upgrade:
  - `deepmerge` ≥4.2.0 (prototype poisoning, GHSA-gcqx-w48m-w2h4) ผ่าน `@sveltejs/vite-plugin-svelte` เป็นต้นทางของ chain `@sveltejs/kit`, `adapter-node`, `bits-ui`, `runed`, `svelte-toolbelt` ใช้เฉพาะตอน build/config merge ไม่อยู่ใน runtime ของ adapter-node และไม่มีเวอร์ชันที่ fix (`deepmerge@4.3.1` เป็นตัวล่าสุด)
  - `esbuild` ≤0.24.2 (dev server CORS, GHSA-67mh-4wv8-2f99) ผ่าน `drizzle-kit` → `@esbuild-kit/*` (pin `esbuild@0.18.20`) ใช้เฉพาะ `drizzle-kit` CLI ไม่ใช่ dev server ของแอป
  - `minimatch` 7.0.0–11.0.0 (ReDoS, GHSA-g3hv-75wg-m249) ผ่าน `eslint@10` และ `typescript-eslint@8` (ต้องการ `^10`, ซึ่ง 10.2.6 เป็นตัวล่าสุด และ fix อยู่ใน 11.x) ใช้เฉพาะ lint
  - prod deps: 0 vulnerabilities; `package.json` ไม่มี `latest`/`*`; `npm ci` ผ่าน (lockfile สอดคล้อง)
- **Header gap:** static files และ response ที่ kit ตอบก่อน `handle` ไม่มี security header ถ้าต้องการให้ครอบคลุม แนะนำให้ Wave 4 ตั้ง Cloudflare Response Header Transform Rule (static headers เท่านั้น ห้าม CSP)
- **Deploy (Wave 4):** ต้องตั้ง `ORIGIN=https://worldview.nared-fu.com` ไว้เหมือนเดิม (ทำให้ `isHttpsRequest` เป็น true และ CSRF ทำงาน) และไม่ต้องตั้ง HSTS ซ้ำที่ Cloudflare (ถ้าตั้งก็ไม่เป็นไร แต่ต้องไม่มี `preload` จนกว่าจะตัดสินใจ)
- เมื่อแก้ theme script ใน `src/app.html` หรือ `<style>` ใน `src/error.html` ต้องอัปเดต hash ใน `src/lib/server/auth/csp.ts` (`npm test` จะแสดงค่าใหม่ให้)
