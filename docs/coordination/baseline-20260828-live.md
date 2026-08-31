# Runcard live judge review — RC-20260828-02

Started 2026-08-29T01:36:07Z (August 28 local). Target:
https://runcard.vercel.app/. Browser: Codex built-in browser. Reported served
asset `/assets/index-BxDmbpZd.js`; repository revision f39c348. This is evidence
from the deployed page and WebMCP capability, not localhost.

## Verified so far

- First-minute header registration, ten-tool discovery, and list_runs all pass.
- Product validation passes. explain_result begins with a self-contained brief
  giving the value, method/sample size, uncertainty to quote, drift evidence,
  run-to-run context, and the narrow sign claim supported.
- Pending proposal pmtdpo017 visibly changes product dt to 0.001 and remains
  pending for the human. Before/after validation both pass. No agent approval.
- Tool Calls gives readable natural summaries for all calls made so far.
- Missing-run WebMCP and URL behavior correctly explain the live 404 and recover.
- Home, run, and compare have no document-level horizontal overflow at 390px.

## Presentation notes, not dispatched failures

- The narrow compare table avoids page overflow but breaks identifiers and the
  “sampling length” badge across several short lines. It remains usable, though
  a mobile-specific row/card presentation would scan better for judges.
- The explanation brief directly answers “what is ΔG and how much should I trust
  it?” The ending “the sign is robust, the second decimal is not” is clear.

## Pending checkpoint

The user approved proposal pmtdpo017. The live tool generated ten files with
applied_proposals=[pmtdpo017], and final Tool Calls summaries were readable with a
clean console. Browser automation could not save the ZIP, so the user downloaded
it manually. Read-only ZIP inspection verified all ten entries, clean CRC,
md/product.in dt=0.001 and pinned ig=702337. Existing older ZIPs were not reused
as evidence and were not deleted. Batch complete with no verified failures and
zero fix rounds dispatched.
