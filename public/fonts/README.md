# Fonts

This folder contains font files that can be used by Formforge for:

- in-app preview (browser rendering)
- PDF export (embedding fonts so CJK renders correctly)

## Add a new font

### 1) Put the font file here

Add your font file to `public/fonts/`.

Recommended formats:

- `.ttf`
- `.otf`

### 2) Register it for in-app preview

Edit `src/font-faces.css` and add a new `@font-face` entry pointing to the file in this folder.

Example:

```css
@font-face {
  font-family: "My Font";
  src: url("/fonts/MyFont-Regular.ttf") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
```

### 3) Add it to the font dropdown

Edit `src/constants.ts` and add an entry to `FONT_FAMILY_MAP`:

```ts
export const FONT_FAMILY_MAP = {
  // ...
  "My Font": '"My Font", sans-serif',
};
```

### 4) Make it available for PDF export embedding

PDF export embedding is configured in `src/services/pdf/lib/built-in-fonts.ts`.

- Add a new entry to `BUILT_IN_EXPORT_FONTS`
- Ensure the `path` matches your filename in this folder

### 5) Update licensing / attribution

Edit `public/fonts/NOTICE.txt` and add an entry for your font (copyright + license).

If you redistribute this application, you must comply with each font's license.
