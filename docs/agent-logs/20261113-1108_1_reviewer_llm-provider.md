# 1 · reviewer · llm-provider

| Field | Value |
|---|---|
| Started | 2026-11-13 11:08:00 (Asia/Bangkok) |
| Finished | 2026-11-13 11:16:00 (Asia/Bangkok) |
| Status | done |
| Agent type | reviewer (read-only code review) |

## Goal

Review branch `feature/llm-provider` (worktree `C:\Project\WORLDVIEW-worktrees\llm-provider`, diff `main..HEAD`, 32 ไฟล์ ~3.3k บรรทัด) เทียบกับ ARCHITECTURE §10/§11 และ PRD §5, FR-02, §9.2 โดยเน้น security (key/source leak, prompt injection, hallucinated ref/URL/lesson id), correctness (fallback, repair turn, retry/backoff, caps, cache, timeout/abort, gates), edge cases และ simplicity ห้ามแก้โค้ด

## What I did (in order)

1. 11:08 — `git log`/`git diff --stat main..HEAD` ดู commit และไฟล์ที่เปลี่ยน
2. 11:09 — อ่าน `provider.ts`, `transport.ts`, `routing.ts`, `cache-key.ts`, `json.ts`, `prompt.ts`, `tasks/*`, `mock.ts`, `index.ts`, `editorial/*`, `scripts/llm-smoke.ts`, `types/{llm,editorial,domain}.ts`, repository `llm-calls.ts`, `config.ts` (เฉพาะส่วน llm)
3. 11:09 — อ่าน ARCHITECTURE §6, §8, §10, §11, §14 และ PRD FR-02, §4.3, §5, §9 ใน worktree
4. 11:10 — รัน tests ของ lane และ `tsc --noEmit`
5. 11:11 — อ่าน tests (`provider.test.ts`, `llm-down.test.ts`, `event-gate.test.ts`, fixtures) หา test ที่ผ่านแบบ vacuous
6. 11:12 — เขียน probe script ใน scratchpad (นอก repo) เพื่อยืนยันพฤติกรรมที่สงสัย 8 ข้อ
7. 11:13 — สรุป findings และเขียน log นี้

## Files created / changed

- `C:\Project\WORLDVIEW\docs\agent-logs\20261113-1108_1_reviewer_llm-provider.md` — log นี้ (ไฟล์เดียวที่เขียน)
- ไม่ได้แก้ไฟล์ใดใน worktree (probe script อยู่ใน scratchpad ของ session เท่านั้น)

## Commands run & results

| Time | Command | Result |
|---|---|---|
| 11:08 | `git -C … log --oneline main..HEAD` / `diff --stat` | 5 commits, 32 files, +3303/-1 |
| 11:10 | `npx vitest run src/lib/server/llm src/lib/server/editorial` (PowerShell, cwd `C:\…`) | 7 files, 78 tests passed |
| 11:10 | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| 11:12 | `npx tsx <scratchpad>/probe.mts` | ยืนยัน findings 1–8 (ดูด้านล่าง) |

ผล probe:
1. 2 runs พร้อมกัน, `dailyMaxRequests=1` → ทั้งคู่ `budget_exceeded`, ส่ง request 0 ครั้ง (ควรผ่าน 1)
2. extraction cache round-trip ที่มี `occurred_at` (+07:00) → cache hit ถูกต้อง
3. transport โยน `TypeError` → ถูก retry รวม 6 ครั้ง (3×2 models) แม้ comment บอก non-retryable
4. timeout ทุกครั้ง → บันทึก 6 rows, tokens รวม 0
5. `current_status: 'hidden'` + gates ผ่าน → `published`
6. `signals.sensitive=false` แต่ `extraction.sensitive=true`, publisher เดียว → `published`
7. `what_happened_th` มี bare domain `evil-news.example.com/x` → `published`
8. abort ระหว่างรอ semaphore → transport ถูกเรียก และบันทึก row `aborted` ใน `llm_calls`

## Findings (สรุป — รายละเอียดเต็มอยู่ใน handback ให้ orchestrator)

