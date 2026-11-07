import {
  duplicateFieldForDrag,
  duplicateAnnotationForDrag,
} from "@/lib/controlDuplication";
import { ANNOTATION_STYLES } from "@/constants";
import { preparePastedControls } from "@/lib/controlClipboard";
import { getPageId } from "@legir/pdf-core/lib/pageStructure";
import {
  getMoveDelta,
  getMovedAnnotationUpdates,
  getMovedFieldUpdates,
} from "@legir/pdf-model/controlMovement";
import {
  getNextLayerOrderForPage,
  getOrderedPageControls,
  reorderControlLayer,
} from "@legir/pdf-model/controlLayerOrder";
import { shouldSwitchToSelectAfterUse } from "@/lib/tool-behavior";
import {
  prepareAnnotationsForStore,
  prepareInkAnnotationForStore,
} from "@legir/pdf-model/inkGeometry";
import {
  PdfPermissionDeniedError,
  assertPdfPermissionOperation,
  canModifyPdfAnnotations,
  canModifyPdfContents,
  canUpdateFormFieldWithPdfPermissions,
  canUseToolWithPdfPermissions,
  getFormFieldUpdateDirtyScopes,
  isFormFieldValueUpdate,
  mergePdfPermissionDirtyScopes,
} from "@legir/pdf-model/pdfPermissions";
import type { Annotation, AnnotationReply, FormField } from "@/types";
import { FieldType } from "@/types";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

const throwFormFieldPermissionDenied = (updates: Partial<FormField>) => {
  throw new PdfPermissionDeniedError(
    isFormFieldValueUpdate(updates) ? "fill_form_value" : "edit_form_structure",
  );
};

// Field/annotation editing and tool transitions live together because most of
// these reducers need to coordinate selection, history, and "switch back to select".
export const createControlSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "addField"
    | "pasteControl"
    | "duplicateControls"
    | "addAnnotation"
    | "addAnnotations"
    | "updateField"
    | "resetFieldToDefault"
    | "updateAnnotation"
    | "addAnnotationReply"
    | "updateAnnotationReply"
    | "deleteAnnotationReply"
    | "deleteAnnotation"
    | "deleteSelection"
    | "reorderControlLayer"
    | "selectControl"
    | "setTool"
    | "openDialog"
    | "closeDialog"
    | "setKeys"
    | "moveSelectedControl"
    | "translateSelectedControls"
    | "setAllFreetextFlatten"
  >
