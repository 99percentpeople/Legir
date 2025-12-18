# Technology Stack

## Project Type

Web Application (Single Page Application)

## Core Technologies

### Primary Language(s)

- **Language**: TypeScript
- **Runtime**: Node.js (Development), Browser (Production)

### Key Dependencies/Libraries

- **UI Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4, Radix UI (Headless UI components)
- **PDF Processing**: pdf-lib (Creation/Modification), pdfjs-dist (Rendering)
- **AI Integration**: @google/genai (Gemini API)
- **Icons**: Lucide React
- **Internationalization**: i18n support (custom implementation in `src/locales`)

### Application Architecture

- **Client-Side Rendering (CSR)**: Fully client-side React application.
- **Component-Based**: Modular UI using React components and hooks.
- **Web Workers**: Uses `pdf-render.worker.ts` for off-main-thread PDF rendering to ensure UI responsiveness.

## Development Environment

### Build & Development Tools

- **Package Manager**: Bun
- **Linter/Formatter**: Prettier
- **Git Hooks**: Husky (pre-commit)

### Code Quality Tools

- **TypeScript**: Strict type checking.
- **Prettier**: Automatic code formatting.

## Technical Decisions & Rationale

1. **pdf-lib & pdfjs-dist**: `pdfjs-dist` is the standard for rendering PDFs in the browser, while `pdf-lib` provides powerful modification capabilities (filling forms, adding annotations) completely client-side.
2. **Web Workers**: PDF rendering can be computationally expensive; offloading this to a worker prevents the main UI thread from freezing.
3. **Tailwind CSS & Radix UI**: Provides a modern, accessible, and highly customizable UI foundation without the bloat of heavy component libraries.
4. **Local-First AI**: The AI features (Gemini) are integrated directly via the client SDK, reducing the need for a complex backend proxy for this prototype phase.
