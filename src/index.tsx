import "./globals.css";

import { initializePwaLaunchQueue } from "./services/platform/browser/launch";
import { isDesktopApp } from "./services/platform/runtime";
import {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
} from "./components/ErrorBoundary";
import { markAppPerformance } from "./lib/appPerformance";

markAppPerformance("app:entry", { once: true });

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const getErrorMessage = (error: Error) => {
  return [error.name, error.message].filter(Boolean).join(": ");
};

initializePwaLaunchQueue();

const injectedBootstrap = window.__APP_WINDOW_BOOTSTRAP__ as
  | { kind?: unknown; filePath?: unknown }
  | undefined;
if (
  isDesktopApp() &&
  injectedBootstrap?.kind === "startup-open" &&
  typeof injectedBootstrap.filePath === "string"
) {
  void import("./services/platform/files").then(({ primeOpenFileFromPath }) => {
    primeOpenFileFromPath(injectedBootstrap.filePath as string);
  });
  void import("./services/pdfService");
  void import("./pages/EditorPage");
  void import("./components/workspace/Workspace");
}

if (!isDesktopApp()) {
  void import("./styles/font-faces.css");
}

const bootstrapApp = async () => {
  const [
    { default: React },
    { createRoot },
    { default: App },
    { ThemeProvider },
    { LanguageProvider, useLanguage },
    { Toaster },
    { Router },
    { useBootstrapAwareBrowserLocation },
  ] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
    import("./components/theme-provider"),
    import("./components/language-provider"),
    import("./components/ui/sonner"),
    import("wouter"),
    import("./app/useBootstrapAwareBrowserLocation"),
  ]);

  const AppErrorFallback = ({
    error,
    resetErrorBoundary,
  }: ErrorBoundaryFallbackProps) => {
    const { t } = useLanguage();

    return (
      <div
        role="alert"
        className="bg-background text-foreground flex h-full w-full items-center justify-center p-6"
      >
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold">
            {t("app.error_boundary.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("app.error_boundary.description")}
          </p>
          <pre className="bg-muted text-muted-foreground max-h-32 overflow-auto rounded-md p-3 text-left font-mono text-xs whitespace-pre-wrap">
            {getErrorMessage(error)}
          </pre>
          <div className="flex justify-center gap-2">
            <button
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
              type="button"
              onClick={resetErrorBoundary}
            >
              {t("common.actions.retry")}
            </button>
            <button
              className="border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md border px-4 py-2 text-sm font-medium"
              type="button"
              onClick={() => window.location.reload()}
            >
              {t("app.error_boundary.reload")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <LanguageProvider defaultLanguage="system" storageKey="app-ui-language">
        <ErrorBoundary
          fallbackRender={(props) => <AppErrorFallback {...props} />}
          onError={(error, info) => {
            console.error("Application render error", error, info);
          }}
        >
          <ThemeProvider defaultTheme="system" storageKey="app-ui-theme">
            <Toaster position="top-center" />
            <Router hook={useBootstrapAwareBrowserLocation}>
              <App />
            </Router>
          </ThemeProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </React.StrictMode>,
  );
};

void bootstrapApp();
