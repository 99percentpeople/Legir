# `src/components/workspace/lib`

Workspace-local rendering and interaction helpers.

Put code here when it is:

- Used by workspace layers, widgets, or interaction components
- Closely tied to viewport layout, DOM rendering, canvas/text layer behavior, or workspace hit-testing
- Not useful outside the editor workspace UI

Do not put code here when it is:

- A generic app helper
- A PDF pipeline primitive that should be shared by services and UI
- Editor-wide domain data contracts
- Pure value utilities with no workspace context

Rule of thumb:

- If the code assumes a rendered workspace, viewport rectangles, or DOM/canvas behavior, this is the right home.
