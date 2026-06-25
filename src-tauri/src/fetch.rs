//! One-shot `git fetch` on panel summon (opt-in, default on).
//!
//! gitwink's libgit2 is built without a network transport, so fetching is
//! impossible through it — and `git.rs` is contractually read-only. This
//! module instead shells out to the SYSTEM `git` binary for a single,
//! non-interactive `git fetch` of the currently-viewed repo when the tray
//! panel is summoned, so a teammate's just-pushed commit surfaces. The
//! existing file-watcher turns the resulting `refs/remotes/*` update into a
//! timeline refresh, so all this module does is *trigger* the fetch.
//!
//! Guarantees: async/non-blocking (runs on a blocking thread), never
//! interactive (no credential prompt — silent no-op on auth failure / no
//! git / no remote / no network), per-repo cooldown, single-repo mode only.
//! Fetch is NOT a mutation of your work — it only updates the local mirror of
//! remote refs + downloads objects; it never touches your branches, working
//! tree, or history (which is the real read-only/safety guarantee).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Skip a repo's fetch if we fetched it within this window.
pub const FETCH_COOLDOWN: Duration = Duration::from_secs(180);

/// Hard cap on a single fetch — a hung network call is killed past this.
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

/// Per-repo last-fetch timestamps so repeated summons don't spam the remote.
/// Managed Tauri state; keyed by the repo path the frontend passes (the same
/// key the rest of the IPC surface uses — no canonicalization).
pub struct FetchCooldown(Mutex<HashMap<PathBuf, Instant>>);

impl Default for FetchCooldown {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

impl FetchCooldown {
    /// Atomically check-and-record: returns true (and stamps `now`) if the
    /// repo is eligible to fetch, false if it was fetched within `interval`.
    /// Claimed BEFORE spawning so rapid re-summons during an in-flight fetch
    /// are also suppressed. Fail-closed on a poisoned lock (skip the fetch).
    pub fn try_claim(&self, repo: &Path, interval: Duration) -> bool {
        let Ok(mut map) = self.0.lock() else {
            return false;
        };
        let now = Instant::now();
        match map.get(repo) {
            Some(last) if now.duration_since(*last) < interval => false,
            _ => {
                map.insert(repo.to_path_buf(), now);
                true
            }
        }
    }
}

/// Fire a single non-interactive `git fetch` against `repo`. Blocks the
/// calling thread — run it under `spawn_blocking`. Every failure mode (no
/// git on PATH, no remote, auth required, network down, repo gone) is
/// swallowed silently; this feature must never surface an error or a prompt.
pub fn git_fetch_one_shot(repo: &Path) {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["fetch", "--quiet", "--no-tags", "--no-write-fetch-head"])
        // Non-interactive: never pop a credential prompt. GIT_TERMINAL_PROMPT
        // disables git's own TTY prompt; GIT_ASKPASS=echo makes any askpass
        // return empty creds (auth fails fast instead of hanging); GCM's GUI
        // is suppressed too. `echo` is on PATH on both Windows and POSIX.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "echo")
        .env("GCM_INTERACTIVE", "never")
        // ssh consults SSH_ASKPASS (not GIT_ASKPASS); forbid its GUI prompt so
        // a key passphrase fails fast instead of popping a dialog. We do NOT
        // override the ssh binary itself (custom ssh/plink setups keep working);
        // nulled stdio + no TTY + the timeout below bound the rest.
        .env("SSH_ASKPASS_REQUIRE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // CREATE_NO_WINDOW — no console flash when spawning git on Windows.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    if let Ok(child) = cmd.spawn() {
        wait_with_timeout(child, FETCH_TIMEOUT);
    }
}

/// Poll-wait for the child, killing it past `timeout`. `std::process` has no
/// native timeout; a short poll loop avoids pulling in an async-process dep.
fn wait_with_timeout(mut child: std::process::Child, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return,
        }
    }
}
