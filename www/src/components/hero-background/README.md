# Hero tidal background

The decorative ASCII / 5×7 dot-matrix fluid field is adapted from the user-supplied `/tmp/code-mcp-demo` project (revision `bbbbe50e3de3ab587366c3d7fb35c1b3912c6d60`). `field/engine.js`, `field/glyph-matrix.js` and `field/themes.js` retain its renderer and glyph atlas. No temporary-directory imports, compiled demo bundles, Web Component registration, extra dependencies or external requests are used by the site.

## Integration

`HeroTidalBackground` is mounted only in the landing page's hero. Its canvas is decorative, hidden from assistive technology and cannot receive pointer events. The app preview and the application's global theme tokens remain unchanged. A CSS texture is the no-Canvas / failed-import / data-saving fallback.

The renderer is loaded in a separate chunk, after the hero becomes visible and the browser has idle time. `runtime.ts` owns resizing, theme synchronization and animation lifecycle. It uses the original low quality grid (at most 96 × 60 cells), 20 Hz simulation scheduling, 24 Hz rendering and a capped device-pixel ratio. `config.ts` slows physical time to 20% while retaining that frame cadence, lowers dye decay from 0.13 to 0.045, and retains a small continuous wave source (0.06). This slows advection as well as dissipation: merely lowering decay still dissolved the initial glyph shapes in seconds. The clouds now soften into a continuing texture rather than disappearing or restarting on a timer. Initialization still primes a complete first frame. A deterministic seed, a broad quiet zone behind the heading and edge fades make it a restrained editorial background rather than a second interactive demo.

Light mode uses neutral ink with a muted red crest; dark mode uses graphite and soft red. The canvas background is read from the site's actual `--site-bg` token. Root theme changes update the palette in place without resetting the fluid field.

The backdrop has no pause/resume button, manual pause state, or focusable controls. `prefers-reduced-motion` still renders a still frame. Data-saving mode does not download the renderer. Offscreen and hidden-tab states stop scheduling animation; returning resumes the same field without resetting it or catching up elapsed wall time. Cleanup cancels idle work, observers, events and animation frames, including a late import after React unmounts.

## Verification

`bun run test tests/www` covers the adapter's scheduling, theme and reduced-motion behavior, plus the real fluid solver's time scale and retained glyph structure over two simulated minutes. Browser checks must sample the actual canvas after 5, 30 and 60 seconds, not just verify that an animation frame is scheduled. Also cover both themes, narrow screens, scrolling beyond the hero, background-module failure and the absence of new workers/provider requests. Check that the heading, links, native scrolling and the source-backed PDF preview remain unaffected, and that the decorative layer contains no controls.
