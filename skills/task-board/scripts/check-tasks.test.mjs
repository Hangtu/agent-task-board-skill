// Run: node --test scripts/check-tasks.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  boardErrors,
  boardWarnings,
  checkTasks,
  MAX_NEXT_STEP_WORDS,
} from "./check-tasks.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-tasks.mjs");

function task(
  id,
  folder,
  {
    next = "Do the thing.",
    header = "",
    extra = "",
    checklist = "- [x] Done.",
  } = {},
) {
  const text = `# ${id} — Example

id: ${id}
updated: 2026-01-01
${header}
## Goal

A goal.

## Out of scope

- Nothing.

## Next step

${next}

## Checklist

${checklist}
${extra}`;
  return { id, folder, file: `${id}-example.md`, text };
}

const ctx = {
  repoPathExists: (p) => p === "src/a.ts",
  taskPathExists: (p) => p === "archive/old.md",
};
const check = (tasks) => checkTasks(tasks, ctx);
const has = (list, fragment) => list.some((m) => m.includes(fragment));
const words = (n) => "word ".repeat(n).trim();

describe("task shape", () => {
  it("accepts well-formed tasks in every folder", () => {
    const result = check([
      task("001", "active"),
      task("002", "backlog"),
      task("003", "completed"),
    ]);
    assert.deepEqual(result, { errors: [], warnings: [] });
  });

  it("requires Goal, Out of scope, Next step and Checklist", () => {
    const missing = task("001", "active");
    missing.text = missing.text.replace("## Out of scope\n\n- Nothing.\n", "");
    assert.ok(has(check([missing]).errors, 'section "Out of scope"'));
  });

  it("treats a section holding only a template comment as empty", () => {
    const t = task("001", "active", { next: "<!-- fill this in -->" });
    assert.ok(has(check([t]).errors, 'section "Next step"'));
  });

  it("requires the header id to match the file name", () => {
    const t = task("001", "active");
    t.text = t.text.replace("id: 001", "id: 002");
    assert.ok(has(check([t]).errors, 'expected one "id: 001"'));
  });

  it("rejects an id reused across folders", () => {
    const result = check([task("001", "active"), task("001", "completed")]);
    assert.ok(has(result.errors, "duplicate id 001"));
  });
});

describe("Next step limit", () => {
  it("accepts exactly the maximum", () => {
    const t = task("001", "active", { next: words(MAX_NEXT_STEP_WORDS) });
    assert.deepEqual(check([t]).errors, []);
  });

  it("rejects one word over and reports the count", () => {
    const t = task("001", "active", { next: words(MAX_NEXT_STEP_WORDS + 1) });
    assert.ok(has(check([t]).errors, "Next step is 81 words (max 80)"));
  });

  it("does not count words inside comments", () => {
    const t = task("001", "active", { next: `Short. <!-- ${words(200)} -->` });
    assert.deepEqual(check([t]).errors, []);
  });

  it("checks backlog tasks, which are resumed later", () => {
    const t = task("001", "backlog", { next: words(200) });
    assert.ok(has(check([t]).errors, "Next step is 200 words"));
  });

  it("exempts completed tasks, which are never resumed", () => {
    const t = task("001", "completed", { next: words(200) });
    assert.deepEqual(check([t]).errors, []);
  });
});

