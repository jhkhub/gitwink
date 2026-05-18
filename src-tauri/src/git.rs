// Read-only git access via `git2`.
//
// HARD RULE: every call here must be read-only. No commits, fetches, pushes,
// merges, or any operation that mutates a repo's state on disk.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result};
use git2::{Oid, Repository, Sort};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub repo_path: String,
    pub repo_name: String,
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    /// Unix seconds.
    pub timestamp: i64,
    /// Branch-name hint for commits NOT reachable from the currently checked-out
    /// branch. None means "this commit is on the branch you're already on" (or
    /// HEAD is detached, in which case we suppress all labels to avoid noise).
    pub branch_label: Option<String>,
    /// True if this commit has more than one parent (merge commit).
    pub is_merge: bool,
    /// True if any tag points at this commit.
    pub is_tagged: bool,
    /// Parent commit SHAs in order (first parent, then merge parents).
    /// Needed by the DAG lane drawer in single-repo mode.
    pub parents: Vec<String>,
    /// Full commit message (summary + body). Surfaced in the inline
    /// expansion. Empty string if libgit2 couldn't decode it.
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub insertions: usize,
    pub deletions: usize,
    /// "modified" | "new" | "renamed" | "deleted" | "typechange"
    pub status: String,
    /// True if libgit2 (or our extension heuristic) thinks this file is
    /// binary — patch text won't be useful, image preview may be.
    pub is_binary: bool,
    /// Byte size on disk in the parent commit (None for newly-added files).
    pub old_size: Option<u64>,
    /// Byte size in this commit (None for deleted files).
    pub new_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileBlobs {
    pub old_base64: Option<String>,
    pub new_base64: Option<String>,
    /// Hint so the frontend can pick the right MIME type.
    pub extension: String,
    /// True if either side is a Git LFS pointer (the actual blob lives in
    /// LFS storage; gitwink doesn't fetch LFS in v0.1).
    pub is_lfs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub tip_hash: String,
    pub is_head: bool,
    pub commit_count: usize,
    /// Unix seconds of the tip commit, for "recent activity" sort.
    pub last_activity: i64,
}

