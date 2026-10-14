// Copyright (c) 2026 Legir contributors. BSD-3-Clause.
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  PDFOperator,
} from "./objects.js";
import { PDFFont, StandardFonts } from "./fonts.js";
import {
  type Color,
  type Rotation,
  TextAlignment,
  colorComponents,
  componentsToColor,
  drawEllipse,
  drawRectangle,
  drawTextField,
  layoutCombedText,
  layoutMultilineText,
  layoutSinglelineText,
  op,
  rgb,
  rotateInPlace,
  setFillingColor,
  setStrokingColor,
} from "./operators.js";
import type { PDFDocument, PDFPage } from "./document.js";
const key = PDFName.of;
function inherited(dict: PDFDict, name: string): PDFObject | undefined {
  const seen = new Set<PDFDict>();
  let current: PDFDict | undefined = dict;
  while (current && !seen.has(current)) {
    seen.add(current);
    const value = current.lookup(key(name));
    if (value !== undefined) return value;
    current = current.lookupMaybe(key("Parent"), PDFDict);
  }
}
const stringValue = (value: PDFObject | undefined) =>
  value instanceof PDFString
    ? value.decodeText()
    : value instanceof PDFName
      ? value.decodeText()
      : undefined;
function appearanceColor(da: string | undefined): Color {
  let result: Color = rgb(0, 0, 0);
  for (const match of (da ?? "").matchAll(
    /((?:[-+]?(?:\d*\.)?\d+\s+){1,4})(rg|g|k)\b/g,
  )) {
    const values = match[1].trim().split(/\s+/).map(Number);
    const count = match[2] === "rg" ? 3 : match[2] === "k" ? 4 : 1;
    if (values.length === count) result = componentsToColor(values)!;
  }
  return result;
}
class AppearanceCharacteristics {
  constructor(readonly dict: PDFDict) {}
  getRotation() {
    return this.dict.lookupMaybe(key("R"), PDFNumber)?.asNumber();
  }
  setRotation(value: number) {
    this.dict.set(key("R"), PDFNumber.of(value));
  }
  private color(name: string) {
    return this.dict
      .lookupMaybe(key(name), PDFArray)
      ?.asArray()
      .map((v) => (v as PDFNumber).asNumber());
  }
  getBorderColor() {
    return this.color("BC");
  }
  getBackgroundColor() {
    return this.color("BG");
  }
  setBorderColor(value: number[]) {
    this.dict.set(key("BC"), this.dict.context.obj(value));
  }
  setBackgroundColor(value: number[]) {
    this.dict.set(key("BG"), this.dict.context.obj(value));
  }
  setCaptions(value: { normal?: string; rollover?: string; down?: string }) {
    for (const [name, text] of [
      ["CA", value.normal],
      ["RC", value.rollover],
      ["AC", value.down],
    ])
      if (text !== undefined)
        this.dict.set(key(name!), PDFHexString.fromText(text));
  }
}
class BorderStyle {
  constructor(readonly dict: PDFDict) {}
  getWidth() {
    return this.dict.lookupMaybe(key("W"), PDFNumber)?.asNumber() ?? 1;
  }
  setWidth(value: number) {
    this.dict.set(key("W"), PDFNumber.of(value));
  }
  getStyle() {
    return this.dict.lookupMaybe(key("S"), PDFName);
  }
  setStyle(value: PDFName) {
    this.dict.set(key("S"), value);
  }
}
export class PDFWidgetAnnotation {
  static fromDict(dict: PDFDict) {
    return new PDFWidgetAnnotation(dict);
  }
  constructor(readonly dict: PDFDict) {}
  getRectangle() {
    return (
      this.dict.lookupMaybe(key("Rect"), PDFArray)?.asRectangle() ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
    );
  }
  setRectangle(r: { x: number; y: number; width: number; height: number }) {
    this.dict.set(
      key("Rect"),
      this.dict.context.obj([r.x, r.y, r.x + r.width, r.y + r.height]),
    );
  }
  getDefaultAppearance() {
    return stringValue(this.dict.lookup(key("DA")));
  }
  setDefaultAppearance(text: string) {
    this.dict.set(key("DA"), PDFString.of(text));
  }
  private ensure(name: string) {
    let dict = this.dict.lookupMaybe(key(name), PDFDict);
    if (!dict) {
      dict = this.dict.context.obj({});
      this.dict.set(key(name), dict);
    }
    return dict;
  }
  getAppearanceCharacteristics() {
    const dict = this.dict.lookupMaybe(key("MK"), PDFDict);
    return dict ? new AppearanceCharacteristics(dict) : undefined;
  }
  getOrCreateAppearanceCharacteristics() {
    return new AppearanceCharacteristics(this.ensure("MK"));
  }
  getBorderStyle() {
    const dict = this.dict.lookupMaybe(key("BS"), PDFDict);
    return dict ? new BorderStyle(dict) : undefined;
  }
  getOrCreateBorderStyle() {
    return new BorderStyle(this.ensure("BS"));
  }
  setP(page: PDFRef) {
    this.dict.set(key("P"), page);
  }
  P() {
    return this.dict.get(key("P")) as PDFRef | undefined;
  }
  getAppearanceState() {
    return this.dict.lookupMaybe(key("AS"), PDFName);
  }
  setAppearanceState(state: PDFName) {
    this.dict.set(key("AS"), state);
  }
  getAppearances() {
    const dict = this.dict.lookupMaybe(key("AP"), PDFDict);
    return {
      normal: dict?.lookup(key("N")) as PDFDict | PDFStream | undefined,
      rollover: dict?.lookup(key("R")) as PDFDict | PDFStream | undefined,
      down: dict?.lookup(key("D")) as PDFDict | PDFStream | undefined,
    };
  }
  getNormalAppearance() {
    return this.getAppearances().normal;
  }
  setNormalAppearance(appearance: PDFRef | PDFDict) {
    this.ensure("AP").set(key("N"), appearance);
  }
  getOnValue() {
    const normal = this.getAppearances().normal;
    return normal instanceof PDFDict
      ? normal.keys().find((name) => name !== key("Off"))
      : undefined;
  }
  getFlags() {
    return this.dict.lookupMaybe(key("F"), PDFNumber)?.asNumber() ?? 0;
  }
  setFlags(value: number) {
    this.dict.set(key("F"), PDFNumber.of(value));
  }
}
export class AcroField {
  constructor(
    readonly dict: PDFDict,
    readonly ref: PDFRef,
  ) {}
  Kids() {
    return this.dict.lookupMaybe(key("Kids"), PDFArray);
  }
  Opt() {
    return this.dict.lookupMaybe(key("Opt"), PDFArray);
  }
  getWidgets() {
    if (this.dict.get(key("Subtype")) === key("Widget"))
      return [PDFWidgetAnnotation.fromDict(this.dict)];
    return (this.Kids()?.asArray() ?? [])
      .map((ref) => this.dict.context.lookup(ref))
      .filter((v): v is PDFDict => v instanceof PDFDict)
      .map(PDFWidgetAnnotation.fromDict);
  }
  setPartialName(name: string) {
    this.dict.set(key("T"), PDFHexString.fromText(name));
  }
  getFullyQualifiedName() {
    const parts: string[] = [];
    const seen = new Set<PDFDict>();
    let dict: PDFDict | undefined = this.dict;
    while (dict && !seen.has(dict)) {
      seen.add(dict);
      const name = stringValue(dict.lookup(key("T")));
      if (name) parts.unshift(name);
      dict = dict.lookupMaybe(key("Parent"), PDFDict);
    }
    return parts.join(".");
  }
  getDefaultAppearance() {
    return stringValue(inherited(this.dict, "DA"));
  }
  setDefaultAppearance(value: string) {
    this.dict.set(key("DA"), PDFString.of(value));
  }
  getFlags() {
    const flags = inherited(this.dict, "Ff");
    return flags instanceof PDFNumber ? flags.asNumber() : 0;
  }
  setFlags(value: number) {
    this.dict.set(key("Ff"), PDFNumber.of(value));
  }
  getOnValues() {
    return this.getWidgets()
      .map((w) => w.getOnValue())
      .filter((v): v is PDFName => !!v);
  }
  getValue() {
    return (inherited(this.dict, "V") as PDFName | undefined) ?? key("Off");
  }
  setValue(value: PDFObject) {
    this.dict.set(key("V"), value);
    if (value instanceof PDFName)
      for (const widget of this.getWidgets())
        widget.setAppearanceState(
          widget.getOnValue() === value ? value : key("Off"),
        );
  }
  addWidget(ref: PDFRef) {
    let kids = this.Kids();
    if (!kids) {
      kids = this.dict.context.obj([]);
      this.dict.set(key("Kids"), kids);
    }
    kids.push(ref);
  }
}
export type FieldOptions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  borderWidth?: number;
  borderColor?: Color;
  backgroundColor?: Color;
  textColor?: Color;
  font?: PDFFont;
  rotate?: Rotation;
  hidden?: boolean;
  caption?: string;
};
export type AppearanceProviderFor<T extends PDFField> = (
  field: T,
  widget: PDFWidgetAnnotation,
  font: PDFFont,
) =>
  | PDFOperator[]
  | { normal: PDFOperator[]; down?: PDFOperator[]; rollover?: PDFOperator[] };
