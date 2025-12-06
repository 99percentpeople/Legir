import { FormField, Annotation } from "@/types";

export interface PropertyPanelProps<T = FormField | Annotation> {
  data: T;
  onChange: (updates: Partial<T>) => void;
  onTriggerHistorySave: () => void;
}
