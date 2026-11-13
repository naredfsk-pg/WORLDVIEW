# QA bug report — Wave 3 acceptance suite

Branch `test/acceptance-suite` from `main` @ `e074515`, 2026-11-13. Found by the acceptance suite
(`docs/qa/ACCEPTANCE.md`), axe-core 4.14 via `@axe-core/playwright` 4.14, and exploratory testing on the
production build (`vite preview`, seeded demo database, Chromium 1254 from Playwright 1.65).

Severity: **P1** data loss / security · **P2** broken feature · **P3** degraded UX, accessibility, or
hardening. No P1 or P2 bugs were found.

Each bug has a test that reproduces it. The test is marked `test.fixme` (Playwright) or `it.todo`,
next to a passing `repro` test (Vitest). When you fix a bug, remove the fixme or todo marker and the
entry in `tests/e2e/a11y-helpers.ts` `KNOWN_A11Y_BUGS`.

| ID | Severity | Area | Summary | Owner |
|---|---|---|---|---|
| BUG-QA-001 | P3 (axe serious) | a11y, shell | The sidebar logo link's name does not contain its visible text | frontend |
| BUG-QA-002 | P3 (axe serious) | a11y, archive | Calendar days without a brief have 1.77:1 contrast (light) and 2.35:1 (dark) | frontend |
| BUG-QA-003 | P3 (axe serious) | a11y, theme | The `text-faint` token is 4.47:1 in the light theme, just under 4.5:1 | frontend |
| BUG-QA-004 | P3 (axe serious) | a11y, event | The event facts `<dl>` has a `<p>` as a direct child | frontend |
| BUG-QA-005 | P3 (hardening) | public read | A published relation is listed even when none of its evidence resolves | backend |
| BUG-QA-006 | P3 (hardening) | public read | A published event with no linked article is still public, with 0 sources | backend |
| BUG-QA-007 | P3 | archive | A future date is shown as "the news of that day", and next-month links never stop | frontend |
| BUG-QA-008 | P3 (axe moderate) | a11y, brief | The brief page skips from `<h1>` to `<h3>` | frontend |
| BUG-QA-009 | P3 (Lighthouse) | readability | Only 46–55 % of the text is ≥ 12 px on `/`, `/archive` and the event page | frontend |
| BUG-QA-010 | P3 (Lighthouse) | performance | `/archive` has CLS 0.175 on Lighthouse mobile (0.32 under CDP throttling) | frontend |

---

## BUG-QA-001: the sidebar logo link's name does not contain its visible text

**Severity**: P3. axe `label-content-name-mismatch` (serious, WCAG 2.1 SC 2.5.3 Label in Name). It
appears on every page, public and admin, in both themes.
**Reproduction**:

1. Open any page at a width of 1024 px or more, where the sidebar is visible.
2. Run axe on the page, or inspect the link `a[aria-label="Worldview หน้าหลัก"]` in the sidebar
   (`src/lib/components/AppShell.svelte`, around line 126).

**Expected**: the accessible name contains the visible text, so speech-input users can say what
they see.
**Actual**: the visible text is "worldview MAKE SENSE OF THE WORLD". The `aria-label`
"Worldview หน้าหลัก" replaces it, so the tagline is not in the name. (The header logo is fine: its
visible text is `aria-hidden`.)
**Suggested fix**: hide the tagline from assistive tech (`aria-hidden="true"`), or drop the
`aria-label` and add visually hidden "หน้าหลัก" text.
**Test**: `tests/e2e/a11y.e2e.ts` › "known accessibility bugs › BUG-QA-001: the logo link name
contains its visible text" (fixme).
**Suggested Owner**: frontend

## BUG-QA-002: archive calendar days without a brief fail the contrast check

**Severity**: P3. axe `color-contrast` (serious, WCAG SC 1.4.3), 17 nodes on `/archive`.
**Reproduction**:

1. Open `/archive?month=2026-11` in either theme.
2. Look at the day numbers that have no brief, for example 14–30. They render as
   `span.text-muted-foreground/40`.

