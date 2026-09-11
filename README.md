<!-- @format -->

# secaudit

`secaudit` is a command-line tool that checks your project's dependencies
for known security vulnerabilities. You don't need to be a security expert
to use it — run one command, get a plain-language summary, and open a
report in your browser if you want the details.

## What problem does this solve?

Every Node.js project depends on hundreds of third-party packages, and some
of those packages have known security issues (a vulnerable version of
`lodash`, for example). There are already good free tools that can find
these issues — `npm audit`, `retire.js`, and `cve-lite-cli` , but each one
has its own command, its own flags, and its own output format, and none of
them remember what you found last time so you can tell if things got
better or worse.

`secaudit` runs all three tools for you with sensible defaults, saves every
scan so nothing is ever overwritten, and can generate a before/after
comparison report when you fix something and want to confirm the fix
actually worked.

`secaudit` does not invent its own vulnerability database or its own HTML
report designs — it deliberately reuses what the underlying tools already
produce:

- `npm audit` doesn't generate an HTML page by itself, so `secaudit` pipes
  its output through a small helper called `audit-export`, which turns it
  into one.
- `cve-lite-cli` already generates its own HTML page directly.
- `secaudit`'s job is to run these tools correctly, save everything they
  produce to disk, and open the HTML pages in your browser automatically.
- `retire.js` doesn't have an HTML report of its own. Its findings show up
  in the terminal summary and in `secaudit`'s Markdown comparison report
  instead.

## Requirements

- **Node.js 18 or newer.** `npm` comes bundled with Node.js, so if you have
  Node installed, you already have `npm` — there's nothing extra to
  install for it.
- **`retire`, `cve-lite-cli`, and `audit-export`** installed globally. You
  don't need to install these yourself first — run `secaudit init` (see
  below) and it will check for each one and offer to install any that are
  missing.

## Install

`secaudit` isn't published to the npm registry yet (see [Project stages](#project-stages)
below). For now, install it straight from GitHub:

```bash
npm install -g git+https://github.com/DonAmit197/secaudit.git
```

