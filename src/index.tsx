import "./globals.css";
import { initializePwaLaunchQueue } from "./services/platform/browser/launch";
import { isDesktopApp } from "./services/platform/runtime";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

initializePwaLaunchQueue();

if (!isDesktopApp()) {
  void import("./styles/font-faces.css");
}

const bootstrapApp = async () => {
  const [
    { default: React },
    { createRoot },
    { default: App },
    { ThemeProvider },
    { LanguageProvider },
    { Toaster },
    { Router },
    { useBootstrapAwareHashLocation },
  ] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
    import("./components/theme-provider"),
    import("./components/language-provider"),
    import("./components/ui/sonner"),
    import("wouter"),
    import("./app/useBootstrapAwareHashLocation"),
  ]);

  const root = createRoot(rootElement);
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
};

void bootstrapApp();