export class PDFField {
  readonly acroField: AcroField;
  constructor(
    dict: PDFDict,
    readonly ref: PDFRef,
    readonly doc: PDFDocument,
  ) {
    this.acroField = new AcroField(dict, ref);
  }
  getName() {
    return this.acroField.getFullyQualifiedName();
  }
  isReadOnly() {
    return !!(this.acroField.getFlags() & 1);
  }
  enableReadOnly() {
    this.flag(1, true);
  }
  disableReadOnly() {
    this.flag(1, false);
  }
  isRequired() {
    return !!(this.acroField.getFlags() & 2);
  }
  enableRequired() {
    this.flag(2, true);
  }
  disableRequired() {
    this.flag(2, false);
  }
  isExported() {
    return !(this.acroField.getFlags() & 4);
  }
  disableExporting() {
    this.flag(4, true);
  }
  enableExporting() {
    this.flag(4, false);
  }
  protected flag(mask: number, value: boolean) {
    const flags = this.acroField.getFlags();
    this.acroField.setFlags(value ? flags | mask : flags & ~mask);
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  protected widget(page: PDFPage, options: FieldOptions = {}, on?: string) {
    const context = this.doc.context,
      border = options.borderWidth ?? 1;
    const angle = options.rotate
      ? options.rotate.angle *
        (options.rotate.type === "radians" ? 180 / Math.PI : 1)
      : 0;
    const rotation = ((angle % 360) + 360) % 360;
    if (rotation % 90)
      throw new Error("Widget rotation must be a multiple of 90 degrees");
    const width = options.width ?? 200,
      height = options.height ?? 50;
    const r = {
      x:
        (options.x ?? 0) -
        border / 2 -
        (rotation === 90 ? height : rotation === 180 ? width : 0),
      y:
        (options.y ?? 0) -
        border / 2 -
        (rotation === 180 ? height : rotation === 270 ? width : 0),
      width: (rotation % 180 ? height : width) + border,
      height: (rotation % 180 ? width : height) + border,
    };
    const dict = context.obj({
      Type: "Annot",
      Subtype: "Widget",
      Rect: [r.x, r.y, r.x + r.width, r.y + r.height],
      Parent: this.ref,
      P: page.ref,
      F: options.hidden ? 2 : 4,
      BS: { Type: "Border", W: border, S: "S" },
      MK: {
        R: rotation,
        BC: colorComponents(options.borderColor ?? rgb(0, 0, 0)),
        BG: colorComponents(options.backgroundColor ?? rgb(1, 1, 1)),
      },
      ...(on ? { AS: "Off" } : {}),
    });
    const ref = context.register(dict);
    this.acroField.addWidget(ref);
    page.node.addAnnot(ref);
    this.doc.getForm().markFieldAsDirty(this.ref);
    const widget = PDFWidgetAnnotation.fromDict(dict);
    if (options.textColor)
      widget.setDefaultAppearance(
        setFillingColor(options.textColor).toString(),
      );
    return widget;
  }
  protected appearance(
    widget: PDFWidgetAnnotation,
    operators: PDFOperator[],
    font?: PDFFont,
  ) {
    const rect = widget.getRectangle(),
      rotation = widget.getAppearanceCharacteristics()?.getRotation() ?? 0;
    const resources = font ? { Font: { [font.name]: font.ref } } : {};
    const ref = this.doc.context.register(
      this.doc.context.formXObject(operators, {
        BBox: [0, 0, rect.width, rect.height],
        Resources: resources,
      }),
    );
    if (rotation)
      widget.getOrCreateAppearanceCharacteristics().setRotation(rotation);
    return ref;
  }
  needsAppearancesUpdate() {
    return (
      this.doc.getForm().fieldIsDirty(this.ref) ||
      this.acroField.getWidgets().some((w) => !w.getAppearances().normal)
    );
  }
  defaultUpdateAppearances(font: PDFFont) {
    this.updateAppearances(font);
  }
  updateAppearances(_font?: PDFFont) {
    this.doc.getForm().markFieldAsClean(this.ref);
  }
  setFontSize(size: number) {
    const da = this.acroField.getDefaultAppearance() ?? "/Helvetica 0 Tf 0 g";
    this.acroField.setDefaultAppearance(
      /\/[^\s]+\s+[\d.+-]+\s+Tf/.test(da)
        ? da.replace(/(\/[^\s]+\s+)[\d.+-]+(\s+Tf)/, `$1${size}$2`)
        : `${da}\n/Helvetica ${size} Tf`,
    );
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
}
function defaultTextAppearance(
  field: PDFTextField,
  widget: PDFWidgetAnnotation,
  font: PDFFont,
) {
  const r = widget.getRectangle(),
    mk = widget.getAppearanceCharacteristics(),
    border = widget.getBorderStyle()?.getWidth() ?? 0,
    rotation = mk?.getRotation() ?? 0,
    w = rotation % 180 ? r.height : r.width,
    h = rotation % 180 ? r.width : r.height,
    da =
      widget.getDefaultAppearance() ??
      field.acroField.getDefaultAppearance() ??
      "",
    fontSize =
      Number(
        /([\d.]+)\s+Tf/.exec(da)?.[1] ??
          /([\d.]+)\s+Tf/.exec(
            field.acroField.getDefaultAppearance() ?? "",
          )?.[1],
      ) || undefined,
    bounds = {
      x: border + 1,
      y: border + 1,
      width: w - 2 * (border + 1),
      height: h - 2 * (border + 1),
    },
    text = field.isPassword()
      ? "*".repeat((field.getText() ?? "").length)
      : (field.getText() ?? ""),
    textColor = appearanceColor(da);
  const options = { font, fontSize, bounds, alignment: field.getAlignment() };
  const layout = field.isMultiline()
    ? layoutMultilineText(text, options)
    : field.isCombed()
      ? layoutCombedText(text, {
          ...options,
          cellCount: field.getMaxLength() ?? 0,
        })
      : layoutSinglelineText(text, options);
  const lines =
    "lines" in layout
      ? layout.lines
      : "cells" in layout
        ? layout.cells
        : [layout.line];
  field.acroField.setDefaultAppearance(
    `/${font.name} ${layout.fontSize} Tf ${setFillingColor(textColor)}`,
  );
  return [
    ...rotateInPlace({ ...r, rotation }),
    ...drawTextField({
      x: border / 2,
      y: border / 2,
      width: w - border,
      height: h - border,
      borderWidth: border,
      borderColor: componentsToColor(mk?.getBorderColor()),
      color: componentsToColor(mk?.getBackgroundColor()),
      textColor,
      font: font.name,
      fontSize: layout.fontSize,
      textLines: lines,
      padding: 1,
    }),
  ];
}
export class PDFTextField extends PDFField {
  getText() {
    return stringValue(inherited(this.acroField.dict, "V"));
  }
  setText(text: string | undefined) {
    if (text === undefined) this.acroField.dict.delete(key("V"));
    else {
      if (
        this.getMaxLength() !== undefined &&
        text.length > this.getMaxLength()!
      )
        throw new Error("Text exceeds maximum length");
      this.acroField.dict.set(key("V"), PDFHexString.fromText(text));
    }
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  getAlignment() {
    const q = inherited(this.acroField.dict, "Q");
    return q instanceof PDFNumber ? q.asNumber() : TextAlignment.Left;
  }
  setAlignment(value: TextAlignment) {
    this.acroField.dict.set(key("Q"), PDFNumber.of(value));
  }
  isMultiline() {
    return !!(this.acroField.getFlags() & (1 << 12));
  }
  enableMultiline() {
    this.flag(1 << 12, true);
  }
  disableMultiline() {
    this.flag(1 << 12, false);
  }
  isCombed() {
    return !!(this.acroField.getFlags() & (1 << 24));
  }
  enableCombing() {
    this.flag(1 << 24, true);
  }
  disableCombing() {
    this.flag(1 << 24, false);
  }
  getMaxLength() {
    const max = inherited(this.acroField.dict, "MaxLen");
    return max instanceof PDFNumber ? max.asNumber() : undefined;
  }
  setMaxLength(value: number) {
    this.acroField.dict.set(key("MaxLen"), PDFNumber.of(value));
  }
  removeMaxLength() {
    this.acroField.dict.delete(key("MaxLen"));
  }
  enablePassword() {
    this.flag(1 << 13, true);
  }
  isPassword() {
    return !!(this.acroField.getFlags() & (1 << 13));
  }
  addToPage(page: PDFPage, options: FieldOptions = {}) {
    this.widget(page, options);
    this.updateAppearances(options.font ?? this.doc.getForm().getDefaultFont());
  }
  updateAppearances(
    font = this.doc.getForm().getDefaultFont(),
    provider: AppearanceProviderFor<PDFTextField> = defaultTextAppearance,
  ) {
    for (const widget of this.acroField.getWidgets()) {
      const appearance = provider(this, widget, font);
      widget.setNormalAppearance(
        this.appearance(
          widget,
          Array.isArray(appearance) ? appearance : appearance.normal,
          font,
        ),
      );
      if (!Array.isArray(appearance)) {
        const ap = widget.dict.lookup(key("AP"), PDFDict);
        if (appearance.down)
          ap.set(key("D"), this.appearance(widget, appearance.down, font));
        if (appearance.rollover)
          ap.set(key("R"), this.appearance(widget, appearance.rollover, font));
      }
    }
    this.doc.getForm().registerFont(font);
    this.doc.getForm().markFieldAsClean(this.ref);
  }
}
class PDFToggleField extends PDFField {
  protected buttonAppearance(
    widget: PDFWidgetAnnotation,
    on: string,
    radio: boolean,
  ) {
    const rect = widget.getRectangle(),
      mk = widget.getAppearanceCharacteristics(),
      rotation = mk?.getRotation() ?? 0,
      r = {
        width: rotation % 180 ? rect.height : rect.width,
        height: rotation % 180 ? rect.width : rect.height,
      },
      markColor = appearanceColor(
        widget.getDefaultAppearance() ?? this.acroField.getDefaultAppearance(),
      ),
      bw = widget.getBorderStyle()?.getWidth() ?? 1;
    const rotate = rotateInPlace({ ...rect, rotation });
    const base = radio
      ? drawEllipse({
          x: r.width / 2,
          y: r.height / 2,
          xScale: (r.width - bw) / 2,
          yScale: (r.height - bw) / 2,
          borderColor: componentsToColor(mk?.getBorderColor()),
          borderWidth: bw,
          color: componentsToColor(mk?.getBackgroundColor()),
        })
      : drawRectangle({
          x: bw / 2,
          y: bw / 2,
          width: r.width - bw,
          height: r.height - bw,
          borderColor: componentsToColor(mk?.getBorderColor()),
          borderWidth: bw,
          color: componentsToColor(mk?.getBackgroundColor()),
        });
    const mark = radio
      ? drawEllipse({
          x: r.width / 2,
          y: r.height / 2,
          xScale: r.width / 4,
          yScale: r.height / 4,
          color: markColor,
        })
      : [
          op("q"),
          setStrokingColor(markColor),
          op("w", Math.max(1, r.width / 10)),
          op("m", r.width * 0.2, r.height * 0.5),
          op("l", r.width * 0.43, r.height * 0.25),
          op("l", r.width * 0.82, r.height * 0.78),
          op("S"),
          op("Q"),
        ];
    const normal = this.doc.context.obj({
      Off: this.appearance(widget, [...rotate, ...base]),
      [on]: this.appearance(widget, [...rotate, ...base, ...mark]),
    });
    widget.setNormalAppearance(normal);
    widget.setAppearanceState(
      this.acroField.getValue() === key(on) ? key(on) : key("Off"),
    );
  }
}
export class PDFCheckBox extends PDFToggleField {
  isChecked() {
    return this.acroField.getValue() !== key("Off");
  }
  check() {
    this.acroField.setValue(this.acroField.getOnValues()[0] ?? key("Yes"));
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  uncheck() {
    this.acroField.setValue(key("Off"));
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  addToPage(page: PDFPage, options: FieldOptions = {}) {
    const w = this.widget(page, { width: 50, height: 50, ...options }, "Yes");
    this.buttonAppearance(w, "Yes", false);
  }

  updateAppearances() {
    for (const widget of this.acroField.getWidgets())
      this.buttonAppearance(
        widget,
        widget.getOnValue()?.decodeText() ?? "Yes",
        false,
      );
    this.doc.getForm().markFieldAsClean(this.ref);
  }
}
export class PDFRadioGroup extends PDFToggleField {
  getOptions() {
    const options = this.acroField.Opt();
    return options
      ? options
          .asArray()
          .map((v) => stringValue(this.doc.context.lookup(v)) ?? "")
      : this.acroField.getOnValues().map((v) => v.decodeText());
  }
  addOptionToPage(option: string, page: PDFPage, options: FieldOptions = {}) {
    let opts = this.acroField.Opt();
    if (!opts) {
      opts = this.doc.context.obj([]);
      this.acroField.dict.set(key("Opt"), opts);
    }
    const on = String(opts.size());
    opts.push(PDFHexString.fromText(option));
    const widget = this.widget(page, { width: 50, height: 50, ...options }, on);
    this.buttonAppearance(widget, on, true);
  }
  select(option: string) {
    const index = this.getOptions().indexOf(option);
    if (index < 0) throw new Error(`Unknown radio option ${option}`);
    this.acroField.setValue(
      this.acroField.getWidgets()[index]?.getOnValue() ?? key(String(index)),
    );
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  getSelected() {
    const value = this.acroField.getValue();
    if (value === key("Off")) return undefined;
    const index = this.acroField.getOnValues().indexOf(value);
    return this.getOptions()[index];
  }
  clear() {
    this.acroField.setValue(key("Off"));
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  updateAppearances() {
    for (const widget of this.acroField.getWidgets())
      this.buttonAppearance(
        widget,
        widget.getOnValue()?.decodeText() ?? "Yes",
        true,
      );
    this.doc.getForm().markFieldAsClean(this.ref);
  }
}
class PDFChoiceField extends PDFField {
  setOptions(options: string[]) {
    this.acroField.dict.set(
      key("Opt"),
      this.doc.context.obj(options.map(PDFHexString.fromText)),
    );
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  addOptions(options: string | string[]) {
    this.setOptions([
      ...this.getOptions(),
      ...(Array.isArray(options) ? options : [options]),
    ]);
  }
  getOptions() {
    return (
      this.acroField
        .Opt()
        ?.asArray()
        .map((value) => {
          const object = this.doc.context.lookup(value);
          return object instanceof PDFArray
            ? (stringValue(object.lookup(1)) ?? "")
            : (stringValue(object) ?? "");
        }) ?? []
    );
  }
  getSelected() {
    const value = inherited(this.acroField.dict, "V");
    return value instanceof PDFArray
      ? value
          .asArray()
          .map((v) => stringValue(this.doc.context.lookup(v)) ?? "")
      : stringValue(value) !== undefined
        ? [stringValue(value)!]
        : [];
  }
  select(values: string | string[], merge = false) {
    const selected = Array.isArray(values) ? values : [values];
    if (
      !this.isEditable() &&
      selected.some((v) => !this.getOptions().includes(v))
    )
      throw new Error("Unknown choice value");
    const all = merge
      ? [...new Set([...this.getSelected(), ...selected])]
      : selected;
    if (all.length > 1 && !this.isMultiselect())
      throw new Error("Multiple values require a multiselect field");
    this.acroField.dict.set(
      key("V"),
      all.length === 1
        ? PDFHexString.fromText(all[0])
        : this.doc.context.obj(all.map(PDFHexString.fromText)),
    );
    const indexes = all
      .map((v) => this.getOptions().indexOf(v))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    this.acroField.dict.set(key("I"), this.doc.context.obj(indexes));
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  clear() {
    this.acroField.dict.delete(key("V"));
    this.acroField.dict.delete(key("I"));
    this.doc.getForm().markFieldAsDirty(this.ref);
  }
  enableEditing() {
    this.flag(1 << 18, true);
  }
  disableEditing() {
    this.flag(1 << 18, false);
  }
  isEditable() {
    return !!(this.acroField.getFlags() & (1 << 18));
  }
  enableMultiselect() {
    this.flag(1 << 21, true);
  }
  disableMultiselect() {
    this.flag(1 << 21, false);
  }
  isMultiselect() {
    return !!(this.acroField.getFlags() & (1 << 21));
  }
  addToPage(page: PDFPage, options: FieldOptions = {}) {
    this.widget(page, options);
    this.updateAppearances(options.font ?? this.doc.getForm().getDefaultFont());
  }
  updateAppearances(font = this.doc.getForm().getDefaultFont()) {
    const dict = this.acroField.dict,
      proxy = new PDFTextField(dict, this.ref, this.doc);
    proxy.getText = () =>
      this instanceof PDFOptionList
        ? this.getOptions().join("\n")
        : this.getSelected().join("\n");
    proxy.isMultiline = () => this instanceof PDFOptionList;
    proxy.updateAppearances(font);
  }
}
export class PDFDropdown extends PDFChoiceField {}
export class PDFOptionList extends PDFChoiceField {
  updateAppearances(font = this.doc.getForm().getDefaultFont()) {
    const selected = new Set(this.getSelected()),
      options = this.getOptions();
    const top =
      this.acroField.dict.lookupMaybe(key("TI"), PDFNumber)?.asNumber() ?? 0;
    for (const widget of this.acroField.getWidgets()) {
      const rect = widget.getRectangle(),
        mk = widget.getAppearanceCharacteristics(),
        rotation = mk?.getRotation() ?? 0;
      const width = rotation % 180 ? rect.height : rect.width,
        height = rotation % 180 ? rect.width : rect.height;
      const border = widget.getBorderStyle()?.getWidth() ?? 0,
        pad = border + 1;
      const da =
        widget.getDefaultAppearance() ?? this.acroField.getDefaultAppearance();
      const size = Number(/([\d.]+)\s+Tf/.exec(da ?? "")?.[1]) || 12;
      const textColor = appearanceColor(da),
        lineHeight = font.heightAtSize(size) * 1.2;
      const ops = [
        ...rotateInPlace({ ...rect, rotation }),
        ...drawRectangle({
          x: border / 2,
          y: border / 2,
          width: width - border,
          height: height - border,
          borderWidth: border,
          borderColor: componentsToColor(mk?.getBorderColor()),
          color: componentsToColor(mk?.getBackgroundColor()),
        }),
        op("q"),
        op(
          "re",
          pad,
          pad,
          Math.max(0, width - 2 * pad),
          Math.max(0, height - 2 * pad),
        ),
        op("W"),
        op("n"),
      ];
      for (let i = top; i < options.length; i++) {
        const y = height - pad - (i - top + 1) * lineHeight;
        if (y + lineHeight < pad) break;
        if (selected.has(options[i]))
          ops.push(
            ...drawRectangle({
              x: pad,
              y,
              width: width - 2 * pad,
              height: lineHeight,
              color: rgb(153 / 255, 193 / 255, 218 / 255),
            }),
          );
        ops.push(
          op("BT"),
          setFillingColor(textColor),
          op("Tf", key(font.name), size),
          op(
            "Tm",
            1,
            0,
            0,
            1,
            pad + 1,
            y + (lineHeight - font.heightAtSize(size)) / 2,
          ),
          op("Tj", font.encodeText(options[i])),
          op("ET"),
        );
      }
      ops.push(op("Q"));
      widget.setNormalAppearance(this.appearance(widget, ops, font));
    }
    this.doc.getForm().registerFont(font);
    this.doc.getForm().markFieldAsClean(this.ref);
  }
}
export class PDFButton extends PDFField {
  addToPage(caption: string, page: PDFPage, options: FieldOptions = {}) {
    const widget = this.widget(page, options);
    widget
      .getOrCreateAppearanceCharacteristics()
      .setCaptions({ normal: caption });
    const proxy = new PDFTextField(this.acroField.dict, this.ref, this.doc);
    proxy.getText = () => caption;
    proxy.updateAppearances(
      options.font ?? this.doc.getForm().getDefaultFont(),
    );
  }
}
export class PDFSignature extends PDFField {}
export class PDFForm {
  readonly acroForm: {
    dict: PDFDict;
    normalizedEntries: () => { Fields: PDFArray };
    removeField: (field: AcroField) => void;
  };
  private nameIndex?: Set<string>;
  private readonly dirty = new Set<number>();
  private defaultFont?: PDFFont;
  constructor(readonly doc: PDFDocument) {
    let dict = doc.catalog.lookupMaybe(key("AcroForm"), PDFDict);
    if (!dict) {
      dict = doc.context.obj({ Fields: [] });
      doc.catalog.set(key("AcroForm"), doc.context.register(dict));
    }
    const root = dict;
    this.acroForm = {
      dict,
      normalizedEntries: () => {
        let fields = root.lookupMaybe(key("Fields"), PDFArray);
        if (!fields) {
          fields = doc.context.obj([]);
          root.set(key("Fields"), fields);
        }
        return { Fields: fields };
      },
      removeField: (field) => {
        this.nameIndex?.delete(field.getFullyQualifiedName());
        const parent = field.dict.lookupMaybe(key("Parent"), PDFDict);
        const array =
          parent?.lookupMaybe(key("Kids"), PDFArray) ??
          this.acroForm.normalizedEntries().Fields;
        const i = array.indexOf(field.ref);
        if (i !== undefined) array.remove(i);
      },
    };
  }
  getFields(): PDFField[] {
    return this.readFields();
  }
  invalidateNames() {
    this.nameIndex = undefined;
  }
  private readFields(): PDFField[] {
    const result: PDFField[] = [],
      seen = new Set<PDFDict>();
    const visit = (ref: PDFObject) => {
      const dict = this.doc.context.lookup(ref);
      if (
        !(dict instanceof PDFDict) ||
        seen.has(dict) ||
        !(ref instanceof PDFRef)
      )
        return;
      seen.add(dict);
      const kids = dict.lookupMaybe(key("Kids"), PDFArray);
      const isBranch = kids?.asArray().some((k) => {
        const d = this.doc.context.lookup(k);
        return d instanceof PDFDict && d.get(key("Subtype")) !== key("Widget");
      });
      if (isBranch) {
        for (const k of kids!.asArray()) visit(k);
        return;
      }
      const ft = stringValue(inherited(dict, "FT")),
        flags = inherited(dict, "Ff"),
        ff = flags instanceof PDFNumber ? flags.asNumber() : 0;
      const cls =
        ft === "Tx"
          ? PDFTextField
          : ft === "Ch"
            ? ff & (1 << 17)
              ? PDFDropdown
              : PDFOptionList
            : ft === "Sig"
              ? PDFSignature
              : ft === "Btn"
                ? ff & (1 << 16)
                  ? PDFButton
                  : ff & (1 << 15)
                    ? PDFRadioGroup
                    : PDFCheckBox
                : undefined;
      if (cls) result.push(new cls(dict, ref, this.doc));
    };
    for (const ref of this.acroForm.normalizedEntries().Fields.asArray())
      visit(ref);
    return result;
  }
  getFieldMaybe(name: string) {
    return this.getFields().find((f) => f.getName() === name);
  }
  getField(name: string) {
    const f = this.getFieldMaybe(name);
    if (!f) throw new Error(`No PDF field named ${name}`);
    return f;
  }
  private typed<T extends PDFField>(
    name: string,
    cls: new (...args: ConstructorParameters<typeof PDFField>) => T,
  ) {
    const field = this.getField(name);
    if (!(field instanceof cls))
      throw new Error(`Incorrect PDF field type: ${name}`);
    return field;
  }
  getTextField(name: string) {
    return this.typed(name, PDFTextField);
  }
  getCheckBox(name: string) {
    return this.typed(name, PDFCheckBox);
  }
  getRadioGroup(name: string) {
    return this.typed(name, PDFRadioGroup);
  }
  getDropdown(name: string) {
    return this.typed(name, PDFDropdown);
  }
  getOptionList(name: string) {
    return this.typed(name, PDFOptionList);
  }
  getButton(name: string) {
    return this.typed(name, PDFButton);
  }
  getSignature(name: string) {
    return this.typed(name, PDFSignature);
  }
  private create<T extends PDFField>(
    name: string,
    cls: new (...args: ConstructorParameters<typeof PDFField>) => T,
    ft: string,
    flags = 0,
  ) {
    if (
      !name ||
      (this.nameIndex ??= new Set(
        this.readFields().map((field) => field.getName()),
      )).has(name)
    )
      throw new Error(`Duplicate or empty PDF field name: ${name}`);
    const dict = this.doc.context.obj({
        FT: ft,
        Ff: flags,
        T: PDFHexString.fromText(name),
        Kids: [],
      }),
      ref = this.doc.context.register(dict);
    this.acroForm.normalizedEntries().Fields.push(ref);
    this.nameIndex!.add(name);
    this.markFieldAsDirty(ref);
    return new cls(dict, ref, this.doc);
  }
  createTextField(name: string) {
    return this.create(name, PDFTextField, "Tx");
  }
  createCheckBox(name: string) {
    return this.create(name, PDFCheckBox, "Btn");
  }
  createRadioGroup(name: string) {
    return this.create(name, PDFRadioGroup, "Btn", 1 << 15);
  }
  createDropdown(name: string) {
    return this.create(name, PDFDropdown, "Ch", 1 << 17);
  }
  createOptionList(name: string) {
    return this.create(name, PDFOptionList, "Ch");
  }
  createButton(name: string) {
    return this.create(name, PDFButton, "Btn", 1 << 16);
  }
  getDefaultFont() {
    return (this.defaultFont ??= this.doc.embedStandardFont(
      StandardFonts.Helvetica,
    ));
  }
  registerFont(font: PDFFont) {
    let resources = this.acroForm.dict.lookupMaybe(key("DR"), PDFDict);
    if (!resources) {
      resources = this.doc.context.obj({});
      this.acroForm.dict.set(key("DR"), resources);
    }
    let fonts = resources.lookupMaybe(key("Font"), PDFDict);
    if (!fonts) {
      fonts = this.doc.context.obj({});
      resources.set(key("Font"), fonts);
    }
    fonts.set(key(font.name), font.ref);
  }
  markFieldAsDirty(ref: PDFRef) {
    this.dirty.add(ref.objectNumber);
  }
  markFieldAsClean(ref: PDFRef) {
    this.dirty.delete(ref.objectNumber);
  }
  fieldIsDirty(ref: PDFRef) {
    return this.dirty.has(ref.objectNumber);
  }
  updateFieldAppearances(font?: PDFFont) {
    for (const field of this.getFields())
      if (field.needsAppearancesUpdate())
        field.defaultUpdateAppearances(font ?? this.getDefaultFont());
  }
  removeField(field: PDFField) {
    for (const widget of field.acroField.getWidgets()) {
      const ref = this.doc.context.getObjectRef(widget.dict) ?? field.ref;
      for (const page of this.doc.getPages()) page.node.removeAnnot(ref);
      if (ref !== field.ref) this.doc.context.delete(ref);
    }
    this.acroForm.removeField(field.acroField);
    this.doc.context.delete(field.ref);
  }
  flatten(options: { updateFieldAppearances?: boolean } = {}) {
    if (options.updateFieldAppearances !== false) this.updateFieldAppearances();
    for (const field of this.getFields()) {
      for (const widget of field.acroField.getWidgets()) {
        const widgetRef =
            this.doc.context.getObjectRef(widget.dict) ?? field.ref,
          page = this.doc
            .getPages()
            .find(
              (p) =>
                p.ref === widget.P() ||
                p.node.Annots()?.asArray().includes(widgetRef),
            );
        if (!page) continue;
        let appearance = widget.getAppearances().normal;
        if (appearance instanceof PDFDict)
          appearance = appearance.lookup(
            widget.getAppearanceState() ?? key("Off"),
          ) as PDFStream | undefined;
        if (appearance instanceof PDFStream)
          page.drawAppearance(appearance, widget.getRectangle());
      }
      this.removeField(field);
    }
    this.acroForm.dict.delete(key("XFA"));
  }
  hasXFA() {
    return this.acroForm.dict.has(key("XFA"));
  }
  deleteXFA() {
    this.acroForm.dict.delete(key("XFA"));
  }
}
