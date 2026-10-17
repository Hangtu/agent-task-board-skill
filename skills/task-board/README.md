# Tasks

This board is an index. Each task holds the current state needed to resume;
Git and linked archives preserve history.

## Current focus

None.

## Backlog (in priority order)

None.

## Icebox (not approved)

None.

## Structure

```text
tasks/
  README.md
  TEMPLATE.md
  active/       # Current work; create when needed
  backlog/      # Approved work waiting to start
  completed/    # Goal met and required validation passed
  archive/      # Historical detail; create when needed
```

The folder is the status. Do not duplicate it in a task header.
Use `NNN-short-title.md` with an unused id across all task folders.
Start from [TEMPLATE.md](TEMPLATE.md).

## Board conventions

- List every active and backlog task once in its matching section, using a
  relative Markdown link. Update links whenever a task moves.
- Keep entries to a title and one short sentence about the next action or
  blocker. Completed-task summaries belong in their task files.
- Backlog means approved scope, not permission to start automatically.
- Icebox entries record an idea, its source and enough context to revisit it.
  They do not authorize implementation.
- Write `None.` when a section has no entries.
- Run the guard, `node scripts/check-tasks.mjs`, after every checkpoint and
  every move. It checks task shape, ids, blockers, board links and the
  `Next step` limit; it cannot tell whether a goal is actually met.

## Working conventions

- Default to one runnable task. Record an external wait in `Next step`;
  use optional `blocked-by: NNN` only for another active task. Dependencies
  must exist and must not form a cycle.
- Before implementation, save the whole agreed plan. On resume, read the
  current state and relevant files, verify saved claims against the code, and
  restate Goal, Out of scope and Next step before acting.
- Checkpoint after decisions, meaningful progress and failed attempts, and
  before ending a session. Update the date, next action and checklist first;
  then record actual validation results, including failures and unrun checks.
- Keep `Next step` to one action, its blocker if any, and its completion
  condition, in at most 80 words (the guard fails longer ones). Keep history
  out of this section.
- Keep current decisions, useful failed approaches and relevant evidence in
  the task. Move lengthy historical detail to a linked archive when needed;
  preserve enough context to resume without reading that archive.
- Record out-of-scope findings under `Discoveries`. Before closing, route
  them to approved backlog, the icebox, or a logged dismissal with a reason.
- When a blocker closes, remove the parent's `blocked-by` and resume the
  parent's saved Next step.
- When the user switches to unrelated work, checkpoint the current task and
  move it to backlog before activating the new one. Park a blocker chain
  together and note its ids in the Log.
- Close only when the goal, checklist and the project's required checks are
  satisfied. Update the board and verify links after moving the file.
  Do not reopen a completed task: follow-up work gets a new id and links back.

## Project configuration

Workflow: <link to the project's authoritative workflow>

That workflow defines validation commands, release requirements, permissions
and any overrides to the defaults above. Do not duplicate those rules in each
task. This scaffold does not replace an existing workflow.
