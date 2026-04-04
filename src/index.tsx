import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { Toaster } from "./components/ui/sonner";
import { Router } from "wouter";
import { useBootstrapAwareHashLocation } from "./app/useBootstrapAwareHashLocation";
import { shouldLoadPlatformFontFaces } from "./services/platform";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

if (shouldLoadPlatformFontFaces()) {
  void import("./styles/font-faces.css");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider defaultLanguage="system" storageKey="app-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="app-ui-theme">
        <Toaster position="top-center" />
        <Router hook={useBootstrapAwareHashLocation}>
          <App />
        </Router>
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
