import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './components/theme-provider';
import { LanguageProvider } from './components/language-provider';
import * as pdfjsLib from 'pdfjs-dist';

// Handle potential default export wrapper from CDN
const pdfJs = (pdfjsLib as any).default || pdfjsLib;

// Set up the PDF.js worker source to a CDN to ensure it works in the browser environment
if (pdfJs.GlobalWorkerOptions) {
  pdfJs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfJs.version}/pdf.worker.min.js`;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <LanguageProvider defaultLanguage="en" storageKey="vite-ui-language">
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <App />
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>
);
