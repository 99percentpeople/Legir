import { useTheme } from "@/components/theme-provider";
import type { PreviewMode } from "../content/types";

const screenshots = import.meta.glob<string>(
  "../assets/workspace/previews/*.webp",
  { eager: true, query: "?url", import: "default" },
);

export function WorkspaceScreenshot({
  language,
  mode,
  label,
}: {
  language: string;
  mode: PreviewMode;
  label: string;
}) {
  const { theme } = useTheme();
  const source = (appearance: "light" | "dark") =>
    screenshots[
      `../assets/workspace/previews/${language}-${appearance}-${mode}.webp`
    ] ??
    screenshots[`../assets/workspace/previews/en-${appearance}-${mode}.webp`];

  return (
    <picture className="workspace-screenshot">
      {theme === "system" && (
        <source media="(prefers-color-scheme: dark)" srcSet={source("dark")} />
      )}
      <img
        src={source(theme === "dark" ? "dark" : "light")}
        alt={label}
        width={1200}
        height={900}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
