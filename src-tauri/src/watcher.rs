// Watch each discovered repo's .git directory. Any change (a `git commit`,
// `git checkout`, branch update, fetch, etc.) bubbles up to a debounced
// refresh that re-reads that repo's recent commits and emits a
// `timeline://repo-fill` event the frontend already knows how to merge.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{cache, git};

/// How recent a commit has to be to enter the streamed payload. Matches the
/// panel's default time window so the merge in the frontend is meaningful.
const REFRESH_WINDOW_DAYS: i64 = 7;
const REFRESH_MAX_PER_REPO: usize = 10;
const DEBOUNCE_MS: u64 = 500;

#[derive(Serialize, Clone)]
struct RepoFillPayload {
    commits: Vec<git::CommitSummary>,
    fresh: bool,
}

pub struct RepoWatcher {
    inner: Arc<Mutex<RecommendedWatcher>>,
    watched: Arc<Mutex<HashSet<PathBuf>>>,
}

impl RepoWatcher {
    pub fn start(app: AppHandle) -> anyhow::Result<Self> {
        let last_fired: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let lf = Arc::clone(&last_fired);
        let app_for_event = app.clone();

        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else {
                return;
            };
            let Some(path) = event.paths.first() else {
                return;
            };

            // Walk up to the .git directory we're watching, then take its parent
            // as the repo root.
            let Some(git_dir) = path.ancestors().find(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n == ".git")
                    .unwrap_or(false)
            }) else {
                return;
            };
            let Some(repo_path) = git_dir.parent().map(|p| p.to_path_buf()) else {
                return;
            };

            // Per-repo debounce — `git commit` fires several writes inside
            // .git in quick succession.
            {
                let mut lf = lf.lock().unwrap();
                let now = Instant::now();
                if let Some(prev) = lf.get(&repo_path) {
                    if now.duration_since(*prev) < Duration::from_millis(DEBOUNCE_MS) {
                        return;
                    }
                }
                lf.insert(repo_path.clone(), now);
            }

            let app2 = app_for_event.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
                refresh_repo(&app2, &repo_path);
            });
        })?;

        Ok(Self {
            inner: Arc::new(Mutex::new(watcher)),
            watched: Arc::new(Mutex::new(HashSet::new())),
        })
    }

    pub fn add(&self, repo_path: &Path) {
        let git_dir = repo_path.join(".git");
        if !git_dir.is_dir() {
            // Worktrees keep .git as a file pointing at the common dir.
            // Skip for v0.1 — main usecase is normal clones.
            return;
        }
        let canon = git_dir.canonicalize().unwrap_or(git_dir);
        let mut watched = self.watched.lock().unwrap();
        if watched.contains(&canon) {
            return;
        }
        let mut w = self.inner.lock().unwrap();
        if w.watch(&canon, RecursiveMode::Recursive).is_ok() {
            watched.insert(canon);
        }
    }
}

fn refresh_repo(app: &AppHandle, repo_path: &Path) {
    let cutoff = unix_now() - REFRESH_WINDOW_DAYS * 86_400;
    let Ok(commits) = git::recent_commits(repo_path, REFRESH_MAX_PER_REPO, cutoff) else {
        return;
    };
    if commits.is_empty() {
        return;
    }

    if let Ok(mut conn) = cache::open(app) {
        let _ = cache::upsert_commits(&mut conn, &commits);
    }

    let _ = app.emit(
        "timeline://repo-fill",
        RepoFillPayload { commits, fresh: true },
    );
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