> = (set, get) => ({
  pasteControl: (clipboard, target) => {
    const state = get();
    const page = state.pages.find((item) =>
      target
        ? getPageId(item) === target.pageId
        : item.pageIndex === state.currentPageIndex,
    );
    if (!page || state.mode === "pages" || state.documentLoadState !== "ready")
      return false;
    const controls = preparePastedControls(clipboard, page, state, target);
    if (!controls?.length) return false;
    if (controls.length === 1) {
      const control = controls[0];
      if (control.type === "field") state.addField(control.data);
      else state.addAnnotation(control.data);
      set({
        mode: control.type === "field" ? "form" : "annotation",
        tool: "select",
        selectedId: control.data.id,
        selectedControlIds: [control.data.id],
      });
    } else {
      const isField = controls[0].type === "field";
      assertPdfPermissionOperation(
        isField ? "edit_form_structure" : "create_annotation",
        state.documentPermissions,
      );
      const fields = [...state.fields];
      const annotations = [...state.annotations];
      const updatedAt = new Date().toISOString();
      for (const control of controls) {
        const layerOrder = getNextLayerOrderForPage(
          fields,
          annotations,
          page.pageIndex,
        );
        if (control.type === "field")
          fields.push({ ...control.data, layerOrder });
        else
          annotations.push({
            ...control.data,
            layerOrder,
            updatedAt,
            author: control.data.author || state.options.userName,
          });
      }
      state.saveCheckpoint();
      set({
        fields,
        annotations,
        mode: isField ? "form" : "annotation",
        tool: "select",
        selectedId: controls.at(-1)!.data.id,
        selectedControlIds: controls.map((control) => control.data.id),
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          isField ? { modifyContents: true } : { modifyAnnotations: true },
        ),
      });
    }
    return true;
  },

  duplicateControls: (ids, dx, dy) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const state = get();
    const wanted = new Set(ids);
    const first = [...state.fields, ...state.annotations].find((control) =>
      wanted.has(control.id),
    );
    if (!first || state.documentLoadState !== "ready") return;
    const isField = state.fields.some((field) => field.id === first.id);
    if (state.mode !== (isField ? "form" : "annotation")) return;
    const originals = getOrderedPageControls(
      state.fields,
      state.annotations,
      first.pageIndex,
    ).filter(
      (entry) =>
        wanted.has(entry.control.id) && (entry.kind === "field") === isField,
    );
    if (
      originals.length !== wanted.size ||
      originals.some(
        (entry) =>
          entry.kind === "field" &&
          entry.control.type === FieldType.SIGNATURE &&
          entry.control.signature?.present,
      )
    )
      return;
    assertPdfPermissionOperation(
      isField ? "edit_form_structure" : "create_annotation",
      state.documentPermissions,
    );
    const fields = [...state.fields];
    const annotations = [...state.annotations];
    const names = new Set(fields.map((field) => field.name));
    const selectedControlIds: string[] = [];
    const updatedAt = new Date().toISOString();
    for (const entry of originals) {
      const layerOrder = getNextLayerOrderForPage(
        fields,
        annotations,
        first.pageIndex,
      );
      if (entry.kind === "field") {
        const field = duplicateFieldForDrag(entry.control);
        // Radio widgets intentionally retain their group name; other fields must be independent.
        if (field.type !== FieldType.RADIO) {
          const base = field.name.replace(/_\d+$/, "");
          let suffix = 1;
          while (names.has(field.name)) field.name = `${base}_${suffix++}`;
        }
        names.add(field.name);
        fields.push({
          ...field,
          ...getMovedFieldUpdates(field, dx, dy),
          layerOrder,
        });
        selectedControlIds.push(field.id);
      } else {
        const annotation = duplicateAnnotationForDrag(entry.control);
        annotations.push(
          prepareInkAnnotationForStore(
            {
              ...annotation,
              ...getMovedAnnotationUpdates(annotation, dx, dy),
              layerOrder,
              updatedAt,
              author: annotation.author || state.options.userName,
            },
            { recomputeRect: true, recomputeSvgPath: true },
          ),
        );
        selectedControlIds.push(annotation.id);
      }
    }
    state.saveCheckpoint();
    set({
      fields,
      annotations,
      selectedControlIds,
      selectedId: selectedControlIds.at(-1)!,
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        isField ? { modifyContents: true } : { modifyAnnotations: true },
      ),
    });
  },

  addField: (field) => {
    assertPdfPermissionOperation(
      "edit_form_structure",
      get().documentPermissions,
    );
    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => {
      const shouldSwitch = shouldSwitchToSelectAfterUse(state.tool);
      const isForcedContinuous = state.keys.ctrl || state.keys.meta;
      const nextField = {
        ...field,
        layerOrder: getNextLayerOrderForPage(
          state.fields,
          state.annotations,
          field.pageIndex,
        ),
      } satisfies FormField;
      return {
        fields: [...state.fields, nextField],
        selectedId: nextField.id,
        tool: shouldSwitch && !isForcedContinuous ? "select" : state.tool,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyContents: true },
        ),
      };
    });
  },

  addAnnotation: (annotation, opts) => {
    assertPdfPermissionOperation(
      "create_annotation",
      get().documentPermissions,
    );
    const { saveCheckpoint } = get();
    saveCheckpoint();
    const now = new Date().toISOString();
    set((state) => {
      const author = annotation.author || state.options.userName;
      const annotationWithDetails = prepareInkAnnotationForStore({
        ...annotation,
        layerOrder: getNextLayerOrderForPage(
          state.fields,
          state.annotations,
          annotation.pageIndex,
        ),
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
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  addAnnotations: (annotations, opts) => {
    if (!Array.isArray(annotations) || annotations.length === 0) return;
    assertPdfPermissionOperation(
      "create_annotation",
      get().documentPermissions,
    );
    const { saveCheckpoint } = get();
    saveCheckpoint();
    const now = new Date().toISOString();
    set((state) => {
      const authorFallback = state.options.userName;
      const pageNextLayerOrder = new Map<number, number>();
      const batch = prepareAnnotationsForStore(
        annotations.map(
          (annotation) =>
            ({
              ...annotation,
              layerOrder: (() => {
                const current =
                  pageNextLayerOrder.get(annotation.pageIndex) ??
                  getNextLayerOrderForPage(
                    state.fields,
                    state.annotations,
                    annotation.pageIndex,
                  );
                pageNextLayerOrder.set(annotation.pageIndex, current + 1);
                return current;
              })(),
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
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  updateField: (id, updates) => {
    const currentState = get();
    const originalField = currentState.fields.find((field) => field.id === id);
    if (
      !originalField ||
      (originalField.type === FieldType.SIGNATURE &&
        originalField.signature?.present)
    )
      return;
    if (
      !canUpdateFormFieldWithPdfPermissions(
        currentState.documentPermissions,
        updates,
      )
    ) {
      throwFormFieldPermissionDenied(updates);
    }

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
        "placeholder",
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

      return {
        fields: nextFields,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          getFormFieldUpdateDirtyScopes(state.documentPermissions, updates),
        ),
      };
    });
  },

  resetFieldToDefault: (id) => {
    const targetField = get().fields.find((field) => field.id === id);
    if (!targetField) return;

    if (targetField.type === FieldType.RADIO) {
      const nextFields = get().fields.map((field) => {
        if (field.type !== FieldType.RADIO || field.name !== targetField.name) {
          return field;
        }

        return {
          ...field,
          isChecked: !!field.isDefaultChecked,
        };
      });

      const changed = nextFields.some((field, index) => {
        const current = get().fields[index];
        return current && field.isChecked !== current.isChecked;
      });

      if (!changed) return;

      if (
        !canUpdateFormFieldWithPdfPermissions(get().documentPermissions, {
          isChecked: true,
        })
      ) {
        throwFormFieldPermissionDenied({ isChecked: true });
      }

      const { saveCheckpoint } = get();
      saveCheckpoint();
      set((state) => ({
        fields: nextFields,
        selectedId: id,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          getFormFieldUpdateDirtyScopes(state.documentPermissions, {
            isChecked: true,
          }),
        ),
      }));
      return;
    }

    const resetUpdates: Partial<FormField> = (() => {
      switch (targetField.type) {
        case FieldType.TEXT:
        case FieldType.DROPDOWN:
          return { value: targetField.defaultValue ?? "" };
        case FieldType.CHECKBOX:
          return { isChecked: !!targetField.isDefaultChecked };
        case FieldType.BUTTON:
          return { buttonImage: undefined };
        case FieldType.SIGNATURE:
          return {};
        default:
          return {};
      }
    })();

    const changed = Object.entries(resetUpdates).some(([key, value]) => {
      const typedKey = key as keyof FormField;
      return targetField[typedKey] !== value;
    });

    if (!changed) return;
    if (
      !canUpdateFormFieldWithPdfPermissions(
        get().documentPermissions,
        resetUpdates,
      )
    ) {
      throwFormFieldPermissionDenied(resetUpdates);
    }

    const { saveCheckpoint, updateField } = get();
    saveCheckpoint();
    updateField(id, resetUpdates);
  },

  reorderControlLayer: (id, move) => {
    const state = get();
    const target =
      state.fields.find((field) => field.id === id) ||
      state.annotations.find((annotation) => annotation.id === id);
    if (!target) return;
    const isField = state.fields.some((field) => field.id === id);
    if (
      isField
        ? !canModifyPdfContents(state.documentPermissions)
        : !canModifyPdfAnnotations(state.documentPermissions)
    ) {
      throw new PdfPermissionDeniedError(
        isField ? "edit_form_structure" : "edit_annotation",
      );
    }

    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => {
      const target =
        state.fields.find((field) => field.id === id) ||
        state.annotations.find((annotation) => annotation.id === id);
      if (!target) return state;

      const reordered = reorderControlLayer({
        fields: state.fields,
        annotations: state.annotations,
        targetId: id,
        move,
      });

      if (!reordered.changed) return state;

      // Layer-only changes are written by reordering /Annots references during
      // export. Do not mark unchanged appearances (or their replies) for rebuild.
      return {
        fields: reordered.fields,
        annotations: reordered.annotations,
        selectedId: id,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          isField ? { modifyContents: true } : { modifyAnnotations: true },
        ),
      };
    });
  },

  updateAnnotation: (id, updates) => {
    assertPdfPermissionOperation("edit_annotation", get().documentPermissions);
    set((state) => {
      const current = state.annotations.find(
        (annotation) => annotation.id === id,
      );
      const nextAuthor = updates.author ?? state.options.userName;

      const shouldMarkEdited =
        !!current?.sourcePdfRef && current.isEdited !== true;
      const shouldResetFontOnFirstEdit =
        shouldMarkEdited &&
        !!current?.sourcePdfFontMissing &&
        updates.fontFamily === undefined;

      const updatesWithTime = {
        ...updates,
        author: nextAuthor,
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
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  addAnnotationReply: (annotationId, reply) => {
    assertPdfPermissionOperation("edit_annotation", get().documentPermissions);
    const hasTarget = get().annotations.some(
      (annotation) => annotation.id === annotationId,
    );
    if (!hasTarget) return;

    const { saveCheckpoint } = get();
    saveCheckpoint();

    const now = new Date().toISOString();
    set((state) => {
      const author = reply.author || state.options.userName;

      return {
        annotations: state.annotations.map((annotation) => {
          if (annotation.id !== annotationId) return annotation;

          const shouldMarkEdited =
            !!annotation.sourcePdfRef && annotation.isEdited !== true;
          const nextReply: AnnotationReply = {
            ...reply,
            parentAnnotationId: annotationId,
            author,
            updatedAt: now,
          };

          return prepareInkAnnotationForStore({
            ...annotation,
            replies: [...(annotation.replies ?? []), nextReply],
            updatedAt: now,
            ...(shouldMarkEdited ? { isEdited: true } : null),
          });
        }),
        selectedId: annotationId,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  updateAnnotationReply: (annotationId, replyId, updates) => {
    assertPdfPermissionOperation("edit_annotation", get().documentPermissions);
    const targetAnnotation = get().annotations.find(
      (annotation) => annotation.id === annotationId,
    );
    if (!targetAnnotation?.replies?.some((reply) => reply.id === replyId)) {
      return;
    }

    set((state) => {
      const now = new Date().toISOString();
      const nextAuthor = updates.author ?? state.options.userName;

      return {
        annotations: state.annotations.map((annotation) => {
          if (annotation.id !== annotationId) return annotation;

          const shouldMarkEdited =
            !!annotation.sourcePdfRef && annotation.isEdited !== true;

          return prepareInkAnnotationForStore({
            ...annotation,
            replies: (annotation.replies ?? []).map((reply) =>
              reply.id === replyId
                ? {
                    ...reply,
                    ...updates,
                    author: nextAuthor,
                    updatedAt: now,
                    ...(reply.sourcePdfRef && !reply.isEdited
                      ? { isEdited: true }
                      : null),
                  }
                : reply,
            ),
            updatedAt: now,
            ...(shouldMarkEdited ? { isEdited: true } : null),
          });
        }),
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  deleteAnnotationReply: (annotationId, replyId) => {
    assertPdfPermissionOperation("edit_annotation", get().documentPermissions);
    const targetAnnotation = get().annotations.find(
      (annotation) => annotation.id === annotationId,
    );
    if (!targetAnnotation?.replies?.some((reply) => reply.id === replyId)) {
      return;
    }

    const { saveCheckpoint } = get();
    saveCheckpoint();

    set((state) => {
      const now = new Date().toISOString();

      return {
        annotations: state.annotations.map((annotation) => {
          if (annotation.id !== annotationId) return annotation;

          const shouldMarkEdited =
            !!annotation.sourcePdfRef && annotation.isEdited !== true;

          return prepareInkAnnotationForStore({
            ...annotation,
            replies: (annotation.replies ?? [])
              .filter((reply) => reply.id !== replyId)
              .map((reply) =>
                reply.inReplyToReplyId === replyId
                  ? {
                      ...reply,
                      inReplyToReplyId: targetAnnotation.replies?.find(
                        (parent) => parent.id === replyId,
                      )?.inReplyToReplyId,
                    }
                  : reply,
              ),
            updatedAt: now,
            ...(shouldMarkEdited ? { isEdited: true } : null),
          });
        }),
        selectedId: annotationId,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },

  deleteAnnotation: (id) => {
    assertPdfPermissionOperation(
      "delete_annotation",
      get().documentPermissions,
    );
    const { saveCheckpoint } = get();
    saveCheckpoint();
    set((state) => ({
      annotations: state.annotations.filter(
        (annotation) => annotation.id !== id,
      ),
      selectedId: state.selectedId === id ? null : state.selectedId,
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        { modifyAnnotations: true },
      ),
    }));
  },

  deleteSelection: () => {
    const state = get();
    const ids = new Set(state.selectedControlIds);
    const fields = state.fields.filter((item) => ids.has(item.id));
    const annotations = state.annotations.filter((item) => ids.has(item.id));
    if (!fields.length && !annotations.length) return;
    if (
      fields.some(
        (field) =>
          field.type === FieldType.SIGNATURE && field.signature?.present,
      )
    )
      return;
    if (fields.length)
      assertPdfPermissionOperation(
        "edit_form_structure",
        state.documentPermissions,
      );
    if (annotations.length)
      assertPdfPermissionOperation(
        "delete_annotation",
        state.documentPermissions,
      );
    state.saveCheckpoint();
    set({
      fields: state.fields.filter((item) => !ids.has(item.id)),
      annotations: state.annotations.filter((item) => !ids.has(item.id)),
      selectedId: null,
      selectedControlIds: [],
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        {
          ...(fields.length ? { modifyContents: true } : {}),
          ...(annotations.length ? { modifyAnnotations: true } : {}),
        },
      ),
    });
  },

  selectControl: (id, intent = "replace") => {
    const state = get();
    if (!id) {
      set({ selectedId: null, selectedControlIds: [] });
      return;
    }
    const field = state.fields.find((item) => item.id === id);
    const control = field ?? state.annotations.find((item) => item.id === id);
    if (!control) return;
    if (intent === "preserve" && state.selectedControlIds.includes(id)) return;
    const primary = [...state.fields, ...state.annotations].find(
      (item) => item.id === state.selectedId,
    );
    const sameScope =
      primary?.pageIndex === control.pageIndex &&
      state.fields.some((item) => item.id === primary?.id) === !!field;
    const canToggle =
      intent === "toggle" &&
      sameScope &&
      (field ? state.mode === "form" : state.mode === "annotation");
    const ids = canToggle
      ? state.selectedControlIds.includes(id)
        ? state.selectedControlIds.filter((item) => item !== id)
        : [...state.selectedControlIds, id]
      : [id];
    set({
      selectedControlIds: ids,
      selectedId: ids.includes(id) ? id : (ids.at(-1) ?? null),
    });
  },

  setTool: (tool) =>
    set((state) => {
      if (
        state.documentLoadState !== undefined &&
        state.documentLoadState !== "ready" &&
        tool !== "pan" &&
        tool !== "select_text"
      ) {
        return { tool: "select_text", selectedId: null };
      }
      if (
        !canUseToolWithPdfPermissions(
          tool,
          state.mode,
          state.documentPermissions,
        )
      ) {
        return {
          tool: "select",
          selectedId: state.selectedId,
        };
      }

      if (tool === "draw_highlight") {
        return {
          tool,
          selectedId: null,
          highlightStyle: {
            color:
              state.highlightStyle?.color || ANNOTATION_STYLES.highlight.color,
            thickness:
              state.highlightStyle?.thickness ??
              ANNOTATION_STYLES.highlight.thickness,
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
    }),

  closeDialog: () =>
    set({
      activeDialog: null,
    }),

  setKeys: (keys) => set((state) => ({ keys: { ...state.keys, ...keys } })),

  moveSelectedControl: (direction, isFast, checkpoint = true) => {
    const { dx, dy } = getMoveDelta(direction, isFast);
    get().translateSelectedControls(dx, dy, checkpoint);
  },

  translateSelectedControls: (dx, dy, checkpoint = false) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
    const state = get();
    const ids = new Set(state.selectedControlIds);
    const fields = state.fields.filter((item) => ids.has(item.id));
    const annotations = state.annotations.filter((item) => ids.has(item.id));
    if (!fields.length && !annotations.length) return;
    if (
      fields.some(
        (field) =>
          field.type === FieldType.SIGNATURE && field.signature?.present,
      )
    )
      return;
    if (fields.length)
      assertPdfPermissionOperation(
        "edit_form_structure",
        state.documentPermissions,
      );
    if (annotations.length)
      assertPdfPermissionOperation(
        "edit_annotation",
        state.documentPermissions,
      );
    if (checkpoint) state.saveCheckpoint();
    const updatedAt = new Date().toISOString();
    set({
      fields: fields.length
        ? state.fields.map((field) =>
            ids.has(field.id)
              ? { ...field, ...getMovedFieldUpdates(field, dx, dy) }
              : field,
          )
        : state.fields,
      annotations: annotations.length
        ? state.annotations.map((annotation) => {
            if (!ids.has(annotation.id)) return annotation;
            const next = {
              ...annotation,
              ...getMovedAnnotationUpdates(annotation, dx, dy),
              updatedAt,
              ...(annotation.sourcePdfRef ? { isEdited: true } : {}),
            };
            return annotation.type === "ink"
              ? prepareInkAnnotationForStore(next, {
                  recomputeRect: true,
                  recomputeSvgPath: true,
                })
              : next;
          })
        : state.annotations,
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        {
          ...(fields.length ? { modifyContents: true } : {}),
          ...(annotations.length ? { modifyAnnotations: true } : {}),
        },
      ),
    });
  },

  setAllFreetextFlatten: (flatten) => {
    assertPdfPermissionOperation("edit_annotation", get().documentPermissions);
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
      return {
        annotations: nextAnnotations,
        isDirty: true,
        dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
          state.dirtyPermissionScopes,
          { modifyAnnotations: true },
        ),
      };
    });
  },
});
