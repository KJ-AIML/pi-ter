/** Single restrained palette: neutral greys plus one soft accent. */
export const THEME = {
  text: '#e6e6e8',    // primary text
  muted: '#8b8b94',   // secondary text / labels
  faint: '#5c5c66',   // separators, hints
  accent: '#b8a8f0',  // the only accent (soft lavender)
  warn: '#d9a066',    // ON FIRE (muted amber)
  danger: '#d9737a',  // YOLO (muted red)
} as const;

export const rgb = (hex: string, text: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}\x1b[39m`;
};
export const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
export const text = (s: string) => rgb(THEME.text, s);
export const muted = (s: string) => rgb(THEME.muted, s);
export const faint = (s: string) => rgb(THEME.faint, s);
export const accent = (s: string) => rgb(THEME.accent, s);
