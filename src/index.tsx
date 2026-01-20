import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isTauri } from "@tauri-apps/api/core";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { Toaster } from "./components/ui/sonner";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

// App entrypoint.
//
// Key responsibilities:
// - Mount global providers (i18n/theme/toast)
// - Use hash-based routing for compatibility with static hosting + Tauri
//
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

if (!isTauri()) {
  void import("./styles/font-faces.css");
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