/// Extension classification. We override libgit2's is_binary heuristic for
/// well-known text formats (Unity YAML can include NUL bytes inside long
/// fields and gets misclassified) and for unambiguous binaries.
fn extension_lc(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_known_text_ext(ext: &str) -> bool {
    matches!(
        ext,
        // Unity assets, all YAML in Force Text mode (Unity default).
        "unity" | "prefab" | "asset" | "mat" | "anim" | "controller" | "meta"
        | "asmdef" | "asmref" | "uxml" | "uss" | "shader" | "cginc"
        // Generic text
        | "yaml" | "yml" | "json" | "json5" | "toml" | "xml" | "html" | "htm"
        | "md" | "markdown" | "txt" | "csv" | "tsv" | "ini" | "cfg" | "conf"
        // Code
        | "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs"
        | "py" | "rb" | "go" | "java" | "kt" | "swift" | "c" | "h" | "cc"
        | "cpp" | "hpp" | "cs" | "fs" | "vb" | "scala" | "clj" | "lua" | "sh"
        | "bash" | "zsh" | "fish" | "ps1" | "psm1" | "bat" | "cmd"
        | "css" | "scss" | "sass" | "less"
        | "sql" | "graphql" | "gql" | "proto"
        | "dockerfile" | "gitignore" | "gitattributes" | "editorconfig"
    )
}

fn is_known_binary_ext(ext: &str) -> bool {
    matches!(
        ext,
        // Images (preview handled separately)
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" | "tif"
        // Audio / video
        | "mp3" | "mp4" | "wav" | "ogg" | "flac" | "m4a" | "mov" | "avi" | "webm" | "mkv"
        // Archives / packages
        | "zip" | "tar" | "gz" | "bz2" | "xz" | "rar" | "7z" | "jar" | "war"
        // Executables / libs
        | "exe" | "dll" | "so" | "dylib" | "a" | "o" | "obj" | "lib"
        // Documents / design
        | "pdf" | "psd" | "ai" | "sketch" | "fig"
        // 3D / Unity-shipped binaries
        | "fbx" | "blend" | "stl" | "ply" | "dae" | "max" | "ma" | "mb" | "abc"
        // Fonts
        | "ttf" | "otf" | "woff" | "woff2" | "eot"
        // Other
        | "db" | "sqlite" | "sqlite3" | "wasm"
    )
}

fn classify_binary(path: &str, git2_says_binary: bool) -> bool {
    let ext = extension_lc(path);
    if is_known_text_ext(&ext) {
        return false;
    }
    if is_known_binary_ext(&ext) {
        return true;
    }
    git2_says_binary
}

/// Return the changed file list for the given commit. Compares against the
/// first parent (root commit compares against an empty tree). Renames are
/// detected via libgit2's similarity heuristic.
pub fn changed_files(repo_path: &Path, commit_hash: &str) -> Result<Vec<ChangedFile>> {
    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;
    let oid = git2::Oid::from_str(commit_hash).context("parse commit hash")?;
    let commit = repo.find_commit(oid).context("find commit")?;

    let new_tree = commit.tree().context("commit tree")?;
    let old_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let mut diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)
        .context("diff trees")?;
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(false);
    diff.find_similar(Some(&mut find_opts)).ok();

    // Per-path line counts via a single print pass.
    let mut counts: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();
    diff.print(git2::DiffFormat::Patch, |delta, _, line| {
        let p = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let entry = counts.entry(p).or_insert((0, 0));
        match line.origin() {
            '+' => entry.0 += 1,
            '-' => entry.1 += 1,
            _ => {}
        }
        true
    })
    .ok();

    let mut out: Vec<ChangedFile> = Vec::new();
    for delta in diff.deltas() {
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());

        let status = match delta.status() {
            git2::Delta::Added => "new",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            git2::Delta::Typechange => "typechange",
            _ => "modified",
        }
        .to_string();

        let display_path = if status == "deleted" {
            old_path.clone().unwrap_or_else(|| new_path.clone())
        } else {
            new_path.clone()
        };

        let (insertions, deletions) = counts
            .get(&display_path)
            .or_else(|| old_path.as_ref().and_then(|p| counts.get(p)))
            .copied()
            .unwrap_or((0, 0));

        let git2_binary = delta.new_file().is_binary() || delta.old_file().is_binary();
        let is_binary = classify_binary(&display_path, git2_binary);
        // delta.{new,old}_file().size() routinely returns 0 in git2 when the
        // blob wasn't loaded; fetch it explicitly.
        let new_size = if delta.new_file().exists() {
            repo.find_blob(delta.new_file().id())
                .map(|b| b.size() as u64)
                .ok()
        } else {
            None
        };
        let old_size = if delta.old_file().exists() {
            repo.find_blob(delta.old_file().id())
                .map(|b| b.size() as u64)
                .ok()
        } else {
            None
        };

        out.push(ChangedFile {
            path: display_path,
            old_path: if status == "renamed" { old_path } else { None },
            insertions,
            deletions,
            status,
            is_binary,
            old_size,
            new_size,
        });
    }

    Ok(out)
}

