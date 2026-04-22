use serde::{Deserialize, Serialize};

/// The active profile configuration, received from the frontend.
/// Used to inject identity env vars into git CLI commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveProfile {
    pub profile_id: String,
    pub user_name: String,
    pub user_email: String,
    pub ssh_key_path: Option<String>,
}
