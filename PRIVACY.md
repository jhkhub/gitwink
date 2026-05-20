# gitwink Privacy Policy

_Last updated: 2026-05-20_

gitwink is a tray-resident, read-only tool for glancing at recent commit
activity across your local Git repositories.

## Summary

gitwink does not collect, store, or transmit any personal information.
Everything it reads stays on your own computer.

## What gitwink accesses

To do its job, gitwink reads — locally, on your machine — the Git
repositories you point it at or that it discovers in common project
folders:

- Commit metadata (messages, author names and email addresses,
  timestamps, branch and tag names) from each repository's Git history.
- File contents and diffs, when you open a commit to inspect it.

This information is read directly from your local `.git` directories. It
is **never** sent anywhere.

## What gitwink stores

gitwink keeps a local cache and your settings on your own machine, under
your user profile (`%APPDATA%\gg.var.gitwink` on Windows):

- `cache.db` — a SQLite cache of repository and commit data so the app
  paints quickly.
- `settings.json` — your preferences (panel position, pinned
  repositories, update-check mode, and similar).

These files never leave your computer. Uninstalling gitwink or deleting
that folder removes them.

## Network activity

gitwink has no account, no telemetry, no analytics, and no advertising.
It does not phone home.

The only network activity is the optional update checker: gitwink may
contact GitHub to see whether a newer release is available and, if you
choose to update, to download it. Those requests go to GitHub and are
subject to [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
No information about you or your repositories is included in them. You
can set the update checker to manual or turn it off entirely in
`settings.json`.

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
