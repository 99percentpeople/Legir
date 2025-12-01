

export const DEFAULT_SCALE = 1.0;
export const MIN_FIELD_SIZE = 10;
export const PAGE_PADDING = 24; // px

export const COLORS = {
  primary: 'blue-600',
  fieldBorder: '#3b82f6',
  fieldBg: 'rgba(59, 130, 246, 0.15)',
  fieldSelectedBorder: '#2563eb',
  fieldSelectedBg: 'rgba(37, 99, 235, 0.3)',
};

export const DEFAULT_FIELD_STYLE = {
  borderColor: '#000000',
  backgroundColor: '#e6f2ff', // Light blue-ish hint by default
  borderWidth: 1,
  textColor: '#000000',
  fontSize: 12,
  fontFamily: 'Helvetica',
  isTransparent: false,
};

export const ANNOTATION_STYLES = {
  highlight: {
    color: '#ffeb3b', // Yellow
    opacity: 0.4
  },
  ink: {
    color: '#ef4444', // Red
    thickness: 2,
    opacity: 1.0
  },
  note: {
    color: '#000000',
    fontSize: 12,
    backgroundColor: 'transparent'
  }
};

export const FONT_FAMILY_MAP: Record<string, string> = {
  'Helvetica': 'Helvetica, Arial, sans-serif',
  'Times Roman': '"Times New Roman", Times, serif',
  'Courier': '"Courier New", Courier, monospace',
};