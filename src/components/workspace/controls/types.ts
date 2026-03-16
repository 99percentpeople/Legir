/**
 * Workspace control component contracts.
 *
 * Keep shared props for control renderers and wrappers here. Do not move
 * service, store, or editor domain types into this file; import those from
 * their source modules instead.
 */
import React from "react";
import { FormField, Annotation } from "@/types";

/**
 * Base properties shared by all workspace controls.
 * @template T The type of data associated with the control (FormField or Annotation).
 */
export interface BaseControlProps<T = FormField | Annotation> {
  /** Unique identifier of the control */
  id: string;
  /** Whether the control is currently selected */
  isSelected: boolean;
  /** Actual zoom level for UI scaling (handles, borders) when scale is normalized */
  zoom?: number;
  /** Whether the workspace is in annotation mode */
  isAnnotationMode: boolean;
  /** Whether the workspace is in form editing mode */
  isFormMode: boolean;
  /** Whether the pan tool is active (should override cursor) */
  isSelectable?: boolean;
  /** Callback for pointer down event (usually for selection initiation) */
  onPointerDown: (e: React.PointerEvent) => void;
  /** Callback when the control is selected */
  onSelect: (id: string) => void;
  /** Callback to update control data */
  onUpdate: (id: string, updates: Partial<T>) => void;
  /** Optional callback to delete the control */
  onDelete?: (id: string) => void;
  /** Optional callback to trigger edit mode (e.g., text editing) */
  onEdit?: (id: string) => void;
  /** Optional callback to start resizing */
  onResizeStart?: (handle: string, e: React.PointerEvent) => void;
}

/**
 * Properties for form field controls.
 */
export interface FormControlProps extends BaseControlProps<FormField> {
  /** The form field data */
  data: FormField;
}

/**
 * Properties for annotation controls.
 */
export interface AnnotationControlProps extends BaseControlProps<Annotation> {
  /** The annotation data */
  data: Annotation;
}

export type ControlProps = FormControlProps | AnnotationControlProps;
