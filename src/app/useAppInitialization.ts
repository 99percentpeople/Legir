import { useEffect } from "react";
import {
  preferencesStore,
  setPreferenceOptions,
} from "@/store/preferencesStore";
import { getPlatformUserName } from "@/services/platform";

export function useAppInitialization() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const CANCELLED = Symbol("cancelled");
      const throwIfCancelled = () => {
        if (cancelled) throw CANCELLED;
      };

      void import("@/services/ai/modelCache")
        .then(({ loadModels }) => loadModels())
        .catch((error) => {
          console.warn("Failed to initialize AI models", error);
        });

      try {
        const snapshot = preferencesStore.getState();
        const existing = snapshot.options?.userName;
        if (!existing) {
          const name = await getPlatformUserName();
          throwIfCancelled();
          const current = preferencesStore.getState().options?.userName;
          if (!current && typeof name === "string" && name.trim().length > 0) {
            setPreferenceOptions({ userName: name.trim() });
          }
        }
      } catch (e) {
        if (e !== CANCELLED) {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
