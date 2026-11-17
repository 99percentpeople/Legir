import { useId, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CircleDot,
  RectangleHorizontal,
  RectangleVertical,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { PageCropMargins, PageResizeOptions } from "@legir/pdf-model";
import {
  cropPageGeometry,
  getPageGeometry,
  resizePageGeometry,
  resetPageCrop,
} from "@legir/pdf-model/pageGeometry";
import { getPageId } from "@legir/pdf-core/lib/pageStructure";
import { useEditorView, useEditorViewApi } from "@/store/useEditorView";
import { useLanguage } from "@/components/language-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  getPageView,
  pagePointToView,
} from "@/components/workspace/lib/pageViewRotation";
import { getThumbnailContents } from "@/services/pdfService/thumbnailRenderer";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { parsePageRange } from "@/utils/pageRange";
import { PageGeometryPreview } from "./PageGeometryPreview";

const mm = 72 / 25.4;
const zeroMargins = { top: 0, right: 0, bottom: 0, left: 0 };
const presets: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
};
const anchors = [
  ArrowUpLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  CircleDot,
  ArrowRight,
  ArrowDownLeft,
  ArrowDown,
  ArrowDownRight,
].map((Icon, index) => ({
  Icon,
  index,
  value: `${(index % 3) / 2},${Math.floor(index / 3) / 2}`,
}));
export type PageGeometryMode = "resize" | "crop";

