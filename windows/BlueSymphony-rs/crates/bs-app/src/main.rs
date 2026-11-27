#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod icons;
mod image_cache;
mod router;
mod settings;
mod shaders;
mod state;
mod theme;
mod views;
mod widgets;

use state::AppState;
use tracing_subscriber::EnvFilter;

fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let dir = std::path::PathBuf::from(local_app_data).join("BlueSymphony");
            if std::fs::create_dir_all(&dir).is_ok() {
                let log_path = dir.join("crash.log");
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(log_path)
                {
                    use std::io::Write;
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
                        (*s).to_string()
                    } else if let Some(s) = info.payload().downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "non-string panic payload".to_string()
                    };
                    let loc = info
                        .location()
                        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let _ = writeln!(file, "[{ts}] PANIC at {loc}: {payload}");
                }
            }
        }
        prev(info);
    }));
}

fn main() -> iced::Result {
    // iced_wgpu defaults to PowerPreference::HighPerformance when WGPU_POWER_PREF is unset,
    // which wakes the discrete GPU on hybrid laptops; default to onboard iGPU ("low") + DX12
    // so Windows DXGI keeps laptops cool and avoids loading the Vulkan ICD (NV Optimus wake).
    // Respect user-supplied env vars if set externally.
    if std::env::var_os("WGPU_POWER_PREF").is_none() {
        std::env::set_var("WGPU_POWER_PREF", "low");
    }
    #[cfg(target_os = "windows")]
    if std::env::var_os("WGPU_BACKEND").is_none() {
        std::env::set_var("WGPU_BACKEND", "dx12");
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,wgpu_core=warn,wgpu_hal=warn,naga=warn")),
        )
        .init();

    install_panic_hook();

    // PlaybackCoordinator uses tokio::spawn during boot(); ensure a Tokio runtime is active
    // on the main thread when iced::daemon runs boot().
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let _guard = rt.enter();

    iced::daemon(AppState::boot, AppState::update, AppState::view)
        .title(AppState::title)
        .theme(AppState::theme)
        .style(AppState::style)
        .subscription(AppState::subscription)
        .antialiasing(true)
        .run()
}
