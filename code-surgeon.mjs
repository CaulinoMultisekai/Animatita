#!/usr/bin/env node
/**
 * code-surgeon.mjs
 *
 * Single-file Node.js utility for applying machine-readable code surgery plans.
 *
 * Works well for Vite + Node projects.
 *
 * Usage:
 *   node code-surgeon.mjs --plan surgery.json --root .
 *   node code-surgeon.mjs --plan surgery.json --root . --apply
 *   cat surgery.json | node code-surgeon.mjs --root . --apply
 *
 * Default mode is dry-run. Nothing is written unless --apply is passed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const VERSION = "1.1.0";

function help() {
    console.log(`
code-surgeon.mjs v${VERSION}

Usage:
  node code-surgeon.mjs --plan surgery.json --root .
  node code-surgeon.mjs --plan surgery.json --root . --apply
  cat surgery.json | node code-surgeon.mjs --root . --apply

Options:
  --plan <file>     JSON plan file.
  --root <dir>      Repository root. Default: current working directory.
  --apply           Actually write changes. Without this, dry-run is used.
  --dry-run         Force dry-run mode.
  --no-backup       Disable backups.
  --help            Show help.

Supported operations:
  replace
  insert_before
  insert_after
  delete
  create_file
  append
  prepend
  ensure_import
`.trim());
}

function parseArgs(argv) {
    const args = {
        plan: null,
        root: process.cwd(),
        apply: false,
        dryRun: false,
        backup: true,
        help: false
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") args.help = true;
        else if (arg === "--apply") args.apply = true;
        else if (arg === "--dry-run") args.dryRun = true;
        else if (arg === "--no-backup") args.backup = false;
        else if (arg === "--plan") {
            args.plan = argv[++i];
            if (!args.plan) throw new Error("--plan requires a file path.");
        } else if (arg === "--root") {
            args.root = argv[++i];
            if (!args.root) throw new Error("--root requires a directory path.");
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => data += chunk);
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}

function normalizeNewlines(value) {
    return String(value ?? "").replace(/\r\n/g, "\n");
}

function hash(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function assertSafeRelativePath(file) {
    if (!file || typeof file !== "string") {
        throw new Error("file must be a non-empty string.");
    }

    if (path.isAbsolute(file)) {
        throw new Error(`Absolute paths are not allowed: ${file}`);
    }

    const normalized = path.normalize(file);

    if (
        normalized === ".." ||
        normalized.startsWith(`..${path.sep}`) ||
        normalized.includes(`${path.sep}..${path.sep}`)
    ) {
        throw new Error(`Path traversal is not allowed: ${file}`);
    }

    return normalized;
}

function resolveInsideRoot(root, file) {
    const safe = assertSafeRelativePath(file);
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, safe);

    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Resolved path escapes root: ${file}`);
    }

    return target;
}

function ensureParent(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function findAll(content, anchor) {
    anchor = normalizeNewlines(anchor);

    if (!anchor) {
        throw new Error("find anchor cannot be empty.");
    }

    const positions = [];
    let index = 0;

    while (true) {
        const found = content.indexOf(anchor, index);
        if (found === -1) break;
        positions.push(found);
        index = found + anchor.length;
    }

    return positions;
}

function selectMatches(content, anchor, occurrence = "unique") {
    const matches = findAll(content, anchor);

    if (matches.length === 0) {
        throw new Error("find anchor was not found.");
    }

    if (occurrence === "unique" || occurrence === null || occurrence === undefined) {
        if (matches.length !== 1) {
            throw new Error(`Expected unique match, found ${matches.length}.`);
        }
        return matches;
    }

    if (occurrence === "all") {
        return matches;
    }

    const num = Number(occurrence);
    if (Number.isInteger(num) && num >= 1 && num <= matches.length) {
        return [matches[num - 1]];
    }

    throw new Error(`Invalid occurrence value: ${occurrence}`);
}

function getLineOffsets(content, lineStart, lineEnd) {
    if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) {
        throw new Error("line_start and line_end must be integers.");
    }

    if (lineStart < 1 || lineEnd < lineStart) {
        throw new Error("Invalid line range. Use 1-based lines.");
    }

    const lines = content.split("\n");

    if (lineEnd > lines.length) {
        throw new Error(`Line range exceeds file length. File has ${lines.length} lines.`);
    }

    let start = 0;
    for (let i = 0; i < lineStart - 1; i++) {
        start += lines[i].length + 1;
    }

    let end = start;
    for (let i = lineStart - 1; i < lineEnd; i++) {
        end += lines[i].length;
        if (i < lineEnd - 1) end += 1;
    }

    return { start, end };
}

function replaceMatches(content, anchor, replacement, occurrence) {
    anchor = normalizeNewlines(anchor);
    replacement = normalizeNewlines(replacement);

    const positions = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const pos of [...positions].reverse()) {
        output = output.slice(0, pos) + replacement + output.slice(pos + anchor.length);
    }

    return output;
}

function insertMatches(content, anchor, insertion, occurrence, mode) {
    anchor = normalizeNewlines(anchor);
    insertion = normalizeNewlines(insertion);

    const positions = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const pos of [...positions].reverse()) {
        const insertAt = mode === "before" ? pos : pos + anchor.length;
        output = output.slice(0, insertAt) + insertion + output.slice(insertAt);
    }

    return output;
}

function deleteMatches(content, anchor, occurrence) {
    anchor = normalizeNewlines(anchor);

    const positions = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const pos of [...positions].reverse()) {
        output = output.slice(0, pos) + output.slice(pos + anchor.length);
    }

    return output;
}

function ensureImport(content, edit) {
    const statement = normalizeNewlines(edit.import_statement ?? edit.content);

    if (!statement.trim()) {
        throw new Error("ensure_import requires import_statement or content.");
    }

    if (content.includes(statement)) {
        return content;
    }

    const lines = content.split("\n");
    let lastImportLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (
            trimmed.startsWith("import ") ||
            trimmed.startsWith("import{") ||
            (trimmed.startsWith("const ") && trimmed.includes("require(")) ||
            (trimmed.startsWith("let ") && trimmed.includes("require(")) ||
            (trimmed.startsWith("var ") && trimmed.includes("require("))
        ) {
            lastImportLine = i;
        }
    }

    if (lastImportLine >= 0) {
        lines.splice(lastImportLine + 1, 0, statement);
        return lines.join("\n");
    }

    return statement + "\n" + content;
}

function applyEdit(content, edit) {
    switch (edit.operation) {
        case "replace": {
            if (typeof edit.find === "string") {
                return replaceMatches(content, edit.find, edit.replace_with, edit.occurrence);
            }

            const range = getLineOffsets(content, edit.line_start, edit.line_end);
            return content.slice(0, range.start) + normalizeNewlines(edit.replace_with) + content.slice(range.end);
        }

        case "insert_before":
            return insertMatches(content, edit.find, edit.insert ?? edit.content, edit.occurrence, "before");

        case "insert_after":
            return insertMatches(content, edit.find, edit.insert ?? edit.content, edit.occurrence, "after");

        case "delete": {
            if (typeof edit.find === "string") {
                return deleteMatches(content, edit.find, edit.occurrence);
            }

            const range = getLineOffsets(content, edit.line_start, edit.line_end);
            return content.slice(0, range.start) + content.slice(range.end);
        }

        case "append":
            return content + normalizeNewlines(edit.content ?? edit.insert);

        case "prepend":
            return normalizeNewlines(edit.content ?? edit.insert) + content;

        case "ensure_import":
            return ensureImport(content, edit);

        default:
            throw new Error(`Unsupported operation: ${edit.operation}`);
    }
}

function backupFile(root, file, content) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(root, ".code-surgery-backups", stamp, assertSafeRelativePath(file));
    ensureParent(backupPath);
    fs.writeFileSync(backupPath, content, "utf8");
    return path.relative(root, backupPath);
}

function validatePlan(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
        throw new Error("Plan must be a JSON object.");
    }

    if (!Array.isArray(plan.edits)) {
        throw new Error("Plan must contain edits array.");
    }

    for (let i = 0; i < plan.edits.length; i++) {
        const edit = plan.edits[i];

        if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
            throw new Error(`Edit ${i} must be an object.`);
        }

        if (!edit.operation) {
            throw new Error(`Edit ${i} is missing operation.`);
        }

        if (!edit.file) {
            throw new Error(`Edit ${i} is missing file.`);
        }
    }
}

function runValidation(root, commands) {
    const results = [];

    for (const command of commands) {
        const result = spawnSync(command, {
            cwd: root,
            shell: true,
            encoding: "utf8",
            stdio: "pipe"
        });

        results.push({
            command,
            exit_code: result.status,
            stdout: result.stdout,
            stderr: result.stderr
        });

        if (result.status !== 0) {
            return { ok: false, results };
        }
    }

    return { ok: true, results };
}

function applyPlan(plan, options) {
    validatePlan(plan);

    const root = path.resolve(options.root);
    const dryRun = options.dryRun || !options.apply || plan.dry_run === true;
    const shouldBackup = options.backup && plan.backup !== false;
    const stopOnError = plan.stop_on_error !== false;

    const report = {
        ok: true,
        version: VERSION,
        root,
        dry_run: dryRun,
        changed: [],
        failed: [],
        validation: null
    };

    for (let i = 0; i < plan.edits.length; i++) {
        const edit = plan.edits[i];
        const id = edit.id ?? `E${String(i + 1).padStart(3, "0")}`;
        const file = assertSafeRelativePath(edit.file);
        const target = resolveInsideRoot(root, file);

        try {
            let before = fs.existsSync(target) ? normalizeNewlines(fs.readFileSync(target, "utf8")) : null;
            let after;

            if (edit.operation === "create_file") {
                if (before !== null && edit.overwrite !== true) {
                    throw new Error("File already exists. Set overwrite=true to replace it.");
                }

                after = normalizeNewlines(edit.content);
            } else {
                if (before === null) {
                    throw new Error("Target file does not exist.");
                }

                if (edit.expected_sha256 && hash(before) !== edit.expected_sha256) {
                    throw new Error("expected_sha256 mismatch.");
                }

                after = applyEdit(before, edit);
            }

            if (before === after) {
                report.changed.push({
                    id,
                    file,
                    operation: edit.operation,
                    status: "unchanged"
                });
                continue;
            }

            let backup_path = null;

            if (!dryRun) {
                if (shouldBackup && before !== null) {
                    backup_path = backupFile(root, file, before);
                }

                ensureParent(target);
                fs.writeFileSync(target, after, "utf8");
            }

            report.changed.push({
                id,
                file,
                operation: edit.operation,
                status: dryRun ? "dry_run_changed" : "changed",
                before_sha256: before === null ? null : hash(before),
                after_sha256: hash(after),
                backup_path
            });
        } catch (error) {
            report.ok = false;
            report.failed.push({
                id,
                file,
                operation: edit.operation,
                error: error.message
            });

            if (stopOnError) {
                break;
            }
        }
    }

    const commands = plan.validation?.commands;

    if (!dryRun && report.failed.length === 0 && Array.isArray(commands) && commands.length > 0) {
        report.validation = runValidation(root, commands);

        if (!report.validation.ok) {
            report.ok = false;
        }
    }

    return report;
}

async function main() {
    try {
        const args = parseArgs(process.argv);

        if (args.help) {
            help();
            process.exit(0);
        }

        let rawPlan;

        if (args.plan) {
            rawPlan = fs.readFileSync(path.resolve(args.plan), "utf8");
        } else {
            rawPlan = await readStdin();
        }

        if (!rawPlan.trim()) {
            throw new Error("No plan provided. Use --plan file.json or pipe JSON through stdin.");
        }

        const plan = JSON.parse(rawPlan);

        const report = applyPlan(plan, {
            root: args.root,
            apply: args.apply,
            dryRun: args.dryRun,
            backup: args.backup
        });

        console.log(JSON.stringify(report, null, 2));

        process.exit(report.ok ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            error: error.message
        }, null, 2));

        process.exit(1);
    }
}

main();
