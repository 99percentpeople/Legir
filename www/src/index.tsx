import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "@/components/language-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { shouldLoadPlatformFontFaces } from "@/services/platform";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

if (shouldLoadPlatformFontFaces()) {
  void import("../../src/styles/font-faces.css");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider defaultLanguage="system" storageKey="www-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="www-ui-theme">
        <Toaster position="top-center" />
        <App />
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
