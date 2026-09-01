# Demo video plan — runcard (~1:55, six clips)

Built to the Devpost recording rules: working product in the first 10–15 s, no intro/title/setup,
agent-using-tools as the centerpiece, one strong example per feature, no live typing, no dead air,
short clips, on-screen text over narration. Team story and inspiration stay in the written
description (`docs/devpost.md`), not here.

**Runtime target: under 2:00.** Everything is recorded on the LIVE URL (https://runcard.vercel.app),
already loaded, already logged in to the agent. If it loads, it gets cut.

---

## Before recording (do once)

- [ ] Chrome with `chrome://flags/#enable-webmcp-testing` on (or ChatGPT's browser), signed in, ready.
- [ ] Split screen prepared: agent chat left (~40%), runcard right (~60%). Hide bookmarks bar, tabs
      you don't need, notifications off (Do Not Disturb).
- [ ] The three prompts below staged in a clipboard manager — **pasted on camera, never typed**.
- [ ] Live site warm (visited once so fonts/assets are cached; never film a load).
- [ ] Recorder set for short clips (QuickTime/OBS). 1920×1080. Each clip is its own file so any one
      can be redone alone.
- [ ] Page state is in-memory: **reload between clips** for a clean rail, EXCEPT clip D which needs
      its own unbroken propose → approve → bundle continuity.

**Prompts (paste-ready):**

1. `Is this ΔG trustworthy? Which uncertainty should I quote? Use the tools on this page and do not claim more than the evidence supports.`
2. `Investigate this run and tell me what to do about it.`
3. `Prepare a controlled temperature change to 310 K on this run and stop at a pending proposal for my approval. Then, after I approve, generate the rerun bundle.`

---

## Clips

### A — cold open: an agent is already working (0:00–0:12)
- **Screen:** `#/run/1l2y-rep4`, split screen. Prompt 1 was pasted just before recording started —
  the recording opens with tool calls already landing in the rail's Tool activity log
  (`explain_result`, `get_run_manifest`…), each tagged "via agent / WebMCP".
- **Text overlay:** "This MD run page registers 16 WebMCP tools. A real agent is using them."
- **Cut:** start mid-action. No logo, no greeting, no page load.

### B — the answer that proves the page thinks (0:12–0:32)
- **Screen:** the agent's reply quoting the run-to-run spread as the uncertainty to quote — while the
  camera pans the ΔG card showing the same number and the "the within-run SEM is not" caption.
- **Text overlay:** "It refuses the flattering error bar — run-to-run spread, not within-run SEM."
- **Cut:** jump-cut the agent's thinking time to zero; speed up scrolling 1.5×.

### C — automode: it decides, it cannot act (0:32–0:50)
- **Screen:** fresh reload. Paste prompt 2 (or click Auto → Investigate in the Tool Console). The
  numbered trace renders: which rung is holding the run back, what it checked, one recommendation.
  End the clip on the Proposals panel still saying "None yet."
- **Text overlay:** "It picks what to investigate from the evidence — and creates nothing."
- **Cut:** trim the investigation latency; hold 1 s on the empty Proposals panel.

### D — THE CENTERPIECE: agent proposes, human approves, bundle ships (0:50–1:30)
One unbroken state chain, recorded in one clip, tightened with jump cuts:
1. Paste prompt 3 → a **pending** proposal card appears in the rail (temp0 300 → 310, material ·
   thermodynamic state, before PASS → after PASS).
2. Mouse moves to **Approve**. Click. Status flips to approved. *(This is the money frame — slow
   nothing down, but let the click land clean.)*
3. Agent generates the rerun bundle → "Prepared rerun bundle … self-contained" appears → Download →
   quick cut to the unzipped folder: 15 files, then 2 s on `analysis/mmgbsa.in` (this run's own masks).
- **Text overlays, in sequence:** "Agent proposes." → "A human approves — the agent cannot." →
  "The bundle re-runs the MD *and* reproduces the number."
- **Cut:** jump-cut every wait; the unzip happens off camera.

### E — the loop already closed on a real cluster (1:30–1:50)
- **Screen:** the Confidence ladder: "independently replicated — verified … 6 of 3 needed ✓", then
  one replicate card (`1l2y-rep4-ice1`) with its lineage line "Independent replicate of 1l2y-rep4 —
  fresh seeds."
- **Text overlay:** "This exact bundle ran on a university cluster. Four results came back — the page
  re-verified its own confidence."
- **Cut:** two static shots, 8–10 s each, crossfade or hard cut.

### F — end card (1:50–1:55)
- **Screen:** the home page cohort table.
- **Text overlay:** "runcard.vercel.app — open it, bring your agent."
- No outro speech. End.

---

## Edit pass (applies to every clip)

- Jump-cut all pauses, filler, and agent latency; nothing on screen may be idle for >2 s.
- Speed up scrolls and long renders 1.5–2×; never speed up the Approve click.
- On-screen text: one line at a time, high-contrast bar, ≥28 px, on screen ≥2.5 s.
- Optional VO only where a caption can't carry it; if in doubt, caption only.
- Criteria coverage check before export: A/B = WebMCP leverage · C = creativity ·
  D = leverage + execution · E = potential impact. If a clip serves no criterion, cut it.

## Redo rules

Each clip is independent except D. If D's chain breaks (wrong proposal, mis-click), reload and
re-record D only — state is in-memory, so a reload always gives a clean slate.
