# agent-task-board-skill

A Claude Code plugin with one skill, `task-board`: file-based task tracking for
coding agents. The chat is temporary; the task file is the memory.

Work state lives in a `tasks/` folder in your repo, not in the conversation.
Any model, on any machine, on any day can read the active task and know the
goal, what is excluded and the next action.

## What you get

- **A board.** `tasks/README.md` indexes the work. The folder a task sits in is
  its status: `active/`, `backlog/` or `completed/`. There is no status field
  to drift out of sync.
- **A task shape.** `TEMPLATE.md`: Goal, Out of scope, a `Next step` capped at
  80 words, a checklist, validation results and a log. Out-of-scope findings go
  to `Discoveries` instead of becoming work.
- **Rituals.** Start or resume, checkpoint, end a session, close a task.
- **A guard.** `scripts/check-tasks.mjs` checks task shape, ids, blockers, board
  links and the `Next step` limit. Node 18+, no packages.

## Install

```text
/plugin marketplace add Hangtu/agent-task-board-skill
/plugin install task-board@agent-task-board-skill
```

## Use

In a project, ask Claude to set up the task board (or run `/task-board:task-board setup`).
The skill copies the board and template into `tasks/`, copies the guard into
`scripts/`, and asks you to link the project's own workflow (validation
commands, release rules, git rules) on the `Workflow:` line.

Then work by task id: "start task 004", "save progress", "close the task".

## The guard

```bash
node scripts/check-tasks.mjs                        # board in ./tasks
node scripts/check-tasks.mjs --tasks docs/tasks --root .
```

Errors exit 1: missing sections, duplicate ids, a `Next step` over 80 words, bad
or cyclic `blocked-by`, board links out of sync with folders, missing `Files` or
`History` targets, and completed tasks with open items or Discoveries.
Warnings print but pass: more than one runnable active task, and an unlinked
`Workflow:` line. It cannot tell whether a goal is actually met.

Its tests use Node's built-in runner:

```bash
node --test skills/task-board/scripts/check-tasks.test.mjs
```

## Layout

```text
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   makes this repo installable as a marketplace
skills/task-board/SKILL.md        the skill
skills/task-board/README.md       board conventions, copied into a project's tasks/
skills/task-board/TEMPLATE.md     task template, copied into a project's tasks/
skills/task-board/scripts/        the guard and its tests
```

## License

MIT
