import React from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({ scale, onZoomIn, onZoomOut, onReset }) => {
  const percentage = Math.round(scale * 100);

  return (
    <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-1 bg-background p-1 rounded-lg shadow-lg border border-border z-40 transition-colors duration-200">
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
        className="px-2 min-w-12 text-center text-sm font-medium text-foreground cursor-pointer hover:text-primary"
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

      <Separator orientation="vertical" className="h-4 mx-1" />

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