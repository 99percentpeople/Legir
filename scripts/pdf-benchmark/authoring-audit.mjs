/* global process, console */
// Run with the current SDK, or an absolute historical authoring-module path.
// The resulting PDFs are checked/rasterized by qpdf and Poppler separately.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import fontkit from "pdf-fontkit";
const [output, historicalModule] = process.argv.slice(2);
if (!output)
  throw new Error("Usage: node authoring-audit.mjs OUTPUT [AUTHORING_MODULE]");
const api = await import(
  historicalModule
    ? pathToFileURL(resolve(historicalModule)).href
    : "@legir/pdfium/authoring"
);
const { PDFDocument, StandardFonts, rgb, degrees } = api;
await mkdir(output, { recursive: true });
const pdf = await PDFDocument.create();
try {
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const cjk = await pdf.embedFont(
    new Uint8Array(await readFile("public/fonts/NotoSansSC-Regular.ttf")),
    { subset: true },
  );
  const serif = await pdf.embedFont(
    new Uint8Array(await readFile("public/fonts/SourceHanSerifSC-VF.ttf")),
    { subset: true },
  );
  const page = pdf.addPage([600, 800]);
  page.drawText("PDF authoring: colors / shapes / Chinese", {
    font,
    size: 18,
    x: 30,
    y: 760,
  });
  page.drawText("中文表单与印章测试，文字清晰完整。", {
    font: cjk,
    size: 18,
    x: 30,
    y: 720,
  });
  page.drawText("中文宋体与字体子集", { font: serif, size: 18, x: 30, y: 685 });
  page.drawRectangle({
    x: 30,
    y: 600,
    width: 100,
    height: 50,
    rotate: degrees(10),
    color: rgb(0.9, 0.1, 0.2),
    opacity: 0.7,
  });
  page.drawEllipse({
    x: 210,
    y: 625,
    xScale: 45,
    yScale: 25,
    color: rgb(0.1, 0.3, 0.8),
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
  });
  const svg = await pdf.embedSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100" viewBox="0 0 240 100"><g transform="translate(4 4)" fill="none" stroke="#07583b" stroke-width="3"><rect width="232" height="92" rx="8"/><path d="M 12 70 Q 100 -10 220 70"/></g><text x="120" y="48" font-family="Helvetica" font-size="22" text-anchor="middle" dominant-baseline="middle" fill="#07583b">APPROVED</text></svg>',
  );
  page.drawSvg(svg, {
    x: 300,
    y: 650,
    width: 240,
    height: 100,
    fonts: { Helvetica: font },
  });
  const png = await pdf.embedPng(
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAACCAYAAACQahZdAAAAF0lEQVR4nGP4z8Dwn4HhPwMqjSHwnwEAQfYO8jhL1bQAAAAASUVORK5CYII=",
  );
  page.drawImage(png, { x: 30, y: 525, width: 100, height: 40 });
  const form = pdf.getForm();
  const text = form.createTextField("name");
  text.setText("Alice");
  text.addToPage(page, {
    x: 30,
    y: 460,
    width: 200,
    height: 28,
    font,
    textColor: rgb(0.1, 0.2, 0.8),
  });
  text.setFontSize(13);
  text.updateAppearances(font);
  const chinese = form.createTextField("chinese");
  chinese.setText("中文输入");
  chinese.addToPage(page, {
    x: 300,
    y: 460,
    width: 220,
    height: 28,
    font: cjk,
    textColor: rgb(0.7, 0, 0),
  });
  chinese.setFontSize(14);
  chinese.updateAppearances(cjk);
  const multi = form.createTextField("multiline");
  multi.enableMultiline();
  multi.setText("Words should wrap at word boundaries.\nSecond line.");
  multi.addToPage(page, { x: 30, y: 340, width: 200, height: 80, font });
  multi.setFontSize(13);
  multi.updateAppearances(font);
  const combo = form.createTextField("combed");
  combo.setMaxLength(6);
  combo.enableCombing();
  combo.setText("A12345");
  combo.addToPage(page, { x: 300, y: 380, width: 220, height: 35, font });
  combo.setFontSize(16);
  combo.updateAppearances(font);
  const password = form.createTextField("password");
  password.enablePassword();
  password.setText("secret");
  password.addToPage(page, { x: 300, y: 330, width: 220, height: 30, font });
  password.setFontSize(13);
  password.updateAppearances(font);
  const checkbox = form.createCheckBox("check");
  checkbox.addToPage(page, {
    x: 30,
    y: 280,
    width: 20,
    height: 20,
    textColor: rgb(0.8, 0, 0),
  });
  checkbox.check();
  checkbox.updateAppearances();
  const radio = form.createRadioGroup("radio");
  radio.addOptionToPage("yes", page, { x: 90, y: 280, width: 20, height: 20 });
  radio.addOptionToPage("no", page, { x: 130, y: 280, width: 20, height: 20 });
  radio.select("yes");
  radio.updateAppearances();
  const dropdown = form.createDropdown("dropdown");
  dropdown.setOptions(["red", "green", "blue"]);
  dropdown.select("green");
  dropdown.addToPage(page, { x: 300, y: 270, width: 220, height: 30, font });
  dropdown.setFontSize(13);
  dropdown.updateAppearances(font);
  const list = form.createOptionList("list");
  list.setOptions(["one", "two", "three"]);
  list.select("two");
  list.addToPage(page, { x: 30, y: 100, width: 200, height: 120, font });
  list.setFontSize(13);
  list.updateAppearances(font);
  const rotated = form.createTextField("rotated");
  rotated.setText("ROTATED");
  rotated.addToPage(page, {
    x: 550,
    y: 150,
    width: 120,
    height: 28,
    font,
    rotate: degrees(90),
  });
  rotated.setFontSize(13);
  rotated.updateAppearances(font);
  pdf.setTitle("Native authoring audit");
  await writeFile(
    `${output}/editable.pdf`,
    await pdf.save({ updateFieldAppearances: false }),
  );
  form.flatten({ updateFieldAppearances: false });
  await writeFile(
    `${output}/flattened.pdf`,
    await pdf.save({ updateFieldAppearances: false }),
  );
  console.log(
    JSON.stringify({
      output,
      pages: pdf.getPageCount(),
      flattenedFields: form.getFields().length,
    }),
  );
} finally {
  pdf.destroy?.();
}
