import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The user-facing settings slice — mirrors the Rust `AppSettings`. */
export interface AppSettings {
  uiScale: number;
  diffFontFamily: string | null;
  panelHotkey: string;
}

/** Built-in diff/code monospace stack — the fallback when no font is
 *  picked. Kept in sync with the `.sbs` rule in styles.css. */
export const MONO_STACK =
  'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, monospace';

export const DEFAULT_SETTINGS: AppSettings = {
  uiScale: 1,
  diffFontFamily: null,
  panelHotkey: "CmdOrCtrl+Shift+G",
};

/** App-wide event carrying a full settings snapshot — broadcast by the
 *  Settings window so every window re-applies without a disk round-trip. */
const SETTINGS_EVENT = "settings://changed";

let current: AppSettings = { ...DEFAULT_SETTINGS };

/** Mirror live settings into CSS custom properties on :root; styles.css
 *  reads the vars. Every window calls this on load + on live change. */
export function applySettings(s: AppSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(s.uiScale));
  root.style.setProperty(
    "--diff-font-family",
    s.diffFontFamily?.trim() ? s.diffFontFamily : MONO_STACK,
  );
}

function setLocal(s: AppSettings): void {
  current = s;
  applySettings(s);
}

/** The settings snapshot last loaded or broadcast into this window. */
export function getCurrentSettings(): AppSettings {
  return current;
}

/** Load settings from the backend, apply them, and start listening for
 *  live changes from the Settings window. Called once per window mount,
 *  before first render. */
export async function initSettings(): Promise<void> {
  try {
    setLocal(await invoke<AppSettings>("get_settings"));
  } catch {
    setLocal({ ...DEFAULT_SETTINGS });
  }
  void listen<AppSettings>(SETTINGS_EVENT, (e) => {
    if (e.payload) setLocal(e.payload);
  });
}
