import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ensureIconfontSprite } from "./components/icons/iconfont-loader.js";

const root = document.getElementById("root");

if (!(root instanceof HTMLElement)) {
  throw new Error("app root not found");
}

void ensureIconfontSprite();

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
