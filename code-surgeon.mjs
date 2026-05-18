#!/usr/bin/env node
/**
 * code-surgeon.mjs
 *
 * Single-file Node.js utility for applying machine-readable code surgery plans.
 * Optimized with a clean, unified left-to-right web interface workflow!
 *
 * Usage:
 * node code-surgeon.mjs --plan surgery.json --root .
 * node code-surgeon.mjs --plan surgery.json --root . --apply
 * cat surgery.json | node code-surgeon.mjs --root . --apply
 * node code-surgeon.mjs --web [--port 3333]
 *
 * Default mode is dry-run. Nothing is written unless --apply is passed.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import url from "node:url";
import { spawnSync, spawn } from "node:child_process";

const VERSION = "1.4.2";

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

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAll(content, anchor) {
    anchor = String(anchor || "");
    if (!anchor) {
        throw new Error("find anchor cannot be empty.");
    }

    // Adapt the anchor search to tolerate both \n and \r\n without mutating file content
    const escapedAnchor = escapeRegExp(anchor.replace(/\r\n/g, "\n"));
    const regexSource = escapedAnchor.replace(/\n/g, '\\r?\\n');
    const regex = new RegExp(regexSource, 'g');

    const positions = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        positions.push({ index: match.index, length: match[0].length });
        if (match[0].length === 0) regex.lastIndex++; // Prevent infinite loops
    }

    return positions;
}

/**
 * Returns diagnostic hints when a find anchor fails to match.
 */
function diagnoseFailedFind(content, anchor) {
    const hints = [];

    // Normalize newlines in both for comparison
    const contentNorm = content.replace(/\r\n/g, "\n");
    const anchorNorm = String(anchor || "").replace(/\r\n/g, "\n");

    const normalizeWS = s => s.replace(/[ \t]+/g, " ").replace(/^[ \t]+/gm, "").trim();
    if (normalizeWS(contentNorm).includes(normalizeWS(anchorNorm))) {
        hints.push(
            "A whitespace-normalized version of this anchor WAS found in the file. " +
            "The find string likely has wrong indentation or mixed tabs/spaces. " +
            "Copy the anchor verbatim from the file content, preserving exact leading whitespace."
        );
    }

    const anchorLines = anchorNorm.split("\n").map(l => l.trim()).filter(Boolean);
    if (anchorLines.length > 0) {
        const firstLine = anchorLines[0];
        const contentLines = contentNorm.split("\n");
        const lineMatches = contentLines
            .map((l, i) => (l.includes(firstLine) ? i + 1 : null))
            .filter(Boolean);

        if (lineMatches.length > 0) {
            hints.push(
                `The first line of the anchor (${JSON.stringify(firstLine.slice(0, 70))}) ` +
                `was found at line(s): ${lineMatches.slice(0, 5).join(", ")}. ` +
                `The mismatch is likely in the lines that follow — check indentation and exact content.`
            );
        } else {
            hints.push(
                `The first line of the anchor (${JSON.stringify(firstLine.slice(0, 70))}) ` +
                `was NOT found anywhere in the file. ` +
                `The anchor may reference code that was already modified, renamed, or never existed.`
            );
        }
    }

    if (anchorLines.length > 1) {
        const lastLine = anchorLines[anchorLines.length - 1];
        const contentLines = contentNorm.split("\n");
        const lastLineMatches = contentLines
            .map((l, i) => (l.includes(lastLine) ? i + 1 : null))
            .filter(Boolean);

        if (lastLineMatches.length > 0) {
            hints.push(
                `The last line of the anchor (${JSON.stringify(lastLine.slice(0, 70))}) ` +
                `exists at line(s): ${lastLineMatches.slice(0, 5).join(", ")}. ` +
                `Consider using a shorter, single-line anchor instead.`
            );
        }
    }

    const lineCount = anchorNorm.split("\n").length;
    if (lineCount > 4) {
        hints.push(
            `Anchor spans ${lineCount} lines — long anchors are fragile. ` +
            `Prefer the shortest unique substring (ideally 1–2 lines) or use line_start/line_end instead.`
        );
    }

    return hints;
}

