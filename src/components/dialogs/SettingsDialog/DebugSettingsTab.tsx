import { AlertCircle, Bug } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DebugOptions } from "@/types";

import { SETTINGS_CARD_COMPACT_CLASS } from "./styles";
import type { UpdateDebugOption } from "./types";

interface DebugSettingsTabProps {
  options: DebugOptions;
  onUpdate: UpdateDebugOption;
}

export const DebugSettingsTab = ({
  options,
  onUpdate,
}: DebugSettingsTabProps) => {
  const { t } = useLanguage();

  return (
    <TabsContent value="debug">
      <div className="space-y-6">
        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bug className="text-primary h-4 w-4" />
              <Label
                htmlFor="debug-pdf-text-layer"
                className="mb-0 font-semibold"
              >
                {t("settings.debug.pdf_text_layer_debug")}
              </Label>
            </div>
            <Switch
              id="debug-pdf-text-layer"
              checked={options.pdfTextLayer}
              onCheckedChange={(checked) => onUpdate("pdfTextLayer", checked)}
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.debug.pdf_text_layer_debug_desc")}
          </p>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bug className="text-primary h-4 w-4" />
              <Label
                htmlFor="debug-disable-pdf-text-layer"
                className="mb-0 font-semibold"
              >
                {t("settings.debug.disable_pdf_text_layer")}
              </Label>
            </div>
            <Switch
              id="debug-disable-pdf-text-layer"
              checked={options.disablePdfTextLayer}
              onCheckedChange={(checked) =>
                onUpdate("disablePdfTextLayer", checked)
              }
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.debug.disable_pdf_text_layer_desc")}
          </p>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bug className="text-primary h-4 w-4" />
              <div className="flex items-center gap-1.5">
                <Label
                  htmlFor="debug-pdf-zoom-render-timing"
                  className="mb-0 font-semibold"
                >
                  {t("settings.debug.pdf_zoom_render_timing")}
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center transition-colors"
                      aria-label={t(
                        "settings.debug.pdf_zoom_render_timing_tooltip_label",
                      )}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-sm space-y-1 text-left"
                  >
                    <div className="font-medium">
                      {t("settings.debug.pdf_zoom_render_timing_tooltip_title")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.page_waiting")}
                      </span>
                      :{" "}
                      {t(
                        "settings.debug.pdf_zoom_render_timing_tooltip_waiting",
                      )}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.page_current_waiting")} /{" "}
                        {t("debug_overlay.page_current_partial")} /{" "}
                        {t("debug_overlay.page_current_ready")}
                      </span>
                      :{" "}
                      {t(
                        "settings.debug.pdf_zoom_render_timing_tooltip_current",
                      )}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.page_first_rendering")} /{" "}
                        {t("debug_overlay.page_first_partial")} /{" "}
                        {t("debug_overlay.page_first_ready")}
                      </span>
                      :{" "}
                      {t(
                        "settings.debug.pdf_zoom_render_timing_tooltip_initial",
                      )}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.page_zoom_rendering")} /{" "}
                        {t("debug_overlay.page_zoom_partial")} /{" "}
                        {t("debug_overlay.page_zoom_ready")}
                      </span>
                      :{" "}
                      {t("settings.debug.pdf_zoom_render_timing_tooltip_zoom")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.zoom")}
                      </span>
                      :{" "}
                      {t("settings.debug.pdf_zoom_render_timing_tooltip_scale")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.canvas")}
                      </span>
                      :{" "}
                      {t(
                        "settings.debug.pdf_zoom_render_timing_tooltip_canvas",
                      )}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.text")}
                      </span>
                      :{" "}
                      {t("settings.debug.pdf_zoom_render_timing_tooltip_text")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.total")}
                      </span>
                      :{" "}
                      {t("settings.debug.pdf_zoom_render_timing_tooltip_total")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <Switch
              id="debug-pdf-zoom-render-timing"
              checked={options.pdfZoomRenderTiming}
              onCheckedChange={(checked) =>
                onUpdate("pdfZoomRenderTiming", checked)
              }
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.debug.pdf_zoom_render_timing_desc")}
          </p>
        </div>

        <div className={SETTINGS_CARD_COMPACT_CLASS}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bug className="text-primary h-4 w-4" />
              <div className="flex items-center gap-1.5">
                <Label
                  htmlFor="debug-workspace-zoom-jank"
                  className="mb-0 font-semibold"
                >
                  {t("settings.debug.workspace_zoom_jank")}
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center transition-colors"
                      aria-label={t(
                        "settings.debug.workspace_zoom_jank_tooltip_label",
                      )}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-sm space-y-1 text-left"
                  >
                    <div className="font-medium">
                      {t("settings.debug.workspace_zoom_jank_tooltip_title")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.workspace_zooming")} /{" "}
                        {t("debug_overlay.workspace_last")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_status")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.scale")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_scale")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.duration")}
                      </span>
                      :{" "}
                      {t("settings.debug.workspace_zoom_jank_tooltip_duration")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.response")}
                      </span>
                      :{" "}
                      {t("settings.debug.workspace_zoom_jank_tooltip_response")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.stall")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_stall")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.avg")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_avg")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.worst")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_worst")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.jank")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_jank")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.dropped")}
                      </span>
                      :{" "}
                      {t("settings.debug.workspace_zoom_jank_tooltip_dropped")}
                    </div>
                    <div>
                      <span className="font-mono">
                        {t("debug_overlay.steps")}
                      </span>
                      : {t("settings.debug.workspace_zoom_jank_tooltip_steps")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <Switch
              id="debug-workspace-zoom-jank"
              checked={options.workspaceZoomJank}
              onCheckedChange={(checked) =>
                onUpdate("workspaceZoomJank", checked)
              }
            />
          </div>
          <p className="text-muted-foreground px-1 text-xs">
            {t("settings.debug.workspace_zoom_jank_desc")}
          </p>
        </div>
      </div>
    </TabsContent>
  );
};