**Confirmed**
- [high] `editorial/event-gate.ts:13-19` — auto gate คืน `published` ให้ event ที่ `hidden` (และล้าง `manual_flag` เพราะ gate ไม่รู้ reasons เดิม) ขัด §6 lifecycle
- [medium] `editorial/event-gate.ts:91` — `signals?.sensitive ?? extraction.sensitive` ให้ signals ชนะเสมอ: signals เก่า/ไม่ตรงกัน (false) ทับ extraction ใหม่ (true) → sensitive single-source ถูก publish (ขัด PRD §4.3 #6)
- [medium] `llm/provider.ts:243-250, 262-264, 294` — token cap นับต่ำ: error/timeout บันทึก 0 tokens, ไม่ reserve tokens ของ in-flight calls, และเชื่อ `usage` ของ proxy ที่ต่ำกว่าจริง
- [medium] `llm/provider.ts:234-240, 291` — reservation นับ call ที่ยังรอ semaphore ด้วย → ใกล้ cap แล้วปฏิเสธเกินจริง (probe: cap=1, 2 runs → 0 ผ่าน); ย้าย budget check เข้าไปใน `limit()` จะง่ายและแม่นกว่า
- [low] `llm/provider.ts:312-314` — unknown throwable ถูก map เป็น `network` ซึ่ง retryable → retry 6 ครั้ง ขัด comment
- [low] `llm/provider.ts:240` + `llm/provider.ts:394` — abort ระหว่างรอ semaphore ไม่ถูกเช็ก → เรียก transport และบันทึก row นับเข้า request cap
- [low] `editorial/event-gate.test.ts:102` — test `constructor` ผ่านแม้ไม่มี `Object.hasOwn` (vacuous สำหรับ prototype guard)
- [low] `editorial/lesson-links.ts:12` — ไม่ตรวจ `lesson_id` กับรายการที่มีจริง (พึ่ง provider อย่างเดียว)

**Suspicions / design**
- [medium] `llm/transport.ts:120` — ส่ง `response_format` เสมอ ซึ่งไม่อยู่ใน body ตาม §10; model/proxy บางตัวตอบ 400 → `bad_request` ไม่ retry และ fallback อาจพังเงียบ
- [low] `editorial/text.ts:5` — G3 ตรง spec แต่ไม่จับ bare domain (`evil.example.com`) ที่ injection ใส่ได้
- [low] `llm/tasks/shared.ts:72` + `prompt.ts` repair turn — ค่า ref จาก LLM (≤32 ตัวอักษร) ถูกใส่ใน user message นอก `<data>`
- [low] `editorial/event-gate.ts:24` — `input_too_large`/`auth`/`bad_request` กลายเป็น `llm_failed` ที่ retry ทุก digest ไม่ถึงมือคน
- [low] worst-case เวลาต่อ run (~18 นาทีเมื่อ endpoint ช้า) ใกล้ job abort 20 นาที; ไม่มี guard input ว่าง / >12 articles ที่ provider

**ตรวจแล้วถูกต้อง**: `<data>` escaping (`\u003c`), ไม่มี key/header/prompt ใน log/error/`llm_calls`, ref check ใช้ `Set`/`hasOwn`, cache เฉพาะ `ok` + re-validate, cache key canonical, fallback `cc/`/`cx/`/อื่นๆ, budget/aborted ไม่ fallback, repair turn ครั้งเดียว, retries = 1+`LLM_MAX_RETRIES`, Retry-After cap 30 s, timeout ครอบ body read, omit temperature, `not_configured` เมื่อไม่มี config, error envelope 200 ถูก reject, relation gate (causal → review, ≥0.6), `keep_published`

## Errors & problems

| Time | Where (file/command/step) | Error | Cause | Resolution |
|---|---|---|---|---|
| 11:12 | `npx tsx probe.ts` (scratchpad) | `Top-level await is currently not supported with the "cjs" output format` | ไฟล์ `.ts` นอก package ถูก treat เป็น CJS | เปลี่ยนชื่อเป็น `probe.mts` แล้วรันใหม่ผ่าน |
| 11:10 | `tsc --noEmit` | ไม่มี error (หมายเหตุ: `.svelte-kit/tsconfig.json` ไม่มีใน worktree แต่ `$app/tsconfig` resolve ได้) | — | — |

## Open issues / follow-ups for the orchestrator

- แก้ข้อ high (hidden/manual_flag) ก่อน Wave 2 digest จะเรียก gate กับ event เดิมที่มีบทความใหม่
- ตัดสินใจ policy token accounting (`max(reported, estimate)` และนับ tokens_in ของ request ที่ส่งไปแล้วแต่ timeout)
- พิจารณาเอา `response_format` ออก หรือทำเป็น opt-in ต่อ model