function selectMatches(content, anchor, occurrence = "unique") {
    const matches = findAll(content, anchor);

    if (matches.length === 0) {
        const preview = anchor.length > 100 ? anchor.slice(0, 100) + "…" : anchor;
        const hints = diagnoseFailedFind(content, anchor);
        const hintsText = hints.length > 0
            ? "\n  Hints:\n" + hints.map(h => "    • " + h).join("\n")
            : "";
        throw new Error(
            `find anchor not found in file.\n  Anchor preview: ${JSON.stringify(preview)}${hintsText}`
        );
    }

    if (occurrence === "unique" || occurrence === null || occurrence === undefined) {
        if (matches.length !== 1) {
            const preview = anchor.length > 80 ? anchor.slice(0, 80) + "…" : anchor;
            const lineNumbers = matches.map(m => content.slice(0, m.index).split("\n").length);
            throw new Error(
                `Expected unique match but found ${matches.length} occurrences.\n` +
                `  Anchor preview: ${JSON.stringify(preview)}\n` +
                `  Found at line(s): ${lineNumbers.join(", ")}\n` +
                `  Fix: Use "occurrence": 1, 2, … to target a specific instance, ` +
                `expand the anchor to include more surrounding context, or use "occurrence": "all".`
            );
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

    throw new Error(
        `Invalid occurrence value: ${JSON.stringify(occurrence)}. ` +
        `Use "unique", "all", or a positive integer (1–${matches.length}).`
    );
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
    const predominantLineEnding = (content.match(/\r\n/g) || []).length > (content.match(/\n/g) || []).length / 2 ? "\r\n" : "\n";
    const replacementAdapted = String(replacement || "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);

    const matches = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const match of [...matches].reverse()) {
        output = output.slice(0, match.index) + replacementAdapted + output.slice(match.index + match.length);
    }

    return output;
}

function insertMatches(content, anchor, insertion, occurrence, mode) {
    const predominantLineEnding = (content.match(/\r\n/g) || []).length > (content.match(/\n/g) || []).length / 2 ? "\r\n" : "\n";
    const insertionAdapted = String(insertion || "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);

    const matches = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const match of [...matches].reverse()) {
        const insertAt = mode === "before" ? match.index : match.index + match.length;
        output = output.slice(0, insertAt) + insertionAdapted + output.slice(insertAt);
    }

    return output;
}

function deleteMatches(content, anchor, occurrence) {
    const matches = selectMatches(content, anchor, occurrence);
    let output = content;

    for (const match of [...matches].reverse()) {
        output = output.slice(0, match.index) + output.slice(match.index + match.length);
    }

    return output;
}

function ensureImport(content, edit) {
    const predominantLineEnding = (content.match(/\r\n/g) || []).length > (content.match(/\n/g) || []).length / 2 ? "\r\n" : "\n";
    let statement = edit.import_statement ?? edit.content;
    statement = String(statement || "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);

    if (!statement.trim()) {
        throw new Error("ensure_import requires import_statement or content.");
    }

    if (content.replace(/\r\n/g, "\n").includes(String(edit.import_statement ?? edit.content).replace(/\r\n/g, "\n"))) {
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
        const needsCR = lines[lastImportLine].endsWith("\r");
        const statementToInsert = needsCR && !statement.endsWith("\r") ? statement + "\r" : statement;
        lines.splice(lastImportLine + 1, 0, statementToInsert);
        return lines.join("\n");
    }

    return statement + predominantLineEnding + content;
}

function applyEdit(content, edit) {
    const predominantLineEnding = (content.match(/\r\n/g) || []).length > (content.match(/\n/g) || []).length / 2 ? "\r\n" : "\n";

    switch (edit.operation) {
        case "replace": {
            if (typeof edit.find === "string") {
                return replaceMatches(content, edit.find, edit.replace_with, edit.occurrence);
            }

            const range = getLineOffsets(content, edit.line_start, edit.line_end);
            const replacement = String(edit.replace_with ?? "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);
            return content.slice(0, range.start) + replacement + content.slice(range.end);
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

        case "append": {
            const insertion = String(edit.content ?? edit.insert ?? "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);
            return content + insertion;
        }

        case "prepend": {
            const insertion = String(edit.content ?? edit.insert ?? "").replace(/\r\n/g, "\n").replace(/\n/g, predominantLineEnding);
            return insertion + content;
        }

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
            const rawContent = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

            // Core Fix: Do NOT forcefully strip \r\n from file strings
            let before = rawContent !== null ? rawContent : null;
            let after;

            if (edit.operation === "create_file") {
                if (before !== null && edit.overwrite !== true) {
                    throw new Error("File already exists. Set overwrite=true to replace it.");
                }

                after = String(edit.content ?? "");
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

            const writeContent = after;
            let backup_path = null;

            if (!dryRun) {
                if (shouldBackup && rawContent !== null) {
                    backup_path = backupFile(root, actualFile, rawContent);
                }

                ensureParent(target);
                fs.writeFileSync(target, writeContent, "utf8");
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

    function generateAndApplyPatch(filePath, beforeContent, afterContent, rootDir) {
        const randId = Math.random().toString(36).substring(2, 7);
        const tempBefore = path.join(rootDir, `.cs_temp_before_${Date.now()}_${randId}`);
        const tempAfter = path.join(rootDir, `.cs_temp_after_${Date.now()}_${randId}`);
        const patchFile = path.join(rootDir, `.cs_temp_patch_${Date.now()}_${randId}`);

        try {
            fs.writeFileSync(tempBefore, beforeContent || "", "utf8");
            fs.writeFileSync(tempAfter, afterContent || "", "utf8");

            // Run git diff --no-index. It exits with 1 if there are differences.
            const res = spawnSync("git", ["diff", "--no-index", "--patch", "--no-color", tempBefore, tempAfter], {
                cwd: rootDir,
                encoding: "utf8"
            });

            const stdout = res.stdout || "";
            if (res.status > 1 || (!stdout && res.error)) {
                throw new Error(res.stderr || res.error?.message || `Failed to generate diff for ${filePath}`);
            }

            if (!stdout.trim()) {
                // No differences, nothing to stage
                return;
            }

            // Rewrite patch headers
            const beforeBase = path.basename(tempBefore);
            const afterBase = path.basename(tempAfter);

            // Ensure standard relative path format for Git (forward slashes)
            const relPath = filePath.replace(/\\/g, "/");

            // Mantém o \r intacto preservando o formato original do diff gerado pelo Git
            const lines = stdout.split('\n');
            const rewrittenLines = lines.map(line => {
                if (line.startsWith("--- ") && line.includes(beforeBase)) {
                    return line.endsWith("\r") ? `--- a/${relPath}\r` : `--- a/${relPath}`;
                }
                if (line.startsWith("+++ ") && line.includes(afterBase)) {
                    return line.endsWith("\r") ? `+++ b/${relPath}\r` : `+++ b/${relPath}`;
                }
                return line;
            });

            const cleanPatch = rewrittenLines.join("\n");
            fs.writeFileSync(patchFile, cleanPatch, "utf8");

            // Apply the patch to the staging area
            const applyRes = spawnSync("git", ["apply", "--cached", patchFile], {
                cwd: rootDir,
                encoding: "utf8"
            });

            if (applyRes.status !== 0) {
                throw new Error(applyRes.stderr || `Failed to stage patch for ${filePath}`);
            }
        } finally {
            // Always clean up temp files
            if (fs.existsSync(tempBefore)) fs.unlinkSync(tempBefore);
            if (fs.existsSync(tempAfter)) fs.unlinkSync(tempAfter);
            if (fs.existsSync(patchFile)) fs.unlinkSync(patchFile);
        }
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
                        if (!data.files || typeof data.files !== "object") {
                            throw new Error("Missing files map payload.");
                        }

                        const filesList = Object.keys(data.files);
                        for (const file of filesList) {
                            const fileInfo = data.files[file];
                            if (!fileInfo.before) {
                                runGitCommand(["add", file], args.root);
                            } else {
                                generateAndApplyPatch(file, fileInfo.before, fileInfo.after, args.root);
                            }
                        }

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
            grid-template-columns: 460px 1fr 380px;
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

        /* Right Column (Git Version Control & Safety Revert) */
        .git-column {
            background: var(--bg-panel);
            border-left: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            overflow-y: auto;
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

        /* Disabled state styling for buttons */
        .action-btn:disabled, .btn-sm:disabled {
            opacity: 0.4 !important;
            cursor: not-allowed !important;
            pointer-events: none !important;
            box-shadow: none !important;
            background: rgba(255, 255, 255, 0.05) !important;
            border-color: rgba(255, 255, 255, 0.1) !important;
            color: var(--text-secondary) !important;
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
            <span class="logo-badge">v1.4.2</span>
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

            <!-- Animated Step-by-Step Progress Tracking -->
            <div id="surgery-progress-container" style="display: none; width: 100%; background: var(--border); height: 6px; border-radius: 3px; margin-top: 12px; overflow: hidden; position: relative;">
                <div id="surgery-progress-bar" style="width: 0%; height: 100%; background: var(--accent); transition: width 0.2s ease;"></div>
            </div>
            <div id="surgery-progress-lbl" style="display: none; font-size: 0.75rem; color: var(--text-secondary); margin-top: 6px; text-align: center; font-weight: 500;">Ready</div>

        </div>

        <!-- VISUAL PANEL (MIDDLE COLUMN) -->
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
        </div>

        <!-- GIT & DASHBOARD PANEL (RIGHT COLUMN) -->
        <div class="git-column">
            
            <!-- Git Version Control Card -->
            <div class="section-card" id="git-vc-card" style="display: flex; flex-direction: column; gap: 10px;">
                <div class="card-header" style="padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                    <span class="card-title">💾 Git Version Control</span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);" id="git-status-lbl">Ready</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">Commit Message (Fully Editable):</label>
                    <textarea id="git-commit-msg-preview" style="width: 100%; height: 160px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.8rem; padding: 8px; resize: none;" placeholder="Commit message preview will appear here when surgery is simulated or executed..."></textarea>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <div style="font-size: 0.75rem; color: var(--text-secondary);" id="git-affected-files-lbl">
                        0 files affected
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-sm" id="btn-git-commit" style="background: rgba(99, 102, 241, 0.1); border-color: var(--accent); color: #c7d2fe; display: flex; align-items: center; gap: 6px;" onclick="executeGitCommit()">
                            Commit 💾
                        </button>
                        <button class="btn-sm" id="btn-git-push" style="background: rgba(16, 185, 129, 0.1); border-color: var(--success); color: #d1fae5; display: flex; align-items: center; gap: 6px;" onclick="executeGitPush()">
                            Push 🚀
                        </button>
                    </div>
                </div>
            </div>

            <!-- Surgery Analytics Dashboard -->
            <div class="section-card">
                <div class="card-header" style="padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                    <span class="card-title">📊 Surgery Dashboard</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
                    <div class="stat-badge" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 8px; border-radius: 4px;">
                        <span class="stat-badge-lbl">Total Edits</span>
                        <span class="stat-badge-val" id="stat-total">0</span>
                    </div>
                    <div class="stat-badge" style="background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16,185,129,0.15); padding: 8px; border-radius: 4px; color: var(--success);">
                        <span class="stat-badge-lbl">Succeeded</span>
                        <span class="stat-badge-val" id="stat-success">0</span>
                    </div>
                    <div class="stat-badge" style="background: rgba(239, 68, 68, 0.04); border: 1px solid rgba(239,68,68,0.15); padding: 8px; border-radius: 4px; color: var(--error);">
                        <span class="stat-badge-lbl">Failed</span>
                        <span class="stat-badge-val" id="stat-failed">0</span>
                    </div>
                    <div class="stat-badge" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 8px; border-radius: 4px; color: var(--text-secondary);">
                        <span class="stat-badge-lbl">Unchanged</span>
                        <span class="stat-badge-val" id="stat-unchanged">0</span>
                    </div>
                </div>
            </div>

            <!-- Analytical & Safety Drawer -->
            <div class="bottom-drawer" style="box-shadow: none; padding: 0; background: transparent; border: none;">
                <div id="revert-action-container" style="display: none; width: 100%;">
                    <!-- Undo Reversion button rendered dynamically if backups exist -->
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
        let lastReportBackups = {}; 
        let failedFilesMap = {};

        window.addEventListener('DOMContentLoaded', () => {
            document.getElementById('plan-code').value = "";
            onPlanCodeChange();
        });

        function onPlanCodeChange() {
            validatePlanJSON();
        }

        let lastValidationErrorMsg = "";

        function validatePlanJSON() {
            const indicator = document.getElementById('plan-validation-indicator');
            const msgSpan = document.getElementById('validation-msg');
            const copyBtn = document.getElementById('copy-error-btn');
            
            try {
                const planText = document.getElementById('plan-code').value;
                if (!planText.trim()) throw new Error("Plan JSON is empty.");
                smartParseJSON(planText);
                msgSpan.innerText = "🟢 Valid JSON";
                indicator.className = "validation-alert valid";
                copyBtn.style.display = "none";
                lastValidationErrorMsg = "";
                updateButtonStates(true);
            } catch (err) {
                msgSpan.innerText = "🔴 Invalid JSON: " + err.message;
                indicator.className = "validation-alert invalid";
                copyBtn.style.display = "inline-block";
                lastValidationErrorMsg = err.message;
                updateButtonStates(false);
            }
        }

        function updateButtonStates(isValid) {
            const sendBtn = document.querySelector('.section-card button[onclick="updateIntentionPreview()"]');
            const dryBtn = document.querySelector('.action-btn-dry');
            const applyBtn = document.querySelector('.action-btn-apply');

            const buttons = [sendBtn, dryBtn, applyBtn];
            buttons.forEach(btn => {
                if (btn) btn.disabled = !isValid;
            });
        }

        function copyValidationError(e) {
            if (e) e.stopPropagation();
            if (!lastValidationErrorMsg) return;
            navigator.clipboard.writeText(lastValidationErrorMsg).then(() => {
                showToast("Error copied to clipboard!", "success");
            }).catch(() => {
                showToast("Failed to copy error", "error");
            });
        }

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

            if (window.surgeryProgressInterval) clearInterval(window.surgeryProgressInterval);

            const progContainer = document.getElementById('surgery-progress-container');
            const progBar = document.getElementById('surgery-progress-bar');
            const progLbl = document.getElementById('surgery-progress-lbl');

            progContainer.style.display = 'block';
            progLbl.style.display = 'block';
            progBar.style.width = '10%';
            progLbl.innerText = isRealExecution ? "10% - Initializing surgery on workspace..." : "10% - Initializing simulation...";

            let currentProgress = 10;
            window.surgeryProgressInterval = setInterval(() => {
                if (currentProgress < 90) {
                    const increment = Math.max(1, Math.floor((90 - currentProgress) / 8));
                    currentProgress += increment;
                    progBar.style.width = currentProgress + '%';
                    
                    let msg = "";
                    if (currentProgress < 30) {
                        msg = \`\${currentProgress}% - Loading workspace source files...\`;
                    } else if (currentProgress < 60) {
                        msg = \`\${currentProgress}% - Resolving search anchors and IDs...\`;
                    } else if (currentProgress < 85) {
                        msg = isRealExecution ? \`\${currentProgress}% - Performing structural surgery...\` : \`\${currentProgress}% - Simulating surgery dry-run...\`;
                    } else {
                        msg = \`\${currentProgress}% - Finalizing intention report...\`;
                    }
                    progLbl.innerText = msg;
                }
            }, 200);

            let report = null;
            try {
                showToast(isRealExecution ? "Executing surgery on workspace..." : "Simulating changes...");
                
                const res = await fetch('/api/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(plan)
                });
                
                report = await res.json();
                
                if (report.error) {
                    showToast(report.error, "error");
                    return;
                }

                updateAnalyticsDashboard(report);

                originalContentMap = report.file_contents_before || {};
                modifiedContentMap = {};
                lastReportBackups = {};
                failedFilesMap = {};

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

                const filesList = [];
                report.changed.forEach(c => {
                    if (c.status === 'changed' || c.status === 'dry_run_changed' || c.status === 'unchanged') {
                        if (!filesList.includes(c.file)) filesList.push(c.file);
                        if (c.backup_path) lastReportBackups[c.file] = c.backup_path;

                        // DO NOT forcefully strip original newlines here
                        const originalCode = originalContentMap[c.file] || "";
                        try {
                            modifiedContentMap[c.file] = applyPlanClientSide(plan, originalCode, c.file);
                        } catch (e) {
                            modifiedContentMap[c.file] = originalCode; 
                        }
                    }
                });

                report.failed.forEach(f => {
                    const normalized = normalizePlanFilePathClient(f.file || f.requested_file);
                    if (!filesList.includes(normalized)) filesList.push(normalized);
                });

                renderModifiedFilesSwitcher(filesList);
                renderRevertSafetyActions(isRealExecution);

                const affectedFiles = Object.keys(lastReportBackups);
                document.getElementById('git-affected-files-lbl').innerText = \`\${affectedFiles.length} file\${affectedFiles.length !== 1 ? 's' : ''} affected\`;
                document.getElementById('git-commit-msg-preview').value = generateGitCommitMessage();

                if (report.ok) {
                    showToast(isRealExecution ? "Surgery executed SUCCESSFULLY!" : "Simulation completed!");
                } else {
                    showToast("Surgery completed with errors. Check the failed files.", "error");
                }

            } catch (err) {
                showToast("Error during operation: " + err.message, "error");
            } finally {
                if (window.surgeryProgressInterval) clearInterval(window.surgeryProgressInterval);
                progBar.style.width = '100%';
                progLbl.innerText = (report && report.ok) ? '100% - Surgery completed successfully! 🟢' : '100% - Surgery completed with errors! 🔴';
                setTimeout(() => {
                    progContainer.style.display = 'none';
                    progLbl.style.display = 'none';
                }, 3000);
            }
        }

        function renderModifiedFilesSwitcher(filesList) {
            const container = document.getElementById('modified-files-bar-container');
            
            if (filesList.length === 0) {
                container.innerHTML = '<div style="font-size: 0.85rem; color: var(--text-secondary);">Surgery completed. No files modified.</div>';
                clearDiffWindow();
                return;
            }

            container.innerHTML = filesList.map((file, idx) => {
                const isActive = (activeModifiedFile === file || (!activeModifiedFile && idx === 0)) ? 'active' : '';
                if (!activeModifiedFile && idx === 0) activeModifiedFile = file;
                const hasFailed = failedFilesMap[file];
                const badge = hasFailed ? '<span style="color: #ef4444; font-weight: bold; margin-left: 6px;">⚠️</span>' : '';
                const tabStyle = hasFailed ? 'border-color: rgba(239, 68, 68, 0.4);' : '';
                return \`
                    <button class="m-file-tab \${isActive}" style="\${tabStyle}" onclick="selectModifiedFile('\${file}')">
                        📄 \${file}\${badge}
                    </button>
                \`;
            }).join('');

            if (activeModifiedFile) selectModifiedFile(activeModifiedFile);
        }

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

        function selectModifiedFile(filePath) {
            activeModifiedFile = filePath;
            
            document.querySelectorAll('.m-file-tab').forEach(tab => {
                if (tab.innerText.includes(filePath)) tab.classList.add('active');
                else tab.classList.remove('active');
            });

            document.getElementById('active-diff-file-label').innerText = "📄 " + filePath;

            // Only normalize here so visual diff LCS engine works smoothly without newline mismatches
            const originalCode = (originalContentMap[filePath] || "").replace(/\\r\\n/g, "\\n");
            let modifiedCode = (modifiedContentMap[filePath] || "").replace(/\\r\\n/g, "\\n");

            const warningBanner = document.getElementById('diff-failed-warning-banner');
            if (failedFilesMap[filePath]) {
                const failedInfo = failedFilesMap[filePath];
                modifiedCode = originalCode;
                warningBanner.style.display = 'block';
                warningBanner.innerHTML = \`
                    <div style="background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 12px 16px; margin: 12px; border-radius: 4px; font-size: 0.85rem; color: #fca5a5; display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(239, 68, 68, 0.25);">
                        <strong style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                            <span style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 1.1rem;">⚠️</span> Surgery Failed on Workspace (\${failedInfo.id || 'No ID'} - \${failedInfo.operation || 'Unknown'})
                            </span>
                            <button class="btn-sm" style="background: rgba(239, 68, 68, 0.25); border-color: rgba(239, 68, 68, 0.45); color: #fecaca; display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.75rem;" onclick="copyErrorForAI('\${filePath}')">
                                📋 Copy Error for AI
                            </button>
                        </strong>
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

        async function revertWorkspaceFile(targetFile, backupPath) {
            try {
                showToast(\`Restaurando backup de \${targetFile}...\`);
                const res = await fetch('/api/revert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_file: targetFile, backup_path: backupPath })
                });

                const data = await res.json();
                if (data.ok) {
                    showToast("Surgery reverted SUCCESSFULLY!", "success");
                    
                    try {
                        const fileRes = await fetch(\`/api/read?file=\${encodeURIComponent(targetFile)}\`);
                        const fileData = await fileRes.json();
                        originalContentMap[targetFile] = fileData.content;
                        modifiedContentMap[targetFile] = fileData.content;
                        selectModifiedFile(targetFile);
                    } catch (e) {}

                    delete lastReportBackups[targetFile];
                    renderRevertSafetyActions(true);
                } else {
                    showToast("Error reverting backup: " + data.error, "error");
                }
            } catch (err) {
                showToast("Network error during revert: " + err.message, "error");
            }
        }

        function renderDiff(one, other) {
            const lines1 = one.split('\\n');
            const lines2 = other.split('\\n');
            const n = lines1.length;
            const m = lines2.length;
            
            let prefixLines = 0;
            while (prefixLines < n && prefixLines < m && lines1[prefixLines] === lines2[prefixLines]) {
                prefixLines++;
            }
            
            let suffixLines = 0;
            while (suffixLines < (n - prefixLines) && suffixLines < (m - prefixLines) && 
                   lines1[n - 1 - suffixLines] === lines2[m - 1 - suffixLines]) {
                suffixLines++;
            }
            
            const mid1 = lines1.slice(prefixLines, n - suffixLines);
            const mid2 = lines2.slice(prefixLines, m - suffixLines);
            
            let diff = [];
            
            if (mid1.length > 0 || mid2.length > 0) {
                const len1 = mid1.length;
                const len2 = mid2.length;
                
                // Fallback apenas para arquivos absurdamente gigantes (> 8000 linhas no meio do diff)
                if (len1 * len2 > 64000000) {
                    mid1.forEach((line, idx) => diff.push({ type: 'removed', value: line, line1: prefixLines + idx + 1 }));
                    mid2.forEach((line, idx) => diff.push({ type: 'added', value: line, line2: prefixLines + idx + 1 }));
                } else {
                    // Matriz DP 1D ultrarrápida usando Typed Arrays
                    const cols = len2 + 1;
                    const dp = new Int32Array((len1 + 1) * cols);
                    
                    for (let i = 1; i <= len1; i++) {
                        let i_pos = i * cols;
                        let i_prev_pos = (i - 1) * cols;
                        for (let j = 1; j <= len2; j++) {
                            if (mid1[i - 1] === mid2[j - 1]) {
                                dp[i_pos + j] = dp[i_prev_pos + (j - 1)] + 1;
                            } else {
                                dp[i_pos + j] = Math.max(dp[i_prev_pos + j], dp[i_pos + (j - 1)]);
                            }
                        }
                    }
                    
                    const midDiff = [];
                    let i = len1, j = len2;
                    while (i > 0 || j > 0) {
                        let i_pos = i * cols;
                        let i_prev_pos = (i - 1) * cols;
                        if (i > 0 && j > 0 && mid1[i - 1] === mid2[j - 1]) {
                            midDiff.push({ type: 'equal', value: mid1[i - 1], line1: prefixLines + i, line2: prefixLines + j });
                            i--; j--;
                        } else if (j > 0 && (i === 0 || dp[i_pos + (j - 1)] >= dp[i_prev_pos + j])) {
                            midDiff.push({ type: 'added', value: mid2[j - 1], line2: prefixLines + j });
                            j--;
                        } else if (i > 0 && (j === 0 || dp[i_pos + (j - 1)] < dp[i_prev_pos + j])) {
                            midDiff.push({ type: 'removed', value: mid1[i - 1], line1: prefixLines + i });
                            i--;
                        }
                    }
                    midDiff.reverse();
                    diff = midDiff;
                }
            }
            
            let additions = 0;
            let deletions = 0;
            diff.forEach(d => {
                if (d.type === 'added') additions++;
                if (d.type === 'removed') deletions++;
            });
            
            function makeRowHtml(line1, line2, type, value) {
                let classType = "";
                let indicator = " ";
                if (type === 'added') { classType = "add-line"; indicator = "+"; } 
                else if (type === 'removed') { classType = "del-line"; indicator = "-"; }
                const safeValue = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                return \`
                    <div class="diff-tr \${classType}">
                        <div class="diff-td-num">\${line1 || ""}</div>
                        <div class="diff-td-num">\${line2 || ""}</div>
                        <div class="diff-td-content">\${indicator} \${safeValue}</div>
                    </div>
                \`;
            }
            
            let allLines = [];
            for (let idx = 0; idx < prefixLines; idx++) allLines.push({ type: 'equal', value: lines1[idx], line1: idx + 1, line2: idx + 1 });
            allLines.push(...diff);
            const suffixStartIdx = n - suffixLines;
            const suffixStartIdx2 = m - suffixLines;
            for (let idx = 0; idx < suffixLines; idx++) {
                allLines.push({ type: 'equal', value: lines1[suffixStartIdx + idx], line1: suffixStartIdx + idx + 1, line2: suffixStartIdx2 + idx + 1 });
            }
            
            const CONTEXT_LINES = 3; 
            const keep = new Uint8Array(allLines.length);
            for (let i = 0; i < allLines.length; i++) {
                if (allLines[i].type === 'added' || allLines[i].type === 'removed') keep[i] = 1;
            }
            for (let i = 0; i < allLines.length; i++) {
                if (allLines[i].type === 'added' || allLines[i].type === 'removed') {
                    for (let j = Math.max(0, i - CONTEXT_LINES); j < i; j++) keep[j] = 1;
                    for (let j = i + 1; j <= Math.min(allLines.length - 1, i + CONTEXT_LINES); j++) keep[j] = 1;
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
                } else hiddenCount++;
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
            
            if (prefixLines === n && suffixLines === n && n === m) {
                html = \`
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        The files are identical. No changes performed.
                    </div>
                \`;
            }
            
            const diffBody = document.getElementById('diff-visual-output-container');
            diffBody.innerHTML = \`<div class="diff-line-table">\${html}</div>\`;
            
            document.getElementById('active-diff-stats-label').innerText = \`+\\u0020\${additions} additions, -\\u0020\${deletions} deletions\`;
        }

        function generateGitCommitMessage() {
            try {
                const planText = document.getElementById('plan-code').value;
                const plan = smartParseJSON(planText);
                let msg = "";
                
                let fileOperations = [];
                if (Array.isArray(plan.edits)) {
                    plan.edits.forEach(edit => {
                        const fileBaseName = edit.file ? edit.file.split('/').pop() : 'file';
                        fileOperations.push(\`\${edit.operation || 'edit'} \${fileBaseName}\`);
                    });
                }
                
                if (fileOperations.length > 0) msg += \`surgery: \${fileOperations.join(', ')}\\n\\n\`;
                else msg += \`surgery: Applied JSON changes\\n\\n\`;
                
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
                
                if (plan.validation && plan.validation.expected_result) {
                    msg += \`Expected Validation Result:\\n- \${plan.validation.expected_result}\\n\\n\`;
                }
                
                if (plan.notes) {
                    msg += \`Surgery Notes:\\n\`;
                    if (typeof plan.notes === 'string') msg += \`- \${plan.notes}\\n\`;
                    else {
                        if (plan.notes.risk_level) msg += \`- Risk level: \${plan.notes.risk_level}\\n\`;
                        if (plan.notes.requires_manual_review) msg += \`- Requires manual review: \${plan.notes.requires_manual_review}\\n\`;
                        for (let k in plan.notes) {
                            if (k !== 'risk_level' && k !== 'requires_manual_review') msg += \`- \${k}: \${plan.notes[k]}\\n\`;
                        }
                    }
                }
                return msg.trim();
            } catch (err) {
                return "surgery: Applied code surgery plan";
            }
        }

        async function executeGitCommit() {
            const files = Object.keys(lastReportBackups);
            if (files.length === 0) {
                showToast("No executed surgery files found to commit.", "warning");
                return;
            }

            const filesData = {};
            files.forEach(file => {
                filesData[file] = {
                    before: originalContentMap[file] || "",
                    after: modifiedContentMap[file] || ""
                };
            });

            const commitMsg = document.getElementById('git-commit-msg-preview').value;
            if (!commitMsg.trim()) {
                showToast("Commit message cannot be empty.", "warning");
                return;
            }

            try {
                showToast("Staging and committing specific surgery lines...");
                const res = await fetch('/api/git-commit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: commitMsg, files: filesData })
                });
                const data = await res.json();
                if (data.error) showToast("Commit failed: " + data.error, "error");
                else showToast("Surgical changes Committed SUCCESSFULLY!", "success");
            } catch (err) {
                showToast("Network error during commit: " + err.message, "error");
            }
        }

        function copyErrorForAI(filePath) {
            const failedInfo = failedFilesMap[filePath];
            if (!failedInfo) return;

            const planText = document.getElementById('plan-code').value;
            let edit = null;
            let targetEditJson = "";
            try {
                const plan = smartParseJSON(planText);
                edit = plan.edits.find(e => e.id === failedInfo.id || normalizePlanFilePathClient(e.file) === filePath);
                if (edit) targetEditJson = JSON.stringify(edit, null, 4);
            } catch (e) {}

            let diagnostics = "";
            const fileContent = originalContentMap[filePath];
            if (fileContent === undefined || fileContent === null) {
                diagnostics += "- File Status: \u274c File DOES NOT exist in workspace!\\n";
            } else {
                const fileLines = fileContent.replace(/\\r\\n/g, "\\n").split('\\n');
                const totalLinesCount = fileLines.length;
                diagnostics += "- File Status: \ud83d\udcc4 File exists (" + totalLinesCount + " lines total).\\n";

                const bt = String.fromCharCode(96);

                if (edit) {
                    if (edit.line_start !== undefined || edit.line_end !== undefined) {
                        const lStart = Number(edit.line_start);
                        const lEnd = Number(edit.line_end);
                        if (lStart > totalLinesCount || lEnd > totalLinesCount) {
                            diagnostics += "- Diagnosis: \u26a0\ufe0f Out of Bounds! The plan requested lines " + lStart + " to " + lEnd + ", but the file only has " + totalLinesCount + " lines.\\n";
                        } else {
                            const actualLinesContent = fileLines.slice(lStart - 1, lEnd).join('\\n');
                            diagnostics += "- Actual content at lines " + lStart + " to " + lEnd + " in the file:\\n" +
                                bt + bt + bt + "\\n" + actualLinesContent + "\\n" + bt + bt + bt + "\\n";
                        }
                    }
                    if (edit.find) {
                        const findAnchor = String(edit.find).trim();
                        const firstLineFind = findAnchor.split('\\n')[0].trim();
                        
                        let partialMatches = [];
                        if (firstLineFind.length > 4) {
                            fileLines.forEach((line, idx) => {
                                if (line.toLowerCase().includes(firstLineFind.toLowerCase()) || 
                                    (line.trim().length > 4 && firstLineFind.toLowerCase().includes(line.trim().toLowerCase()))) {
                                    if (partialMatches.length < 5) partialMatches.push("- Line " + (idx + 1) + ": " + bt + line.trim() + bt);
                                }
                            });
                        }
                        
                        if (partialMatches.length > 0) {
                            diagnostics += "- Diagnosis: \ud83d\udd0d Similar lines found in the file (did you mean one of these?):\\n" + partialMatches.join('\\n') + "\\n";
                        } else {
                            diagnostics += "- Diagnosis: \u274c The anchor text was not found anywhere in the file. Indentation, spaces, or capitalization might be different.\\n";
                        }
                    }
                }
            }

            const prompt = "Code Surgery Failed:\\n" +
                "- File: " + filePath + "\\n" +
                "- Edit ID: " + (failedInfo.id || "N/A") + "\\n" +
                "- Operation: " + (failedInfo.operation || "N/A") + "\\n" +
                "- Error: " + failedInfo.error + "\\n\\n" +
                "Diagnostic Information:\\n" +
                diagnostics + "\\n" +
                "Please fix the edit with ID " + (failedInfo.id || "N/A") + " based on the diagnostic above.";

            navigator.clipboard.writeText(prompt).then(() => {
                showToast("Failure report copied for AI! \ud83d\udccb", "success");
            }).catch(() => {
                showToast("Failed to copy error report", "error");
            });
        }

        async function executeGitPush() {
            try {
                showToast("Pushing changes to Git origin...");
                const res = await fetch('/api/git-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }});
                const data = await res.json();
                if (data.error) showToast("Push failed: " + data.error, "error");
                else showToast("Pushed to Origin SUCCESSFULLY!", "success");
            } catch (err) {
                showToast("Network error during push: " + err.message, "error");
            }
        }

        function escapeHtml(text) {
            return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }

        function extractJsonFromFencedBlockClient(input) {
            const text = String(input ?? "").trim();
            const fence = String.fromCharCode(96, 96, 96);
            const newline = String.fromCharCode(10);
            if (!text.startsWith(fence)) return text;
            const firstLineEnd = text.indexOf(newline);
            if (firstLineEnd === -1) return text;
            const openingFence = text.slice(0, firstLineEnd).trim().toLowerCase();
            if (openingFence !== fence && openingFence !== fence + "json") return text;
            let body = text.slice(firstLineEnd + 1).trim();
            if (body.endsWith(fence)) body = body.slice(0, -fence.length).trim();
            return body;
        }

        function smartParseJSON(rawText) {
            let clean = extractJsonFromFencedBlockClient(rawText);
            clean = clean.replace(/\\/\\/.*/g, '');
            clean = clean.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
            clean = clean.replace(/,([\\s]*[\\]}])/g, '$1');
            return JSON.parse(clean);
        }

        function parsePlanText() {
            const raw = document.getElementById('plan-code').value;
            return smartParseJSON(raw);
        }

        function normalizePlanFilePathClient(filePath) {
            return String(filePath ?? "").replace(/\\\\/g, "/").replace(/^\\.\\/+/, "").replace(/^\\/+/, "").split("/").filter(Boolean).join("/");
        }

        function clientEditTargetsFile(generatedPath, targetFile) {
            const generated = normalizePlanFilePathClient(generatedPath);
            const target = normalizePlanFilePathClient(targetFile);
            return generated === target || generated.endsWith("/" + target) || target.endsWith("/" + generated);
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
            let result = "";
            let inString = false;
            let escaped = false;
            for (let i = 0; i < clean.length; i++) {
                const char = clean[i];
                if (inString) {
                    if (char === "\\\\") { escaped = !escaped; result += char; } 
                    else if (char === '"') {
                        if (escaped) { result += char; escaped = false; } 
                        else { inString = false; result += char; }
                    } else if (char === "\\n") { result += "\\\\n"; escaped = false; } 
                    else if (char === "\\r") {
                        if (clean[i + 1] !== "\\n") result += "\\\\r";
                        escaped = false;
                    } else { result += char; escaped = false; }
                } else {
                    if (char === '"') { inString = true; escaped = false; result += char; } 
                    else result += char;
                }
            }
            let finalClean = result.replace(/\\/\\/.*/g, '').replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/,([\\s]*[\\]}])/g, '$1');
            try { return JSON.stringify(JSON.parse(finalClean), null, 4); } catch (err) { return finalClean; }
        }

        function onTryFixJson() {
            const textarea = document.getElementById('plan-code');
            if (!textarea.value.trim()) { showToast("JSON is empty.", "warning"); return; }
            const fixed = tryFixJSON(textarea.value);
            textarea.value = fixed;
            validatePlanJSON();
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
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // ==========================================
        // CLIENT-SIDE CODE SURGERY SIMULATION ENGINE
        // ==========================================
        function applyPlanClientSide(plan, originalText, targetFile) {
            let workingText = String(originalText ?? ""); 
            plan.edits.forEach(edit => {
                if (!clientEditTargetsFile(edit.file, targetFile)) return;
                if (edit.operation === "create_file") {
                    workingText = String(edit.content ?? "");
                    return;
                }
                workingText = clientApplyEdit(workingText, edit);
            });
            return workingText;
        }

        function clientApplyEdit(content, edit) {
            const find = edit.find; 
            const replace_with = edit.replace_with;
            const occurrence = edit.occurrence || "unique";

            const predominantLineEnding = (content.match(/\\r\\n/g) || []).length > (content.match(/\\n/g) || []).length / 2 ? "\\r\\n" : "\\n";

            switch (edit.operation) {
                case "replace":
                    if (typeof find === "string") return clientReplaceMatches(content, find, replace_with, occurrence);
                    const range = clientGetLineOffsets(content, edit.line_start, edit.line_end);
                    const replacement = String(replace_with || "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding);
                    return content.slice(0, range.start) + replacement + content.slice(range.end);
                case "insert_before":
                    return clientInsertMatches(content, find, edit.insert ?? edit.content, occurrence, "before");
                case "insert_after":
                    return clientInsertMatches(content, find, edit.insert ?? edit.content, occurrence, "after");
                case "delete":
                    if (typeof find === "string") return clientDeleteMatches(content, find, occurrence);
                    const delRange = clientGetLineOffsets(content, edit.line_start, edit.line_end);
                    return content.slice(0, delRange.start) + content.slice(delRange.end);
                case "append":
                    return content + String(edit.content ?? edit.insert ?? "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding);
                case "prepend":
                    return String(edit.content ?? edit.insert ?? "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding) + content;
                case "ensure_import":
                    return clientEnsureImport(content, edit);
                default:
                    throw new Error("Operation not supported or cannot be simulated in sandbox.");
            }
        }

        function clientReplaceMatches(content, anchor, replacement, occurrence) {
            const predominantLineEnding = (content.match(/\\r\\n/g) || []).length > (content.match(/\\n/g) || []).length / 2 ? "\\r\\n" : "\\n";
            const replacementAdapted = String(replacement || "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding);
            const matches = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const match of [...matches].reverse()) {
                output = output.slice(0, match.index) + replacementAdapted + output.slice(match.index + match.length);
            }
            return output;
        }

        function clientInsertMatches(content, anchor, insertion, occurrence, mode) {
            const predominantLineEnding = (content.match(/\\r\\n/g) || []).length > (content.match(/\\n/g) || []).length / 2 ? "\\r\\n" : "\\n";
            const insertionAdapted = String(insertion || "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding);
            const matches = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const match of [...matches].reverse()) {
                const insertAt = mode === "before" ? match.index : match.index + match.length;
                output = output.slice(0, insertAt) + insertionAdapted + output.slice(insertAt);
            }
            return output;
        }

        function clientDeleteMatches(content, anchor, occurrence) {
            const matches = clientSelectMatches(content, anchor, occurrence);
            let output = content;
            for (const match of [...matches].reverse()) {
                output = output.slice(0, match.index) + output.slice(match.index + match.length);
            }
            return output;
        }

        function clientEnsureImport(content, edit) {
            const predominantLineEnding = (content.match(/\\r\\n/g) || []).length > (content.match(/\\n/g) || []).length / 2 ? "\\r\\n" : "\\n";
            let statement = edit.import_statement ?? edit.content;
            statement = String(statement || "").replace(/\\r\\n/g, "\\n").replace(/\\n/g, predominantLineEnding);

            if (!statement.trim()) throw new Error("ensure_import requires import_statement or content.");
            if (content.replace(/\\r\\n/g, "\\n").includes(String(edit.import_statement ?? edit.content).replace(/\\r\\n/g, "\\n"))) {
                return content;
            }

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
                const needsCR = lines[lastImportLine].endsWith("\\r");
                const statementToInsert = needsCR && !statement.endsWith("\\r") ? statement + "\\r" : statement;
                lines.splice(lastImportLine + 1, 0, statementToInsert);
                return lines.join('\\n');
            }
            return statement + predominantLineEnding + content;
        }

        function escapeRegExpClient(string) {
            return string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
        }

        function clientFindAll(content, anchor) {
            anchor = String(anchor || "");
            if (!anchor) throw new Error("find anchor cannot be empty.");

            const escapedAnchor = escapeRegExpClient(anchor.replace(/\\r\\n/g, "\\n"));
            const regexSource = escapedAnchor.replace(/\\\\n/g, '\\\\r?\\\\n');
            const regex = new RegExp(regexSource, 'g');

            const positions = [];
            let match;
            while ((match = regex.exec(content)) !== null) {
                positions.push({ index: match.index, length: match[0].length });
                if (match[0].length === 0) regex.lastIndex++;
            }
            return positions;
        }

        function clientDiagnoseFailedFind(content, anchor) {
            const hints = [];
            const contentNorm = content.replace(/\\r\\n/g, "\\n");
            const anchorNorm = String(anchor || "").replace(/\\r\\n/g, "\\n");

            const normalizeWS = s => String(s || "").replace(/[ \\t]+/g, " ").replace(/^[ \\t]+/gm, "").trim();
            if (normalizeWS(contentNorm).includes(normalizeWS(anchorNorm))) {
                hints.push("Whitespace-normalized version WAS found — likely wrong indentation or tabs vs spaces.");
            }
            const anchorLines = anchorNorm.split("\\n").map(l => l.trim()).filter(Boolean);
            if (anchorLines.length > 0) {
                const firstLine = anchorLines[0];
                const lineNums = contentNorm.split("\\n")
                    .map((l, i) => l.includes(firstLine) ? i + 1 : null)
                    .filter(Boolean);
                if (lineNums.length > 0) hints.push(\`First anchor line found at line(s): \${lineNums.slice(0, 5).join(", ")} — mismatch is in following lines.\`);
                else hints.push("First anchor line NOT found in file — anchor may reference already-changed or nonexistent code.");
            }
            if (anchorNorm.split("\\n").length > 4) hints.push(\`Anchor is \${anchorNorm.split("\\n").length} lines long — consider a shorter 1–2 line anchor.\`);
            return hints;
        }

        function clientSelectMatches(content, anchor, occurrence) {
            const matches = clientFindAll(content, anchor);
            if (matches.length === 0) {
                const preview = anchor.length > 80 ? anchor.slice(0, 80) + "…" : anchor;
                const hints = clientDiagnoseFailedFind(content, anchor);
                const hintsText = hints.length > 0 ? "\\n\\nHints:\\n" + hints.map(h => "  • " + h).join("\\n") : "";
                throw new Error(\`Anchor not found: \${JSON.stringify(preview)}\${hintsText}\`);
            }
            if (occurrence === "unique" || occurrence === null || occurrence === undefined) {
                if (matches.length !== 1) {
                    const lineNums = matches.map(m => content.slice(0, m.index).split("\\n").length);
                    throw new Error(\`Expected unique match, found \${matches.length} occurrences at line(s): \${lineNums.join(", ")}. Use "occurrence": 1, 2, … or "all".\`);
                }
                return [matches[0]];
            }
            if (occurrence === "all") return matches;
            const num = Number(occurrence);
            if (Number.isInteger(num) && num >= 1 && num <= matches.length) return [matches[num - 1]];
            throw new Error(\`Invalid occurrence: \${JSON.stringify(occurrence)}. Use "unique", "all", or integer 1–\${matches.length}.\`);
        }

        function clientGetLineOffsets(content, lineStart, lineEnd) {
            const lines = content.split('\\n');
            let start = 0;
            for (let i = 0; i < lineStart - 1; i++) start += lines[i].length + 1;
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