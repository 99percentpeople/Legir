import React, { useState, useRef, useEffect } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/utils/cn";
import { Trash2, Palette, Type, Pencil, MessageSquare } from "lucide-react";
import { ControlWrapper } from "../ControlWrapper";
import { Button } from "@/components/ui/button";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { FloatingToolbar } from "../FloatingToolbar";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getContrastColor } from "@/utils/colors";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import {
  resolveCjkFallbackFontStack,
  resolveFontStackForDisplay,
  resolveFontStackWithCjkFallback,
  isKnownFontKey,
  splitTextRuns,
} from "@/lib/fonts";
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

export const FreetextControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, isSelected, onUpdate, onDelete, onEdit, onAskAi } = props;
  const { t } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const warnedMissingFontRef = useRef(false);

  const displaySize = Math.round((data.size || 12) as number);
  const lineHeightMultiplier =
    typeof data.lineHeight === "number" &&
    Number.isFinite(data.lineHeight) &&
    data.lineHeight > 0
      ? data.lineHeight
      : 1;
  const baseLineHeightPx = (data.size || 12) * lineHeightMultiplier;
  const rotationDeg =
    typeof data.rotationDeg === "number" ? data.rotationDeg : 0;

  const rotatedOuterRect = (() => {
    const rect = data.rect;
    if (!rect) return undefined;
    if (!Number.isFinite(rotationDeg) || rotationDeg === 0) return undefined;

    const theta = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const absCos = Math.abs(cos);
    const absSin = Math.abs(sin);

    const outerW = absCos * rect.width + absSin * rect.height;
    const outerH = absSin * rect.width + absCos * rect.height;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    return {
      x: cx - outerW / 2,
      y: cy - outerH / 2,
      width: outerW,
      height: outerH,
    };
  })();

  const resolvedFontFamily = resolveFontStackForDisplay(data.fontFamily);
  const cjkFontFamily = resolveCjkFallbackFontStack(data.fontFamily);
  const editFontFamily = resolveFontStackWithCjkFallback(data.fontFamily);

  const sourcePdfFallbackFontFamily = (() => {
    const raw = (data.sourcePdfFontName || "").trim();
    const derivedFromInjected = (() => {
      const s = (data.fontFamily || "").trim();
      const m = s.match(/^pdf-(.+)-[0-9a-f]{8}$/i);
      return m?.[1]?.trim() || "";
    })();

    const candidate = raw || derivedFromInjected;
    if (!candidate) return undefined;

    const noPrefix = candidate.replace(/^\//, "");
    const noSubset = noPrefix.includes("+")
      ? noPrefix.split("+").slice(1).join("+")
      : noPrefix;
    const cleaned = noSubset.trim();
    if (!cleaned) return undefined;
    return `"${cleaned}"`;
  })();

  const nonAsciiFontFamily =
    data.fontFamily && !isKnownFontKey(data.fontFamily)
      ? (() => {
          const base = resolveFontStackWithCjkFallback(data.fontFamily);
          if (!sourcePdfFallbackFontFamily) return base;
          if (base.includes(sourcePdfFallbackFontFamily)) return base;
          return `${data.fontFamily}, ${sourcePdfFallbackFontFamily}, ${cjkFontFamily}`;
        })()
      : cjkFontFamily;

  const lastClickTimeRef = useRef<number>(0);

  const baseOpacity = Math.min(1, Math.max(0, data.opacity ?? 1));
  const hasText = (data.text || "").length > 0;
  const hasBackgroundColor = (data.backgroundColor || "").trim().length > 0;
  const borderWidth =
    typeof data.borderWidth === "number" && Number.isFinite(data.borderWidth)
      ? Math.max(0, data.borderWidth)
      : 0;
  const hasBorder = borderWidth > 0;
  const borderColor = data.borderColor || data.color || "#000000";
  const innerContentWidth = Math.max(
    1,
    (data.rect?.width ?? 1) - borderWidth * 2,
  );
  const innerContentHeight = Math.max(
    1,
    (data.rect?.height ?? 1) - borderWidth * 2,
  );
  const effectiveOpacity =
    baseOpacity * (!hasText && !hasBackgroundColor ? 0.1 : 1);
  const contentBoxStyle: React.CSSProperties = {
    backgroundColor: data.backgroundColor || undefined,
    borderStyle: hasBorder ? "solid" : "none",
    borderColor: hasBorder ? borderColor : undefined,
    borderWidth: hasBorder
      ? `calc(${borderWidth}px * var(--scale, 1))`
      : undefined,
    boxSizing: "border-box",
  };

  useEffect(() => {
    if (!isSelected) {
      setIsEditing(false);
    }
  }, [isSelected]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    if (warnedMissingFontRef.current) return;
    if (!data.sourcePdfFontMissing) return;
    warnedMissingFontRef.current = true;
    toast.warning(t("annotation.font_missing_warning"));
  }, [isEditing, data.sourcePdfFontMissing, t]);

  const handlePointerDown = (_e: React.PointerEvent) => {
    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) {
      // Double click detected
      // e.stopPropagation(); // Removed to allow double click to work properly
      setIsEditing(true);
    }
    lastClickTimeRef.current = now;
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  return (
    <ControlWrapper
      {...props}
      customRect={rotatedOuterRect}
      showBorder={isSelected}
      resizable={true}
    >
      <FloatingToolbar isVisible={isSelected && !isEditing} sideOffset={32}>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Font Size"
            >
              <Type size={16} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 p-3"
            align="start"
            side="top"
            alignOffset={-6}
            sideOffset={6}
          >
            <div className="flex items-center gap-3">
              <span className="w-8 text-sm font-medium">{displaySize}pt</span>
              <Slider
                value={[displaySize]}
                min={8}
                max={72}
                step={1}
                onValueChange={(vals) => onUpdate?.(data.id, { size: vals[0] })}
                className="flex-1"
              />
            </div>
          </PopoverContent>
        </Popover>

        <ColorPickerPopover
          paletteType="foreground"
          color={data.color || "#000000"}
          onColorChange={(c) => onUpdate?.(data.id, { color: c })}
          showThickness={false}
          side="top"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            style={{
              backgroundColor: getContrastColor(data.color || "#000000"),
            }}
          >
            <Palette size={16} style={{ color: data.color }} />
          </Button>
        </ColorPickerPopover>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsEditing(true)}
          title="Edit Text"
        >
          <Pencil size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onEdit?.(data.id)}
          title="Open in Comments Panel"
        >
          <MessageSquare size={16} />
        </Button>

        <AnnotationAskAiButton annotation={data} onAskAi={onAskAi} />

        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
          onClick={() => onDelete?.(data.id)}
        >
          <Trash2 size={16} />
        </Button>
      </FloatingToolbar>

      <div
        className="relative flex h-full w-full items-start overflow-hidden transition-colors"
        style={{
          color: data.color || "#000000",
          fontSize: `calc(${data.size || 12}px * var(--scale, 1))`,
          fontFamily: resolvedFontFamily,
          lineHeight: `calc(${baseLineHeightPx}px * var(--scale, 1))`,
          opacity: effectiveOpacity,
        }}
        onPointerDown={handlePointerDown}
      >
        {rotationDeg !== 0 && data.rect ? (
          <div
            className="absolute top-1/2 left-1/2"
            style={{
              width: `calc(${data.rect.width}px * var(--scale, 1))`,
              height: `calc(${data.rect.height}px * var(--scale, 1))`,
              transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
              transformOrigin: "50% 50%",
            }}
          >
            <div className="h-full w-full" style={contentBoxStyle}>
              {isEditing ? (
                <textarea
                  ref={textareaRef}
                  className="h-full w-full resize-none bg-transparent outline-none"
                  value={data.text || ""}
                  onChange={(e) =>
                    onUpdate?.(data.id, { text: e.target.value })
                  }
                  onBlur={handleBlur}
                  onPointerDown={(e) => {
                    if (e.button === 1) return;
                    e.stopPropagation();
                  }}
                  style={{
                    fontFamily: editFontFamily,
                    fontSize: "inherit",
                    color: "inherit",
                    lineHeight: "inherit",
                  }}
                />
              ) : (
                <div className="h-full w-full wrap-break-word whitespace-pre-wrap">
                  {hasText
                    ? data.text!.split(/\r\n|\r|\n/).map((line, idx, arr) => (
                        <React.Fragment key={idx}>
                          {splitTextRuns(line).map((run, rIdx) => (
                            <span
                              key={rIdx}
                              style={{
                                fontFamily: run.isAscii
                                  ? resolvedFontFamily
                                  : nonAsciiFontFamily,
                              }}
                            >
                              {run.text}
                            </span>
                          ))}
                          {idx < arr.length - 1 ? "\n" : null}
                        </React.Fragment>
                      ))
                    : hasBackgroundColor
                      ? null
                      : "Double click to edit"}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full w-full" style={contentBoxStyle}>
            {isEditing ? (
              <textarea
                ref={textareaRef}
                className="h-full w-full resize-none bg-transparent outline-none"
                value={data.text || ""}
                onChange={(e) => onUpdate?.(data.id, { text: e.target.value })}
                onBlur={handleBlur}
                onPointerDown={(e) => {
                  if (e.button === 1) return;
                  e.stopPropagation();
                }}
                style={{
                  fontFamily: editFontFamily,
                  fontSize: "inherit",
                  color: "inherit",
                  lineHeight: "inherit",
                }}
              />
            ) : (
              <div
                className="relative h-full w-full"
                style={{
                  color: "inherit",
                }}
              >
                <div
                  className="absolute top-0 left-0"
                  style={{
                    width: `${innerContentWidth}px`,
                    height: `${innerContentHeight}px`,
                    transform: "scale(var(--scale, 1))",
                    transformOrigin: "0 0",
                    fontFamily: resolvedFontFamily,
                    fontSize: `${data.size || 12}px`,
                    lineHeight: `${baseLineHeightPx}px`,
                    color: "inherit",
                  }}
                >
                  <div className="h-full w-full wrap-break-word whitespace-pre-wrap">
                    {hasText
                      ? data.text!.split(/\r\n|\r|\n/).map((line, idx, arr) => (
                          <React.Fragment key={idx}>
                            {splitTextRuns(line).map((run, rIdx) => (
                              <span
                                key={rIdx}
                                style={{
                                  fontFamily: run.isAscii
                                    ? resolvedFontFamily
                                    : nonAsciiFontFamily,
                                }}
                              >
                                {run.text}
                              </span>
                            ))}
                            {idx < arr.length - 1 ? "\n" : null}
                          </React.Fragment>
                        ))
                      : hasBackgroundColor
                        ? null
                        : "Double click to edit"}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ControlWrapper>
  );
};
