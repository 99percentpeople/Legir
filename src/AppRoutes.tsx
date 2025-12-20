import React, { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";

interface AppRoutesProps {
  landing: React.ReactNode;
  editor: React.ReactNode;
  canAccessEditor: boolean;
  isLoading: boolean;
}

const EditorRouteGuard: React.FC<{
  canAccessEditor: boolean;
  isLoading: boolean;
  children: React.ReactNode;
}> = ({ canAccessEditor, isLoading, children }) => {
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!canAccessEditor && !isLoading) {
      navigate("/");
    }
  }, [canAccessEditor, isLoading, navigate]);

  if (!canAccessEditor && !isLoading) return null;
  return <>{children}</>;
};

const AppRoutes: React.FC<AppRoutesProps> = ({
  landing,
  editor,
  canAccessEditor,
  isLoading,
}) => {
  return (
    <Switch>
      <Route path="/">{landing}</Route>
      <Route path="/editor">
        <EditorRouteGuard
          canAccessEditor={canAccessEditor}
          isLoading={isLoading}
        >
          {editor}
        </EditorRouteGuard>
      </Route>
      <Route>{landing}</Route>
    </Switch>
  );
};

export default AppRoutes;
