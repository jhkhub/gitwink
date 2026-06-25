# gitwink Privacy Policy

_Last updated: 2026-06-24_

gitwink is a tray-resident, read-only tool for glancing at recent commit
activity across your local Git repositories.

## Summary

gitwink is **read-only** — it never merges, pushes, rebases, or rewrites, so
it cannot alter or lose your work. It has no telemetry or analytics and sends
no information about you or your repositories to us. Its network use is
limited and optional, and goes only to services you already use: a check for
app updates (GitHub) and, if you enable it, a `git fetch` of the repository
you're viewing (your own remote, via your own Git credentials). See
[Network activity](#network-activity) below.

## What gitwink accesses

To do its job, gitwink reads — locally, on your machine — the Git
repositories you point it at or that it discovers in common project
folders:

- Commit metadata (messages, author names and email addresses,
  timestamps, branch and tag names) from each repository's Git history.
- File contents and diffs, when you open a commit to inspect it.

This information is read directly from your local `.git` directories and is
**never** sent to us or any third party. (If you enable auto-fetch, a
`git fetch` talks only to the Git remote you already configured for that
repository — see [Network activity](#network-activity).)

## What gitwink stores

gitwink keeps a local cache and your settings on your own machine, under
your user profile (`%APPDATA%\gg.var.gitwink` on Windows):

- `cache.db` — a SQLite cache of repository and commit data so the app
  paints quickly.
- `settings.json` — your preferences (panel position, pinned
  repositories, update-check mode, the auto-fetch toggle, and similar).

These files never leave your computer. Uninstalling gitwink or deleting
that folder removes them.

## Network activity

gitwink has no account, no telemetry, no analytics, and no advertising, and
it sends no information about you or your repositories to us. It makes only
two kinds of network request — both optional, both to services you already
use:

1. **App update check** — gitwink may contact GitHub to see whether a newer
   release is available and, if you choose to update, to download it. These
   requests go to GitHub and are subject to
   [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement);
   no information about you or your repositories is included in them. Set the
   update checker to manual or off in `settings.json`.
2. **Auto-fetch on panel open** _(optional)_ — when you're viewing a single
   repository, gitwink can run a quiet `git fetch` as the panel opens, so a
   teammate's just-pushed commit shows up. It uses your system `git` and your
   existing Git credentials to talk only to the remote you already configured
   for that repository — gitwink adds no destination of its own, and includes
   no extra data. It only **reads** remote state; it never pushes, merges, or
   rewrites. Turn it off in Settings → Auto-fetch (or `settings.json`).

## Third-party components

- gitwink's interface is rendered with Microsoft Edge WebView2, a Windows
  component governed by Microsoft's privacy terms.
- Update checks and downloads are served by GitHub, as described above.

## Children's privacy

gitwink is a developer tool, is not directed at children, and collects no
personal information from anyone.

## Changes to this policy

If this policy changes, the updated version will be published at this
same URL with a new "Last updated" date.

## Contact

Questions about privacy in gitwink: **admin@var.gg**

Issues and source code: <https://github.com/var-gg/gitwink>
