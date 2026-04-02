import React, { Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";

import { Spinner } from "./components/ui/spinner";
import { Skeleton } from "./components/ui/skeleton";
import type { LandingPageProps } from "./pages/LandingPage";
import type { EditorPageProps } from "./pages/EditorPage";

const LandingPage = React.lazy(() => import("./pages/LandingPage"));
const EditorPage = React.lazy(() => import("./pages/EditorPage"));

interface AppRoutesProps {
  landingProps: LandingPageProps;
  editorProps: EditorPageProps;
  canAccessEditor: boolean;
  isLoading: boolean;
}

const EditorRouteGuard: React.FC<{
  canAccessEditor: boolean;
  isLoading: boolean;
  fallback: React.ReactNode;
  loadingFallback: React.ReactNode;
  children: React.ReactNode;
}> = ({ canAccessEditor, isLoading, fallback, loadingFallback, children }) => {
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!canAccessEditor && !isLoading) {
      navigate("/");
    }
  }, [canAccessEditor, isLoading, navigate]);

  if (!canAccessEditor && !isLoading) return <>{fallback}</>;
  if (!canAccessEditor && isLoading) return <>{loadingFallback}</>;
  return <>{children}</>;
};

function LandingRouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner size="xl" />
    </div>
  );
}

function EditorRouteFallback() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        <Skeleton className="hidden h-full w-72 shrink-0 lg:block" />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex gap-6"></div>
        </div>
        <Skeleton className="hidden h-full w-80 shrink-0 xl:block" />
      </div>
    </div>
  );
}

const AppRoutes: React.FC<AppRoutesProps> = ({
  landingProps,
  editorProps,
  canAccessEditor,
  isLoading,
}) => {
  const [location] = useLocation();

  return (
    <Suspense
      fallback={
        location.startsWith("/editor") ? (
          <EditorRouteFallback />
        ) : (
          <LandingRouteFallback />
        )
      }
    >
      <Switch>
        <Route path="/editor">
          <EditorRouteGuard
            canAccessEditor={canAccessEditor}
            isLoading={isLoading}
            fallback={<LandingPage {...landingProps} />}
            loadingFallback={<EditorRouteFallback />}
          >
            <EditorPage {...editorProps} />
          </EditorRouteGuard>
        </Route>
        <Route path="/">
          <LandingPage {...landingProps} />
        </Route>
        <Route>
          <LandingPage {...landingProps} />
        </Route>
      </Switch>
    </Suspense>
  );
};

export default AppRoutes;
