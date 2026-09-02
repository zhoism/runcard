# Design decision — 2026-09-01 overnight UI pass

Two directions were built against the unchanged `src/App.tsx` markup and compared on the three key
screens (home/cohort, run detail, compare) at 390/1440/2560 px. Screenshots in `docs/design/shots/`
(gitignored, regenerable: load each stylesheet via a preview entry and screenshot with headless Chrome).

## Direction R — "preprint" (control, refined original)

`src/theme.css`, viewable via `preview.html` (loads `src/main.preview.tsx`). Cream paper #f4f1ea,
Newsreader serif, terracotta accent, hairline rules, stage ticks on a line. Brought up to date in this
pass (lineage, cohorts, mode switch, trace, fork stacking, `.ladder`, sticky rail). It is competent and
calm — and it is almost exactly the templated look AI design output defaults to (cream + high-contrast
serif + terracotta; broadsheet hairlines). It also styles the agent rail as more of the same article,
which undersells the one thing runcard is about.

## Direction N — "amber record" (chosen, now the production stylesheet)

`src/amber.css`, imported by `src/main.tsx`. Thesis: **two readers, one record** — serif carries human
explanation, mono carries machine-verifiable fact. The engine is Amber; amber preserves specimens.

- Ground `--bench #f1f1ec` (cool lab-bench, deliberately not cream); ink `#21241f` graphite.
- Accent `--amber #a05a0e`; the headline ΔG sits in a translucent **resin field**
  (`--resin` gradient + amber left rule) — preserved evidence, not a hero stat.
- **The agent rail is a graphite instrument panel** (`--panel #24261f`, text `#e5e3d6`, actions in
  `--warn-b #d9a83d`): the human/agent boundary of WebMCP made visible. Sticky, own scrollbar; the
  grid paints the column full-height via `.app::after`. Judges watch proposals and the tool log land here.
- Type: IBM Plex Serif (400/500/600) + IBM Plex Mono (400/500) — the "man and machine" family, loaded
  in `index.html`. Root 17.5px, nothing under 14px.
- Section heads: mono, sentence case, prefixed `&` (Fortran-namelist vernacular — every stage input on
  the page starts `&cntrl`). The prefix is CSS `content: "&" / ""` so accessible names stay clean.
- Status marks are square ticks (`■`), echoed by the stage-pipeline squares; PASS stays uncoloured.
- pass `#37613d` / warn `#8a5f07` / fail `#9c3218`, brightened variants on the panel; plot blue `#2f5f8f`.

## Why N

Equal usability (same markup, same hierarchy decisions), stronger identity, and the identity encodes the
product's actual differentiators: provenance (resin/amber), machine-verifiability (mono facts), and the
human-approves/agent-proposes split (light page / graphite rail). R is the safest evolution; it is also
the look every third AI-generated page has this year.

## Rules that still bind (from the earlier design critique)

Hierarchy with one primary; never repeat a fact on a page; no oversized numbers; group related info;
sticky nav owns its z-index; nothing under 14px; sentence-case titles.

## Verified in this pass

654 tests, `tsc -b`, `vite build` clean. DevTools inspection at 390 (emulated) / 1440 / 2560: no
horizontal overflow, no console errors. Exercised live: stage disclosure, propose_change →
Approve → generate_rerun_bundle (15 files, approved dt captured), automode trace, evidence brief,
404 recovery, compare (same- and cross-system). Real-WebMCP registration is unchanged
(`src/webmcp.ts` untouched); only the stylesheet import and font links changed in the entry path.

## Addendum — 2026-09-01: designer rulings land as the "report" theme

Lailai Zhang reviewed the preprint UI (Figma file `Runcard`, comments pulled via REST) and overrode
three defended stances; the user accepted the rulings. What renders now is `src/report.css`:

- Two fonts (Inter + JetBrains Mono for machine text); hierarchy by size/weight, no italics, no caps.
- Muted deep blue / white / grey; deep-blue top nav carries white text, logo returns home.
- One semantic code everywhere: green = pass, amber = needs attention, red = fail. PASS is now
  colored (ruling #4); the copy still scopes it as an input sanity check.
- Warnings are emphasized banners, bold and lowercased for display (ruling #3); the caption states
  the source file prints them in capitals, so the verbatim claim stays honest.
- Bento cards on a grey ground; the rail is sized to fit the viewport (ruling #1).

Not done from the spec (structural, post-deadline unless asked): splitting the report into pages with
a left side nav, and an Overleaf-style collapsible split view for the compare route.
`theme.css` (preprint) and `amber.css` remain in-tree as reference only.

## 2026-09-01 (evening) — the designer's redesign supersedes the report theme
The owner: "if I bring a bunch of stuff I expect change. Adopt it." The mockup in `redesign-2026-09-01/` is now the
visual language of the app (IBM Plex, paper ground, flat sections, ink buttons, agent accent). The report theme's
semantic colour code and the 13 px text floor carry over; its bento cards and navy header do not.

## 2026-09-01 (later) — reverted
The redesign adoption (007890a) was reverted on the owner's instruction; the report theme of e365aa6 stands. The
mockup stays archived for reference. The Fork dropdown, grouped compare picker and logo mark are kept.

## Addendum — 2026-09-01, late: the "editorial" theme (branch `design/editorial`)

The user compared the site against the WebMCP reference sites Devpost points at (captured in
`docs/design/references-2026-09-01/`) and asked for their look. What those sites share and the report theme
lacked: one display face with an italic accent word, kicker labels above each block, whitespace instead of
borders, one accent colour, a `WebMCP · N tools` pill, agent presence on the objects, and a real object at
the top of each page instead of a paragraph.

`src/editorial.css` is the result, imported by `src/main.tsx`; `src/report.css` stays as the reference for the
previous look, like `theme.css` and `amber.css` before it. Markup changes in `src/App.tsx` and the new
`src/Spread.tsx`:

- Instrument Serif (400, italic) for h1, project headlines, section labels and the headline ΔG; Inter for
  the rest; JetBrains Mono for machine text. Three faces, which overrides the designer's two-font ruling;
  the user asked for the reference look and this is what it is made of.
- Kickers are sentence case at 13.5 px, never uppercase tracking — the user's own rule stands.
- Cards lose their borders; a white surface on an off-white ground with a barely-there ring separates them.
- The header is white with a hairline; the WebMCP badge is one pill, green when registered, amber when the
  browser does not expose WebMCP (it still leads to the console).
- **The spread is an object.** `Spread` draws one dot per run on the ΔG axis, the band is mean ± run-to-run
  SD, the ring marks the run the page starts from, colours are per owner. Every dot is an index entry; the
  mean and SD are the cohort's. Home cards and the project page lead with it. The run page puts the
  per-frame trace directly under the number.
- The agent rail is one tinted card — "your agent is invited", the Investigate button — with the 17-tool
  developer console folded beneath it (`details.devtools`; a page button that drafts a call unfolds it).
- Proposal threads carry an `agent proposal` chip instead of a glyph.

Rules that still bind: one primary per page, no repeated facts, no oversized numbers, nothing under 13 px,
sentence case.
