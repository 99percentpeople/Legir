import React from "react";

// Workspace-level pointerdown is used to dismiss global editor menus, but
// selected-control toolbars need to opt out so nested popovers stay interactive.
const WorkspacePointerDownDismissContext = React.createContext<
  boolean | undefined
>(undefined);

interface WorkspacePointerDownDismissProviderProps {
  value: boolean;
  children: React.ReactNode;
}

export const WorkspacePointerDownDismissProvider: React.FC<
  WorkspacePointerDownDismissProviderProps
> = ({ value, children }) => {
  return (
    <WorkspacePointerDownDismissContext.Provider value={value}>
      {children}
    </WorkspacePointerDownDismissContext.Provider>
  );
};

export const useWorkspacePointerDownDismiss = (fallback = true) => {
  return React.useContext(WorkspacePointerDownDismissContext) ?? fallback;
};