/// Load the raw bytes of a file at the given commit (new side) and at its
/// first parent (old side), returning both base64-encoded so the frontend
/// can render them as data: URLs. Limits each side to MAX_BLOB_BYTES to keep
/// the IPC payload reasonable.
pub fn commit_file_blobs(
    repo_path: &Path,
    commit_hash: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<CommitFileBlobs> {
    use base64::{engine::general_purpose, Engine as _};

    const MAX_BLOB_BYTES: usize = 4 * 1024 * 1024; // 4 MB per side

    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;
    let oid = git2::Oid::from_str(commit_hash).context("parse commit hash")?;
    let commit = repo.find_commit(oid).context("find commit")?;

    fn looks_like_lfs(bytes: &[u8]) -> bool {
        bytes.starts_with(b"version https://git-lfs.github.com/spec/v1")
    }

    /// Pull `oid sha256:<hex>` out of an LFS pointer text body.
    fn parse_lfs_oid(bytes: &[u8]) -> Option<String> {
        let text = std::str::from_utf8(bytes).ok()?;
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("oid sha256:") {
                let oid = rest.trim();
                if oid.len() == 64 && oid.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Some(oid.to_string());
                }
            }
        }
        None
    }

    /// Look up the actual LFS object bytes in the local cache
    /// (`<gitdir>/lfs/objects/<2>/<2>/<oid>`). `git clone` of an LFS repo
    /// usually pulls these automatically; if missing, we hand back None
    /// and let the UI explain. Worktrees pointing at a separate common dir
    /// are not handled here; v0.1 limitation.
    fn load_lfs_object(repo: &Repository, oid_hex: &str) -> Option<Vec<u8>> {
        let gitdir = repo.path();
        let path = gitdir
            .join("lfs")
            .join("objects")
            .join(&oid_hex[0..2])
            .join(&oid_hex[2..4])
            .join(oid_hex);
        std::fs::read(&path).ok()
    }

    fn load(
        repo: &Repository,
        tree: &git2::Tree<'_>,
        path: &str,
        max: usize,
    ) -> (Option<String>, bool) {
        let entry = match tree.get_path(std::path::Path::new(path)) {
            Ok(e) => e,
            Err(_) => return (None, false),
        };
        let blob = match repo.find_blob(entry.id()) {
            Ok(b) => b,
            Err(_) => return (None, false),
        };
        let content = blob.content();

        if looks_like_lfs(content) {
            // Try the local LFS cache; if the user has `git lfs pull`-ed
            // (which `git clone` does by default on LFS repos) the actual
            // bytes will be there.
            if let Some(oid_hex) = parse_lfs_oid(content) {
                if let Some(actual) = load_lfs_object(repo, &oid_hex) {
                    if actual.len() > max {
                        return (None, false);
                    }
                    return (
                        Some(base64::engine::general_purpose::STANDARD.encode(&actual)),
                        false,
                    );
                }
            }
            return (None, true);
        }

        if content.len() > max {
            return (None, false);
        }
        (
            Some(base64::engine::general_purpose::STANDARD.encode(content)),
            false,
        )
    }

    let new_tree = commit.tree()?;
    let (new_base64, new_is_lfs) = load(&repo, &new_tree, file_path, MAX_BLOB_BYTES);

    let (old_base64, old_is_lfs) = if commit.parent_count() > 0 {
        let parent_tree = commit.parent(0)?.tree()?;
        let probe = old_path.unwrap_or(file_path);
        load(&repo, &parent_tree, probe, MAX_BLOB_BYTES)
    } else {
        (None, false)
    };

    let extension = std::path::Path::new(file_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    // Touch the engine constant so optimizer/linter doesn't see unused.
    let _ = general_purpose::STANDARD;

    Ok(CommitFileBlobs {
        old_base64,
        new_base64,
        extension,
        is_lfs: new_is_lfs || old_is_lfs,
    })
}

/// Unified diff text (git's standard patch output) for a single file in a
/// commit, against that commit's first parent. Root commit compares against
/// the empty tree.
pub fn file_diff(repo_path: &Path, commit_hash: &str, file_path: &str) -> Result<String> {
    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;
    let oid = git2::Oid::from_str(commit_hash).context("parse commit hash")?;
    let commit = repo.find_commit(oid).context("find commit")?;

    let new_tree = commit.tree()?;
    let old_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path);
    opts.context_lines(3);
    // Force text patch generation. libgit2's binary heuristic misfires on
    // big Unity YAML scenes (NUL bytes in long fields) and would otherwise
    // emit "Binary files differ" for files that are perfectly diffable.
    // Frontend only calls file_diff for paths it has already classified as
    // text, so forcing text here is safe.
    opts.force_text(true);
    let mut diff = repo
        .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))
        .context("diff trees")?;

    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true);
    diff.find_similar(Some(&mut find_opts)).ok();

    let mut out = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            'F' | 'H' => {
                // file or hunk header — content already includes its prefix
                out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
            }
            origin => {
                out.push(origin);
                out.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
            }
        }
        true
    })
    .ok();

    Ok(out)
}

