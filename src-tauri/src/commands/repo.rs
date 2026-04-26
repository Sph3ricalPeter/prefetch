use crate::background::BackgroundFetcher;
use crate::error::AppError;
use crate::events;
use crate::git::{
    repository,
    types::{
        self, BranchInfo, ConflictState, FileDiff, FileStatus, GitIdentity, GraphData, StashInfo,
        TagInfo, UndoAction,
    },
};
use crate::watcher::RepoWatcher;
use crate::AppState;
use tauri::{Emitter, State};
use tracing::{debug, instrument, warn};

/// Extract the repo path from state (convenience helper).
fn repo_path(state: &State<'_, AppState>) -> Result<String, AppError> {
    let lock = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    lock.as_ref()
        .cloned()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))
}

/// Build profile environment variables from the active profile in AppState.
/// Returns an empty Vec when no profile is active (no-op for git commands).
fn get_profile_env(state: &State<'_, AppState>) -> Vec<(String, String)> {
    let profile = state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    repository::profile_env(&profile)
}

/// Extract the active profile's ID (for profile-scoped token lookup).
fn get_profile_id(state: &State<'_, AppState>) -> Option<String> {
    state
        .active_profile
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.profile_id.clone()))
}

/// Run a blocking closure on the tokio thread pool instead of the main thread.
///
/// Tauri v2 runs sync `#[tauri::command]` functions on the main thread, which
/// freezes the window during subprocess spawns and git2-rs operations. This
/// helper moves the work off the main thread.
async fn offload<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("Task join error: {e}")))?
}

// ── Repo open ────────────────────────────────────────────────────────────────

#[instrument(skip(state, app), fields(repo = %path))]
#[tauri::command]
pub fn open_repo(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    // open_repo stays sync: the state mutations (mutex locks, thread spawns)
    // are fast and need direct State access. The git2 open is also fast.
    let _repo = git2::Repository::open(&path)?;
    let name = repository::repo_name(&path);

    {
        let mut repo_path = state
            .repo_path
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *repo_path = Some(path.clone());
    }

    {
        let mut watcher_lock = state
            .watcher
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *watcher_lock = None;
        match RepoWatcher::start(&path, app.clone()) {
            Ok(w) => *watcher_lock = Some(w),
            Err(e) => warn!("failed to start file watcher: {e}"),
        }
    }

    {
        let profile = state
            .active_profile
            .lock()
            .ok()
            .and_then(|guard| guard.clone());
        let mut fetcher_lock = state
            .fetcher
            .lock()
            .map_err(|e| AppError::Other(e.to_string()))?;
        *fetcher_lock = None;
        *fetcher_lock = Some(BackgroundFetcher::start(path.clone(), app, profile));
    }

    debug!(repo_name = %name, "repo opened");
    Ok(name)
}

// ── Read operations (all async → offloaded to thread pool) ───────────────────

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_commits(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<GraphData, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::walk_commits(&path, limit.unwrap_or(10_000))).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::list_branches(&path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_file_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_status(&path)).await
}

#[tauri::command]
pub async fn get_file_diff(
    file_path: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_file_diff(&path, &file_path, staged)).await
}

#[tauri::command]
pub async fn get_commit_files(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_commit_files(&path, &commit_id)).await
}

#[tauri::command]
pub async fn get_commit_file_diff(
    commit_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_commit_file_diff(&path, &commit_id, &file_path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_stashes(state: State<'_, AppState>) -> Result<Vec<StashInfo>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::list_stashes(&path)).await
}

#[tauri::command]
pub async fn get_stash_files(
    index: usize,
    state: State<'_, AppState>,
) -> Result<Vec<FileStatus>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_stash_files(&path, index)).await
}

#[tauri::command]
pub async fn get_stash_file_diff(
    index: usize,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<FileDiff, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_stash_file_diff(&path, index, &file_path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<TagInfo>, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::list_tags(&path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_undo_action(state: State<'_, AppState>) -> Result<UndoAction, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_undo_action(&path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_conflict_state(state: State<'_, AppState>) -> Result<ConflictState, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::get_conflict_state(&path)).await
}

#[instrument(skip(state))]
#[tauri::command]
pub async fn get_git_identity(state: State<'_, AppState>) -> Result<GitIdentity, AppError> {
    let path = repo_path(&state)?;
    offload(move || Ok(repository::get_git_identity(&path))).await
}

// ── Write / mutation operations (all async → offloaded to thread pool) ───────

#[tauri::command]
pub async fn checkout_branch(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::checkout_branch(&path, &name)).await
}

