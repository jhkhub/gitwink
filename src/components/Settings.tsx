import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { broadcastSettings, getCurrentSettings } from "../lib/settings";

/** UI-scale slider bounds — mirror UI_SCALE_MIN/MAX in commands.rs. 100%
 *  is the floor: the diff/timeline default is the most compact legible
 *  size, so the control only scales up. */
const SCALE_MIN = 1;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.05;
/** Debounce before persisting — a slider sweep / font typing becomes
 *  one disk write per pause instead of one per tick / keystroke. */
const PERSIST_DELAY_MS = 250;

/** Common Windows monospace fonts as datalist suggestions. They ship
 *  with Windows or with VS / Windows Terminal so users almost certainly
 *  have one; they can also type any installed font name. Empty input =
 *  built-in monospace stack (the MONO_STACK in lib/settings.ts). */
const FONT_PRESETS = ["Cascadia Code", "Cascadia Mono", "Consolas", "Courier New"];

export function Settings() {
  const [settings, setSettings] = useState(getCurrentSettings);
  const scaleTimer = useRef<number | undefined>(undefined);
  const fontTimer = useRef<number | undefined>(undefined);

  function setScale(uiScale: number) {
    const next = { ...settings, uiScale };
    setSettings(next);
    broadcastSettings(next);
    window.clearTimeout(scaleTimer.current);
    scaleTimer.current = window.setTimeout(() => {
      void invoke("set_ui_scale", { scale: uiScale });
    }, PERSIST_DELAY_MS);
  }

  function setFont(family: string) {
    const trimmed = family.trim();
    const fam = trimmed.length > 0 ? trimmed : null;
    const next = { ...settings, diffFontFamily: fam };
    setSettings(next);
    broadcastSettings(next);
    window.clearTimeout(fontTimer.current);
    fontTimer.current = window.setTimeout(() => {
      void invoke("set_diff_font", { family: fam });
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
          Scales the whole panel (header, chips, timeline, expansion) and
          resizes the panel window proportionally. 100% is the most
          compact size.
        </p>

        <div className="settings-row">
          <label className="settings-label" htmlFor="diff-font">
            Font
          </label>
          <input
            id="diff-font"
            className="settings-input"
            type="text"
            list="diff-font-presets"
            placeholder="Built-in monospace"
            value={settings.diffFontFamily ?? ""}
            onChange={(e) => setFont(e.target.value)}
          />
          <datalist id="diff-font-presets">
            {FONT_PRESETS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <p className="settings-hint">
          Diff view font. Empty = built-in monospace stack. Any installed
          font is fine — proportional fonts render but the gutter and
          line-number alignment look ragged, so monospace is recommended.
        </p>
      </section>
    </div>
  );
}