pub fn list_branches(repo_path: &Path) -> Result<Vec<BranchInfo>> {
    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;

    let head_branch: Option<String> = if repo.head_detached().unwrap_or(true) {
        None
    } else {
        repo.head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
    };

    let mut out: Vec<BranchInfo> = Vec::new();
    let Ok(refs) = repo.references_glob("refs/heads/*") else {
        return Ok(out);
    };
    for r in refs.flatten() {
        let Some(name) = r.shorthand().map(|s| s.to_string()) else {
            continue;
        };
        let Some(tip) = r.target() else { continue };

        let mut count = 0usize;
        let mut last_activity: i64 = 0;
        if let Ok(mut rw) = repo.revwalk() {
            if rw.push(tip).is_ok() {
                let _ = rw.set_sorting(Sort::TIME);
                for (i, oid_res) in rw.enumerate() {
                    let Ok(oid) = oid_res else { continue };
                    count = i + 1;
                    if i == 0 {
                        if let Ok(c) = repo.find_commit(oid) {
                            last_activity = c.time().seconds();
                        }
                    }
                    // Cap to avoid scanning huge histories purely for the
                    // branch picker; the count is only a hint.
                    if i >= 5_000 {
                        count = 5_001;
                        break;
                    }
                }
            }
        }

        out.push(BranchInfo {
            name: name.clone(),
            tip_hash: tip.to_string(),
            is_head: Some(&name) == head_branch.as_ref(),
            commit_count: count,
            last_activity,
        });
    }
    out.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    Ok(out)
}

/// Walk the given branches (None = all local heads, like recent_commits) in
/// a single repository, deduping by SHA, returning newest-first commits with
/// parent SHAs populated.
pub fn repo_commits(
    repo_path: &Path,
    branches: Option<&[String]>,
    max_count: usize,
    since_unix_seconds: i64,
) -> Result<Vec<CommitSummary>> {
    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;

    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let repo_name = repo_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let detached = repo.head_detached().unwrap_or(true);
    let head_branch_name: Option<String> = if detached {
        None
    } else {
        repo.head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
    };

    let head_reachable: HashSet<Oid> = if head_branch_name.is_some() {
        match repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| {
                let mut rw = repo.revwalk().ok()?;
                rw.push(c.id()).ok()?;
                Some(rw.flatten().collect::<HashSet<_>>())
            }) {
            Some(set) => set,
            None => HashSet::new(),
        }
    } else {
        HashSet::new()
    };

    let tagged_oids: HashSet<Oid> = {
        let mut set = HashSet::new();
        if let Ok(refs) = repo.references_glob("refs/tags/*") {
            for r in refs.flatten() {
                if let Ok(obj) = r.peel(git2::ObjectType::Commit) {
                    set.insert(obj.id());
                }
            }
        }
        set
    };

    let mut commit_to_branch: HashMap<Oid, String> = HashMap::new();
    if let Ok(refs) = repo.references_glob("refs/heads/*") {
        for r in refs.flatten() {
            let Some(name) = r.shorthand().map(|s| s.to_string()) else {
                continue;
            };
            if Some(&name) == head_branch_name.as_ref() {
                continue;
            }
            let Some(tip) = r.target() else { continue };
            let mut rw = match repo.revwalk() {
                Ok(rw) => rw,
                Err(_) => continue,
            };
            if rw.push(tip).is_err() {
                continue;
            }
            for oid_res in rw {
                let Ok(oid) = oid_res else { continue };
                if head_reachable.contains(&oid) {
                    continue;
                }
                commit_to_branch.entry(oid).or_insert_with(|| name.clone());
            }
        }
    }

    let mut revwalk = repo.revwalk().context("init revwalk")?;
    let mut pushed = 0usize;

    match branches {
        Some(names) if !names.is_empty() => {
            for name in names {
                let ref_name = format!("refs/heads/{name}");
                if let Ok(reference) = repo.find_reference(&ref_name) {
                    if let Some(oid) = reference.target() {
                        if revwalk.push(oid).is_ok() {
                            pushed += 1;
                        }
                    }
                }
            }
        }
        _ => {
            if let Ok(refs) = repo.references_glob("refs/heads/*") {
                for r in refs.flatten() {
                    if let Some(oid) = r.target() {
                        if revwalk.push(oid).is_ok() {
                            pushed += 1;
                        }
                    }
                }
            }
        }
    }

    if pushed == 0 {
        let Ok(head) = repo.head() else {
            return Ok(Vec::new());
        };
        let Ok(head_commit) = head.peel_to_commit() else {
            return Ok(Vec::new());
        };
        revwalk.push(head_commit.id()).context("push HEAD")?;
    }

    revwalk
        .set_sorting(Sort::TIME)
        .context("set revwalk sort")?;

    let mut out: Vec<CommitSummary> = Vec::with_capacity(max_count);
    for oid in revwalk {
        if out.len() >= max_count {
            break;
        }
        let oid = match oid {
            Ok(o) => o,
            Err(_) => continue,
        };
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let ts = commit.time().seconds();
        if ts < since_unix_seconds {
            break;
        }
        let hash = oid.to_string();
        let short_hash: String = hash.chars().take(7).collect();
        let summary = commit.summary().unwrap_or("").to_string();
        let author = commit.author();
        let branch_label = if head_branch_name.is_none() || head_reachable.contains(&oid) {
            None
        } else {
            commit_to_branch.get(&oid).cloned()
        };
        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
        let message = commit.message().unwrap_or("").to_string();
        out.push(CommitSummary {
            repo_path: repo_path_str.clone(),
            repo_name: repo_name.clone(),
            hash,
            short_hash,
            summary,
            author: author.name().unwrap_or("").to_string(),
            email: author.email().unwrap_or("").to_string(),
            timestamp: ts,
            branch_label,
            is_merge: commit.parent_count() > 1,
            is_tagged: tagged_oids.contains(&oid),
            parents,
            message,
        });
    }

    Ok(out)
}

