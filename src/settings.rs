use std::{env, fs, path::PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    English,
    Chinese,
}

impl Locale {
    pub const fn toggle(self) -> Self {
        match self {
            Self::English => Self::Chinese,
            Self::Chinese => Self::English,
        }
    }

    pub const fn code(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Chinese => "zh",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::English => "English",
            Self::Chinese => "中文",
        }
    }

    pub const fn text<'a>(self, english: &'a str, chinese: &'a str) -> &'a str {
        match self {
            Self::English => english,
            Self::Chinese => chinese,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub language: Locale,
}

impl Settings {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        load_from(path)
    }

    pub fn save(self) -> Result<()> {
        save_to(config_path()?, self)
    }
}

pub fn config_path() -> Result<PathBuf> {
    if let Some(directory) = env::var_os("LAZYMISE_CONFIG_DIR") {
        return Ok(PathBuf::from(directory).join("settings.json"));
    }
    if let Some(directory) = env::var_os("XDG_CONFIG_HOME") {
        return Ok(PathBuf::from(directory)
            .join("lazymise")
            .join("settings.json"));
    }
    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home)
            .join(".config")
            .join("lazymise")
            .join("settings.json"));
    }
    if let Some(directory) = env::var_os("APPDATA") {
        return Ok(PathBuf::from(directory)
            .join("lazymise")
            .join("settings.json"));
    }
    bail!("cannot determine lazymise config directory")
}

fn load_from(path: PathBuf) -> Result<Settings> {
    let contents = fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_slice(&contents)
        .with_context(|| format!("invalid settings in {}", path.display()))
}

fn save_to(path: PathBuf, settings: Settings) -> Result<()> {
    let directory = path
        .parent()
        .context("lazymise settings path has no parent directory")?;
    fs::create_dir_all(directory)
        .with_context(|| format!("failed to create {}", directory.display()))?;
    let contents = serde_json::to_vec_pretty(&settings)?;
    fs::write(&path, contents).with_context(|| format!("failed to write {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn saves_and_loads_language_preference() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            env::temp_dir().join(format!("lazymise-settings-{}-{unique}", std::process::id()));
        let path = directory.join("settings.json");

        save_to(
            path.clone(),
            Settings {
                language: Locale::Chinese,
            },
        )
        .unwrap();
        let loaded = load_from(path).unwrap();

        assert_eq!(loaded.language, Locale::Chinese);
        fs::remove_dir_all(directory).unwrap();
    }
}
