import React, { useState, useRef, useEffect } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/cn";
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

export const FreetextControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, scale, isSelected, onUpdate, onDelete, onEdit } = props;
  const { t } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const warnedMissingFontRef = useRef(false);

  const displaySize = Math.round((data.size || 12) as number);

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
    <ControlWrapper {...props} showBorder={isSelected} resizable={true}>
      <FloatingToolbar isVisible={isSelected && !isEditing}>
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
              backgroundColor: getContrastColor(data.color),
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
        className={cn(
          "flex h-full w-full items-start overflow-hidden transition-colors",
          isSelected && !isEditing && "ring-primary ring-1 ring-inset",
        )}
        style={{
          "--scale": scale,
          color: data.color || "#000000",
          backgroundColor: data.backgroundColor || undefined,
          fontSize: `calc(${data.size || 12}px * var(--scale, 1))`,
          fontFamily: resolvedFontFamily,
          lineHeight: 1.4,
          opacity: baseOpacity * (data.text ? 1 : 0.5),
        }}
        onPointerDown={handlePointerDown}
      >
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
          <div className="h-full w-full wrap-break-word whitespace-pre-wrap">
            {data.text
              ? data.text.split(/\r\n|\r|\n/).map((line, idx, arr) => (
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
              : "Double click to edit"}
          </div>
        )}
      </div>
    </ControlWrapper>
  );
};
