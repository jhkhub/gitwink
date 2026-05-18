use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

const PANEL_LABEL: &str = "panel";

pub fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    if visible {
        let _ = window.hide();
    } else {
        position_near_cursor(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_panel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        let _ = window.hide();
    }
}

fn position_near_cursor(window: &WebviewWindow) {
    let app = window.app_handle();

    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let cursor_x = cursor.x as i32;
    let cursor_y = cursor.y as i32;

    let win_size = window.outer_size().unwrap_or_default();
    let win_w = win_size.width as i32;
    let win_h = win_size.height as i32;

    let monitor = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let pos = m.position();
                let size = m.size();
                cursor_x >= pos.x
                    && cursor_x < pos.x + size.width as i32
                    && cursor_y >= pos.y
                    && cursor_y < pos.y + size.height as i32
            })
        })
        .or_else(|| window.primary_monitor().ok().flatten());

    let (mon_x, mon_y, mon_w, mon_h) = match monitor {
        Some(m) => {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width as i32, s.height as i32)
        }
        None => (0, 0, 1920, 1080),
    };

    // Anchor panel above-and-left of the cursor (typical tray UX on Windows
    // where the tray sits in the bottom-right). On macOS the menu bar sits at
    // the top, so we drop down from the cursor instead.
    #[cfg(target_os = "macos")]
    let mut y = cursor_y + 8;
    #[cfg(not(target_os = "macos"))]
    let mut y = cursor_y - win_h - 8;

    let mut x = cursor_x - win_w / 2;

    let min_x = mon_x;
    let min_y = mon_y;
    let max_x = mon_x + mon_w - win_w;
    let max_y = mon_y + mon_h - win_h;

    if x < min_x {
        x = min_x;
    }
    if x > max_x {
        x = max_x;
    }
    if y < min_y {
        y = min_y;
    }
    if y > max_y {
        y = max_y;
    }

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
