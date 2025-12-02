import "./globals.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { LanguageProvider } from "./components/language-provider";
import { Toaster } from "./components/ui/sonner";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import * as pdfjsLib from "pdfjs-dist";

// Set up the PDF.js worker source to a CDN to ensure it works in the browser environment
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider defaultLanguage="en" storageKey="vite-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <Toaster position="top-center" />
        <App />
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>
);
