/** Text extraction contracts and layout math, shared by custom text layers. */
export type {
  TextItem,
  TextMarkedContent,
  TextStyle,
  TextContent,
} from "./engine/textTypes.js";
export {
  DEFAULT_PDF_TEXT_STYLE,
  isMarkedContent,
  isTextItem,
  getItemTransform,
  transform,
  normalizeRotationDeg,
  deltaRotationDeg,
  getAxes,
  projectPointsInterval,
  intervalDistance,
} from "./lib/textGeometry.js";
