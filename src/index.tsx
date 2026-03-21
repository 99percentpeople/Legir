import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { Toaster } from "./components/ui/sonner";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
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
    <LanguageProvider defaultLanguage="system" storageKey="ff-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="ff-ui-theme">
        <Toaster position="top-center" />
        <Router hook={useHashLocation}>
          <App />
        </Router>
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
