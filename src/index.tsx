import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { Toaster } from "./components/ui/sonner";
import { registerControls } from "./components/workspace/controls";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

// App entrypoint.
//
// Key responsibilities:
// - Register workspace controls once at startup (Field/Annotation rendering + properties panels)
// - Mount global providers (i18n/theme/toast)
// - Use hash-based routing for compatibility with static hosting + Tauri
//
// If you add a new field/annotation control type, update `registerControls()`.
// Do NOT register controls inside React render to avoid duplicate registration in StrictMode.
// Register all controls
registerControls();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider defaultLanguage="en" storageKey="ff-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="ff-ui-theme">
        <Toaster position="top-center" />
        <Router hook={useHashLocation}>
          <App />
        </Router>
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