export function PageGeometryDialog({
  mode,
  ids,
  worker,
  onClose,
}: {
  mode: PageGeometryMode;
  ids: string[];
  worker: PDFWorkerService | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const store = useEditorViewApi();
  const document = useEditorView(
    useShallow((s) => ({
      pages: s.pages,
      fields: s.fields,
      annotations: s.annotations,
      preservedSourceAnnotations: s.preservedSourceAnnotations,
    })),
  );
  const { pages } = document;
  const initial =
    pages.find((page) => ids.includes(getPageId(page))) ?? pages[0];
  const [scope, setScope] = useState("selected");
  const [range, setRange] = useState("");
  const [preset, setPreset] = useState("custom");
  const [width, setWidth] = useState(() => getPageView(initial, 0).width);
  const [height, setHeight] = useState(() => getPageView(initial, 0).height);
  const [content, setContent] =
    useState<PageResizeOptions["content"]>("original");
  const [anchor, setAnchor] = useState("0.5,0.5");
  const [editedMargins, setMargins] = useState<PageCropMargins>();
  const [locked, setLocked] = useState(false);
  const [failure, setFailure] = useState("");
  const parsed = parsePageRange(range, pages.length, { empty: "none" });
  const targets =
    scope === "all"
      ? pages
      : scope === "range"
        ? parsed.ok
          ? parsed.pageIndices.map((i) => pages[i])
          : []
        : pages.filter((page) => ids.includes(getPageId(page)));
  const reference = targets[0] ?? initial;
  const cropBase = useMemo(
    () => ({ ...reference, geometry: resetPageCrop(reference) }),
    [reference],
  );
  const currentMargins = useMemo(() => {
    const { box } = getPageGeometry(reference);
    const a = pagePointToView({ x: box.x, y: box.y }, cropBase, 0);
    const b = pagePointToView(
      { x: box.x + box.width, y: box.y + box.height },
      cropBase,
      0,
    );
    const full = getPageView(cropBase, 0);
    // Express the current crop in the full paper's displayed coordinates,
    // including saved rotation, resized paper and an imported PDF's CropBox.
    return {
      left: Math.max(0, Math.min(a.x, b.x)),
      top: Math.max(0, Math.min(a.y, b.y)),
      right: Math.max(0, full.width - Math.max(a.x, b.x)),
      bottom: Math.max(0, full.height - Math.max(a.y, b.y)),
    };
  }, [reference, cropBase]);
  const margins = editedMargins ?? currentMargins;
  const [anchorX, anchorY] = anchor.split(",").map(Number) as [
    PageResizeOptions["anchorX"],
    PageResizeOptions["anchorY"],
  ];
  const options = useMemo(
    () => ({ width, height, content, anchorX, anchorY }),
    [width, height, content, anchorX, anchorY],
  );
  const contents = useMemo(() => getThumbnailContents(document), [document]);
  const validation = useMemo(() => {
    if (!targets.length) return { error: t("page_editor.invalid_range") };
    for (const page of targets) {
      try {
        if (mode === "resize") resizePageGeometry(page, options);
        else
          cropPageGeometry({ ...page, geometry: resetPageCrop(page) }, margins);
      } catch {
        return {
          error: t("page_editor.geometry.invalid_page", {
            page: page.pageIndex + 1,
          }),
        };
      }
    }
    return { error: "" };
  }, [targets, mode, options, margins, t]);
  const preview = useMemo(() => {
    if (mode === "crop") return cropBase;
    if (validation.error) return reference;
    return { ...reference, geometry: resizePageGeometry(reference, options) };
  }, [reference, validation.error, mode, options, cropBase]);
  const previewView = getPageView(preview, 0);
  const validFrame = !validation.error && mode === "crop";
  const changeMargins = (next: PageCropMargins) => {
    setMargins(next);
    setFailure("");
  };
  const apply = () => {
    if (validation.error) return;
    try {
      const selected = targets.map(getPageId),
        state = store.getState();
      if (mode === "resize") state.resizePages(selected, options);
      else state.cropPages(selected, margins, { reset: true });
      onClose();
    } catch {
      setFailure(t("page_editor.failed"));
    }
  };
  const select = (
    label: string,
    value: string,
    change: (v: string) => void,
    values: [string, string][],
  ) => (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={change}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        data-page-geometry-dialog={mode}
        onOpenAutoFocus={(event) => {
          if (mode !== "crop" || !(event.target instanceof HTMLElement)) return;
          const preview = event.target.querySelector<HTMLElement>(
            "[data-page-geometry-preview]",
          );
          if (preview) {
            event.preventDefault();
            preview.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b p-5 pr-12 text-left">
          <DialogTitle>{t(`page_editor.geometry.${mode}`)}</DialogTitle>
          <DialogDescription>
            {t(`page_editor.geometry.${mode}_hint`)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto p-5 sm:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            {mode === "resize" ? (
              <>
                {select(
                  t("page_editor.size"),
                  preset,
                  (value) => {
                    setPreset(value);
                    const size = presets[value];
                    if (size) {
                      const landscape = width > height;
                      setWidth(size[landscape ? 1 : 0] * mm);
                      setHeight(size[landscape ? 0 : 1] * mm);
                    }
                  },
                  [
                    ...Object.keys(presets).map(
                      (key) =>
                        [
                          key,
                          key === "letter" ? "Letter" : key.toUpperCase(),
                        ] as [string, string],
                    ),
                    ["custom", t("page_editor.geometry.custom")],
                  ],
                )}
                <div className="grid grid-cols-2 gap-3">
                  {(["width", "height"] as const).map((key) => {
                    const dimension = key === "width" ? width : height;
                    // Whole-mm step origin; keep the exact 1 pt limit in validation.
                    return (
                      <NumberInput
                        key={key}
                        label={`${t(`page_editor.geometry.${key}`)} (mm)`}
                        value={dimension / mm}
                        minValue={0}
                        maxValue={14400 / mm}
                        isInvalid={
                          !Number.isFinite(dimension) ||
                          dimension < 1 ||
                          dimension > 14400
                        }
                        formatOptions={{ maximumFractionDigits: 2 }}
                        onChange={(n) => {
                          setPreset("custom");
                          (key === "width" ? setWidth : setHeight)(
                            Math.min(14400, n * mm),
                          );
                        }}
                      />
                    );
                  })}
                </div>
                <div className="grid gap-2">
                  <Label id={`${id}-orientation`}>
                    {t("page_editor.orientation")}
                  </Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="lg"
                    value={width > height ? "landscape" : "portrait"}
                    aria-labelledby={`${id}-orientation`}
                    className="w-full"
                    onValueChange={(value) => {
                      if (!value) return;
                      const landscape = value === "landscape";
                      setWidth(
                        landscape
                          ? Math.max(width, height)
                          : Math.min(width, height),
                      );
                      setHeight(
                        landscape
                          ? Math.min(width, height)
                          : Math.max(width, height),
                      );
                    }}
                  >
                    <ToggleGroupItem value="portrait" className="flex-1 gap-2">
                      <RectangleVertical aria-hidden="true" />
                      {t("page_editor.portrait")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="landscape" className="flex-1 gap-2">
                      <RectangleHorizontal aria-hidden="true" />
                      {t("page_editor.landscape")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className="grid gap-2">
                  <Label id={`${id}-content`}>
                    {t("page_editor.geometry.content")}
                  </Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="lg"
                    value={content}
                    onValueChange={(value) => {
                      if (value) setContent(value as typeof content);
                    }}
                    aria-labelledby={`${id}-content`}
                    className="w-full"
                  >
                    {(["original", "fit"] as const).map((value) => (
                      <ToggleGroupItem
                        key={value}
                        value={value}
                        className="min-w-0 flex-1 text-xs"
                      >
                        {t(`page_editor.geometry.${value}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="grid gap-2">
                  <Label id={`${id}-anchor`}>
                    {t("page_editor.geometry.anchor")}
                  </Label>
                  <div className="flex items-center gap-4">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      spacing={1}
                      value={anchor}
                      onValueChange={(value) => {
                        if (value) setAnchor(value);
                      }}
                      aria-labelledby={`${id}-anchor`}
                      className="grid shrink-0 grid-cols-3 gap-1"
                      onKeyDownCapture={(event) => {
                        if (
                          (event.key !== "ArrowUp" &&
                            event.key !== "ArrowDown") ||
                          event.altKey ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.shiftKey
                        )
                          return;
                        const items = Array.from(
                          event.currentTarget.querySelectorAll<HTMLButtonElement>(
                            "[data-slot='toggle-group-item']",
                          ),
                        );
                        const index = items.indexOf(
                          event.target as HTMLButtonElement,
                        );
                        if (index < 0) return;
                        // Move by rows before the toggle group's linear navigation.
                        event.preventDefault();
                        event.stopPropagation();
                        items[
                          (index +
                            (event.key === "ArrowDown" ? 3 : -3) +
                            items.length) %
                            items.length
                        ]?.focus();
                      }}
                    >
                      {anchors.map(({ value, Icon, index }) => (
                        <ToggleGroupItem
                          key={value}
                          value={value}
                          aria-label={t(`page_editor.geometry.anchor_${index}`)}
                          title={t(`page_editor.geometry.anchor_${index}`)}
                          className="size-8 p-0"
                        >
                          <Icon aria-hidden="true" />
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <span className="text-muted-foreground text-xs">
                      {t(
                        `page_editor.geometry.anchor_${anchors.findIndex((item) => item.value === anchor)}`,
                      )}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(["top", "bottom", "left", "right"] as const).map((side) => (
                    <NumberInput
                      key={side}
                      label={`${t(`page_editor.geometry.${side}`)} (mm)`}
                      value={margins[side] / mm}
                      minValue={0}
                      formatOptions={{ maximumFractionDigits: 2 }}
                      onChange={(n) =>
                        changeMargins({ ...margins, [side]: n * mm })
                      }
                    />
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={locked}
                    onCheckedChange={(v) => setLocked(v === true)}
                  />
                  {t("page_editor.geometry.lock_ratio")}
                </label>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMargins(zeroMargins);
                    setFailure("");
                  }}
                >
                  {t("page_editor.geometry.reset_crop")}
                </Button>
                <p className="text-muted-foreground text-xs">
                  {t("page_editor.geometry.crop_note")}
                </p>
              </>
            )}
            {select(t("page_editor.geometry.scope"), scope, setScope, [
              ["selected", t("page_editor.geometry.selected")],
              ["all", t("page_editor.geometry.all")],
              ["range", t("page_editor.geometry.range")],
            ])}
            {scope === "range" && (
              <Input
                aria-label={t("page_editor.geometry.range")}
                placeholder="1-5, 8, 10-12"
                value={range}
                onChange={(e) => setRange(e.target.value)}
              />
            )}
            <p className="text-muted-foreground text-xs">
              {t("page_editor.geometry.count", { count: targets.length })}
            </p>
            {(validation.error || failure) && (
              <p role="alert" className="text-destructive text-sm">
                {validation.error || failure}
              </p>
            )}
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <PageGeometryPreview
              page={preview}
              worker={worker}
              content={contents[reference.pageIndex]}
              margins={validFrame ? margins : undefined}
              onMargins={changeMargins}
              locked={locked}
            />
            <p className="text-muted-foreground text-center text-xs">
              {t("sidebar.page", { page: reference.pageIndex + 1 })}
              {validFrame &&
                ` · ${((previewView.width - margins.left - margins.right) / mm).toFixed(1)} × ${((previewView.height - margins.top - margins.bottom) / mm).toFixed(1)} mm`}
            </p>
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-row justify-end border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {t("common.actions.cancel")}
          </Button>
          <Button disabled={!!validation.error} onClick={apply}>
            {t("page_editor.geometry.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
