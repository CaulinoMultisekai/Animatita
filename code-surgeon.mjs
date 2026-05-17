#!/usr/bin/env node
/**
 * code-surgeon.mjs
 *
 * Single-file Node.js utility for applying machine-readable code surgery plans.
 * Optimized with a clean, unified left-to-right web interface workflow!
 *
 * Usage:
 *   node code-surgeon.mjs --plan surgery.json --root .
 *   node code-surgeon.mjs --plan surgery.json --root . --apply
 *   cat surgery.json | node code-surgeon.mjs --root . --apply
 *   node code-surgeon.mjs --web [--port 3333]
 *
 * Default mode is dry-run. Nothing is written unless --apply is passed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import url from "node:url";
import { spawnSync, spawn } from "node:child_process";

const VERSION = "1.3.0";

function help() {
    console.log(`
code-surgeon.mjs v${VERSION}

Usage:
  node code-surgeon.mjs --plan surgery.json --root .
  node code-surgeon.mjs --plan surgery.json --root . --apply
  cat surgery.json | node code-surgeon.mjs --root . --apply
  node code-surgeon.mjs --web [--port 3333] [--root .]

Options:
  --plan <file>     JSON plan file.
  --root <dir>      Repository root. Default: current working directory.
  --apply           Actually write changes. Without this, dry-run is used.
  --dry-run         Force dry-run mode.
  --no-backup       Disable backups.
  --web             Start the visual web interface in the browser.
  --port <number>   Port for the web server (default: 3333).
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
        help: false,
        web: false,
        port: 3333
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") args.help = true;
        else if (arg === "--apply") args.apply = true;
        else if (arg === "--dry-run") args.dryRun = true;
        else if (arg === "--no-backup") args.backup = false;
        else if (arg === "--web") args.web = true;
        else if (arg === "--port") {
            args.port = parseInt(argv[++i], 10);
            if (isNaN(args.port)) throw new Error("--port requires a number.");
        } else if (arg === "--plan") {
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

    let normalized = String(file)
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "");

    if (/^[a-zA-Z]:\//.test(normalized)) {
        throw new Error(`Windows absolute paths are not allowed: ${file}`);
    }

    const parts = normalized.split("/").filter(Boolean);

    if (parts.length === 0) {
        throw new Error("file must resolve to a non-empty relative path.");
    }

    if (parts.includes("..")) {
        throw new Error(`Path traversal is not allowed: ${file}`);
    }

    return parts.join("/");
}

function listProjectFilePaths(root) {
    const resolvedRoot = path.resolve(root);
    const ignored = new Set([
        "node_modules",
        ".git",
        "dist",
        "build",
        ".vite",
        ".next",
        ".nuxt",
        "coverage",
        ".code-surgery-backups"
    ]);

    const files = [];

    function walk(dir) {
        let entries;

        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (ignored.has(entry.name)) continue;

            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                files.push(path.relative(resolvedRoot, full).replace(/\\/g, "/"));
            }
        }
    }

    walk(resolvedRoot);
    return files;
}

function resolveInsideRoot(root, file) {
    const safe = assertSafeRelativePath(file);
    const resolvedRoot = path.resolve(root);
    const directTarget = path.resolve(resolvedRoot, safe);

    if (directTarget !== resolvedRoot && !directTarget.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Resolved path escapes root: ${file}`);
    }

    if (fs.existsSync(directTarget)) {
        return directTarget;
    }

    const projectFiles = listProjectFilePaths(resolvedRoot);
    const safeParts = safe.split("/");
    const ambiguousMatches = [];

    for (let i = 0; i < safeParts.length; i++) {
        const suffix = safeParts.slice(i).join("/");
        if (!suffix) continue;

        const matches = projectFiles.filter(projectFile => {
            return projectFile === suffix || projectFile.endsWith("/" + suffix);
        });

        if (matches.length === 1) {
            return path.resolve(resolvedRoot, matches[0]);
        }

        if (matches.length > 1) {
            ambiguousMatches.push({ suffix, matches });
        }
    }

    if (ambiguousMatches.length > 0) {
        throw new Error(
            `Ambiguous generated path "${file}". Multiple local files match suffix "${ambiguousMatches[0].suffix}": ` +
            JSON.stringify(ambiguousMatches[0].matches)
        );
    }

    return directTarget;
}

function toProjectRelativePath(root, targetPath) {
    return path.relative(path.resolve(root), targetPath).replace(/\\/g, "/");
}

function extractJsonFromFencedBlock(input) {
    const text = String(input ?? "").trim();

    const jsonFence = text.match(/^```json\s*([\s\S]*?)\s*```$/i);
    if (jsonFence) return jsonFence[1].trim();

    const genericFence = text.match(/^```\s*([\s\S]*?)\s*```$/);
    if (genericFence) return genericFence[1].trim();

    return text;
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
        let file = String(edit.file ?? "");
        let target = null;

        try {
            file = assertSafeRelativePath(edit.file);
            target = resolveInsideRoot(root, file);

            const actualFile = toProjectRelativePath(root, target);
            let before = fs.existsSync(target) ? normalizeNewlines(fs.readFileSync(target, "utf8")) : null;
            let after;

            if (edit.operation === "create_file") {
                if (before !== null && edit.overwrite !== true) {
                    throw new Error("File already exists. Set overwrite=true to replace it.");
                }

                after = normalizeNewlines(edit.content);
            } else {
                if (before === null) {
                    throw new Error(`Target file does not exist. Normalized path: ${file}`);
                }

                if (edit.expected_sha256 && hash(before) !== edit.expected_sha256) {
                    throw new Error("expected_sha256 mismatch.");
                }

                after = applyEdit(before, edit);
            }

            if (before === after) {
                report.changed.push({
                    id,
                    file: actualFile,
                    requested_file: edit.file,
                    operation: edit.operation,
                    status: "unchanged"
                });
                continue;
            }

            let backup_path = null;

            if (!dryRun) {
                if (shouldBackup && before !== null) {
                    backup_path = backupFile(root, actualFile, before);
                }

                ensureParent(target);
                fs.writeFileSync(target, after, "utf8");
            }

            report.changed.push({
                id,
                file: actualFile,
                requested_file: edit.file,
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
                requested_file: edit.file,
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

// ==========================================
// WEB SERVER IMPLEMENTATION (🩺 GUI ROOM)
// ==========================================

function openBrowser(url) {
    const start = {
        win32: { cmd: "cmd", args: ["/c", "start", url] },
        darwin: { cmd: "open", args: [url] },
        linux: { cmd: "xdg-open", args: [url] }
    }[process.platform] || { cmd: "open", args: [url] };

    spawn(start.cmd, start.args, { detached: true, stdio: "ignore" }).unref();
}

function startWebServer(args) {
    function runGitCommand(gitArgs, cwd) {
        const res = spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
        if (res.error) {
            throw new Error(res.error.message);
        }
        if (res.status !== 0) {
            throw new Error((res.stderr || "").trim() || (res.stdout || "").trim() || `Git exited with code ${res.status}`);
        }
        return (res.stdout || res.stderr || "").trim();
    }

    const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = reqUrl.pathname;

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        try {
            if (pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(HTML_TEMPLATE);
                return;
            }

            if (pathname === "/api/read" && req.method === "GET") {
                const fileParam = reqUrl.searchParams.get("file");
                const safePath = resolveInsideRoot(args.root, fileParam);

                if (!fs.existsSync(safePath)) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "File not found." }));
                    return;
                }

                const content = fs.readFileSync(safePath, "utf8");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ content }));
                return;
            }

            if (pathname === "/api/apply" && req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const plan = JSON.parse(extractJsonFromFencedBlock(body));
                        
                        // We also want to capture the original contents of any files that are modified
                        // so that the frontend can compute the visual diff easily!
                        const fileContentsBefore = {};
                        if (Array.isArray(plan.edits)) {
                            for (const edit of plan.edits) {
                                try {
                                    const safePath = resolveInsideRoot(args.root, edit.file);
                                    const actualRel = toProjectRelativePath(args.root, safePath);
                                    if (fs.existsSync(safePath)) {
                                        fileContentsBefore[actualRel] = fs.readFileSync(safePath, "utf8");
                                    } else {
                                        fileContentsBefore[actualRel] = null;
                                    }
                                } catch (e) {
                                    // ignore unresolvable paths during listing
                                }
                            }
                        }

                        const report = applyPlan(plan, {
                            root: args.root,
                            apply: plan.apply === true,
                            dryRun: plan.apply !== true,
                            backup: args.backup
                        });
                        
                        // Attach the before content map so client-side diff computes instantly!
                        report.file_contents_before = fileContentsBefore;

                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify(report));
                    } catch (err) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            if (pathname === "/api/revert" && req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        if (!data.backup_path || !data.target_file) {
                            throw new Error("Missing backup_path or target_file.");
                        }

                        const backupPath = resolveInsideRoot(args.root, data.backup_path);
                        const targetPath = resolveInsideRoot(args.root, data.target_file);

                        if (!fs.existsSync(backupPath)) {
                            throw new Error("Backup file does not exist.");
                        }

                        fs.copyFileSync(backupPath, targetPath);

                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                    } catch (err) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            if (pathname === "/api/git-commit" && req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        if (!data.message) {
                            throw new Error("Missing commit message.");
                        }
                        
                        runGitCommand(["add", "-A"], args.root);
                        const output = runGitCommand(["commit", "-m", data.message], args.root);
                        
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true, output }));
                    } catch (err) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }

            if (pathname === "/api/git-push" && req.method === "POST") {
                try {
                    const output = runGitCommand(["push"], args.root);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, output }));
                } catch (err) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: err.message }));
                }
                return;
            }

            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Route not found" }));
        } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error.message }));
        }
    });

    server.listen(args.port, () => {
        const localUrl = `http://localhost:${args.port}`;
        console.log(`\n🩺 Code Surgeon Web Server started on ${localUrl}`);
        console.log(`Repository Root: ${path.resolve(args.root)}`);
        console.log(`Press Ctrl+C to stop.\n`);
        openBrowser(localUrl);
    });
}

// ==========================================
// MAIN ENTRYPOINT
// ==========================================

async function main() {
    try {
        const args = parseArgs(process.argv);

        if (args.help) {
            help();
            process.exit(0);
        }

        if (args.web) {
            startWebServer(args);
            return;
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

        const plan = JSON.parse(extractJsonFromFencedBlock(rawPlan));

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

// ==========================================
// GORGEOUS SINGLE-PAGE APP HTML TEMPLATE
// ==========================================

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Surgeon 🩺 - Control Panel</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🩺</text></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-main: #090d16;
            --bg-panel: #111827;
            --bg-card: #1f2937;
            --bg-input: #111827;
            --border: #374151;
            --border-hover: #4b5563;
            --text-primary: #f9fafb;
            --text-secondary: #9ca3af;
            --accent: #6366f1;
            --accent-hover: #4f46e5;
            --accent-glow: rgba(99, 102, 241, 0.15);
            --success: #10b981;
            --success-glow: rgba(16, 185, 129, 0.1);
            --error: #ef4444;
            --error-glow: rgba(239, 68, 68, 0.1);
            --warning: #f59e0b;
            --equal-bg: transparent;
            --add-bg: rgba(16, 185, 129, 0.15);
            --del-bg: rgba(239, 68, 68, 0.15);
            --add-border: #10b981;
            --del-border: #ef4444;
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 18px;
            --font-ui: 'Outfit', sans-serif;
            --font-mono: 'Fira Code', monospace;
            --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-main);
            color: var(--text-primary);
            font-family: var(--font-ui);
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Header Style 🩺 */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 32px;
            background: var(--bg-panel);
            border-bottom: 1px solid var(--border);
            height: 70px;
            z-index: 10;
        }

        .logo-area {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .logo-area h1 {
            font-size: 1.4rem;
            font-weight: 700;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #a855f7, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .logo-badge {
            background: #1e1b4b;
            color: #c7d2fe;
            border: 1px solid #312e81;
            font-size: 0.75rem;
            padding: 2px 10px;
            border-radius: 20px;
            font-weight: 600;
        }

        .status-pill {
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            font-size: 0.85rem;
            font-weight: 500;
        }

        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--success);
            box-shadow: 0 0 10px var(--success);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.9); opacity: 0.6; }
            50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 14px var(--success); }
            100% { transform: scale(0.9); opacity: 0.6; }
        }

        /* Workflow Main Grid Layout (Left-to-Right Flow) */
        .workflow-container {
            display: grid;
            grid-template-columns: 460px 1fr;
            height: calc(100vh - 70px);
            overflow: hidden;
        }

        /* Left Column (Input & Plan Control) */
        .control-column {
            background: var(--bg-panel);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            padding: 24px;
            gap: 24px;
        }

        .section-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            transition: var(--transition);
        }

        .section-card:hover {
            border-color: var(--border-hover);
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-title {
            font-size: 1rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--text-primary);
        }

        .card-actions {
            display: flex;
            gap: 8px;
        }

        .btn-sm {
            padding: 6px 12px;
            font-size: 0.75rem;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            background: var(--bg-input);
            color: var(--text-primary);
            cursor: pointer;
            font-family: var(--font-ui);
            font-weight: 500;
            transition: var(--transition);
        }

        .btn-sm:hover {
            background: var(--border);
            border-color: var(--text-secondary);
        }

        .plan-textarea {
            width: 100%;
            height: 220px;
            background: var(--bg-input);
            border: 1px solid var(--border);
            color: #38bdf8;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            padding: 14px;
            border-radius: var(--radius-sm);
            resize: vertical;
            outline: none;
            line-height: 1.4;
            transition: var(--transition);
        }

        .plan-textarea:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-glow);
        }

        .validation-alert {
            font-size: 0.8rem;
            padding: 8px 12px;
            border-radius: var(--radius-sm);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .validation-alert.valid {
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: var(--success);
        }

        .validation-alert.invalid {
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: var(--error);
            font-family: var(--font-mono);
            font-size: 0.75rem;
            word-break: break-all;
        }

        /* Real-time Plan Intention Parser */
        .intention-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 250px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .intention-item {
            background: var(--bg-input);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 12px;
            font-size: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .intention-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .intention-id {
            font-family: var(--font-mono);
            font-weight: 600;
            background: var(--bg-card);
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 0.75rem;
            color: var(--text-secondary);
        }

        .intention-op {
            text-transform: uppercase;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.5px;
        }

        .intention-file {
            font-family: var(--font-mono);
            font-weight: 500;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .intention-details {
            font-size: 0.75rem;
            color: var(--text-secondary);
            opacity: 0.85;
        }

        /* Action Buttons (Sala de Controle) */
        .control-actions {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: auto;
        }

        .action-btn {
            width: 100%;
            padding: 14px;
            border-radius: var(--radius-sm);
            font-family: var(--font-ui);
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: var(--transition);
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .action-btn-dry {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text-primary);
        }

        .action-btn-dry:hover {
            background: var(--bg-card);
            border-color: var(--text-secondary);
        }

        .action-btn-apply {
            background: linear-gradient(135deg, #a855f7, #6366f1);
            color: white;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.25);
        }

        .action-btn-apply:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
        }

        .action-btn:active {
            transform: translateY(0);
        }

        /* Right Column (Visualizations, Diff & Safety Undo) */
        .visual-column {
            background: var(--bg-main);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            padding: 24px;
            gap: 20px;
        }

        /* Modified File Tab Switcher */
        .modified-files-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow-x: auto;
            border-bottom: 1px solid var(--border);
            padding-bottom: 12px;
        }

        .m-file-tab {
            padding: 8px 16px;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text-secondary);
            font-family: var(--font-mono);
            font-size: 0.8rem;
            font-weight: 500;
            cursor: pointer;
            transition: var(--transition);
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .m-file-tab:hover {
            color: var(--text-primary);
            border-color: var(--border-hover);
        }

        .m-file-tab.active {
            color: var(--text-primary);
            background: var(--accent-glow);
            border-color: var(--accent);
            font-weight: 600;
        }

        /* Visual Diff View Pane */
        .diff-window {
            flex: 1;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .diff-title-bar {
            padding: 12px 20px;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .diff-title-left {
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .diff-title-stats {
            font-size: 0.8rem;
            color: var(--text-secondary);
        }

        .diff-body-scroll {
            flex: 1;
            overflow: auto;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            background: #090d16;
        }

        .diff-line-table {
            border-collapse: collapse;
            width: 100%;
        }

        .diff-tr {
            display: flex;
            width: 100%;
        }

        .diff-tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        .diff-td-num {
            width: 50px;
            min-width: 50px;
            text-align: right;
            padding-right: 12px;
            color: var(--text-secondary);
            opacity: 0.4;
            user-select: none;
            border-right: 1px solid var(--border);
            background: rgba(0, 0, 0, 0.15);
            font-size: 0.75rem;
            line-height: 22px;
        }

        .diff-td-content {
            flex: 1;
            padding-left: 14px;
            white-space: pre;
            line-height: 22px;
            overflow-x: auto;
            color: var(--text-primary);
        }

        .diff-tr.add-line {
            background-color: var(--add-bg);
        }
        .diff-tr.add-line .diff-td-num {
            border-right-color: var(--add-border);
            background-color: rgba(16, 185, 129, 0.06);
            opacity: 0.6;
        }
        .diff-tr.add-line .diff-td-content {
            color: #d1fae5;
        }

        .diff-tr.del-line {
            background-color: var(--del-bg);
        }
        .diff-tr.del-line .diff-td-num {
            border-right-color: var(--del-border);
            background-color: rgba(239, 68, 68, 0.06);
            opacity: 0.6;
        }
        .diff-tr.del-line .diff-td-content {
            color: #ffe4e6;
        }

        /* Undo and Analytical Stat Drawer at Bottom */
        .bottom-drawer {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .drawer-stats {
            display: flex;
            gap: 24px;
        }

        .stat-badge {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .stat-badge-lbl {
            font-size: 0.7rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .stat-badge-val {
            font-size: 1.15rem;
            font-weight: 700;
        }

        .btn-revert {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: var(--warning);
            padding: 10px 20px;
            font-size: 0.85rem;
            font-weight: 600;
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn-revert:hover {
            background: rgba(245, 158, 11, 0.2);
            border-color: var(--warning);
        }

        .btn-revert:active {
            transform: scale(0.98);
        }

        /* Toast notifications */
        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 14px 28px;
            border-radius: var(--radius-sm);
            background: var(--bg-card);
            border: 1px solid var(--border);
            color: var(--text-primary);
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateY(100px);
            opacity: 0;
            transition: var(--transition);
            z-index: 100;
            font-weight: 500;
            font-size: 0.9rem;
        }

        .toast.show {
            transform: translateY(0);
            opacity: 1;
        }

        .toast.success {
            border-left: 4px solid var(--success);
        }
        .toast.error {
            border-left: 4px solid var(--error);
        }
        .toast.warning {
            border-left: 4px solid var(--warning);
        }
    </style>
</head>
<body>

    <!-- Header 🩺 -->
    <header>
        <div class="logo-area">
            <h1>🩺 Code Surgeon</h1>
            <span class="logo-badge">v1.3.0</span>
            <span class="logo-badge" style="background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2); color: var(--accent);">Operating Room</span>
        </div>
        <div class="status-pill">
            <span class="status-indicator"></span>
            <span>Workspace Connected</span>
        </div>
    </header>

    <!-- Unified Left-to-Right Workflow Container -->
    <div class="workflow-container">
        
        <!-- CONTROL PANEL (LEFT COLUMN) -->
        <div class="control-column">
            
            <!-- SECTOR 1: Plan Editor -->
            <div class="section-card">
                <div class="card-header">
                    <span class="card-title">📋 1. Surgery JSON Plan</span>
                    <div class="card-actions" style="display: flex; gap: 6px;">
                        <button class="btn-sm" onclick="formatPlan()">✨ Format</button>
                        <button class="btn-sm" id="btn-try-fix" style="background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #fde68a;" onclick="onTryFixJson()">🔧 Try Fix</button>
                    </div>
                </div>
                <textarea class="plan-textarea" id="plan-code" oninput="onPlanCodeChange()" placeholder="Paste or type your JSON plan here..."></textarea>
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                    <div class="validation-alert valid" id="plan-validation-indicator" style="justify-content: space-between; align-items: flex-start; display: flex;">
                        <span id="validation-msg">🟢 Valid JSON</span>
                        <button class="btn-sm" id="copy-error-btn" style="display: none; padding: 2px 8px; font-size: 0.7rem; flex-shrink: 0; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: var(--error);" onclick="copyValidationError(event)">📋 Copy Error</button>
                    </div>
                    <button class="action-btn" style="background: var(--accent); color: white; width: 100%; border: none; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2); padding: 10px; font-size: 0.9rem; margin-top: 4px;" onclick="updateIntentionPreview()">
                        🩺 Send to Analysis
                    </button>
                </div>
            </div>

            <!-- SECTOR 2: Real-time Intention Analysis -->
            <div class="section-card" style="flex: 1; display: flex; flex-direction: column;">
                <div class="card-header">
                    <span class="card-title">🔍 2. Intention Analysis (What it will do)</span>
                </div>
                <div style="flex: 1; overflow: hidden; position: relative;">
                    <div class="intention-list" id="intention-preview-list">
                        <!-- Loaded dynamically as user writes JSON -->
                        <div style="color: var(--text-secondary); font-size: 0.85rem;">Write or paste a valid JSON to see the intention analysis.</div>
                    </div>
                </div>
            </div>

            <!-- SECTOR 3: Control Buttons -->
            <div class="control-actions">
                <button class="action-btn action-btn-dry" onclick="runSurgery(false)">
                    🔍 Simulate Surgery (Dry Run)
                </button>
                <button class="action-btn action-btn-apply" onclick="runSurgery(true)">
                    ⚡ Execute on Workspace
                </button>
            </div>

        </div>

        <!-- VISUAL PANEL (RIGHT COLUMN) -->
        <div class="visual-column">
            
            <!-- Modified Files Switcher Tabs -->
            <div class="modified-files-bar" id="modified-files-bar-container">
                <div style="font-size: 0.85rem; color: var(--text-secondary);">No surgery simulation or execution has been performed yet.</div>
            </div>

            <!-- Visual Diff Window -->
            <div class="diff-window">
                <div class="diff-title-bar">
                    <div class="diff-title-left" id="active-diff-file-label">
                        🩺 Visual Diff of Changes
                    </div>
                    <div class="diff-title-stats" id="active-diff-stats-label">
                        No files processed.
                    </div>
                </div>
                <div id="diff-failed-warning-banner" style="display: none;"></div>
                <div class="diff-body-scroll" id="diff-visual-output-container">
                    <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); padding: 40px; text-align: center;">
                        <div>
                            <div style="font-size: 3rem; margin-bottom: 12px;">🩺</div>
                            <h3>Ready for Operation</h3>
                            <p style="font-size: 0.85rem; margin-top: 6px; opacity: 0.7;">Insert the JSON plan on the left, check the intention analysis, and click "Simulate" or "Execute"!</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Analytical & Safety Drawer -->
            <div class="bottom-drawer">
                <div class="drawer-stats">
                    <div class="stat-badge">
                        <span class="stat-badge-lbl">Total Operations</span>
                        <span class="stat-badge-val" id="stat-total">0</span>
                    </div>
                    <div class="stat-badge" style="color: var(--success);">
                        <span class="stat-badge-lbl">Modified</span>
                        <span class="stat-badge-val" id="stat-success">0</span>
                    </div>
                    <div class="stat-badge" style="color: var(--error);">
                        <span class="stat-badge-lbl">Failed</span>
                        <span class="stat-badge-val" id="stat-failed">0</span>
                    </div>
                    <div class="stat-badge" style="color: var(--text-secondary);">
                        <span class="stat-badge-lbl">Unchanged</span>
                        <span class="stat-badge-val" id="stat-unchanged">0</span>
                    </div>
                </div>

                <div id="revert-action-container" style="display: none;">
                    <!-- Undo Reversion button rendered dynamically if backups exist -->
                </div>

                <div class="git-action-container" style="display: flex; gap: 10px; margin-top: 4px; border-top: 1px solid var(--border); padding-top: 12px; align-items: center; justify-content: space-between;">
                    <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
                        <span>Version Control:</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-sm" id="btn-git-commit" style="background: rgba(99, 102, 241, 0.1); border-color: var(--accent); color: #c7d2fe; display: flex; align-items: center; gap: 6px;" onclick="executeGitCommit()">
                            Stage & Commit 💾
                        </button>
                        <button class="btn-sm" id="btn-git-push" style="background: rgba(16, 185, 129, 0.1); border-color: var(--success); color: #d1fae5; display: flex; align-items: center; gap: 6px;" onclick="executeGitPush()">
                            Push to Origin 🚀
                        </button>
                    </div>
                </div>
            </div>

        </div>

    </div>

    <!-- Notification Toast -->
    <div class="toast" id="toast-notif">
        <span id="toast-message">Operation completed</span>
    </div>

    <!-- SCRIPT LOGIC -->
    <script>
        let currentWorkspaceFiles = [];
        let originalContentMap = {};
        let modifiedContentMap = {};
        let activeModifiedFile = null;
        let lastReportBackups = {}; // Store backup_path maps for undo operations: { file: backup_path }
        let failedFilesMap = {};

        const DEFAULT_PLAN = {
            edits: [
                {
                    id: "E001",
                    operation: "replace",
                    file: "src/App.tsx",
                    find: "// Alvo para substituição",
                    replace_with: "// Substituído com sucesso via Code Surgeon!"
                }
            ]
        };

        // Initialize Page
        window.addEventListener('DOMContentLoaded', () => {
            document.getElementById('plan-code').value = "";
            onPlanCodeChange();
        });

        // Triggered whenever code plan changes
        function onPlanCodeChange() {
            validatePlanJSON();
        }

        let lastValidationErrorMsg = "";

        // Real-time JSON validation
        function validatePlanJSON() {
            const indicator = document.getElementById('plan-validation-indicator');
            const msgSpan = document.getElementById('validation-msg');
            const copyBtn = document.getElementById('copy-error-btn');
            
            try {
                const planText = document.getElementById('plan-code').value;
                smartParseJSON(planText);
                msgSpan.innerText = "🟢 Valid JSON";
                indicator.className = "validation-alert valid";
                copyBtn.style.display = "none";
                lastValidationErrorMsg = "";
            } catch (err) {
                msgSpan.innerText = "🔴 Invalid JSON: " + err.message;
                indicator.className = "validation-alert invalid";
                copyBtn.style.display = "inline-block";
                lastValidationErrorMsg = err.message;
            }
        }

        // Copy validation error function
        function copyValidationError(e) {
            if (e) e.stopPropagation();
            if (!lastValidationErrorMsg) return;
            navigator.clipboard.writeText(lastValidationErrorMsg).then(() => {
                showToast("Error copied to clipboard!", "success");
            }).catch(() => {
                showToast("Failed to copy error", "error");
            });
        }

        // Intention Parser (displays actions dynamically)
        function updateIntentionPreview() {
            const listContainer = document.getElementById('intention-preview-list');
            try {
                const plan = parsePlanText();
                if (!plan || !Array.isArray(plan.edits) || plan.edits.length === 0) {
                    listContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem;">No actions registered in the plan.</div>';
                    return;
                }

                let html = "";
                plan.edits.forEach((edit, index) => {
                    const id = edit.id || \`E\${String(index + 1).padStart(3, '0')}\`;
                    const file = edit.file || 'File not specified';
                    const op = edit.operation || 'Unknown';
                    
                    let opColor = 'var(--accent)';
                    if (op === 'delete') opColor = 'var(--error)';
                    if (op === 'create_file') opColor = 'var(--success)';
                    
                    let desc = '';
                    if (edit.find) {
                        desc = \`Find: <code style="font-family: var(--font-mono); font-size:0.75rem; background:var(--bg-panel); padding:2px 4px; border-radius:3px; color:var(--warning);">\${escapeHtml(edit.find.substring(0, 30))}\${edit.find.length > 30 ? '...' : ''}</code>\`;
                    } else if (edit.line_start) {
                        desc = \`Lines \${edit.line_start} to \${edit.line_end}\`;
                    } else {
                        desc = \`No search anchors (operating directly on file)\`;
                    }
                    
                    html += \`
                        <div class="intention-item">
                            <div class="intention-meta">
                                <span class="intention-id">\${id}</span>
                                <span class="intention-op" style="color: \${opColor};">\${op}</span>
                            </div>
                            <div class="intention-file" title="\${file}">📄 \${file}</div>
                            <div class="intention-details">\${desc}</div>
                        </div>
                    \`;
                });

                listContainer.innerHTML = html;
                showToast("Intention analysis completed!", "success");
            } catch (e) {
                listContainer.innerHTML = '<div style="color: var(--error); font-size: 0.85rem; padding: 10px; border: 1px solid rgba(239, 68, 68, 0.2); border-radius:var(--radius-sm);">Fix JSON to preview planned actions.</div>';
                showToast("Analysis failed: " + e.message, "error");
            }
        }

        // Execute surgery or dry run
        async function runSurgery(isRealExecution) {
            const planText = document.getElementById('plan-code').value;
            let plan;

            try {
                plan = JSON.parse(extractJsonFromFencedBlockClient(planText));
            } catch (err) {
                showToast("Invalid Surgery Plan JSON!", "error");
                return;
            }

            plan.apply = isRealExecution;
            plan.dry_run = !isRealExecution;

            try {
                showToast(isRealExecution ? "Executing surgery on workspace..." : "Simulating changes...");
                
                const res = await fetch('/api/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(plan)
                });
                
                const report = await res.json();
                
                if (report.error) {
                    showToast(report.error, "error");
                    return;
                }

                // Render Analytical Stats
                updateAnalyticsDashboard(report);

                // Populate file maps and display diffs
                originalContentMap = report.file_contents_before || {};
                modifiedContentMap = {};
                lastReportBackups = {};
                failedFilesMap = {};

                // Populate failed files mapping
                if (Array.isArray(report.failed)) {
                    report.failed.forEach(f => {
                        const normalized = normalizePlanFilePathClient(f.file || f.requested_file);
                        failedFilesMap[normalized] = {
                            id: f.id,
                            operation: f.operation,
                            error: f.error || "Unknown error"
                        };
                    });
                }

                // Compute modified contents for all files affected
                const filesList = [];
                report.changed.forEach(c => {
                    if (c.status === 'changed' || c.status === 'dry_run_changed' || c.status === 'unchanged') {
                        if (!filesList.includes(c.file)) {
                            filesList.push(c.file);
                        }
                        // Save backups for revert action
                        if (c.backup_path) {
                            lastReportBackups[c.file] = c.backup_path;
                        }

                        // Compute new client-side contents with CRLF-to-LF normalization
                        const originalCode = (originalContentMap[c.file] || "").replace(/\\r\\n/g, "\\n");
                        try {
                            modifiedContentMap[c.file] = applyPlanClientSide(plan, originalCode, c.file);
                        } catch (e) {
                            modifiedContentMap[c.file] = originalCode; // Fallback
                        }
                    }
                });

                // Failures might also affect file lists
                report.failed.forEach(f => {
                    const normalized = normalizePlanFilePathClient(f.file || f.requested_file);
                    if (!filesList.includes(normalized)) {
                        filesList.push(normalized);
                    }
                });

                // Render Modified Files Tab Switcher
                renderModifiedFilesSwitcher(filesList);

                // Show revert/undo actions if any backup was generated
                renderRevertSafetyActions(isRealExecution);

                if (report.ok) {
                    showToast(isRealExecution ? "Surgery executed SUCCESSFULLY!" : "Simulation completed!");
                } else {
                    showToast("Surgery completed with errors. Check the failed files.", "error");
                }

            } catch (err) {
                showToast("Error during operation: " + err.message, "error");
            }
        }

        // Render file tabs that were modified by the surgery plan
        function renderModifiedFilesSwitcher(filesList) {
            const container = document.getElementById('modified-files-bar-container');
            
            if (filesList.length === 0) {
                container.innerHTML = '<div style="font-size: 0.85rem; color: var(--text-secondary);">Surgery completed. No files modified.</div>';
                clearDiffWindow();
                return;
            }

            container.innerHTML = filesList.map((file, idx) => {
                const isActive = (activeModifiedFile === file || (!activeModifiedFile && idx === 0)) ? 'active' : '';
                if (!activeModifiedFile && idx === 0) {
                    activeModifiedFile = file;
                }
                const hasFailed = failedFilesMap[file];
                const badge = hasFailed ? '<span style="color: #ef4444; font-weight: bold; margin-left: 6px;">⚠️</span>' : '';
                const tabStyle = hasFailed ? 'border-color: rgba(239, 68, 68, 0.4);' : '';
                return \`
                    <button class="m-file-tab \${isActive}" style="\${tabStyle}" onclick="selectModifiedFile('\${file}')">
                        📄 \${file}\${badge}
                    </button>
                \`;
            }).join('');

            if (activeModifiedFile) {
                selectModifiedFile(activeModifiedFile);
            }
        }

        // Clear visual diff pane
        function clearDiffWindow() {
            document.getElementById('active-diff-file-label').innerText = "🩺 Visual Diff of Changes";
            document.getElementById('active-diff-stats-label').innerText = "No files processed.";
            document.getElementById('diff-visual-output-container').innerHTML = \`
                <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); padding: 40px; text-align: center;">
                    No diff data available.
                </div>
            \`;
            const warningBanner = document.getElementById('diff-failed-warning-banner');
            if (warningBanner) {
                warningBanner.style.display = 'none';
                warningBanner.innerHTML = '';
            }
        }

        // Select a file from the switcher to view diff
        function selectModifiedFile(filePath) {
            activeModifiedFile = filePath;
            
            // Highlight active tab
            document.querySelectorAll('.m-file-tab').forEach(tab => {
                if (tab.innerText.includes(filePath)) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });

            document.getElementById('active-diff-file-label').innerText = "📄 " + filePath;

            const originalCode = (originalContentMap[filePath] || "").replace(/\\r\\n/g, "\\n");
            let modifiedCode = (modifiedContentMap[filePath] || "").replace(/\\r\\n/g, "\\n");

            const warningBanner = document.getElementById('diff-failed-warning-banner');
            if (failedFilesMap[filePath]) {
                const failedInfo = failedFilesMap[filePath];
                modifiedCode = originalCode;
                warningBanner.style.display = 'block';
                warningBanner.innerHTML = \`
                    <div style="background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 12px 16px; margin: 12px; border-radius: 4px; font-size: 0.85rem; color: #fca5a5; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(239, 68, 68, 0.25);">
                        <strong style="display: flex; align-items: center; gap: 6px;"><span style="font-size: 1.1rem;">⚠️</span> Surgery Failed on Workspace (\${failedInfo.id || 'No ID'} - \${failedInfo.operation || 'Unknown'})</strong>
                        <div style="opacity: 0.9; margin-top: 2px;">
                            Error in file <code>\${filePath}</code>: <span style="font-family: var(--font-mono); font-weight: bold; background: rgba(0,0,0,0.2); padding: 1px 4px; border-radius: 3px; color: #fecaca;">\${failedInfo.error}</span>
                        </div>
                    </div>
                \`;
            } else {
                warningBanner.style.display = 'none';
                warningBanner.innerHTML = '';
            }

            renderDiff(originalCode, modifiedCode);
        }

        // Update statistics drawer
        function updateAnalyticsDashboard(report) {
            const total = report.changed.length + report.failed.length;
            const succeeded = report.changed.filter(c => c.status === 'changed' || c.status === 'dry_run_changed').length;
            const unchanged = report.changed.filter(c => c.status === 'unchanged').length;
            const failed = report.failed.length;

            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-success').innerText = succeeded;
            document.getElementById('stat-failed').innerText = failed;
            document.getElementById('stat-unchanged').innerText = unchanged;
        }

        // Render Undo / Revert operations
        function renderRevertSafetyActions(isRealExecution) {
            const container = document.getElementById('revert-action-container');
            const filesWithBackups = Object.keys(lastReportBackups);

            if (!isRealExecution || filesWithBackups.length === 0) {
                container.style.display = 'none';
                container.innerHTML = '';
                return;
            }

            container.style.display = 'block';
            container.innerHTML = filesWithBackups.map(file => {
                const backupPath = lastReportBackups[file];
                return \`
                    <button class="btn-revert" onclick="revertWorkspaceFile('\${file}', '\${backupPath}')">
                        🔄 Undo Surgery (\${file})
                    </button>
                \`;
            }).join('');
        }

        // Revert a workspace file to its backup
        async function revertWorkspaceFile(targetFile, backupPath) {
            try {
                showToast(\`Restaurando backup de \${targetFile}...\`);
                const res = await fetch('/api/revert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_file: targetFile,
                        backup_path: backupPath
                    })
                });

                const data = await res.json();
                if (data.ok) {
                    showToast("Surgery reverted SUCCESSFULLY!", "success");
                    
                    // Reset maps and reload contents
                    try {
                        const fileRes = await fetch(\`/api/read?file=\${encodeURIComponent(targetFile)}\`);
                        const fileData = await fileRes.json();
                        originalContentMap[targetFile] = fileData.content;
                        modifiedContentMap[targetFile] = fileData.content;
                        
                        selectModifiedFile(targetFile);
                    } catch (e) {}

                    // Hide revert buttons since undo is completed
                    delete lastReportBackups[targetFile];
                    renderRevertSafetyActions(true);
                } else {
                    showToast("Error reverting backup: " + data.error, "error");
                }
            } catch (err) {
                showToast("Network error during revert: " + err.message, "error");
            }
        }

        // Computes unified diff with prefix/suffix trimming and context collapsing
        function renderDiff(one, other) {
            const lines1 = one.split('\\n');
            const lines2 = other.split('\\n');
            const n = lines1.length;
            const m = lines2.length;
            
            // 1. Find common prefix
            let prefixLines = 0;
            while (prefixLines < n && prefixLines < m && lines1[prefixLines] === lines2[prefixLines]) {
                prefixLines++;
            }
            
            // 2. Find common suffix
            let suffixLines = 0;
            while (suffixLines < (n - prefixLines) && suffixLines < (m - prefixLines) && 
                   lines1[n - 1 - suffixLines] === lines2[m - 1 - suffixLines]) {
                suffixLines++;
            }
            
            // 3. Extract the changed middle segment
            const mid1 = lines1.slice(prefixLines, n - suffixLines);
            const mid2 = lines2.slice(prefixLines, m - suffixLines);
            
            let diff = [];
            
            // If there are changes, compute LCS diff on the middle segment
            if (mid1.length > 0 || mid2.length > 0) {
                // If middle segment itself is too large to do DP safely, fallback to a fast side-by-side replacement list
                if (mid1.length + mid2.length > 1500) {
                    mid1.forEach((line, idx) => {
                        diff.push({ type: 'removed', value: line, line1: prefixLines + idx + 1 });
                    });
                    mid2.forEach((line, idx) => {
                        diff.push({ type: 'added', value: line, line2: prefixLines + idx + 1 });
                    });
                } else {
                    // Compute DP LCS diff on the middle segment
                    const len1 = mid1.length;
                    const len2 = mid2.length;
                    const dp = Array.from({ length: len1 + 1 }, () => new Int32Array(len2 + 1));
                    
                    for (let i = 1; i <= len1; i++) {
                        for (let j = 1; j <= len2; j++) {
                            if (mid1[i - 1] === mid2[j - 1]) {
                                dp[i][j] = dp[i - 1][j - 1] + 1;
                            } else {
                                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                            }
                        }
                    }
                    
                    const midDiff = [];
                    let i = len1, j = len2;
                    while (i > 0 || j > 0) {
                        if (i > 0 && j > 0 && mid1[i - 1] === mid2[j - 1]) {
                            midDiff.push({ type: 'equal', value: mid1[i - 1], line1: prefixLines + i, line2: prefixLines + j });
                            i--;
                            j--;
                        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                            midDiff.push({ type: 'added', value: mid2[j - 1], line2: prefixLines + j });
                            j--;
                        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
                            midDiff.push({ type: 'removed', value: mid1[i - 1], line1: prefixLines + i });
                            i--;
                        }
                    }
                    midDiff.reverse();
                    diff = midDiff;
                }
            }
            
            // Total stats counters
            let additions = 0;
            let deletions = 0;
            
            diff.forEach(d => {
                if (d.type === 'added') additions++;
                if (d.type === 'removed') deletions++;
            });
            
            // Render helper for single row
            function makeRowHtml(line1, line2, type, value) {
                let classType = "";
                let indicator = " ";
                if (type === 'added') {
                    classType = "add-line";
                    indicator = "+";
                } else if (type === 'removed') {
                    classType = "del-line";
                    indicator = "-";
                }
                const safeValue = value
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
                return \`
                    <div class="diff-tr \${classType}">
                        <div class="diff-td-num">\${line1 || ""}</div>
                        <div class="diff-td-num">\${line2 || ""}</div>
                        <div class="diff-td-content">\${indicator} \${safeValue}</div>
                    </div>
                \`;
            }
            
            // Build unified flat array of all comparison lines
            let allLines = [];
            
            // A. Prefix lines (all equal)
            for (let idx = 0; idx < prefixLines; idx++) {
                allLines.push({ type: 'equal', value: lines1[idx], line1: idx + 1, line2: idx + 1 });
            }
            
            // B. Middle lines
            allLines.push(...diff);
            
            // C. Suffix lines (all equal)
            const suffixStartIdx = n - suffixLines;
            const suffixStartIdx2 = m - suffixLines;
            for (let idx = 0; idx < suffixLines; idx++) {
                allLines.push({
                    type: 'equal',
                    value: lines1[suffixStartIdx + idx],
                    line1: suffixStartIdx + idx + 1,
                    line2: suffixStartIdx2 + idx + 1
                });
            }
            
            // Context-collapsing logic
            const CONTEXT_LINES = 3; // Let's focus on 3 lines of context before/after changes
            const keep = new Uint8Array(allLines.length);
            
            // 1. Mark additions & deletions
            for (let i = 0; i < allLines.length; i++) {
                if (allLines[i].type === 'added' || allLines[i].type === 'removed') {
                    keep[i] = 1;
                }
            }
            
            // 2. Spread keep outward by CONTEXT_LINES
            for (let i = 0; i < allLines.length; i++) {
                if (allLines[i].type === 'added' || allLines[i].type === 'removed') {
                    for (let j = Math.max(0, i - CONTEXT_LINES); j < i; j++) {
                        keep[j] = 1;
                    }
                    for (let j = i + 1; j <= Math.min(allLines.length - 1, i + CONTEXT_LINES); j++) {
                        keep[j] = 1;
                    }
                }
            }
            
            let html = "";
            let hiddenCount = 0;
            
            for (let i = 0; i < allLines.length; i++) {
                if (keep[i] === 1) {
                    if (hiddenCount > 0) {
                        const startLine = allLines[i - hiddenCount].line1;
                        const endLine = allLines[i - 1].line1;
                        html += \`
                            <div class="diff-tr" style="background: rgba(255,255,255,0.015); color: var(--text-secondary); font-style: italic;">
                                <div class="diff-td-num">...</div>
                                <div class="diff-td-num">...</div>
                                <div class="diff-td-content" style="padding-left: 20px;">@@ Lines \${startLine} to \${endLine} hidden (unchanged) @@</div>
                            </div>
                        \`;
                        hiddenCount = 0;
                    }
                    html += makeRowHtml(allLines[i].line1, allLines[i].line2, allLines[i].type, allLines[i].value);
                } else {
                    hiddenCount++;
                }
            }
            
            if (hiddenCount > 0) {
                const startLine = allLines[allLines.length - hiddenCount].line1;
                const endLine = allLines[allLines.length - 1].line1;
                html += \`
                    <div class="diff-tr" style="background: rgba(255,255,255,0.015); color: var(--text-secondary); font-style: italic;">
                        <div class="diff-td-num">...</div>
                        <div class="diff-td-num">...</div>
                        <div class="diff-td-content" style="padding-left: 20px;">@@ Lines \${startLine} to \${endLine} hidden (unchanged) @@</div>
                    </div>
                \`;
            }
            
            // If absolutely no changes were detected
            if (prefixLines === n && suffixLines === n && n === m) {
                html = \`
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        The files are identical. No changes performed.
                    </div>
                \`;
            }
            
            const diffBody = document.getElementById('diff-visual-output-container');
            diffBody.innerHTML = \`<div class="diff-line-table">\${html}</div>\`;
            
            // Update stats labels
            document.getElementById('active-diff-stats-label').innerText = \`+\\u0020\${additions} additions, -\\u0020\${deletions} deletions\`;
        }

        function generateGitCommitMessage() {
            try {
                const planText = document.getElementById('plan-code').value;
                const plan = smartParseJSON(planText);
                
                let msg = "";
                
                // 1. General Header
                let fileOperations = [];
                if (Array.isArray(plan.edits)) {
                    plan.edits.forEach(edit => {
                        const fileBaseName = edit.file ? edit.file.split('/').pop() : 'file';
                        fileOperations.push(\`\${edit.operation || 'edit'} \${fileBaseName}\`);
                    });
                }
                
                if (fileOperations.length > 0) {
                    msg += \`surgery: \${fileOperations.join(', ')}\\n\\n\`;
                } else {
                    msg += \`surgery: Applied JSON changes\\n\\n\`;
                }
                
                // 2. Edits reasons
                if (Array.isArray(plan.edits) && plan.edits.length > 0) {
                    msg += \`Planned Edits:\\n\`;
                    plan.edits.forEach((edit, idx) => {
                        const id = edit.id || \`E00\${idx + 1}\`;
                        const file = edit.file || 'unknown';
                        const op = edit.operation || 'edit';
                        const reason = edit.reason || 'No reason provided';
                        msg += \`- [\${id}] \${op} on \${file}: \${reason}\\n\`;
                    });
                    msg += \`\\n\`;
                }
                
                // 3. Expected Result
                if (plan.validation && plan.validation.expected_result) {
                    msg += \`Expected Validation Result:\\n- \${plan.validation.expected_result}\\n\\n\`;
                }
                
                // 4. Notes
                if (plan.notes) {
                    msg += \`Surgery Notes:\\n\`;
                    if (typeof plan.notes === 'string') {
                        msg += \`- \${plan.notes}\\n\`;
                    } else {
                        if (plan.notes.risk_level) msg += \`- Risk level: \${plan.notes.risk_level}\\n\`;
                        if (plan.notes.requires_manual_review) msg += \`- Requires manual review: \${plan.notes.requires_manual_review}\\n\`;
                        // Any other fields
                        for (let k in plan.notes) {
                            if (k !== 'risk_level' && k !== 'requires_manual_review') {
                                msg += \`- \${k}: \${plan.notes[k]}\\n\`;
                            }
                        }
                    }
                }
                
                return msg.trim();
            } catch (err) {
                return "surgery: Applied code surgery plan";
            }
        }

        async function executeGitCommit() {
            const commitMsg = generateGitCommitMessage();
            try {
                showToast("Staging and committing files...");
                const res = await fetch('/api/git-commit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: commitMsg })
                });
                const data = await res.json();
                if (data.error) {
                    showToast("Commit failed: " + data.error, "error");
                } else {
                    showToast("Staged and Committed SUCCESSFULLY!", "success");
                    console.log("Git Output:", data.output);
                }
            } catch (err) {
                showToast("Network error during commit: " + err.message, "error");
            }
        }

        async function executeGitPush() {
            try {
                showToast("Pushing changes to Git origin...");
                const res = await fetch('/api/git-push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.error) {
                    showToast("Push failed: " + data.error, "error");
                } else {
                    showToast("Pushed to Origin SUCCESSFULLY!", "success");
                    console.log("Git Output:", data.output);
                }
            } catch (err) {
                showToast("Network error during push: " + err.message, "error");
            }
        }

        // Helpers
        function escapeHtml(text) {
            return String(text ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        }

        function extractJsonFromFencedBlockClient(input) {
            const text = String(input ?? "").trim();
            const fence = String.fromCharCode(96, 96, 96);
            const newline = String.fromCharCode(10);

            if (!text.startsWith(fence)) {
                return text;
            }

            const firstLineEnd = text.indexOf(newline);
            if (firstLineEnd === -1) {
                return text;
            }

            const openingFence = text.slice(0, firstLineEnd).trim().toLowerCase();
            if (openingFence !== fence && openingFence !== fence + "json") {
                return text;
            }

            let body = text.slice(firstLineEnd + 1).trim();
            if (body.endsWith(fence)) {
                body = body.slice(0, -fence.length).trim();
            }

            return body;
        }

        function smartParseJSON(rawText) {
            let clean = extractJsonFromFencedBlockClient(rawText);
            // Remove single-line comments (// ...)
            clean = clean.replace(/\\/\\/.*/g, '');
            // Remove multi-line comments (/* ... */)
            clean = clean.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
            // Remove trailing commas before closing braces/brackets
            clean = clean.replace(/,([\\s]*[\\]}])/g, '$1');
            return JSON.parse(clean);
        }

        function parsePlanText() {
            const raw = document.getElementById('plan-code').value;
            return smartParseJSON(raw);
        }

        function normalizePlanFilePathClient(filePath) {
            return String(filePath ?? "")
                .replace(/\\\\/g, "/")
                .replace(/^\\.\\/+/, "")
                .replace(/^\\/+/, "")
                .split("/")
                .filter(Boolean)
                .join("/");
        }

        function clientEditTargetsFile(generatedPath, targetFile) {
            const generated = normalizePlanFilePathClient(generatedPath);
            const target = normalizePlanFilePathClient(targetFile);

            return generated === target ||
                generated.endsWith("/" + target) ||
                target.endsWith("/" + generated);
        }

        function formatPlan() {
            const textarea = document.getElementById('plan-code');
            try {
                const parsed = JSON.parse(extractJsonFromFencedBlockClient(textarea.value));
                textarea.value = JSON.stringify(parsed, null, 4);
                validatePlanJSON();
                showToast("JSON formatted successfully!");
            } catch (e) {
                showToast("Failed to format: Invalid JSON.", "error");
            }
        }

        function tryFixJSON(rawText) {
            let clean = extractJsonFromFencedBlockClient(rawText);
            
            // Character by character scan to escape raw newlines inside double-quoted strings
            let result = "";
            let inString = false;
            let escaped = false;
            
            for (let i = 0; i < clean.length; i++) {
                const char = clean[i];
                
                if (inString) {
                    if (char === "\\\\") {
                        escaped = !escaped;
                        result += char;
                    } else if (char === '"') {
                        if (escaped) {
                            result += char;
                            escaped = false;
                        } else {
                            inString = false;
                            result += char;
                        }
                    } else if (char === "\\n") {
                        result += "\\\\n";
                        escaped = false;
                    } else if (char === "\\r") {
                        if (clean[i + 1] === "\\n") {
                            // skip carriage return if followed by newline
                        } else {
                            result += "\\\\r";
                        }
                        escaped = false;
                    } else {
                        result += char;
                        escaped = false;
                    }
                } else {
                    if (char === '"') {
                        inString = true;
                        escaped = false;
                        result += char;
                    } else {
                        result += char;
                    }
                }
            }
            
            let finalClean = result;
            finalClean = finalClean.replace(/\\/\\/.*/g, '');
            finalClean = finalClean.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
            finalClean = finalClean.replace(/,([\\s]*[\\]}])/g, '$1');
            
            try {
                const parsed = JSON.parse(finalClean);
                return JSON.stringify(parsed, null, 4);
            } catch (err) {
                return finalClean;
            }
        }

        function onTryFixJson() {
            const textarea = document.getElementById('plan-code');
            const originalVal = textarea.value;
            if (!originalVal.trim()) {
                showToast("JSON is empty.", "warning");
                return;
            }
            
            const fixed = tryFixJSON(originalVal);
            textarea.value = fixed;
            
            // Re-validate JSON
            validatePlanJSON();
            
            // Check if it's now valid JSON
            try {
                smartParseJSON(fixed);
                showToast("JSON fixed and formatted successfully!", "success");
            } catch (err) {
                showToast("Attempted fix, but JSON still has syntax errors.", "error");
            }
        }



        function showToast(message, type = "success") {
            const toast = document.getElementById('toast-notif');
            toast.innerText = message;
            toast.className = \`toast show \${type}\`;
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // ==========================================
        // CLIENT-SIDE CODE SURGERY SIMULATION ENGINE
        // ==========================================
        function applyPlanClientSide(plan, originalText, targetFile) {
            let workingText = String(originalText ?? "").replace(/\\r\\n/g, "\\n");
            
            plan.edits.forEach(edit => {
                if (!clientEditTargetsFile(edit.file, targetFile)) return;

                if (edit.operation === "create_file") {
                    workingText = String(edit.content ?? "").replace(/\\r\\n/g, "\\n");
                    return;
                }

                workingText = clientApplyEdit(workingText, edit);
            });

            return workingText;
        }

        function clientApplyEdit(content, edit) {
            const find = edit.find ? String(edit.find).replace(/\\r\\n/g, "\\n") : edit.find;
            const replace_with = edit.replace_with ? String(edit.replace_with).replace(/\\r\\n/g, "\\n") : edit.replace_with;
            const occurrence = edit.occurrence || "unique";

            switch (edit.operation) {
                case "replace":
                    if (typeof find === "string") {
                        return clientReplaceMatches(content, find, replace_with, occurrence);
                    }
                    const range = clientGetLineOffsets(content, edit.line_start, edit.line_end);
                    return content.slice(0, range.start) + replace_with + content.slice(range.end);
                
                case "insert_before":
                    return clientInsertMatches(content, find, String(edit.insert ?? edit.content ?? "").replace(/\\r\\n/g, "\\n"), occurrence, "before");
                
                case "insert_after":
                    return clientInsertMatches(content, find, String(edit.insert ?? edit.content ?? "").replace(/\\r\\n/g, "\\n"), occurrence, "after");
                
                case "delete":
                    if (typeof find === "string") {
                        return clientDeleteMatches(content, find, occurrence);
                    }
                    const delRange = clientGetLineOffsets(content, edit.line_start, edit.line_end);
                    return content.slice(0, delRange.start) + content.slice(delRange.end);
                
                case "append":
                    return content + String(edit.content ?? edit.insert ?? "").replace(/\\r\\n/g, "\\n");
                
                case "prepend":
                    return String(edit.content ?? edit.insert ?? "").replace(/\\r\\n/g, "\\n") + content;
                
                case "ensure_import":
                    return clientEnsureImport(content, edit);

                default:
                    throw new Error("Operation not supported or cannot be simulated in sandbox.");
            }
        }

        function clientReplaceMatches(content, anchor, replacement, occurrence) {
            const positions = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const pos of [...positions].reverse()) {
                output = output.slice(0, pos) + replacement + output.slice(pos + anchor.length);
            }
            return output;
        }

        function clientInsertMatches(content, anchor, insertion, occurrence, mode) {
            const positions = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const pos of [...positions].reverse()) {
                const insertAt = mode === "before" ? pos : pos + anchor.length;
                output = output.slice(0, insertAt) + insertion + output.slice(insertAt);
            }
            return output;
        }

        function clientDeleteMatches(content, anchor, occurrence) {
            const positions = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const pos of [...positions].reverse()) {
                output = output.slice(0, pos) + output.slice(pos + anchor.length);
            }
            return output;
        }

        function clientEnsureImport(content, edit) {
            const statement = edit.import_statement ?? edit.content;
            if (content.includes(statement)) return content;
            const lines = content.split('\\n');
            let lastImportLine = -1;
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith("import ") || trimmed.startsWith("import{") || 
                    (trimmed.startsWith("const ") && trimmed.includes("require("))) {
                    lastImportLine = i;
                }
            }
            if (lastImportLine >= 0) {
                lines.splice(lastImportLine + 1, 0, statement);
                return lines.join('\\n');
            }
            return statement + "\\n" + content;
        }

        function clientSelectMatches(content, anchor, occurrence) {
            const matches = [];
            let idx = content.indexOf(anchor);
            while (idx !== -1) {
                matches.push(idx);
                idx = content.indexOf(anchor, idx + anchor.length);
            }
            if (matches.length === 0) throw new Error(\`Anchor text "\${anchor}" not found.\`);
            
            if (occurrence === "unique") {
                if (matches.length !== 1) throw new Error(\`Expected exactly 1 occurrence, found \${matches.length}.\`);
                return [matches[0]];
            }
            if (occurrence === "all") return matches;
            
            const num = Number(occurrence);
            if (Number.isInteger(num) && num >= 1 && num <= matches.length) {
                return [matches[num - 1]];
            }
            throw new Error(\`Invalid occurrence: \${occurrence}\`);
        }

        function clientGetLineOffsets(content, lineStart, lineEnd) {
            const lines = content.split('\\n');
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
    </script>
</body>
</html>
`;

main();