This makes the `secaudit` command available everywhere on your machine,
the same way a normal npm-registry global install would. To install a
specific version later instead of always getting the latest code, add a
tag: `...secaudit.git#v0.1.0` (see [Releases and versioning](#releases-and-versioning)).

## Quick start

Run these two commands inside the project you want to scan (not inside
`secaudit` itself):

```bash
secaudit init      # one-time setup — run this first in a new project
secaudit scan      # run all three scanners and see the results
```

That's it for the happy path. Everything below explains what each command
does in more detail.

## Commands

### `secaudit init`

Run this once per project, before your first scan. It:

1. Creates the `audits/` folder structure (see below) where every future
   scan will be saved.
2. Checks whether `npm`, `retire`, `cve-lite-cli`, and `audit-export` are
   installed and reachable. If any are missing, it asks (yes/no) whether
   to install them for you.
3. Asks (yes/no) whether to add `audits/` to your `.gitignore`. Scan
   results can contain a lot of detail about your dependencies, so most
   teams choose not to commit them — but the choice is yours.

It's safe to run `secaudit init` again later; it won't undo anything you
already have.

### `secaudit scan`

Runs `npm audit`, `retire.js`, and `cve-lite-cli` against the current
project, saves every tool's raw output, and prints a plain-language
summary like:

```
2 critical, 4 high, 2 moderate — 8 total (across all three tools)
```

Two of the three tools also get an HTML report opened in your browser:
`npm audit`'s (via `audit-export`) and `cve-lite-cli`'s. `retire.js` has no
HTML report of its own — its raw `report.json` is still saved to the
`audits/retire/` folder like the other two tools (see
[What gets created on disk](#what-gets-created-on-disk)), but to actually
read its findings you'll use the terminal summary or `secaudit compare`'s
Markdown report, not a browser page.

Options:

- `--label <name>` — name this checkpoint something memorable, e.g.
  `--label before-upgrade`. If you don't pass one, `secaudit` derives a
  label from your `package.json` version instead (`release-1.2.0`).
- `--no-open` — don't automatically open the two generated HTML reports
  (`npm audit`'s and `cve-lite-cli`'s) in your browser. Useful when running
  in a script, or on a machine with no browser. (By default, they **do**
  open automatically.)

**Every scan is kept — nothing is ever overwritten.** If you run
`secaudit scan` twice with the same label (e.g. you didn't bump the
version and didn't pass `--label`), `secaudit` will refuse the second
run and tell you to either pass a different `--label` or bump your
project's version first. This is intentional: it stops you from silently
losing a previous scan's results.

### `secaudit compare [before-label] [after-label]`

Compares two saved scans and writes a Markdown report showing what
security issues were fixed, what's still open, and what's newly appeared
since the "before" scan.

```bash
secaudit compare                      # compares the two most recent scans
secaudit compare before-upgrade after-upgrade   # compares two specific scans by label
```

The report is written to `audits/comparisons/<before>_vs_<after>.md` and
`secaudit` prints the file path — it does not open it automatically (it's
a Markdown file meant to be read in your editor, pasted into a PR
description, etc., not a browser report).

Pass `--before-timestamp <iso>` if you have multiple scans that share the
same label and want to compare against an older one specifically rather
than the most recent match.

### `secaudit list`

Shows every scan you've saved for this project, oldest information first,
with a one-line summary of each — useful for finding a label to pass to
`secaudit compare`, or just checking what's been scanned so far.

## What gets created on disk

Running `secaudit init` followed by a couple of `secaudit scan` calls
produces a folder structure like this, inside your project (not inside
`secaudit` itself):

```
your-project/
└── audits/
    ├── npm-audit/
    │   └── <timestamp>_<label>/
    │       ├── report.json         raw npm audit output, full dependency tree
    │       ├── report-prod.json    raw npm audit output, production deps only
    │       └── report.html         browsable HTML report (via audit-export)
    ├── retire/
    │   └── <timestamp>_<label>/
    │       └── report.json         raw retire.js output
    ├── cve-audit/
    │   └── <timestamp>_<label>/
    │       ├── report.json         raw cve-lite-cli output
    │       └── index.html          browsable HTML report (from cve-lite-cli)
    └── comparisons/
        └── <before-label>_vs_<after-label>.md   output of `secaudit compare`
```

`<timestamp>` looks like `2026-09-11T10-27-21Z` and `<label>` is whatever
you passed to `--label` (or the version-derived default). A folder is
created fresh for every single `secaudit scan` run — none of them are ever
reused or overwritten.

## How the three tools differ (and a known limitation)

The three tools don't always agree on numbers, and that's expected —
they're not measuring the exact same thing:

- **`npm audit`** and **`cve-lite-cli`** both check your dependency
  manifest (`package-lock.json`) against a vulnerability database — but
  different ones (GitHub's Advisory Database vs. OSV), and they count
  results differently (advisories-per-package vs. findings-per-package-
  version). Don't expect their totals to match exactly; that's normal.
- **`retire.js`** works differently: instead of reading the manifest, it
  scans actual `.js` file contents on disk looking for known-vulnerable
  code. This means it reliably catches vulnerable packages sitting in
  `node_modules/`, but **it does not reliably catch the same vulnerable
  code once it's been bundled and minified** into a production build
  (`dist/`, `.next/`, etc.) — bundler minification changes the file enough
  that retire's detection signatures usually stop matching, even though
  the vulnerable code is genuinely present in the bundle. This was
  confirmed directly during testing: a bundle that provably contained the
  vulnerable library's code was still not flagged by retire.

**Practical implication:** for frontend/bundler-based projects, treat
`retire.js`'s findings as `node_modules`-level coverage only. `npm audit`
and `cve-lite-cli` (which read the manifest, not built output) are the
tools that reliably cover what actually ships in your production bundle.

There's one more limitation worth knowing about, though it's already
worked around for you: `audit-export` (the helper `secaudit` uses to turn
`npm audit`'s output into an HTML report) has its own `--open` flag for
auto-opening the report, but that flag is broken on Windows — it never
actually opens a browser there. `secaudit` doesn't rely on that flag; it
opens the generated `report.html` itself instead, so auto-opening works
correctly on Windows regardless of that upstream bug.

## Project stages

This project is being rolled out in three stages, and it's currently
between Stage 1 and Stage 2:

- **Stage 1 — Local testing: done.** Built and verified against four real
  project types (vanilla Node, Vite+React, Next.js, Vue), each seeded with
  real known-vulnerable dependencies and a real production build.
- **Stage 2 — GitHub install: in progress.** The target repository is
  `https://github.com/DonAmit197/secaudit`. Your team installs directly
  from GitHub (see [Install](#install) above) — not from the npm registry.
  This is still a testing phase with more people involved; finding bugs
  here is expected, not a sign something was missed earlier.
- **Stage 3 — npm publish: parked on purpose.** `secaudit` will not be
  published to the public (or a private/restricted) npm registry until the
  internal team has tested it via the GitHub install above, and there has
  been an explicit decision to move forward. No `publishConfig` should be
  added to `package.json` and `npm publish` should not be run until then.

## Releases and versioning

Once real users start depending on specific versions (Stage 2 onward), new
changes should be released deliberately rather than just pushed to the
main branch, so that a team member's `secaudit` doesn't silently change
underneath them. The intended process:

1. Decide the new version number following [semver](https://semver.org/)
   (`MAJOR.MINOR.PATCH`) — bug fix → patch, new command/option → minor,
   breaking change to an existing command → major.
2. Update the `version` field in `package.json` to that number.
3. Commit the change, then tag the commit: `git tag v<version>` (e.g.
   `git tag v0.2.0`), and push both the commit and the tag
   (`git push && git push --tags`).
4. Anyone who wants that exact version installs it with the tag pinned:
   `npm install -g git+https://github.com/DonAmit197/secaudit.git#v0.2.0`.
   Installing without a `#tag` always gets whatever is currently on the
   default branch.

Worth knowing: `secaudit scan`'s own default label (`release-<version>`)
reads from this same `package.json` version field — so bumping the version
for a release also changes what your next un-labeled scan will be called.

Once Stage 3 is approved, this same tagged-version process is what gets
published to npm (`npm publish` from the tagged commit), so adopting this
now costs nothing and pays off later.
