import React from "react";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}) => {
  const percentage = Math.round(scale * 100);

  return (
    <div className="bg-background border-border absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 transform items-center gap-1 rounded-lg border p-1 shadow-lg transition-colors duration-200">
      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomOut}
        title="Zoom Out (Ctrl + -)"
        className="h-8 w-8"
      >
        <ZoomOut size={16} />
      </Button>

      <div
        className="text-foreground hover:text-primary min-w-12 cursor-pointer px-2 text-center text-sm font-medium"
        onClick={onReset}
        title="Reset to 100%"
      >
        {percentage}%
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomIn}
        title="Zoom In (Ctrl + +)"
        className="h-8 w-8"
      >
        <ZoomIn size={16} />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-4" />

      <Button
        variant="ghost"
        size="icon"
        onClick={onReset}
        title="Fit / Reset"
        className="h-8 w-8"
      >
        <Maximize size={14} />
      </Button>
    </div>
  );
};

export default ZoomControls;
