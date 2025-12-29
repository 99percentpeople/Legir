export const containsNonAscii = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
};

export const isSerifFamily = (fontFamily: string | undefined) => {
  const f = (fontFamily || "").toLowerCase();
  if (f.includes("sans-serif")) return false;
  return f.includes("times") || f.includes("serif");
};

export const isExplicitCjkFontSelection = (fontFamily: string | undefined) => {
  if (!fontFamily) return false;
  return (
    fontFamily === "Noto Sans SC" ||
    fontFamily === "Source Han Serif SC" ||
    fontFamily === "Custom" ||
    fontFamily === "CustomSans" ||
    fontFamily === "CustomSerif"
  );
};