describe("blocked-by", () => {
  it("accepts an active blocker and raises no parallel-work warning", () => {
    const result = check([
      task("001", "active", { header: "blocked-by: 002" }),
      task("002", "active"),
    ]);
    assert.deepEqual(result, { errors: [], warnings: [] });
  });

  it("rejects a blocker that does not exist", () => {
    const t = task("001", "active", { header: "blocked-by: 009" });
    assert.ok(has(check([t]).errors, "blocked-by 009 is not an active task"));
  });

  it("rejects a blocker that is not active", () => {
    const result = check([
      task("001", "active", { header: "blocked-by: 002" }),
      task("002", "backlog"),
    ]);
    assert.ok(has(result.errors, "blocked-by 002 is not an active task"));
  });

  it("rejects a task blocked by itself", () => {
    const t = task("001", "active", { header: "blocked-by: 001" });
    assert.ok(has(check([t]).errors, "cannot reference itself"));
  });

  it("reports a cycle once", () => {
    const result = check([
      task("001", "active", { header: "blocked-by: 002" }),
      task("002", "active", { header: "blocked-by: 001" }),
    ]);
    assert.equal(result.errors.filter((e) => e.includes("cycle")).length, 1);
  });

  it("is only valid on active tasks", () => {
    const backlog = task("001", "backlog", { header: "blocked-by: 002" });
    const done = task("003", "completed", { header: "blocked-by: 002" });
    const errors = check([backlog, task("002", "active"), done]).errors;
    assert.equal(errors.filter((e) => e.includes("only valid")).length, 2);
  });

  it("rejects duplicate, malformed and body-level declarations", () => {
    const dup = task("001", "active", {
      header: "blocked-by: 002\nblocked-by: 003",
    });
    const bad = task("004", "active", { header: "blocked-by: 002, 003" });
    const body = task("005", "active", {
      extra: "\n## Notes\n\nblocked-by: 002\n",
    });
    for (const t of [dup, bad, body]) {
      assert.ok(has(check([t]).errors, 'one "blocked-by: NNN" line'), t.id);
    }
  });

  it("ignores an optional blocked-by inside a template comment", () => {
    const t = task("001", "active", {
      header: "<!-- Optional: blocked-by: NNN -->",
    });
    assert.deepEqual(check([t]).errors, []);
  });
});

describe("parallel work", () => {
  it("warns, but does not fail, on two runnable active tasks", () => {
    const result = check([task("001", "active"), task("002", "active")]);
    assert.deepEqual(result.errors, []);
    assert.ok(has(result.warnings, "Multiple runnable active tasks: 001, 002"));
  });
});

describe("Files and History", () => {
  const files = (list) => `\n## Files\n\n${list}\n`;

  it("accepts existing backticked repository paths", () => {
    const t = task("001", "active", { extra: files("- `src/a.ts` — why") });
    assert.deepEqual(check([t]).errors, []);
  });

  it("rejects missing paths, including the unreplaced template path", () => {
    for (const path of ["src/gone.ts", "path/to/existing-file", "../x"]) {
      const t = task("001", "active", { extra: files(`- \`${path}\``) });
      assert.ok(has(check([t]).errors, `does not exist: ${path}`), path);
    }
  });

  it("rejects a Files section with no backticked path", () => {
    const t = task("001", "active", { extra: files("- src/a.ts") });
    assert.ok(has(check([t]).errors, "needs backticked repository paths"));
  });

  it("does not require completed tasks to keep their Files current", () => {
    const t = task("001", "completed", { extra: files("- `src/gone.ts`") });
    assert.deepEqual(check([t]).errors, []);
  });

  it("requires History links to resolve, relative to the task file", () => {
    const ok = task("001", "completed", {
      extra: "\n## History\n\n- [old](../archive/old.md#top)\n",
    });
    const gone = task("002", "completed", {
      extra: "\n## History\n\n- [old](../archive/gone.md)\n",
    });
    const web = task("003", "completed", {
      extra: "\n## History\n\n- [docs](https://example.com/x)\n",
    });
    assert.deepEqual(check([ok, web]).errors, []);
    assert.ok(has(check([gone]).errors, "History link does not resolve"));
  });
});

describe("completed tasks", () => {
  it("rejects an unchecked item", () => {
    const t = task("001", "completed", { checklist: "- [ ] Not done." });
    assert.ok(has(check([t]).errors, "unchecked item"));
  });

  it("ignores unchecked items inside template comments", () => {
    const t = task("001", "completed", {
      extra: "\n<!--\n- [ ] sample item\n-->\n",
    });
    assert.deepEqual(check([t]).errors, []);
  });

  it("rejects a Discoveries section that was never routed", () => {
    const t = task("001", "completed", {
      extra: "\n## Discoveries\n\n- Something.\n",
    });
    assert.ok(has(check([t]).errors, "still has Discoveries"));
  });

  it("allows Discoveries while the task is still open", () => {
    const t = task("001", "active", {
      extra: "\n## Discoveries\n\n- Something.\n",
    });
    assert.deepEqual(check([t]).errors, []);
  });
});

