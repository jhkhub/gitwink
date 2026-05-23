import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { getCurrentSettings } from "../lib/settings";

/** UI-scale slider bounds — mirror UI_SCALE_MIN/MAX in commands.rs. 100%
 *  is the floor: the diff/timeline default is the most compact legible
 *  size, so the control only scales up. */
const SCALE_MIN = 1;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.05;

export function Settings() {
  const [settings, setSettings] = useState(getCurrentSettings);

  function setScale(uiScale: number) {
    setSettings({ ...settings, uiScale });
    // The Rust command persists, resizes the panel window, and broadcasts
    // settings://changed to every window — listeners apply the CSS vars,
    // so this one invoke per slider step drives the full live preview.
    void invoke("set_ui_scale", { scale: uiScale });
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
          Scales the whole panel (header, chips, timeline, expansion) and
          resizes the panel window proportionally. 100% is the most
          compact size.
        </p>
      </section>
    </div>
  );
}
