# WAV.builder Copy Audit Workflow (VS Code)

Follow these steps in VS Code to clean up existing changelogs, help texts, and documentation without duplicating folders or risking broken JSX logic.

---

## Step 1: Create a Clean Git Branch

Open the VS Code terminal in your `WAV.builder` repository and create a dedicated branch so every text change is isolated and easy to review in the Git tab:

```bash
git checkout -b chore/copy-audit
```

---

## Step 2: Add the Style Guide to Your Repo

1. Create a `.claude/rules/` folder in your project root (if it doesn't exist yet).
2. Drop the downloaded `writing-style.md` file into `.claude/rules/writing-style.md`.
3. *(Optional)* If you use a root `CLAUDE.md` file, add a single line referencing `@.claude/rules/writing-style.md` so Claude always loads it automatically.

---

## Step 3: Fast Regex Search in VS Code (Zero-LLM Quick Wins)

Before running Claude, you can spot all existing dash habits and brochure words in 10 seconds using VS Code's built-in search.

1. Press `Ctrl+Shift+F` (Windows/Linux) or `Cmd+Shift+F` (Mac) to open Global Search.
2. Click the **`.*` (Use Regular Expression)** icon in the search box.
3. In **files to include**, scope it to your docs and UI files: `*.md, *.tsx, *.ts, *.json`

Paste any of these regex patterns to inspect matches immediately:

* **Find all em dashes and en dashes:**
  ```regex
  [—–]
  ```
* **Find spaced hyphen pivots in prose:**
  ```regex
  [a-zA-Z] - [a-zA-Z]
  ```
* **Find common LLM brochure words:**
  ```regex
  \b(seamless|seamlessly|robust|comprehensive|streamline|leverage|utilize|delve|crucial|effortlessly|tailored|empowers)\b
  ```
* **Find dangling "-ing" justifications after commas:**
  ```regex
  ,\s+(ensuring|enabling|providing|making it|allowing you to)\b
  ```

---

## Step 4: Pass 1 (Generate the Read-Only Audit Ledger)

Open Claude in VS Code and run this prompt on one area at a time (start with your changelogs and README, then move to `src/components/`).

### Copy-Paste Prompt for Pass 1:

```text
Read `.claude/rules/writing-style.md`.

I want to audit our existing copy in a structured, read-only pass. Do NOT edit any source files yet.

Scan the following target paths:
- `README.md`
- `CHANGELOG.md` (or our news/updates files)
- `src/components/` (focus on help modals, tooltips, and user-facing messages)

Look for violations of `.claude/rules/writing-style.md`, specifically:
1. Em dashes (`—`), en dashes (`–`), or spaced pivot hyphens (` - `)
2. Dangling "-ing" justifications (e.g., ", ensuring...", ", making it...")
3. Brochure words (seamless, robust, comprehensive, utilize, etc.)
4. Self-referential help text ("This button allows you to...")

Generate a single file named `COPY_AUDIT.md` grouped into three sections:
1. Changelogs & News Updates
2. In-App Help Texts, Modals, and Tooltips
3. README & Developer Docs

For every violation found, output a Markdown table row with:
| File & Line | Rule Violated | Current Text | Proposed Rewrite |

Ignore variable names, CSS classes, and code logic. Only audit human-readable strings, comments, and markdown prose.
```

---

## Step 5: Review `COPY_AUDIT.md`

1. Open the generated `COPY_AUDIT.md` file in VS Code.
2. Scan the **Proposed Rewrite** column.
3. Delete any table row you don't want changed, or directly edit the **Proposed Rewrite** cell if you want a specific phrasing for a WAV/hardware term.

---

## Step 6: Pass 2 (Apply Approved Changes)

Once `COPY_AUDIT.md` only contains changes you approve, run this second prompt:

### Copy-Paste Prompt for Pass 2:

```text
Read `COPY_AUDIT.md`.

Apply the exact "Proposed Rewrite" text to each corresponding file and line listed in `COPY_AUDIT.md`. 
Do not alter any code logic, JSX structure, props, or strings not listed in the table.
When finished, delete `COPY_AUDIT.md`.
```

Finally, open the **Source Control (`Ctrl+Shift+G`)** tab in VS Code to do a quick visual diff check before committing your branch.