export interface Profile {
  id: string;
  name: string;
  user_name: string;
  user_email: string;
  ssh_key_path: string | null;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

export interface ProfilePath {
  id: number;
  profile_id: string;
  path_prefix: string;
}

/** Sent to Rust backend to configure git command env vars */
export interface ActiveProfileConfig {
  profile_id: string;
  user_name: string;
  user_email: string;
  ssh_key_path: string | null;
}

/** Data required to create a new profile (id and timestamps are generated) */
export interface CreateProfileData {
  name: string;
  user_name: string;
  user_email: string;
  ssh_key_path?: string | null;
  is_default?: boolean;
}
