#!/usr/bin/env node
// Guard for the file-based task board. Zero dependencies (Node >= 18).
//
//   node scripts/check-tasks.mjs [--root <repo>] [--tasks <dir>]
//
// Errors fail the run (exit 1). Warnings print but never fail it.
// Rules live in the board README; this file only enforces them.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_NEXT_STEP_WORDS = 80;
export const TASK_FILE = /^(\d{3})-[a-z0-9-]+\.md$/;
export const FOLDERS = ["active", "backlog", "completed"];
const REQUIRED_SECTIONS = ["Goal", "Out of scope", "Next step", "Checklist"];
const MARKDOWN_LINK = /\[[^\]\r\n]+\]\(([^)\s]+)\)/g;

const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");
const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

/** Text under a `## name` heading, including its `###` subsections. */
function section(text, name) {
  const headings = [...text.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)];
  const index = headings.findIndex((h) => h[1].trim() === name);
  if (index === -1) return undefined;
  const heading = headings[index];
  return text.slice(
    heading.index + heading[0].length,
    headings[index + 1]?.index,
  );
}

/**
 * Pure checks over parsed task files, so tests can run them in memory.
 * tasks: [{ id, folder, file, text }]
 * ctx.repoPathExists(path): repo-relative path exists
 * ctx.taskPathExists(path): path relative to the tasks directory exists
 */
export function checkTasks(tasks, { repoPathExists, taskPathExists }) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const active = tasks.filter((t) => t.folder === "active");
  const activeIds = new Set(active.map((t) => t.id));
  const blockers = new Map();

  for (const task of tasks) {
    const label = `${task.folder}/${task.file}`;
    // Template instructions live in comments; they must not satisfy a check.
    const body = stripComments(task.text);
    const header = body.split(/^##[ \t]+/m)[0];

    const ids = [...header.matchAll(/^id:[ \t]*(\d{3})[ \t]*\r?$/gm)];
    if (ids.length !== 1 || ids[0][1] !== task.id) {
      errors.push(`${label}: expected one "id: ${task.id}" line in the header`);
    }
    if (seen.has(task.id)) errors.push(`${label}: duplicate id ${task.id}`);
    seen.add(task.id);

    for (const name of REQUIRED_SECTIONS) {
      if (!section(body, name)?.trim()) {
        errors.push(`${label}: missing or empty section "${name}"`);
      }
    }

    // A resumable task is read on every start; a completed one is not.
    if (task.folder !== "completed") {
      const words = countWords(section(body, "Next step") ?? "");
      if (words > MAX_NEXT_STEP_WORDS) {
        errors.push(
          `${label}: Next step is ${words} words (max ${MAX_NEXT_STEP_WORDS}); move history to Log`,
        );
      }
    }

    const deps = [...body.matchAll(/^blocked-by:[^\r\n]*$/gm)];
    if (deps.length > 0) {
      const match = /^blocked-by:[ \t]*(\d{3})[ \t]*$/.exec(deps[0][0]);
      if (deps.length !== 1 || !match || deps[0].index >= header.length) {
        errors.push(
          `${label}: blocked-by must be one "blocked-by: NNN" line in the header`,
        );
      } else if (task.folder !== "active") {
        errors.push(`${label}: blocked-by is only valid on active tasks`);
      } else if (match[1] === task.id) {
        errors.push(`${label}: blocked-by cannot reference itself`);
      } else if (!activeIds.has(match[1])) {
        errors.push(`${label}: blocked-by ${match[1]} is not an active task`);
      } else {
        blockers.set(task.id, match[1]);
      }
    }

    // Completed tasks are historical snapshots: source files may move later.
    const files = section(body, "Files");
    if (files !== undefined && task.folder !== "completed") {
      const paths = [...files.matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]);
      if (paths.length === 0) {
        errors.push(`${label}: Files needs backticked repository paths`);
      }
      for (const path of paths) {
        if (
          path.startsWith("/") ||
          path.split("/").includes("..") ||
          !repoPathExists(path)
        ) {
          errors.push(`${label}: Files path does not exist: ${path}`);
        }
      }
    }

    // An archive link that does not resolve is lost history.
    const history = section(body, "History");
    if (history !== undefined) {
      for (const [, href] of history.matchAll(MARKDOWN_LINK)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
        const target = posix.normalize(
          posix.join(task.folder, href.split("#")[0]),
        );
        if (!taskPathExists(target)) {
          errors.push(`${label}: History link does not resolve: ${href}`);
        }
      }
    }

    if (task.folder === "completed") {
      if (/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \]/m.test(body)) {
        errors.push(`${label}: completed task has an unchecked item`);
      }
      if (section(body, "Discoveries") !== undefined) {
        errors.push(`${label}: completed task still has Discoveries`);
      }
    }
  }

  const unblocked = active.filter((t) => !blockers.has(t.id));
  if (unblocked.length > 1) {
    warnings.push(
      `Multiple runnable active tasks: ${unblocked.map((t) => t.id).join(", ")} (default is one)`,
    );
  }

  const reported = new Set();
  for (const task of active) {
    if (reported.has(task.id)) continue;
    const visited = new Set();
    let id = task.id;
    while (id !== undefined) {
      if (visited.has(id)) {
        for (const v of visited) reported.add(v);
        errors.push(`active/${task.file}: blocked-by cycle involving ${id}`);
        break;
      }
      visited.add(id);
      id = blockers.get(id);
    }
  }
  return { errors, warnings };
}

