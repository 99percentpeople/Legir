/**
 * Property panel component contracts for workspace controls.
 *
 * This file is intentionally narrow: only props shared by property editor
 * components should live here.
 */
import { FormField, Annotation } from "@/types";

export interface PropertyPanelProps<T = FormField | Annotation> {
  data: T;
  onChange: (updates: Partial<T>) => void;
  onTriggerHistorySave: () => void;
}
