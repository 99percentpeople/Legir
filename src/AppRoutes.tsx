import React, { Suspense, useEffect, useState } from "react";
import { useEditorTabsRuntime } from "./app/editorRuntime";
import { EditorTabActiveContext } from "./app/editorTabs/context";
import type { WorkspacePage } from "./app/workspaceNavigation/types";
import { EditorTabStrip } from "./pages/EditorPage/components/EditorTabStrip";
import { Spinner } from "./components/ui/spinner";
import type { HomePageProps } from "./pages/HomePage";

const HomePage = React.lazy(() => import("./pages/HomePage"));
const EditorPage = React.lazy(
  () => import("./pages/EditorPage/KeepAliveEditor"),
);

interface AppRoutesProps {
  homeProps: HomePageProps;
  page: WorkspacePage | null;
  showHome: () => void;
}

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner size="xl" />
    </div>
  );
}

/** Routes select visibility, not ownership. Document trees live until closed. */
export default function AppRoutes({
  homeProps,
  page,
  showHome,
}: AppRoutesProps) {
  const { sessions } = useEditorTabsRuntime();
  const isHomeActive = page?.kind === "home";
  const [hasVisitedHome, setHasVisitedHome] = useState(isHomeActive);
  useEffect(() => {
    if (isHomeActive) setHasVisitedHome(true);
  }, [isHomeActive]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <EditorTabStrip isHomeActive={isHomeActive} onHome={showHome} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0 flex min-h-0 flex-col"
          data-workspace-editor
        >
          {!!sessions?.length && (
            <Suspense
              fallback={page?.kind === "document" ? <PageFallback /> : null}
            >
              <EditorPage />
            </Suspense>
          )}
        </div>
        {(hasVisitedHome || isHomeActive) && (
          <div
            data-workspace-home
            className="absolute inset-0 overflow-auto"
            style={{
              visibility: isHomeActive ? "visible" : "hidden",
              pointerEvents: isHomeActive ? undefined : "none",
            }}
            inert={!isHomeActive}
            aria-hidden={!isHomeActive}
          >
            <EditorTabActiveContext.Provider value={isHomeActive}>
              <Suspense fallback={<PageFallback />}>
                <HomePage {...homeProps} isActive={isHomeActive} />
              </Suspense>
            </EditorTabActiveContext.Provider>
          </div>
        )}
        {page === null && (
          <div className="absolute inset-0 flex">
            <PageFallback />
          </div>
        )}
      </div>
    </div>
  );
}
