// Opt-in instrumentation for diagnostic builds only. Inclusive method timings
// overlap; use native call counts and stage timings to locate work, then measure
// improvements with an ordinary, uninstrumented build.
const instrument = String.raw`
function profileMethods(type, names, native = false) {
  for (const name of names) {
    const original = type.prototype[name];
    if (!original) continue;
    let depth = 0;
    type.prototype[name] = function (...args) {
      if (depth) return original.apply(this, args);
      depth++;
      const key = native ? args[0] : type.name + "." + name;
      const start = performance.now();
      const finish = () => {
        depth--;
        const all = globalThis.__pdfProfile ??= {};
        const item = all[key] ??= { calls: 0, ms: 0 };
        item.calls++;
        item.ms += performance.now() - start;
      };
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === "function") return result.finally(finish);
        finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };
  }
}
`;

export function profilePlugin() {
  return {
    name: "pdf-benchmark-profile",
    transform(code, id) {
      let hooks = "";
      if (/packages\/pdfium\/(?:dist\/runtime\.js|src\/runtime\.ts)$/.test(id))
        hooks =
          'profileMethods(Runtime, ["call"], true); profileMethods(Runtime, ["copyBytes"]);';
      if (
        /packages\/pdfium\/(?:dist\/document\.js|src\/document\.ts)$/.test(id)
      )
        hooks =
          'profileMethods(PDFDocument, ["saveToBuffer", "startSave", "insertPage", "rewritePages"]); if (typeof PDFSaveTask !== "undefined") profileMethods(PDFSaveTask, ["nextBlob"]); profileMethods(PDFGraftMap, ["graftObject"]);';
      if (id.endsWith("/engine/documentSession.ts"))
        hooks =
          'profileMethods(DocumentSession, ["addSource", "export", "transaction"]);';
      if (
        /packages\/pdfium\/(?:dist\/authoring\/nativeContext\.js|src\/authoring\/nativeContext\.ts)$/.test(
          id,
        )
      )
        hooks = 'profileMethods(NativeEditingContext, ["flush"]);';
      return hooks ? { code: code + instrument + hooks, map: null } : null;
    },
  };
}
