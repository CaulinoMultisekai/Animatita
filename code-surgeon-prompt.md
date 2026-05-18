You will receive:
1. A user request.
2. Repository context.
3. A LOCAL_FILE_TREE generated from the user's actual local project root.

The LOCAL_FILE_TREE is the source of truth for file paths.

Your task is to return a machine-readable Code Surgery Plan for an automated code editing tool named code-surgeon.mjs.

Your entire response must start with exactly:

```json

Your entire response must end with exactly:

```

Do not write anything before or after the JSON code block.

Inside the code block, return valid JSON only.

The JSON must be directly parseable with JSON.parse after removing the opening ```json and closing ``` fences.

Critical JSON rules:
1. Use double quotes for all keys and string values.
2. Do not use comments.
3. Do not use trailing commas.
4. Do not use single quotes.
5. Do not use undefined.
6. Do not use markdown inside JSON string values unless it is intentionally escaped.
7. Multiline code must be encoded as a JSON string using \n escape sequences.
8. Never place raw unescaped line breaks inside JSON strings.
9. Never use placeholder syntax like <file>, {{code}}, or "...".
10. Use null only when a value is intentionally unknown.
11. If a field is not needed for an edit, omit it instead of filling it with fake data.
12. The output must contain exactly one JSON object.
13. The JSON object must contain an "edits" array, even when empty.

Supported edit operations:
- replace
- insert_before
- insert_after
- delete
- create_file
- append
- prepend
- ensure_import

Required root object shape:

{
  "schema_version": "1.0",
  "dry_run": false,
  "backup": true,
  "stop_on_error": true,
  "edits": [],
  "validation": {
    "commands": [],
    "expected_result": ""
  },
  "notes": {
    "requires_manual_review": false,
    "risk_level": "low"
  }
}

Path rules are critical.

The "file" field must always be a local repository-relative path.

Every edit.file value must be copied from LOCAL_FILE_TREE exactly.

Never output:
- Absolute paths
- Windows drive paths
- Workspace paths
- GitHub owner names
- GitHub repository names
- Temporary extraction folder names
- Uploaded folder names
- Parent folders above the actual project root
- Backslashes

Always output paths exactly as they should exist from the local project root.

Correct examples:
"src/App.tsx"
"src/main.tsx"
"package.json"
"vite.config.ts"

Incorrect examples:
"C:\\Users\\User\\project\\src\\App.tsx"
"/mnt/data/repo/src/App.tsx"
"caulinomultisekai\\animatita\\Animatita-4124ac2584c77201b9328b6f1a4b88927a0a50b6\\src\\App.tsx"
"Animatita-4124ac2584c77201b9328b6f1a4b88927a0a50b6/src/App.tsx"

If the repository was loaded from a GitHub archive, ignore the extracted folder name and use only the path inside the actual project root.

When a local file tree is provided, the "file" value must match one of the paths from that local file tree exactly.

Use forward slashes only, even on Windows.

Before returning the JSON, internally normalize every file path:
1. Convert "\\" to "/".
2. Remove any leading "./".
3. Remove any GitHub owner, repository, archive, workspace, or extracted folder prefix.
4. Keep only the path relative to the project root.
5. Verify the final path exists in LOCAL_FILE_TREE.
6. If the final path is not present in LOCAL_FILE_TREE, do not invent it. Return requires_manual_review: true.

Anchor rules:

"find" is used for character-exact string matching. The tool uses indexOf() — there is no fuzzy matching, no regex, no whitespace normalization. A single wrong space, tab, or missing newline causes the edit to fail completely.

Before writing any "find" value, ask yourself: "Would this string appear exactly — byte for byte — in the file as shown?" If you are not 100% certain, choose a safer strategy.

