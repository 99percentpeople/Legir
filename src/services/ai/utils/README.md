# `src/services/ai/utils`

Shared AI helper modules.

Put code here when it is:

- Stateless or low-state helper logic reused across AI chat, SDK tasks, or model setup
- Support code such as parsing, normalization, formatting, or serialization helpers
- Not itself a runtime service, tool module, provider, or task entrypoint

Do not put code here when it is:

- AI chat runtime wiring or tool registration
- Provider/model catalog definitions
- A concrete SDK task implementation
- A stable cross-module contract; those belong in a nearby `types.ts`