#[tauri::command]
pub async fn reset_branch_to_remote(
    branch: String,
    remote_ref: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::reset_branch_to_remote(&path, &branch, &remote_ref)).await
}

#[tauri::command]
pub async fn create_branch(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::create_branch(&path, &name)).await
}

#[tauri::command]
pub async fn fetch_repo(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || {
        repository::fetch_all(
            &path,
            |progress| {
                app.emit(events::GIT_PROGRESS, progress).ok();
            },
            &env,
            pid.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn pull_repo(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || {
        repository::pull(
            &path,
            |progress| {
                app.emit(events::GIT_PROGRESS, progress).ok();
            },
            &env,
            pid.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn push_repo(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || {
        repository::push(
            &path,
            |progress| {
                app.emit(events::GIT_PROGRESS, progress).ok();
            },
            &env,
            pid.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn force_push_repo(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || {
        repository::force_push(
            &path,
            |progress| {
                app.emit(events::GIT_PROGRESS, progress).ok();
            },
            &env,
            pid.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn resolve_conflict_ours(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::resolve_ours(&path, &file_path)).await
}

#[tauri::command]
pub async fn resolve_conflict_theirs(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::resolve_theirs(&path, &file_path)).await
}

#[tauri::command]
pub async fn discard_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::discard_files(&repo, &paths)).await
}

#[tauri::command]
pub async fn discard_all_changes(state: State<'_, AppState>) -> Result<(), AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::discard_all(&path)).await
}

#[tauri::command]
pub async fn stage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::stage_files(&repo, &paths)).await
}

#[tauri::command]
pub async fn unstage_files(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::unstage_files(&repo, &paths)).await
}

#[tauri::command]
pub async fn stage_patch(patch: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::stage_patch(&repo, &patch)).await
}

#[tauri::command]
pub async fn unstage_patch(patch: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::unstage_patch(&repo, &patch)).await
}

#[tauri::command]
pub async fn get_conflict_contents(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<types::ConflictContents, AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::get_conflict_contents(&repo, &file_path)).await
}

#[tauri::command]
pub async fn resolve_conflict_manual(
    file_path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let repo = repo_path(&state)?;
    offload(move || repository::resolve_conflict_with_content(&repo, &file_path, &content)).await
}

#[tauri::command]
pub async fn create_commit(
    message: String,
    amend: bool,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::create_commit(&path, &message, amend, &env)).await
}

#[tauri::command]
pub async fn stash_save(
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::stash_push(&path, message.as_deref(), &env)).await
}

#[tauri::command]
pub async fn stash_pop(index: usize, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::stash_pop(&path, index)).await
}

#[tauri::command]
pub async fn stash_drop(index: usize, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::stash_drop(&path, index)).await
}

#[tauri::command]
pub async fn create_tag(
    name: String,
    commit: Option<String>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || {
        repository::create_tag(&path, &name, commit.as_deref(), message.as_deref(), &env)
    })
    .await
}

#[tauri::command]
pub async fn delete_tag(name: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::delete_tag(&path, &name)).await
}

#[tauri::command]
pub async fn push_tag(name: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    let pid = get_profile_id(&state);
    offload(move || repository::push_tag(&path, &name, &env, pid.as_deref())).await
}

#[tauri::command]
pub async fn undo_last(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::undo_last(&path, &env)).await
}

#[tauri::command]
pub async fn reset_to_commit(
    commit_id: String,
    mode: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::reset_to_commit(&path, &commit_id, &mode)).await
}

#[tauri::command]
pub async fn cherry_pick(
    commit_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::cherry_pick(&path, &commit_id, &env)).await
}

#[tauri::command]
pub async fn rebase_onto(target: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::rebase_onto(&path, &target, &env)).await
}

#[tauri::command]
pub async fn abort_operation(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    offload(move || repository::abort_operation(&path)).await
}

#[tauri::command]
pub async fn continue_operation(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = repo_path(&state)?;
    let env = get_profile_env(&state);
    offload(move || repository::continue_operation(&path, &env)).await
}
