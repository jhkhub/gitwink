import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { broadcastSettings, getCurrentSettings } from "../lib/settings";

/** UI-scale slider bounds — mirror UI_SCALE_MIN/MAX in commands.rs. 100%
 *  is the floor: the diff/timeline default is the most compact legible
 *  size, so the control only scales up. */
const SCALE_MIN = 1;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.05;
/** Debounce before persisting — a slider sweep becomes one disk write. */
const PERSIST_DELAY_MS = 250;

export function Settings() {
  const [settings, setSettings] = useState(getCurrentSettings);
  const persistTimer = useRef<number | undefined>(undefined);

  function setScale(uiScale: number) {
    const next = { ...settings, uiScale };
    setSettings(next);
    // Live preview across every window — no disk write on each tick.
    broadcastSettings(next);
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void invoke("set_ui_scale", { scale: uiScale });
    }, PERSIST_DELAY_MS);
  }

  return (
    <div className="settings">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-section">
        <h2 className="settings-section-title">Appearance</h2>
        <div className="settings-row">
          <label className="settings-label" htmlFor="ui-scale">
            Size
          </label>
          <input
            id="ui-scale"
            className="settings-slider"
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={settings.uiScale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <span className="settings-value">
            {Math.round(settings.uiScale * 100)}%
          </span>
        </div>
        <p className="settings-hint">
          Scales the diff and timeline text. 100% is the most compact size.
        </p>
      </section>
    </div>
  );
}
