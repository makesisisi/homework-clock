import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { CountdownWindow } from "./Countdowns.jsx";
import "./styles.css";
import "./theme-cotton.css";
import "./theme-liquid.css";
import "./theme-classic.css";
import "./theme-legibility.css";
import "./countdowns.css";
import "./theme-countdown-visual.css";
import "./countdown-layouts.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.countdown ? <CountdownWindow /> : <App />}
  </React.StrictMode>,
);
