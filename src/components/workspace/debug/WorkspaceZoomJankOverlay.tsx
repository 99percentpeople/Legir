import React from "react";
import { useLanguage } from "@/components/language-provider";
import { useWorkspaceZoomJankDebug } from "../hooks/useWorkspaceZoomJankDebug";

interface WorkspaceZoomJankOverlayProps {
  scale: number;
}

const WorkspaceZoomJankOverlay: React.FC<WorkspaceZoomJankOverlayProps> = ({
  scale,
}) => {
  const { t } = useLanguage();
  const workspaceZoomJank = useWorkspaceZoomJankDebug({
    enabled: true,
    scale,
  });

  return (
    <div className="pointer-events-none sticky top-0 left-0 z-[70] h-0 w-0">
      <div className="mt-2 ml-2 w-max rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white shadow-lg">
        <div>
          {workspaceZoomJank?.active
            ? t("debug_overlay.workspace_zooming")
            : t("debug_overlay.workspace_last")}
        </div>
        <div>
          {`${t("debug_overlay.scale")} ${
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
        <div>{`${t("debug_overlay.duration")} ${workspaceZoomJank?.durationMs ?? "--"} ms`}</div>
        <div>{`${t("debug_overlay.response")} ${workspaceZoomJank?.responseMs ?? "--"} ms`}</div>
        <div>{`${t("debug_overlay.stall")} ${workspaceZoomJank?.blockedMs ?? "--"} ms`}</div>
        <div>{`${t("debug_overlay.avg")} ${workspaceZoomJank?.avgFrameMs?.toFixed(1) ?? "--"} ms`}</div>
        <div>
          {`${t("debug_overlay.worst")} ${
            workspaceZoomJank?.maxFrameMs?.toFixed(1) ?? "--"
          } ms`}
        </div>
        <div>{`${t("debug_overlay.jank")} ${workspaceZoomJank?.jankFrameCount ?? "--"}`}</div>
        <div>{`${t("debug_overlay.dropped")} ${workspaceZoomJank?.droppedFrames ?? "--"}`}</div>
        <div>{`${t("debug_overlay.steps")} ${workspaceZoomJank?.zoomChangeCount ?? "--"}`}</div>
      </div>
    </div>
  );
};

export default WorkspaceZoomJankOverlay;
