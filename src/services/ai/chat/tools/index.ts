import { annotationToolModule } from "./annotationTools";
import { documentToolModule } from "./documentTools";
import { formToolModule } from "./formTools";
import { navigationToolModule } from "./navigationTools";

export const aiToolModules = [
  documentToolModule,
  annotationToolModule,
  formToolModule,
  navigationToolModule,
] as const;
