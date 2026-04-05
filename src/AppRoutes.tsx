import React, { Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";

import { Spinner } from "./components/ui/spinner";
import { Skeleton } from "./components/ui/skeleton";
import type { HomePageProps } from "./pages/HomePage";
import type { EditorPageProps } from "./pages/EditorPage";

const HomePage = React.lazy(() => import("./pages/HomePage"));
const EditorPage = React.lazy(() => import("./pages/EditorPage"));

interface AppRoutesProps {
  homeProps: HomePageProps;
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

function HomeRouteFallback() {
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
  homeProps,
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
          <HomeRouteFallback />
        )
      }
    >
      <Switch>
        <Route path="/editor">
          <EditorRouteGuard
            canAccessEditor={canAccessEditor}
            isLoading={isLoading}
            fallback={<HomePage {...homeProps} />}
            loadingFallback={<EditorRouteFallback />}
          >
            <EditorPage {...editorProps} />
          </EditorRouteGuard>
        </Route>
        <Route path="/">
          <HomePage {...homeProps} />
        </Route>
        <Route>
          <HomePage {...homeProps} />
        </Route>
      </Switch>
    </Suspense>
  );
};

export default AppRoutes;
