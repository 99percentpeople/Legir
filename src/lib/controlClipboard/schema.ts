import { z } from "zod";
import { FieldType } from "@/types";
import type { ControlClipboard } from "./types";

const number = z.number().finite();
const point = z.object({ x: number, y: number });
const rect = point.extend({
  width: number.nonnegative(),
  height: number.nonnegative(),
});
const text = z.string().optional();
const flag = z.boolean().optional();
const numeric = number.optional();
const alignment = z.enum(["left", "center", "right"]).optional();
const borderStyle = z.enum(["solid", "dashed", "underline"]).optional();
const scaleMode = z.enum(["contain", "fill"]).optional();
const image = z.string().startsWith("data:image/");
const arrowStyle = z
  .enum([
    "closed_arrow",
    "line_arrow",
    "hollow_arrow",
    "circle",
    "square",
    "diamond",
    "slash",
  ])
  .optional();
const base = z.object({
  id: z.string(),
  pageIndex: number.int().nonnegative(),
  rect,
  rotationDeg: numeric,
});

// Strip unknown properties, particularly source PDF refs and appearance operators.
// All nested values are validated before they can reach rendering/export code.
const field = base.extend({
  type: z.nativeEnum(FieldType),
  name: z.string(),
  required: flag,
  isMultiSelect: flag,
  allowCustomValue: flag,
  style: z
    .object({
      borderColor: text,
      backgroundColor: text,
      borderWidth: numeric,
      borderStyle,
      textColor: text,
      fontSize: numeric,
      fontFamily: text,
      isTransparent: flag,
    })
    .optional(),
  value: text,
  defaultValue: text,
  placeholder: text,
  isChecked: flag,
  isDefaultChecked: flag,
  exportValue: text,
  options: z.array(z.string()).optional(),
  radioValue: text,
  signatureData: image.optional(),
  imageScaleMode: scaleMode,
  toolTip: text,
  readOnly: flag,
  multiline: flag,
  maxLength: numeric,
  alignment,
});

const annotation = base.extend({
  type: z.enum([
    "highlight",
    "ink",
    "comment",
    "freetext",
    "link",
    "shape",
    "stamp",
  ]),
  rects: z.array(rect).optional(),
  points: z.array(point).optional(),
  strokes: z.array(z.array(point)).optional(),
  text,
  highlightedText: text,
  author: text,
  color: text,
  backgroundColor: text,
  backgroundOpacity: numeric,
  borderColor: text,
  borderWidth: numeric,
  borderStyle,
  dashDensity: numeric,
  opacity: numeric,
  thickness: numeric,
  size: numeric,
  lineHeight: numeric,
  textPadding: z
    .union([
      number.nonnegative(),
      z.object({
        top: number.nonnegative(),
        right: number.nonnegative(),
        bottom: number.nonnegative(),
        left: number.nonnegative(),
      }),
    ])
    .optional(),
  fontFamily: text,
  alignment,
  subtype: text,
  intent: text,
  linkUrl: text,
  linkDestPageIndex: number.int().nonnegative().optional(),
  flatten: flag,
  stamp: z
    .object({
      kind: z.enum(["preset", "image"]),
      presetId: z
        .enum(["approved", "rejected", "draft", "confidential", "final"])
        .optional(),
      label: text,
      image: z
        .object({
          dataUrl: image,
          intrinsicSize: z
            .object({ width: number.positive(), height: number.positive() })
            .optional(),
        })
        .optional(),
      appearance: z
        .object({
          frame: z.enum(["plain", "card"]).optional(),
          scaleMode,
          box: rect.optional(),
          source: z.enum(["native", "baked"]).optional(),
        })
        .optional(),
    })
    .optional(),
  shapeType: z
    .enum([
      "square",
      "circle",
      "line",
      "polyline",
      "polygon",
      "cloud_polygon",
      "arrow",
      "cloud",
    ])
    .optional(),
  shapePoints: z.array(point).optional(),
  shapeStartArrow: flag,
  shapeEndArrow: flag,
  shapeStartArrowStyle: arrowStyle,
  shapeEndArrowStyle: arrowStyle,
  arrowSize: numeric,
  cloudIntensity: numeric,
  cloudSpacing: numeric,
  meta: z.object({ kind: z.string() }).catchall(z.unknown()).optional(),
  replies: z
    .array(
      z.object({
        id: z.string(),
        parentAnnotationId: z.string(),
        inReplyToReplyId: text,
        text,
        author: text,
      }),
    )
    .optional(),
});

const envelope = { version: z.literal(1), sourceDocumentId: z.string() };
export const controlClipboardSchema: z.ZodType<ControlClipboard> =
  z.discriminatedUnion("type", [
    z.object({ ...envelope, type: z.literal("field"), data: field }),
    z.object({ ...envelope, type: z.literal("annotation"), data: annotation }),
  ]);
