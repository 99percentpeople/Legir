import React from "react";
import { useWorkspaceZoomJankDebug } from "../hooks/useWorkspaceZoomJankDebug";

interface WorkspaceZoomJankOverlayProps {
  scale: number;
}

const WorkspaceZoomJankOverlay: React.FC<WorkspaceZoomJankOverlayProps> = ({
  scale,
}) => {
  const workspaceZoomJank = useWorkspaceZoomJankDebug({
    enabled: true,
    scale,
  });

  return (
    <div className="pointer-events-none sticky top-0 left-0 z-[70] h-0 w-0">
      <div className="ml-2 mt-2 w-max rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white shadow-lg">
        <div>
          {workspaceZoomJank?.active ? "workspace zooming" : "workspace last"}
        </div>
        <div>
          {`scale ${
            workspaceZoomJank?.startScale === null ||
            workspaceZoomJank?.startScale === undefined
              ? "--"
              : `${Math.round(workspaceZoomJank.startScale * 100)}%`
          } -> ${
            workspaceZoomJank?.targetScale === null ||
            workspaceZoomJank?.targetScale === undefined
              ? "--"
              : `${Math.round(workspaceZoomJank.targetScale * 100)}%`
          }`}
        </div>
        <div>{`duration ${workspaceZoomJank?.durationMs ?? "--"} ms`}</div>
        <div>{`response ${workspaceZoomJank?.responseMs ?? "--"} ms`}</div>
        <div>{`stall ${workspaceZoomJank?.blockedMs ?? "--"} ms`}</div>
        <div>{`avg ${workspaceZoomJank?.avgFrameMs?.toFixed(1) ?? "--"} ms`}</div>
        <div>
          {`worst ${workspaceZoomJank?.maxFrameMs?.toFixed(1) ?? "--"} ms`}
        </div>
        <div>{`jank ${workspaceZoomJank?.jankFrameCount ?? "--"}`}</div>
        <div>{`dropped ${workspaceZoomJank?.droppedFrames ?? "--"}`}</div>
        <div>{`steps ${workspaceZoomJank?.zoomChangeCount ?? "--"}`}</div>
      </div>
    </div>
  );
};

export default WorkspaceZoomJankOverlay;
