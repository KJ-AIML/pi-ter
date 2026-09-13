import { art, artWidth, artHeight } from './wordmark-data.ts';

const dots = [[0,0,1],[0,1,2],[0,2,4],[1,0,8],[1,1,16],[1,2,32],[0,3,64],[1,3,128]];
const bayer = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

/** Shade a baked, bevelled PITER sculpture onto actual terminal dot cells. */
export function wordmark(columns: number, accent: string): string[] {
  const width = Math.max(1, Math.floor(columns));
  const rows = Math.max(1, Math.round(width * artHeight / artWidth / 2));
  const rgb = [1,3,5].map(i => parseInt(accent.slice(i, i + 2), 16));
  const lines: string[] = [];
  const scale = artWidth / (width * 2);
  const sample = (x: number, y: number) => {
    const sx = Math.min(artWidth - 1, Math.floor((x + .5) * scale));
    const sy = Math.min(artHeight - 1, Math.floor((y + .5) * artHeight / (rows * 4)));
    return art[sy * artWidth + sx];
  };
  for (let cy = 0; cy < rows; cy++) {
    let line = '';
    for (let cx = 0; cx < width; cx++) {
      let bits = 0, total = 0, count = 0;
      for (const [dx,dy,bit] of dots) {
        const x = cx * 2 + dx, y = cy * 4 + dy;
        const v = sample(x,y);
        // Dense front faces, lighter textured sides; keep silhouette holes black.
        if (v > 0 && v / 255 > .10 + bayer[(y % 4) * 4 + x % 4] / 16 * .56) {
          bits |= bit; total += v; count++;
        }
      }
      if (!bits) { line += ' '; continue; }
      const light = total / count / 255;
      const color = rgb.map(c => Math.round(light > .72 ? c + (255-c) * (light-.72)/.28 : c * (.3+light*.95)));
      line += `\x1b[38;2;${color.join(';')}m${String.fromCharCode(0x2800 + bits)}\x1b[0m`;
    }
    lines.push(line);
  }
  return lines;
}
