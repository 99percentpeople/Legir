import { ConnectionModelCatalogProvider } from "./modelCatalog/base";
import type { AiSdkModelCatalogProvider } from "./types";
export const getAiSdkModelCatalogProvider = (
  connectionId: string,
): AiSdkModelCatalogProvider =>
  new ConnectionModelCatalogProvider(connectionId);
