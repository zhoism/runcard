# Codex ↔ Claude handoff

This is a local, file-based review → fix → retest workflow. It is not part of
the website. Project AGENTS.md/CLAUDE.md and direct user instructions take
precedence. Setup is authorized; website testing has NOT been started.

## Ownership

- Codex owns `codex.md`: test requests, evidence, batch state, and retest results.
- Claude owns `claude.md`: readiness, claimed files, implementation replies,
  verification evidence, and its scheduler ID. Codex created its initial template
  only; subsequent writes belong to Claude.
- Claude is the default source-code writer; Codex is the browser/tool tester.
  Codex must obtain an explicit handoff before editing source files during a batch.
- Neither agent may revert the other's changes. Inspect current diffs before edits.
  A claimed file is a coordination convention, not a filesystem lock. If ownership
  conflicts or unrelated work changes the tested version, stop and reconcile.

## Setup and start gate

1. Claude reads this file and both mailboxes, acknowledges `SETUP-001`, records
   its current work/claimed files, and marks its readiness in `claude.md`.
2. Claude schedules ONE check every 10 minutes in its existing session, using the
   prompt below; reuse an existing matching task instead of creating duplicates.
   Record the returned scheduler ID and actual cadence in `claude.md`.
3. Codex has a matching follow-up attached to its existing task; its ID and actual
   cadence are recorded in `codex.md` after creation succeeds.
4. `mode: awaiting_start` permits mailbox setup/acknowledgment ONLY. No website
   tests, proposals, fixes, or source edits are authorized by setup.
   `mode: paused` is a stopped workflow: do not schedule or continue polling
   until the user resumes it. `mode: complete` also stops polling. Neither state
   authorizes source edits; missing or unrecognized modes must fail closed.
5. The user must tell Codex to start testing. Codex then records the authorization,
   sets `mode: active`, creates a batch ID, and sets an absolute UTC expiry at most
   two hours away. Claude's readiness is also required before a fix is dispatched.
   A reply from Claude is not a substitute for the user's start authorization.

## Batch protocol

Codex assigns stable issue IDs (for example `RC-001`) and identifies the tested
URL, timestamp, and revision/build when available. Never pretend a local build
is the live deployment, or that source inspection is a browser test.

Each request includes: issue ID, round (1–3), severity, reproduction steps/tool
arguments, expected/actual behavior, evidence, allowed scope, and acceptance check.
The status is `ready_for_claude` only after the request is complete. Label ideas
and untested suspicions explicitly; do not dispatch them as verified failures.

Claude processes each (batch ID, issue ID, round) once, claims only the necessary
files before editing, and replies with the same identifiers. Include changed
files, commands actually executed with outcomes, test target/build, and remaining
limitations. Use `ready_for_retest`, `disputed`, or `blocked`; never self-certify a
browser retest. Release claims when finished.

Codex retests only a matching `ready_for_retest` reply after files are stable,
then records `verified`, `still_failing`, or `blocked` with fresh evidence.
For a failure, publish the next round explicitly; Claude must not retry an old
request without a new round. At most THREE fix/retest rounds per batch, with
rounds counted across the batch, not reset for each new issue. New scope requires
the user to approve another batch. No overlapping batches or extra agent sessions.

No automatic commits, pushes, deployments, dependency installations, scientific
rule changes, or changes to permissions/configuration. The website's Approve
button remains human-controlled. Do not approve a proposal on the user's behalf.
If the browser or WebMCP tools are unavailable, report that blocker; do not replace
the test with a source-code call and describe it as end-to-end verification.

## Stop conditions and idle behavior

- Poll mailboxes once per wakeup, not in a busy loop. If no new actionable message
  exists, do not rewrite files, invent work, or repeat reports.
- Stop on completion, three rounds, either agent's blocker/disagreement, missing
  approval, the user saying stop, or the absolute expiry in `codex.md`.
- On a stop, Codex marks the batch `paused` or `complete` and pauses its matching
  automation. Claude cancels only its matching coordination task and records this.
  Exception requested by the user on 2026-08-28: Codex has a pending reminder to
  revoke Full Access at 2026-08-29 09:00 America/New_York. Only one active heartbeat
  is allowed per Codex task, so at batch stop Codex must repurpose its existing
  heartbeat into that one-time reminder (not continue test polling). Claude still
  cancels its own loop normally. The reminder does not reopen the testing gate.
- Setup polling expires one hour after creation or a user-requested setup resume unless the user authorizes a
  batch. This prevents forgotten idle polling from continuing indefinitely.
- A timer cannot interrupt a running edit. Finish the smallest safe operation,
  preserve work, then stop. Check gates again before any new action.
- To restart, the user asks both agents to resume; do not silently extend expiry
  or reset the round budget. Retain prior exchanges rather than replacing history.

## Claude scheduling prompt

Use this explicit prompt (not a bare `/loop`, which has broader default behavior):

> Read docs/coordination/README.md, codex.md, and claude.md from this repository.
> Follow the setup gate, ownership, message IDs, expiry, and three-round limit.
> Acknowledge SETUP-001 once in claude.md and record readiness/current file claims.
> While mode is awaiting_start, do not test or change source code for this workflow.
> While mode is paused or complete, stop/cancel this coordination task. Treat an
> unknown mode as blocked. Waiting for the initial start in awaiting_start is
> expected and is not itself a missing-approval blocker before the stated expiry.
> When mode is active, handle only a new ready_for_claude request within its stated
> scope; write evidence and a matching ready_for_retest, disputed, or blocked reply
> in claude.md. Never edit codex.md. If unchanged, do nothing. At expiry or any stop
> condition, cancel this coordination task only and record that you stopped.

## Runtime notes

Keep the machine and Codex app running, and the existing Claude session open.
Schedules are approximate, not instant messaging. Each wakeup may use model quota.
No CLI bridge, terminal injection, or permission bypass is used.

References: [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app)
and [Claude session scheduling](https://code.claude.com/docs/en/scheduled-tasks).