/** Board links encode the exact folder, not merely the task's basename. */
export function boardErrors(tasks, rawBoard) {
  const board = stripComments(rawBoard);
  const errors = [];
  for (const [name, folder] of [
    ["Current focus", "active"],
    ["Backlog (in priority order)", "backlog"],
  ]) {
    const text = section(board, name);
    if (text === undefined) {
      errors.push(`Board is missing section "${name}"`);
      continue;
    }
    const expected = new Set(
      tasks
        .filter((t) => t.folder === folder)
        .map((t) => `${folder}/${t.file}`),
    );
    const listed = new Set();
    for (const [, path] of text.matchAll(MARKDOWN_LINK)) {
      if (listed.has(path)) errors.push(`${name}: duplicate link ${path}`);
      if (!expected.has(path)) {
        errors.push(`${name}: link is not a current ${folder} task: ${path}`);
      }
      listed.add(path);
    }
    for (const path of expected) {
      if (!listed.has(path)) errors.push(`${name}: missing task link ${path}`);
    }
    if (expected.size === 0 && !/^[ \t]*None\.?[ \t]*$/m.test(text)) {
      errors.push(`${name}: write None. when the folder is empty`);
    }
  }
  return errors;
}

/** The board defers to the project's workflow; an unfilled slot is a to-do. */
export function boardWarnings(rawBoard) {
  const board = stripComments(rawBoard);
  return /^Workflow:.*\[[^\]]+\]\([^)]+\)/m.test(board)
    ? []
    : ["Board: link the project's workflow on the `Workflow:` line"];
}

/** Read the three status folders. Missing folders count as empty. */
export function loadTasks(tasksDir) {
  const tasks = [];
  const errors = [];
  for (const folder of FOLDERS) {
    const dir = join(tasksDir, folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".md")) continue;
      const match = TASK_FILE.exec(file);
      if (!match) {
        errors.push(`${folder}/${file}: name task files NNN-short-title.md`);
        continue;
      }
      const text = readFileSync(join(dir, file), "utf8");
      tasks.push({ id: match[1], folder, file, text });
    }
  }
  return { tasks, errors };
}

export function run({ root, tasksDir }) {
  if (!existsSync(tasksDir)) {
    return {
      errors: [`tasks directory not found: ${tasksDir}`],
      warnings: [],
      count: 0,
    };
  }
  const loaded = loadTasks(tasksDir);
  const result = checkTasks(loaded.tasks, {
    repoPathExists: (p) => existsSync(resolve(root, p)),
    taskPathExists: (p) => existsSync(resolve(tasksDir, p)),
  });
  const errors = [...loaded.errors, ...result.errors];
  const warnings = [...result.warnings];

  const boardPath = join(tasksDir, "README.md");
  if (existsSync(boardPath)) {
    const board = readFileSync(boardPath, "utf8");
    errors.push(...boardErrors(loaded.tasks, board));
    warnings.push(...boardWarnings(board));
  } else {
    errors.push("README.md (the board) is missing");
  }
  return { errors, warnings, count: loaded.tasks.length };
}

function main() {
  const flag = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const root = resolve(flag("--root", process.cwd()));
  const tasksDir = resolve(root, flag("--tasks", "tasks"));
  const { errors, warnings, count } = run({ root, tasksDir });

  for (const w of warnings) console.warn(`warn   ${w}`);
  for (const e of errors) console.error(`error  ${e}`);
  console.log(
    `${count} task(s) checked: ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
