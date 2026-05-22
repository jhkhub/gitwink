import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";

import App from "./App";
import { DiffApp } from "./components/DiffApp";
import { Settings } from "./components/Settings";
import { initSettings } from "./lib/settings";

const label = getCurrentWindow().label;
const Root =
  label === "diff" ? DiffApp : label === "settings" ? Settings : App;

// Load + apply persisted settings before first paint so the font / scale
// are already correct — no flash of default styling.
void initSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
});
