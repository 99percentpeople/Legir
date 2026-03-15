import { medianNumber, pickMostCommonString, unionRect } from "@/store/helpers";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// Page-translate candidates form a transient editing workspace. Keeping these
// reducers isolated makes the main editor flow easier to follow.
export const createPageTranslateSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "setPageTranslateParagraphCandidates"
    | "clearPageTranslateParagraphCandidates"
    | "removePageTranslateParagraphCandidatesByPageIndex"
    | "setSelectedPageTranslateParagraphIds"
    | "selectPageTranslateParagraphId"
    | "toggleExcludeSelectedPageTranslateParagraphs"
    | "deleteSelectedPageTranslateParagraphs"
    | "mergeSelectedPageTranslateParagraphs"
  >
> = (set) => ({
  setPageTranslateParagraphCandidates: (candidates) =>
    set({
      pageTranslateParagraphCandidates: candidates,
      pageTranslateSelectedParagraphIds: [],
    }),

  clearPageTranslateParagraphCandidates: () =>
    set({
      pageTranslateParagraphCandidates: [],
      pageTranslateSelectedParagraphIds: [],
    }),

  removePageTranslateParagraphCandidatesByPageIndex: (pageIndex) =>
    set((state) => {
      const removedIds = new Set(
        state.pageTranslateParagraphCandidates
          .filter((candidate) => candidate.pageIndex === pageIndex)
          .map((candidate) => candidate.id),
      );
      if (removedIds.size === 0) return state;
      return {
        ...state,
        pageTranslateParagraphCandidates:
          state.pageTranslateParagraphCandidates.filter(
            (candidate) => candidate.pageIndex !== pageIndex,
          ),
        pageTranslateSelectedParagraphIds:
          state.pageTranslateSelectedParagraphIds.filter(
            (id) => !removedIds.has(id),
          ),
      };
    }),

  setSelectedPageTranslateParagraphIds: (ids) =>
    set({ pageTranslateSelectedParagraphIds: ids }),

  selectPageTranslateParagraphId: (id, opts) =>
    set((state) => {
      const additive = Boolean(opts?.additive);
      if (!additive) {
        return { pageTranslateSelectedParagraphIds: [id] };
      }
      const existing = new Set(state.pageTranslateSelectedParagraphIds);
      if (existing.has(id)) existing.delete(id);
      else existing.add(id);
      return { pageTranslateSelectedParagraphIds: Array.from(existing) };
    }),

  toggleExcludeSelectedPageTranslateParagraphs: () =>
    set((state) => {
      const selected = new Set(state.pageTranslateSelectedParagraphIds);
      if (selected.size === 0) return state;
      const nextCandidates = state.pageTranslateParagraphCandidates.map(
        (candidate) => {
          if (!selected.has(candidate.id)) return candidate;
          return { ...candidate, isExcluded: !candidate.isExcluded };
        },
      );
      return { ...state, pageTranslateParagraphCandidates: nextCandidates };
    }),

  deleteSelectedPageTranslateParagraphs: () =>
    set((state) => {
      const selected = new Set(state.pageTranslateSelectedParagraphIds);
      if (selected.size === 0) return state;
      const nextCandidates = state.pageTranslateParagraphCandidates.filter(
        (candidate) => !selected.has(candidate.id),
      );
      return {
        ...state,
        pageTranslateParagraphCandidates: nextCandidates,
        pageTranslateSelectedParagraphIds: [],
      };
    }),

  mergeSelectedPageTranslateParagraphs: () =>
    set((state) => {
      const selectedIds = state.pageTranslateSelectedParagraphIds;
      if (selectedIds.length < 2) return state;
      const selected = state.pageTranslateParagraphCandidates.filter(
        (candidate) => selectedIds.includes(candidate.id),
      );
      if (selected.length < 2) return state;

      const pageIndex = selected[0]!.pageIndex;
      if (selected.some((candidate) => candidate.pageIndex !== pageIndex)) {
        return state;
      }

      const normalizeRotationDeg = (deg: number) => {
        if (!Number.isFinite(deg)) return 0;
        let normalized = deg % 360;
        if (normalized <= -180) normalized += 360;
        if (normalized > 180) normalized -= 360;
        return normalized;
      };

      const deltaRotationDeg = (left: number, right: number) =>
        normalizeRotationDeg(left - right);

      const rotations = selected
        .map((candidate) => candidate.rotationDeg)
        .filter(
          (rotation): rotation is number =>
            typeof rotation === "number" && Number.isFinite(rotation),
        );

      if (rotations.length === selected.length) {
        const baseRotation = rotations[0] ?? 0;
        const incompatible = rotations.some(
          (rotation) => Math.abs(deltaRotationDeg(rotation, baseRotation)) > 1,
        );
        if (incompatible) return state;
      }

      const mergedId = `page_translate_para_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const rect = unionRect(selected.map((candidate) => candidate.rect));
      const fontSize =
        medianNumber(
          selected.map((candidate) => candidate.fontSize).filter((n) => n > 0),
        ) ||
        selected[0]!.fontSize ||
        12;
      const fontFamily =
        pickMostCommonString(
          selected.map((candidate) => candidate.fontFamily),
        ) ||
        selected[0]!.fontFamily ||
        "sans-serif";
      const sourceText = selected
        .slice()
        .sort((left, right) => {
          const dy = left.rect.y - right.rect.y;
          if (Math.abs(dy) > 0.001) return dy;
          return left.rect.x - right.rect.x;
        })
        .map((candidate) => candidate.sourceText)
        .join("\n")
        .trim();

      const rotationDeg =
        rotations.length > 0
          ? normalizeRotationDeg(medianNumber(rotations))
          : undefined;

      const mergedCandidate = {
        id: mergedId,
        pageIndex,
        rect,
        sourceText,
        fontSize,
        fontFamily,
        rotationDeg,
        isExcluded: false,
      };

      const selectedSet = new Set(selectedIds);
      const remainingCandidates = state.pageTranslateParagraphCandidates.filter(
        (candidate) => !selectedSet.has(candidate.id),
      );

      return {
        ...state,
        pageTranslateParagraphCandidates: [
          ...remainingCandidates,
          mergedCandidate,
        ].sort((left, right) => {
          if (left.pageIndex !== right.pageIndex) {
            return left.pageIndex - right.pageIndex;
          }
          const dy = left.rect.y - right.rect.y;
          if (Math.abs(dy) > 0.001) return dy;
          return left.rect.x - right.rect.x;
        }),
        pageTranslateSelectedParagraphIds: [mergedId],
      };
    }),
});
