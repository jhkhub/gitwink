use tauri::{Manager, WindowEvent};

mod cache;
mod commands;
mod discovery;
mod git;
mod tray;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                app.set_activation_policy(ActivationPolicy::Accessory);
            }

            tray::setup(app)?;

            if let Some(panel) = app.get_webview_window("panel") {
                let handle = app.handle().clone();
                panel.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        window::hide_panel(&handle);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