/// Walk HEAD and return up to `max_count` recent commits whose author time is
/// at or after `since_unix_seconds`. Empty / detached repos return an empty
/// vector rather than erroring.
pub fn recent_commits(
    repo_path: &Path,
    max_count: usize,
    since_unix_seconds: i64,
) -> Result<Vec<CommitSummary>> {
    let repo = Repository::open(repo_path)
        .with_context(|| format!("open repo {}", repo_path.display()))?;

    let repo_path_str = repo_path.to_string_lossy().into_owned();
    let repo_name = repo_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    // Identify what HEAD is on right now so we can suppress branch labels for
    // the user's current branch (the spec rule: "체크아웃된 브랜치는 생략").
    let detached = repo.head_detached().unwrap_or(true);
    let head_branch_name: Option<String> = if detached {
        None
    } else {
        repo.head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
    };

    // Set of OIDs reachable from HEAD — these get no label.
    let head_reachable: HashSet<Oid> = if head_branch_name.is_some() {
        match repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| {
                let mut rw = repo.revwalk().ok()?;
                rw.push(c.id()).ok()?;
                Some(rw.flatten().collect::<HashSet<_>>())
            }) {
            Some(set) => set,
            None => HashSet::new(),
        }
    } else {
        HashSet::new()
    };

    // Collect oids that any tag points to (peel annotated tags through to the
    // referenced commit). Used to set is_tagged on the result rows.
    let tagged_oids: HashSet<Oid> = {
        let mut set = HashSet::new();
        if let Ok(refs) = repo.references_glob("refs/tags/*") {
            for r in refs.flatten() {
                if let Ok(obj) = r.peel(git2::ObjectType::Commit) {
                    set.insert(obj.id());
                }
            }
        }
        set
    };

    // For each NON-current branch, build oid -> branch_name (first encountered
    // wins). Skips commits already on HEAD.
    let mut commit_to_branch: HashMap<Oid, String> = HashMap::new();
    if let Ok(refs) = repo.references_glob("refs/heads/*") {
        for r in refs.flatten() {
            let Some(name) = r.shorthand().map(|s| s.to_string()) else {
                continue;
            };
            if Some(&name) == head_branch_name.as_ref() {
                continue;
            }
            let Some(tip) = r.target() else { continue };
            let mut rw = match repo.revwalk() {
                Ok(rw) => rw,
                Err(_) => continue,
            };
            if rw.push(tip).is_err() {
                continue;
            }
            for oid_res in rw {
                let Ok(oid) = oid_res else { continue };
                if head_reachable.contains(&oid) {
                    continue;
                }
                commit_to_branch.entry(oid).or_insert_with(|| name.clone());
            }
        }
    }

    let mut revwalk = repo.revwalk().context("init revwalk")?;

    // Walk every local ref head, not just HEAD. The revwalk dedupes commits
    // that appear on multiple branches, so an agent that committed to a
    // feature branch (or to a branch the user isn't currently on) still
    // shows up in the timeline.
    let mut pushed = 0usize;
    if let Ok(refs) = repo.references_glob("refs/heads/*") {
        for r in refs.flatten() {
            if let Some(oid) = r.target() {
                if revwalk.push(oid).is_ok() {
                    pushed += 1;
                }
            }
        }
    }
    // Fall back to HEAD if for some reason no heads were enumerable
    // (newly-init'd repo, detached HEAD, etc.).
    if pushed == 0 {
        let head = match repo.head() {
            Ok(h) => h,
            Err(_) => return Ok(Vec::new()),
        };
        let head_commit = match head.peel_to_commit() {
            Ok(c) => c,
            Err(_) => return Ok(Vec::new()),
        };
        revwalk.push(head_commit.id()).context("push HEAD")?;
    }

    revwalk
        .set_sorting(Sort::TIME)
        .context("set revwalk sort")?;

    let mut out: Vec<CommitSummary> = Vec::with_capacity(max_count);
    for oid in revwalk {
        if out.len() >= max_count {
            break;
        }
        let oid = match oid {
            Ok(o) => o,
            Err(_) => continue,
        };
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let ts = commit.time().seconds();
        if ts < since_unix_seconds {
            // TIME sort is descending, so older commits won't reappear later.
            break;
        }
        let hash = oid.to_string();
        let short_hash: String = hash.chars().take(7).collect();
        let summary = commit.summary().unwrap_or("").to_string();
        let author = commit.author();
        let branch_label = if head_branch_name.is_none() || head_reachable.contains(&oid) {
            None
        } else {
            commit_to_branch.get(&oid).cloned()
        };
        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
        let message = commit.message().unwrap_or("").to_string();
        out.push(CommitSummary {
            repo_path: repo_path_str.clone(),
            repo_name: repo_name.clone(),
            hash,
            short_hash,
            summary,
            author: author.name().unwrap_or("").to_string(),
            email: author.email().unwrap_or("").to_string(),
            timestamp: ts,
            branch_label,
            is_merge: commit.parent_count() > 1,
            is_tagged: tagged_oids.contains(&oid),
            parents,
            message,
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Signature, Time};
    use tempfile::TempDir;

    fn empty_tree(repo: &Repository) -> git2::Tree<'_> {
        let mut index = repo.index().unwrap();
        let tree_id = index.write_tree().unwrap();
        repo.find_tree(tree_id).unwrap()
    }

    fn commit_with_time(
        repo: &Repository,
        msg: &str,
        ts: i64,
        parents: &[&git2::Commit<'_>],
    ) -> git2::Oid {
        let sig = Signature::new("t", "t@e", &Time::new(ts, 0)).unwrap();
        let tree = empty_tree(repo);
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, parents)
            .unwrap()
    }

    #[test]
    fn empty_repo_returns_empty() {
        let dir = TempDir::new().unwrap();
        let _ = Repository::init(dir.path()).unwrap();
        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert!(commits.is_empty());
    }

    #[test]
    fn returns_commits_newest_first() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let c1 = commit_with_time(&repo, "first", 1_000, &[]);
        let c1c = repo.find_commit(c1).unwrap();
        let c2 = commit_with_time(&repo, "second", 2_000, &[&c1c]);
        let c2c = repo.find_commit(c2).unwrap();
        let _ = commit_with_time(&repo, "third", 3_000, &[&c2c]);

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert_eq!(
            commits.iter().map(|c| c.summary.as_str()).collect::<Vec<_>>(),
            vec!["third", "second", "first"]
        );
        assert_eq!(commits[0].timestamp, 3_000);
    }

    #[test]
    fn caps_max_count() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut parent_oid = commit_with_time(&repo, "c0", 1_000, &[]);
        for i in 1..5 {
            let parent = repo.find_commit(parent_oid).unwrap();
            parent_oid = commit_with_time(&repo, &format!("c{i}"), 1_000 + i, &[&parent]);
        }

        let commits = recent_commits(dir.path(), 3, 0).unwrap();
        assert_eq!(commits.len(), 3);
    }

    #[test]
    fn cutoff_excludes_old_commits() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let old = commit_with_time(&repo, "old", 100, &[]);
        let oldc = repo.find_commit(old).unwrap();
        let _new = commit_with_time(&repo, "new", 2_000, &[&oldc]);

        let commits = recent_commits(dir.path(), 10, 1_000).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].summary, "new");
    }

    #[test]
    fn current_branch_commits_have_no_label() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let _ = commit_with_time(&repo, "on current", 1_000, &[]);
        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].branch_label, None);
    }

    #[test]
    fn other_branch_commits_get_label() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let main = commit_with_time(&repo, "shared", 1_000, &[]);
        let mainc = repo.find_commit(main).unwrap();

        repo.branch("dev", &mainc, false).unwrap();
        let sig = Signature::new("t", "t@e", &Time::new(2_000, 0)).unwrap();
        let tree = empty_tree(&repo);
        repo.commit(
            Some("refs/heads/dev"),
            &sig,
            &sig,
            "dev-only",
            &tree,
            &[&mainc],
        )
        .unwrap();

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        let dev_commit = commits.iter().find(|c| c.summary == "dev-only").unwrap();
        let shared_commit = commits.iter().find(|c| c.summary == "shared").unwrap();
        assert_eq!(dev_commit.branch_label.as_deref(), Some("dev"));
        assert_eq!(shared_commit.branch_label, None);
    }

    #[test]
    fn detached_head_suppresses_all_labels() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let c1 = commit_with_time(&repo, "first", 1_000, &[]);
        let c1c = repo.find_commit(c1).unwrap();
        repo.branch("dev", &c1c, false).unwrap();
        let sig = Signature::new("t", "t@e", &Time::new(2_000, 0)).unwrap();
        let tree = empty_tree(&repo);
        repo.commit(
            Some("refs/heads/dev"),
            &sig,
            &sig,
            "dev-only",
            &tree,
            &[&c1c],
        )
        .unwrap();

        // Detach HEAD onto the first commit.
        repo.set_head_detached(c1).unwrap();

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert!(
            commits.iter().all(|c| c.branch_label.is_none()),
            "detached HEAD must suppress all labels: {commits:?}"
        );
    }

    #[test]
    fn walks_all_local_branches() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        // Commit on the default branch (becomes "refs/heads/master" or
        // "refs/heads/main" depending on git config).
        let main1 = commit_with_time(&repo, "main-only", 1_000, &[]);
        let main1c = repo.find_commit(main1).unwrap();

        // Branch "dev" off main and put a unique commit on it.
        repo.branch("dev", &main1c, false).unwrap();
        let sig = Signature::new("t", "t@e", &Time::new(2_000, 0)).unwrap();
        let tree = empty_tree(&repo);
        repo.commit(
            Some("refs/heads/dev"),
            &sig,
            &sig,
            "dev-only",
            &tree,
            &[&main1c],
        )
        .unwrap();

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        let summaries: Vec<&str> = commits.iter().map(|c| c.summary.as_str()).collect();
        assert!(summaries.contains(&"main-only"), "missing main-only");
        assert!(summaries.contains(&"dev-only"), "missing dev-only");
    }

    #[test]
    fn dedupes_commits_visible_from_multiple_branches() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        // Single commit reachable from main and dev.
        let shared = commit_with_time(&repo, "shared", 1_000, &[]);
        let sharedc = repo.find_commit(shared).unwrap();
        repo.branch("dev", &sharedc, false).unwrap();

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert_eq!(commits.len(), 1, "shared commit should appear once");
    }

    #[test]
    fn populates_short_hash_and_repo_name() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let _ = commit_with_time(&repo, "only", 1_000, &[]);

        let commits = recent_commits(dir.path(), 10, 0).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].short_hash.len(), 7);
        assert!(commits[0].hash.starts_with(&commits[0].short_hash));
        assert_eq!(
            commits[0].repo_name,
            dir.path().file_name().unwrap().to_string_lossy()
        );
    }
}
