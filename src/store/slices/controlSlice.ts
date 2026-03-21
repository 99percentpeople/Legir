import { ANNOTATION_STYLES } from "@/constants";
import {
  getMoveDelta,
  getMovedAnnotationUpdates,
  getMovedFieldUpdates,
} from "@/lib/controlMovement";
import { shouldSwitchToSelectAfterUse } from "@/lib/tool-behavior";
import {
  prepareAnnotationsForStore,
  prepareInkAnnotationForStore,
} from "@/lib/inkGeometry";
import type { Annotation, FormField } from "@/types";
import { FieldType } from "@/types";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// Field/annotation editing and tool transitions live together because most of
// these reducers need to coordinate selection, history, and "switch back to select".
export const createControlSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "addField"
    | "addAnnotation"
    | "addAnnotations"
    | "updateField"
    | "updateAnnotation"
    | "deleteAnnotation"
    | "deleteSelection"
    | "selectControl"
    | "setTool"
    | "openDialog"
    | "closeDialog"
    | "setKeys"
    | "moveSelectedControl"
    | "setAllFreetextFlatten"
  >
> = (set, get) => ({
  addField: (field) => {
    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => {
      const shouldSwitch = shouldSwitchToSelectAfterUse(state.tool);
      const isForcedContinuous = state.keys.ctrl || state.keys.meta;
      return {
        fields: [...state.fields, field],
        selectedId: field.id,
        tool: shouldSwitch && !isForcedContinuous ? "select" : state.tool,
        isDirty: true,
      };
    });
  },

  addAnnotation: (annotation, opts) => {
    const { saveCheckpoint } = get();
    saveCheckpoint();
    const now = new Date().toISOString();
    set((state) => {
      const author = annotation.author || state.options.userName;
      const annotationWithDetails = prepareInkAnnotationForStore({
        ...annotation,
        updatedAt: now,
        author,
      } satisfies Annotation);
      const shouldSwitch = shouldSwitchToSelectAfterUse(state.tool);
      const isForcedContinuous = state.keys.ctrl || state.keys.meta;
      const shouldSelect = opts?.select !== false;
      return {
        annotations: [...state.annotations, annotationWithDetails],
        selectedId: shouldSelect ? annotationWithDetails.id : state.selectedId,
        tool: shouldSwitch && !isForcedContinuous ? "select" : state.tool,
        isDirty: true,
      };
    });
  },

  addAnnotations: (annotations, opts) => {
    if (!Array.isArray(annotations) || annotations.length === 0) return;
    const { saveCheckpoint } = get();
    saveCheckpoint();
    const now = new Date().toISOString();
    set((state) => {
      const authorFallback = state.options.userName;
      const batch = prepareAnnotationsForStore(
        annotations.map(
          (annotation) =>
            ({
              ...annotation,
              updatedAt: now,
              author: annotation.author || authorFallback,
            }) satisfies Annotation,
        ),
      );

      const shouldSelect = opts?.select !== false;
      const last = batch[batch.length - 1];
      return {
        annotations: [...state.annotations, ...batch],
        selectedId: shouldSelect
          ? (last?.id ?? state.selectedId)
          : state.selectedId,
        isDirty: true,
      };
    });
  },

  updateField: (id, updates) => {
    set((state) => {
      let nextFields = state.fields;
      const targetField = state.fields.find((field) => field.id === id);

      if (!targetField) return state;

      if (updates.isChecked === true && targetField.type === FieldType.RADIO) {
        nextFields = nextFields.map((field) =>
          field.name === targetField.name &&
          field.id !== id &&
          field.type === FieldType.RADIO
            ? { ...field, isChecked: false }
            : field,
        );
      }

      const propsToSync = [
        "value",
        "defaultValue",
        "options",
        "required",
        "readOnly",
        "toolTip",
        "multiline",
        "maxLength",
        "alignment",
      ];

      if (targetField.type !== FieldType.RADIO) {
        propsToSync.push("isChecked");
        propsToSync.push("isDefaultChecked");
      }

      const syncUpdates: Partial<FormField> = {};
      propsToSync.forEach((key) => {
        const typedKey = key as keyof FormField;
        if (updates[typedKey] !== undefined) {
          // @ts-expect-error index signature mismatch for dynamic keyof assignment
          syncUpdates[typedKey] = updates[typedKey];
        }
      });

      if (Object.keys(syncUpdates).length > 0) {
        nextFields = nextFields.map((field) =>
          field.name === targetField.name &&
          field.id !== id &&
          field.type === targetField.type
            ? { ...field, ...syncUpdates }
            : field,
        );
      }

      nextFields = nextFields.map((field) =>
        field.id === id ? { ...field, ...updates } : field,
      );

      return { ...state, fields: nextFields, isDirty: true };
    });
  },

  updateAnnotation: (id, updates) => {
    set((state) => {
      const current = state.annotations.find(
        (annotation) => annotation.id === id,
      );

      const shouldMarkEdited =
        !!current?.sourcePdfRef && current.isEdited !== true;
      const shouldResetFontOnFirstEdit =
        shouldMarkEdited &&
        !!current?.sourcePdfFontMissing &&
        updates.fontFamily === undefined;

      const updatesWithTime = {
        ...updates,
        updatedAt: new Date().toISOString(),
        ...(shouldMarkEdited ? { isEdited: true } : null),
        ...(shouldResetFontOnFirstEdit ? { fontFamily: "Helvetica" } : null),
      };
      const shouldRecomputeInkRect =
        current?.type === "ink" &&
        (updates.thickness !== undefined ||
          updates.strokes !== undefined ||
          updates.points !== undefined ||
          current.rect === undefined);
      const shouldRecomputeInkPath =
        current?.type === "ink" &&
        (updates.strokes !== undefined ||
          updates.points !== undefined ||
          !current.svgPath);

      return {
        annotations: state.annotations.map((annotation) =>
          annotation.id === id
            ? prepareInkAnnotationForStore(
                { ...annotation, ...updatesWithTime },
                {
                  recomputeRect: shouldRecomputeInkRect,
                  recomputeSvgPath: shouldRecomputeInkPath,
                },
              )
            : annotation,
        ),
        isDirty: true,
      };
    });
  },

  deleteAnnotation: (id) => {
    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => ({
      annotations: state.annotations.filter(
        (annotation) => annotation.id !== id,
      ),
      selectedId: state.selectedId === id ? null : state.selectedId,
      isDirty: true,
    }));
  },

  deleteSelection: () => {
    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => {
      if (state.selectedId) {
        const isField = state.fields.some(
          (field) => field.id === state.selectedId,
        );
        if (isField) {
          return {
            fields: state.fields.filter(
              (field) => field.id !== state.selectedId,
            ),
            selectedId: null,
            isDirty: true,
          };
        }

        const isAnnotation = state.annotations.some(
          (annotation) => annotation.id === state.selectedId,
        );
        if (isAnnotation) {
          return {
            annotations: state.annotations.filter(
              (annotation) => annotation.id !== state.selectedId,
            ),
            selectedId: null,
            isDirty: true,
          };
        }
      }

      return state;
    });
  },

  selectControl: (id) => set({ selectedId: id }),

  setTool: (tool) =>
    set((state) => {
      if (tool === "draw_highlight") {
        return {
          tool,
          selectedId: null,
          highlightStyle: {
            color:
              state.highlightStyle?.color || ANNOTATION_STYLES.highlight.color,
            thickness: Math.max(
              state.highlightStyle?.thickness ||
                ANNOTATION_STYLES.highlight.thickness,
              ANNOTATION_STYLES.highlight.thickness,
            ),
            opacity:
              state.highlightStyle?.opacity ??
              ANNOTATION_STYLES.highlight.opacity,
          },
        };
      }

      return {
        tool,
        selectedId: tool === "select" ? state.selectedId : null,
      };
    }),

  openDialog: (name) =>
    set({
      activeDialog: name,
      closeConfirmSource: null,
    }),

  closeDialog: () =>
    set({
      activeDialog: null,
      closeConfirmSource: null,
    }),

  setKeys: (keys) => set((state) => ({ keys: { ...state.keys, ...keys } })),

  moveSelectedControl: (direction, isFast) => {
    set((state) => {
      if (!state.selectedId) return state;
      const { dx, dy } = getMoveDelta(direction, isFast);

      const fieldIndex = state.fields.findIndex(
        (field) => field.id === state.selectedId,
      );
      if (fieldIndex !== -1) {
        const field = state.fields[fieldIndex];
        const nextFields = [...state.fields];
        nextFields[fieldIndex] = {
          ...field,
          ...getMovedFieldUpdates(field, dx, dy),
        };

        return { ...state, fields: nextFields, isDirty: true };
      }

      const annotationIndex = state.annotations.findIndex(
        (annotation) => annotation.id === state.selectedId,
      );
      if (annotationIndex === -1) return state;

      const annotation = state.annotations[annotationIndex];
      if (!annotation.rect) return state;

      const shouldMarkEdited =
        !!annotation.sourcePdfRef && annotation.isEdited !== true;
      const updatedAt = new Date().toISOString();
      const baseAnnotation = {
        ...annotation,
        updatedAt,
        ...(shouldMarkEdited ? { isEdited: true } : null),
      } satisfies Annotation;

      let nextAnnotation: Annotation;

      if (annotation.type === "ink") {
        nextAnnotation = prepareInkAnnotationForStore(
          {
            ...baseAnnotation,
            ...getMovedAnnotationUpdates(annotation, dx, dy),
          },
          {
            recomputeRect: true,
            recomputeSvgPath: true,
          },
        );
      } else {
        nextAnnotation = {
          ...baseAnnotation,
          ...getMovedAnnotationUpdates(annotation, dx, dy),
        };
      }

      const nextAnnotations = [...state.annotations];
      nextAnnotations[annotationIndex] = nextAnnotation;
      return { ...state, annotations: nextAnnotations, isDirty: true };
    });
  },

  setAllFreetextFlatten: (flatten) => {
    const { saveCheckpoint } = get();
    saveCheckpoint();
    const now = new Date().toISOString();
    set((state) => {
      let changed = false;
      const nextAnnotations = state.annotations.map((annotation) => {
        if (annotation.type !== "freetext") return annotation;
        if ((annotation.flatten ?? false) === flatten) return annotation;
        changed = true;
        const shouldMarkEdited =
          !!annotation.sourcePdfRef && annotation.isEdited !== true;

        return {
          ...annotation,
          flatten,
          updatedAt: now,
          ...(shouldMarkEdited ? { isEdited: true } : null),
        } satisfies Annotation;
      });

      if (!changed) return state;
      return { ...state, annotations: nextAnnotations, isDirty: true };
    });
  },
});