describe("board", () => {
  const board = (focus, backlog) => `# Tasks

## Current focus

${focus}

## Backlog (in priority order)

${backlog}

## Icebox (not approved)

None.
`;
  const link = (path) => `- [Example](${path}) — next action.`;

  it("accepts a board that matches the folders", () => {
    const tasks = [task("001", "active"), task("002", "backlog")];
    const text = board(
      link("active/001-example.md"),
      link("backlog/002-example.md"),
    );
    assert.deepEqual(boardErrors(tasks, text), []);
  });

  it("requires None. for an empty section", () => {
    assert.deepEqual(boardErrors([], board("None.", "None.")), []);
    const errors = boardErrors([], board("Nothing yet", "None."));
    assert.ok(has(errors, "Current focus: write None."));
  });

  it("rejects a stale focus link after a task moves to completed", () => {
    const errors = boardErrors(
      [task("001", "completed")],
      board(link("active/001-example.md"), "None."),
    );
    assert.ok(has(errors, "not a current active task"));
  });

  it("rejects a backlog task missing from the board", () => {
    const errors = boardErrors(
      [task("002", "backlog")],
      board("None.", "None."),
    );
    assert.ok(has(errors, "missing task link backlog/002-example.md"));
  });

  it("rejects duplicate links and links that omit the folder", () => {
    const tasks = [task("002", "backlog")];
    const dup = link("backlog/002-example.md");
    assert.ok(
      has(
        boardErrors(tasks, board("None.", `${dup}\n${dup}`)),
        "duplicate link",
      ),
    );
    const bare = boardErrors(tasks, board("None.", link("002-example.md")));
    assert.ok(has(bare, "not a current backlog task"));
  });

  it("requires both sections", () => {
    const errors = boardErrors([], "# Tasks\n\n## Current focus\n\nNone.\n");
    assert.ok(has(errors, 'missing section "Backlog (in priority order)"'));
  });

  it("warns until the Workflow line links a real document", () => {
    const placeholder = "Workflow: <link to the project's workflow>";
    assert.equal(boardWarnings(placeholder).length, 1);
    assert.equal(boardWarnings("# Tasks").length, 1);
    assert.deepEqual(boardWarnings("Workflow: [AGENTS.md](../AGENTS.md)"), []);
  });
});

describe("command line", () => {
  const goodBoard = `# Tasks

## Current focus

- [Example](active/001-example.md) — next action.

## Backlog (in priority order)

None.

## Project configuration

Workflow: [AGENTS.md](../AGENTS.md)
`;
  const emptyBoard = goodBoard.replace(
    "- [Example](active/001-example.md) — next action.",
    "None.",
  );

  function withProject(files, fn) {
    const root = mkdtempSync(join(tmpdir(), "task-board-"));
    try {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      return fn(
        spawnSync(process.execPath, [SCRIPT, "--root", root], {
          encoding: "utf8",
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("exits 0 on a consistent board", () => {
    withProject(
      {
        "tasks/README.md": goodBoard,
        "tasks/active/001-example.md": task("001", "active").text,
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /1 task\(s\) checked: 0 error\(s\)/);
      },
    );
  });

  it("exits 1 and names the offending task", () => {
    withProject(
      {
        "tasks/README.md": goodBoard,
        "tasks/active/001-example.md": task("001", "active", {
          next: words(100),
        }).text,
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(
          r.stderr,
          /active\/001-example\.md: Next step is 100 words/,
        );
      },
    );
  });

  it("exits 0 with only warnings", () => {
    withProject(
      {
        "tasks/README.md": emptyBoard.replace(
          /Workflow:.*/,
          "Workflow: <link>",
        ),
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, /warn .*Workflow:/);
      },
    );
  });

  it("treats missing status folders as empty", () => {
    withProject({ "tasks/README.md": emptyBoard }, (r) =>
      assert.equal(r.status, 0, r.stderr),
    );
  });

  it("flags a misnamed task file instead of silently skipping it", () => {
    withProject(
      {
        "tasks/README.md": goodBoard,
        "tasks/active/001-example.md": task("001", "active").text,
        "tasks/backlog/notes.md": "# stray",
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(
          r.stderr,
          /backlog\/notes\.md: name task files NNN-short-title\.md/,
        );
      },
    );
  });

  it("fails clearly when there is no tasks directory", () => {
    withProject({ "other.txt": "x" }, (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /tasks directory not found/);
    });
  });
});
