# Project Structure

## Directory Organization

```text
formforge/
├── .husky/                 # Git hooks
├── .spec-workflow/         # Steering and Spec workflow documents
├── src/
│   ├── components/         # React components
│   │   ├── properties-panel/ # Controls for editing element properties
│   │   ├── sidebar/        # Sidebar panels (Outline, Thumbnails, etc.)
│   │   ├── toolbar/        # Main application toolbar
│   │   ├── ui/             # Reusable UI components (Radix + Tailwind)
│   │   └── workspace/      # Main PDF editing workspace and canvas
│   ├── hooks/              # Custom React hooks (logic reuse)
│   ├── lib/                # Core libraries and helpers
│   ├── locales/            # Translation files
│   ├── services/           # Service layer (API, Storage, PDF logic)
│   ├── utils/              # General utility functions
│   ├── workers/            # Web Workers (PDF rendering)
│   ├── App.tsx             # Root component
│   └── main.tsx            # Entry point
├── public/                 # Static assets
└── package.json            # Dependencies and scripts
```

## Naming Conventions

### Files

- **Components**: `PascalCase.tsx` (e.g., `PDFPage.tsx`)
- **Hooks**: `camelCase.ts` (prefix with `use`, e.g., `useMouse.ts`)
- **Utilities/Services**: `camelCase.ts` (e.g., `pdfService.ts`)

### Code

- **Components**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Types/Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

## Code Organization Principles

1. **Colocation**: Related styles and logic should be kept close to the component.
2. **Service Layer**: Complex logic (especially interacting with external libraries like PDF.js or Gemini) should be encapsulated in `services/`.
3. **UI/Logic Separation**: Use Custom Hooks to separate component logic from rendering views.