1. Prefer exact "find" anchors over line numbers.
2. The "find" value must match existing code exactly, including all leading whitespace, trailing whitespace, and newlines.
3. Use "occurrence": "unique" when the anchor appears once.
4. Use "occurrence": 1, 2, 3, etc. only when editing a specific repeated occurrence.
5. Use "occurrence": "all" only when every occurrence must be edited.
6. If no safe unique anchor exists, do not invent one.
7. If using line_start and line_end, use 1-based line numbers only.
8. Use line ranges only when exact line numbers are known from the supplied local file content.

Find anchor quality rules — follow these to avoid match failures:

RULE F1 — Prefer the shortest unique anchor.
Use the smallest substring that uniquely identifies the location. A single distinctive line is almost always better than a multiline block. Long anchors break if any line in the middle was already modified or has different whitespace.

  GOOD:  "find": "export default function UserProfile("
  BAD:   "find": "export default function UserProfile(\n  props: UserProfileProps\n) {\n  const [open, setOpen] = useState(false);"

RULE F2 — Never include more than 4 lines in a "find" unless you have the raw file content proving it matches exactly.
Every extra line is another opportunity for the match to fail.

RULE F3 — Indentation must match the file exactly.
If the file uses 2-space indent, the anchor must have 2-space indent. If it uses tabs, the anchor must have tabs. Do not guess — copy from the provided file content.

  GOOD (file uses 2-space indent):  "find": "  const value = useMemo("
  BAD (assumed 4-space indent):    "find": "    const value = useMemo("

RULE F4 — Do not include trailing whitespace or trailing newlines in the anchor unless the file has them.
A "find" that ends with \n when the line has no trailing newline will fail silently.

RULE F5 — When the anchor might be non-unique, expand it by one line of surrounding context rather than using "occurrence": 1 blindly.
Expanding the anchor is safer than relying on occurrence numbering, which can shift if the file was already partially modified.

RULE F6 — If the file content is not provided and you cannot verify the exact anchor, use line_start/line_end instead of "find".
Known line numbers from the file tree or tool output are more reliable than a guessed string anchor.

  Safe fallback:
  {
    "operation": "replace",
    "file": "src/utils.ts",
    "line_start": 42,
    "line_end": 45,
    "replace_with": "...",
    "reason": "Used line range because file content was not available to verify exact anchor."
  }

RULE F7 — For multiline anchors encoded as JSON strings, verify the \n placement.
Each \n in the JSON string must correspond to an actual newline in the file. A missing or extra \n at the start or end of the find string is the most common cause of match failure.

  GOOD:  "find": "function foo() {\n  return bar;"   (starts at 'function', not '\nfunction')
  BAD:   "find": "\nfunction foo() {\n  return bar;"  (leading \n often causes a miss)

Safety rules:
1. Do not propose vague edits.
2. Do not explain the implementation outside JSON.
3. Do not include manual instructions as edits.
4. Do not include comments like "// change this" inside JSON unless that comment is part of the actual code being written.
5. Do not output partial JSON.
6. Do not output multiple JSON blocks.
7. Do not include markdown headings, bullet points, or prose outside the fenced JSON block.
8. If the requested change cannot be safely automated, return an empty edits array and set requires_manual_review to true.
9. Always include validation commands when possible, especially for Vite or Node projects.
10. Keep risk_level as one of: "low", "medium", "high".

For Vite + Node projects, prefer these validation commands when applicable:
- npm run build
- npm run lint
- npm test

If no validation command is known, use:
"commands": []

Example of a valid final answer:

```json
{
  "schema_version": "1.0",
  "dry_run": false,
  "backup": true,
  "stop_on_error": true,
  "edits": [
    {
      "id": "E001",
      "operation": "replace",
      "file": "src/App.jsx",
      "find": "const title = \"Old Title\";",
      "replace_with": "const title = \"New Title\";",
      "occurrence": "unique",
      "reason": "Update displayed title."
    }
  ],
  "validation": {
    "commands": [
      "npm run build"
    ],
    "expected_result": "The project builds successfully."
  },
  "notes": {
    "requires_manual_review": false,
    "risk_level": "low"
  }
}
```

Now generate the Code Surgery Plan for the provided repository/request.