**Expected**: at least 4.5:1 contrast for 14 px text. The days are information ("no brief on this
day"), not disabled controls.
**Actual**: #bec4c1 on #ffffff gives 1.77:1 in light; #515f5a on #192522 gives 2.35:1 in dark.
**Test**: `tests/e2e/a11y.e2e.ts` › "BUG-QA-002: archive calendar days without a brief meet 4.5:1
contrast" (fixme).
**Suggested Owner**: frontend

## BUG-QA-003: the `text-faint` token is just under AA in the light theme

**Severity**: P3. axe `color-contrast` (serious), light theme only.
**Reproduction**:

1. Open `/academy/week/1/day/1` and `/connections` in the light theme.
2. Check `.text-faint` text: the "(TODO: verify)" marker of unverified further reading, the
   "ตรวจทานเนื้อหาล่าสุด …" line, and the connections footnote.

**Expected**: 4.5:1 or more.
**Actual**: #67766f on #f7f8f5 gives 4.47:1, at 11–13 px.
**Test**: `tests/e2e/a11y.e2e.ts` › "BUG-QA-003: text-faint meets 4.5:1 contrast in the light theme"
(fixme).
**Suggested Owner**: frontend (darken the light `--faint` token slightly)

## BUG-QA-004: the event facts `<dl>` contains a `<p>`

**Severity**: P3. axe `definition-list` (serious, WCAG SC 1.3.1).
**Reproduction**: open `/events/demo-evt-01`. The time box `<dl class="mt-4 grid …">` has a direct
child `<p>`, the note "เวลาทั้งหมดเป็นเวลาไทย (GMT+7)".
**Expected**: a `<dl>` only contains `<dt>`/`<dd>` groups, optionally wrapped in a `<div>`.
**Actual**: screen readers may announce the list with a wrong item count, or skip the note.
**Test**: `tests/e2e/a11y.e2e.ts` › "BUG-QA-004: the event facts <dl> only contains dt/dd groups"
(fixme).
**Suggested Owner**: frontend (move the `<p>` after the `</dl>`, or wrap it in a `<div>`)

## BUG-QA-005: a published relation with unresolvable evidence is still listed

**Severity**: P3, defence in depth. You can only reach it with a row that bypassed the write-side
gates: the relation gate drops evidence-less relations at creation, and articles are never deleted
today. It is still a PRD §11 #8 invariant ("no causal link without evidence"), and the read layer
does not enforce it.
**Reproduction**:

1. In a seeded database, insert a `published` `response_to` relation whose `evidence_refs` point
   to an article id that does not exist.
2. Call `read.listPublishedRelations(...)`, which backs `/connections` and the event page.

**Expected**: the relation is not returned (or is filtered out once `evidence_source_urls` comes
back empty).
**Actual**: it is returned with `evidence_source_urls: []`, so the UI shows a causal link with no
evidence link.
**Test**: `src/lib/server/db/repositories/public-read.acceptance.test.ts` › "defence in depth … ›
BUG-QA-005 …" (`it.todo`), with the passing "repro BUG-QA-005" test that pins the current
behaviour.
**Suggested Owner**: backend (`selectPublishedRelations` in
`src/lib/server/db/repositories/public-read.ts`: drop rows whose evidence resolves to nothing)

## BUG-QA-006: a published event with no linked article is still public

**Severity**: P3, defence in depth. Both publish paths (the digest gate G1 and the admin publish
gate) require a source. But `isPublicEvent` only checks `status = 'published'` and
`category IS NOT NULL`. PRD §1.4 says every published event has at least one verifiable source.
**Reproduction**:

1. In a seeded database, delete the `event_articles` rows of `demo-evt-02` (published).
2. Call `read.getPublishedEventDetail('demo-evt-02')`, or open `/events/demo-evt-02`.

**Expected**: the event is not public (null / 404), or it is at least kept out of lists.
**Actual**: it is returned with `sources: []`, so the page renders an empty "แหล่งข่าวอ้างอิง"
section.
**Test**: `public-read.acceptance.test.ts` › "BUG-QA-006 …" (`it.todo`), with the passing "repro
BUG-QA-006" test.
**Suggested Owner**: backend

## BUG-QA-007: the archive offers future dates as "the news of that day"

**Severity**: P3 (UX).
**Reproduction**:

1. Open `/archive?date=2099-01-01`.
2. Open `/archive`, then press "เดือนถัดไป" repeatedly.

**Expected**: the date picker already caps at today (`max={data.today}`). The URL should behave the
same: clamp the date to today or reject it, and stop next-month navigation at the current month.
**Actual**: the headline says "ข่าวประจำวันที่ 1 ม.ค. 2099", with the empty state, and next-month
links continue forever (2099-02, …). No 500. Invalid dates such as `2026-02-30` and `2026-13`
already fall back correctly.
**Test**: `tests/e2e/exploratory.e2e.ts` › "archive calendar month boundaries › BUG-QA-007: a future
date is not offered as \"news of that day\"" (fixme).
**Suggested Owner**: frontend (`src/routes/archive/+page.server.ts`)

## BUG-QA-008: the brief page skips a heading level

**Severity**: P3. axe `heading-order` (moderate). There is no fixme, because the policy is to add
fixmes for serious and critical violations only.
**Reproduction**: open `/brief/2026-11-12`. Story cards use `<h3>` (for example "ห่วงโซ่อุปทานชิป…")
without an `<h2>` above them in that section.
**Expected**: heading levels increase by one.
**Actual**: h1 → h3.
**Test**: reported by `tests/e2e/a11y.e2e.ts` (the axe attachment of "/brief/2026-11-12"). It does
not fail the run.
**Suggested Owner**: frontend

## BUG-QA-009: most of the text on three main pages is smaller than 12 px

**Severity**: P3 (readability). PRD §8.1 asks for "Thai-first readability: typography ขนาดอ่าน
สะดวก". This is the Lighthouse `font-size` audit, which fails below 60 %.
**Reproduction**: run Lighthouse mobile on `/`, `/archive` and `/events/demo-evt-01`, or run the
fixme test below.
**Expected**: at least 60 % of the text is 12 px or larger at mobile width. Thai combining vowel
and tone marks make small sizes harder still.
**Actual**: 54.7 % on `/`, 46.0 % on `/archive` and 46.9 % on the event page (Lighthouse). The
main offenders are `.text-[10px]` and `.text-[11px]`: card meta lines, chips, labels, footnotes
and evidence links. The lesson reader passes (96 %).
**Test**: `tests/e2e/lighthouse-findings.e2e.ts` › "Lighthouse mobile findings › BUG-QA-009: at
least 60 % of the text is 12 px or larger" (fixme). The measured shares at 412 px are 0.54, 0.49 and
0.59.
**Suggested Owner**: frontend (raise the 10–11 px tokens to 12 px on mobile, at least for running
text)

## BUG-QA-010: `/archive` shifts its layout while loading on a slow mobile connection

**Severity**: P3 (performance, Core Web Vitals). This is the only route below 90 in Lighthouse
performance (88).
**Reproduction**:

1. Run Lighthouse mobile on `/archive`. CLS is 0.175 in all three runs. The culprit is
   `main#main > div.grid`.
2. Or, in Chromium at 412 px with CDP slow 4G (562 ms latency, 1.47 Mbps) and 4× CPU throttling,
   load `/archive`. The layout-shift sum is 0.32, from two shifts of the main grid at about 2.5 s
   and 2.8 s.

**Expected**: CLS < 0.1 (Lighthouse "good"). The other main routes score 0.001–0.011.
**Actual**: 0.175 (Lighthouse), 0.32 (CDP). Without throttling it is 0.000. The final layout is
identical with and without JS, so this is transient. The likely cause is the date-form row
(`input[type=date]` + "ดูข่าว" + "กลับไปวันล่าสุด", `flex-wrap`) re-wrapping when Noto Sans
Thai replaces the fallback font, which moves the calendar and results below it. This is not
confirmed; check with font preloading or a fixed row height.
**Test**: `tests/e2e/lighthouse-findings.e2e.ts` › "BUG-QA-010: /archive has CLS < 0.1 on a
throttled mobile load" (fixme).
**Suggested Owner**: frontend

---

## Not bugs: observations from the exploratory session

- **Keyboard**: on `/`, `/academy/week/1/day/1`, `/archive` and `/events/demo-evt-01`, Tab order
  follows the visual order: skip link → logo → search → theme → content → bottom nav. Every
  focusable element has a visible focus ring. The only exception is Chromium's own date-picker
  indicator inside `<input type="date">`.
- **The `/` shortcut**: it opens search from the page. It is ignored inside inputs and textareas,
  with Ctrl, Meta or Alt held, and while the dialog is open. Typing `/` in the search field types
  the character.
- **Theme**: the saved choice wins over the OS preference on every page. An invalid stored value
  falls back to the OS preference. The theme is picked before first paint by an inline script in
  `app.html`. **Note for the CSP lane**: a strict `script-src` without a hash or nonce for this
  script would break theme persistence (`tests/e2e/ui.e2e.ts` › "theme choice persists across a
  reload" and `exploratory.e2e.ts` › "theme" would catch it).
- **Archive calendar**: prev/next cross year boundaries both ways. February 2028 has 29 days and
  February 2027 has 28. An empty month shows "เดือนนี้ยังไม่มีสรุปข่าว". Invalid months and dates
  fall back to the latest brief with a 200.
- **Stale and demo states**: with no successful ingest, the shell shows "ข้อมูลอาจไม่เป็นปัจจุบัน ·
  อัปเดตล่าสุด …", and `/health` is `degraded`/`stale: true`. After the fixture pipeline it is
  `ok`/`stale: false`. The demo notice is shown whenever demo rows are public.
- **Admin**: review → publish → public and hide → 404 are covered by `admin.e2e.ts`. The 409
  conflict is covered by `admin-flows.e2e.ts`: the second editor sees the conflict notice and keeps
  their input, and the first save stands.
- **Thai at 360 px**: no clipped heading or paragraph on the main routes. Line breaks fall between
  words. Thai vowel and tone marks render correctly with Noto Sans Thai. In full-page screenshots
  the fixed bottom nav is drawn mid-page; that is an artefact of the screenshot, not a layout bug.
- **Native date input** (`/archive`): the format follows the browser locale (`mm/dd/yyyy` in an
  en-US Chromium). This is expected for `<input type="date">`.
- **Ingest-time grouping on real feeds**: one real ingest made 113 events from 115 articles (see
  `BASELINE.md` §3). This is by design: the strict ingest grouping is followed by LLM clustering
  in the digest. It matches the open item in the Wave 2.5 log, and is worth watching once the real
  LLM runs.
