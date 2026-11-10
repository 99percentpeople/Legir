import "./assets";
import { configurePdfHost } from "@legir/pdf-core/host";
import { getPdfWorkerForBytes } from "@legir/pdf-renderer";
import { getPlatformSystemFontBytes } from "@/services/platform/fonts";
import { isDesktopApp } from "@/services/platform/runtime";
import { getSystemFontCatalog } from "@/lib/system-fonts";
import { appEventBus } from "@/lib/eventBus";

// The only bridge from reusable PDF modules into Legir application services.
configurePdfHost({
  getSystemFontBytes: getPlatformSystemFontBytes,
  systemFontsAvailable: isDesktopApp,
  getSystemFontCatalog,
  emit: appEventBus.emit.bind(appEventBus),
  findContentOwner: getPdfWorkerForBytes,
  createContentWorker: () =>
    new Worker(
      new URL("../../workers/pdf-content.worker.ts", import.meta.url),
      { type: "module", name: "pdf-content" },
    ),
});
