use crate::error::AppError;
use crate::git::{
    repository,
    types::{BranchInfo, GraphData},
};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn open_repo(path: String, state: State<'_, AppState>) -> Result<String, AppError> {
    // Verify it's a valid git repo by trying to open it
    let _repo = git2::Repository::open(&path)?;
    let name = repository::repo_name(&path);

    let mut repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;
    *repo_path = Some(path);

    Ok(name)
}

#[tauri::command]
pub fn get_commits(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<GraphData, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::walk_commits(path, limit.unwrap_or(10_000))
}

#[tauri::command]
pub fn get_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::list_branches(path)
}

#[tauri::command]
pub fn checkout_branch(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::checkout_branch(path, &name)
}

#[tauri::command]
pub fn fetch_repo(state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::fetch_all(path)
}

#[tauri::command]
pub fn pull_repo(state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::pull(path)
}

#[tauri::command]
pub fn push_repo(state: State<'_, AppState>) -> Result<String, AppError> {
    let repo_path = state
        .repo_path
        .lock()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let path = repo_path
        .as_ref()
        .ok_or_else(|| AppError::Other("No repository open".to_string()))?;

    repository::push(path)
}
