import React from "react";
import PageNumberDropdownControl from "./PageNumberDropdownControl";
import PageSettingsDropdownControl from "./PageSettingsDropdownControl";
import { DropdownMenuSeparator } from "../ui/dropdown-menu";
import type { PageFlowDirection, PageLayoutMode } from "../../types";

interface FloatingBarProps {
  currentPageIndex: number;
  pageCount: number;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  onNavigatePage: (pageIndex: number) => void;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
}

const FloatingBar: React.FC<FloatingBarProps> = ({
  currentPageIndex,
  pageCount,
  pageLayout,
  pageFlow,
  isFullscreen,
  onNavigatePage,
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
}) => {
  return (
    <div className="bg-background/72 border-border/70 absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 transform items-center gap-1 rounded-lg border p-1 shadow-xl backdrop-blur-md transition-colors duration-200">
      <PageNumberDropdownControl
        currentPageIndex={currentPageIndex}
        pageCount={pageCount}
        compact={false}
        onNavigatePage={onNavigatePage}
      />

      <DropdownMenuSeparator />

      <PageSettingsDropdownControl
        pageLayout={pageLayout}
        pageFlow={pageFlow}
        isFullscreen={isFullscreen}
        align="end"
        sideOffset={12}
        triggerClassName="sm:h-8 sm:w-8"
        onPageLayoutChange={onPageLayoutChange}
        onPageFlowChange={onPageFlowChange}
        onToggleFullscreen={onToggleFullscreen}
      />
    </div>
  );
};

export default FloatingBar;
