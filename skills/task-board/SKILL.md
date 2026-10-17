---
name: task-board
description: File-based task tracking for a project. A tasks/ board with active, backlog and completed folders, one file per task, and a guard script that checks the board. Use when setting up task tracking in a new project, or when asked to create, resume, checkpoint, pause or close a task ("start task 004", "save progress", "what's next"). The chat is temporary; the task file is the memory.
argument-hint: "[setup | task id | new work request]"
---

# Task board

Work state lives in `tasks/`, not in the conversation. Any model, any
machine, any day: read the active task and know the goal, what is excluded and
the next action.

The rules live in the installed `tasks/README.md` (conventions) and
`tasks/TEMPLATE.md` (task shape). This skill adds setup and the start, end and
close procedures. Read `tasks/README.md` before touching a task.

## Setup (new project)

The files named below live in this skill's base directory (the path shown at
the top when the skill loads).

1. Copy `README.md` and `TEMPLATE.md` from the base directory into the
   project's `tasks/`. Create `active/`, `backlog/` and `completed/` when
   first needed.
2. Replace the `Workflow:` line in `tasks/README.md` with a link to the
   project's own workflow (validation commands, release rules, commit and
   staging rules). If the project has none, write a short one first.
3. Copy `scripts/check-tasks.mjs` from the base directory into the project's
   `scripts/` and add
   `node scripts/check-tasks.mjs` to its validation. Node 18+, no packages.
4. Add one line to the project's `AGENTS.md` or `CLAUDE.md`: task state lives
   in `tasks/`; follow the task-board skill.

## Start or resume

1. Read `tasks/README.md` and `git status`.
2. With a task id, find it across all three folders. Without one, resume the
   unblocked active task (a blocked parent: its active blocker first). With
   nothing active and no work request, show the backlog and wait. A backlog
   entry is not permission to start.
3. For new work, save the whole agreed plan before working: copy
   `TEMPLATE.md` to `NNN-short-title.md` using the next unused id across all
   folders, and delete placeholders and unused optional sections. Questions
   and isolated one-file fixes need no task.
4. Activate a backlog task by moving it to `active/` and updating the board in
   the same change. Follow the project's Workflow for git and staging.
5. Read Next step, Goal, Out of scope, the checklist and the files listed
   under Files. Verify saved claims against the code, then restate Goal, Out of
   scope and Next step and work within them. The user's latest instructions
   beat saved notes: update the task when direction changes.

## End a session

1. Checkpoint first (see Working conventions in the README), including Next
   step and any known blocker.
2. Run the checks the project's Workflow requires and record actual results in
   Validation: command, passed / failed / not run, reason. A failing check
   never skips the checkpoint.
3. If the goal or checks are incomplete, leave the task active. Ending a
   session does not complete a task.
4. Report what changed, validation results and remaining work.

## Close a task

Only when the goal is met, every checklist item is ticked, discoveries are
routed (backlog, icebox, or a logged dismissal; then remove the section) and
the required checks pass.

1. Set Next step to the outcome and record the validation evidence.
2. Move the file to `completed/`, remove `blocked-by` from its parent, and
   update the board and any links to the old path.
3. Run the guard. If it fails, fix the metadata or return the task to
   `active/` with the failure recorded.
4. Do not start another task automatically.

## The guard

```bash
node scripts/check-tasks.mjs                  # board in ./tasks
node scripts/check-tasks.mjs --tasks docs/tasks --root .
```

Errors exit 1: missing sections, duplicate ids, a `Next step` over 80 words,
bad or cyclic `blocked-by`, board links out of sync with folders, missing
`Files` or `History` targets, and completed tasks with open items or
Discoveries. Warnings print but pass: more than one runnable active task, and
an unlinked `Workflow:` line. It cannot tell whether a goal is actually met;
that stays the agent's job.

Its tests: `node --test scripts/check-tasks.test.mjs`.
