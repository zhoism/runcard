# Designer round 2 — spec (2026-09-01)

Source: the designer's `runcard-redesign.html` mockup and four screenshots, relayed by the user.
Frame: **a shareable, agent-readable GitHub for MD runs.** Run = repo, fork = rerun with lineage,
proposal = pull request, Approve = merge, automode = agent review, compare = diff.

Function priority on a run page: (1) the number and how much to trust it, (2) where the run sits
among others (lineage, forks, compare), (3) act on it (fork, hand to an agent, approve), (4) details.

## 1. Proposals become pinned comments on the page (Figma comments, not numbered labels)

- A proposal always targets one stage (`Proposal.stage`), so the **pin anchors to that stage's box**
  in the Stages pipeline. One pin per stage with proposals; a count inside if > 1.
- **Pin shape:** a speech bubble (rounded square with a tail), not a circle. Amber = pending (needs
  attention), green = approved, grey = rejected. A small agent glyph inside; WebMCP does not expose the
  client's name, so the glyph is generic, and the thread says `via WebMCP` or `via page`.
- **Thread opens inline**, in the stage-detail region below the pipeline (same disclosure the stage
  boxes use), not as a floating popover: no z-index, clipping or phone-width problems. Thread card:
  who/when, the reason, the diff (`key: before → after`, before struck through, after green, with the
  parameter's meaning and material/not material), validation after, **Approve / Reject**. Approve keeps
  the existing semantics (`setProposalStatus`; an edit that fails validation cannot be approved).
- **Sidebar Proposals panel** shrinks to a summary: `2 pending on this run — pinned at density, product`
  (links open the thread), plus a compact list for proposals on other runs. Nothing is auto-approved;
  the Approve button stays the most important control on the page.

## 2. Analyses: categories, one-line meaning, filter pills

- A small catalogue in `src/lib/analysisCatalog.ts`: key → human name, category, one-line "what it
  shows" (generic to the analysis type, never a run-specific number). Categories: **structure**
  (rmsd, rg, sasa, distmat), **dynamics** (rmsf, dssp, hbond), **ensemble** (cluster, pca, fel),
  **energy** (thermo, mmgbsa). Unknown keys → other, shown with their file name.
- Filter pills above the gallery: all · structure · dynamics · ensemble · energy. No search bar:
  12 items. Each card: name, category tag, the PNG (still opens full size), the one-line meaning.

## 3. Fork flow: three cards, one primary action each, moved up

- Card order on the run page: ΔG → fork network (if any) → **Fork this experiment** → Stages → …
- Three cards side by side (stack ≤ 600 px): **Reproduce** / **Replicate** / **Extend**. Each: title,
  one-line description, a navy primary button (`Build bundle`, `Plan replicate`, `Prefill console`)
  and a ghost `Copy prompt`. Extend carries the amber `needs your approval` badge. Copy prompt is
  per card, naming this run's URL.
- Title bar gets a **Fork** button beside the `N forks` badge that jumps to the card (GitHub puts Fork
  in the repo header). The two general prompts (inspect the evidence, check comparability) move to the
  Current investigation card, which already invites the reader to ask an agent.

## Not in this round
Activity feed (call log as a timeline), agent-review card, comments/stars/uploads (need a backend).
