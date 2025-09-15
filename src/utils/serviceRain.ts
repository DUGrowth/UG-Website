export type MatrixRegion = { startCol: number; endCol: number };

export type ServiceLayoutStep = { lines: string[]; baseRow: number };

export type MatrixLetter = {
  char: string;
  x: number;
  y: number;
  ty: number;
  locked: boolean;
  [key: string]: any;
};

export type MatrixMetaLine = { text: string; startCol: number; row: number };

export type PlaceWordIntoGridOptions = {
  lines?: string[];
  baseRow?: number;
};

export type PlaceWordIntoGridResult = {
  text: string;
  letters: MatrixLetter[];
  meta: { lines: MatrixMetaLine[] };
};

export function colorMatrix(alpha: number) {
  return `rgba(0,255,65,${alpha})`;
}

export function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function clamp01(v: number) {
  return clamp(v, 0, 1);
}

export function computeRegion(cols: number, startFrac: number, endFrac: number): MatrixRegion {
  return { startCol: Math.floor(cols * startFrac), endCol: Math.floor(cols * endFrac) };
}

export function planServiceLayout(
  services: string[],
  cols: number,
  rows: number,
  region: MatrixRegion,
  margin = 1
): ServiceLayoutStep[] {
  const top = 2;
  const bottom = Math.max(3, rows - 3);
  const available = Math.max(0, bottom - top + 1);
  const regionCols = Math.max(1, region.endCol - region.startCol + 1);
  const maxLineLen = Math.max(1, regionCols - margin * 2);

  const lineData = services.map((s) => splitIntoTwoLines(String(s), maxLineLen).lines.slice(0, 2));
  const blockHeights = lineData.map((arr) => (arr.length === 2 ? 2 : 1));
  const sumBlocks = blockHeights.reduce((a, b) => a + b, 0);
  const gaps = Math.max(0, services.length - 1);
  const leftover = Math.max(0, available - sumBlocks);
  const gapRows = gaps > 0 ? Math.floor(leftover / gaps) : 0;
  let extra = gaps > 0 ? leftover % gaps : 0;

  const plan: ServiceLayoutStep[] = [];
  let cursor = top;
  for (let i = 0; i < services.length; i++) {
    plan.push({ lines: lineData[i], baseRow: cursor });
    if (i < services.length - 1) {
      const advance = blockHeights[i] + gapRows + (extra > 0 ? 1 : 0);
      cursor += advance;
      if (extra > 0) extra--;
    }
  }

  const lastIdx = services.length - 1;
  const lastHeight = blockHeights[lastIdx] || 1;
  const overflow = plan[lastIdx].baseRow + lastHeight - 1 - bottom;
  if (overflow > 0) {
    for (const p of plan) {
      p.baseRow = Math.max(top, p.baseRow - overflow);
    }
  }

  return plan;
}

export function canFitInRegion(
  textLen: number,
  startCol: number,
  row: number,
  blocked: Set<string>,
  region: MatrixRegion,
  margin: number,
  cols: number
) {
  if (startCol < region.startCol + margin) return false;
  if (startCol + textLen - 1 > region.endCol - margin) return false;
  if (startCol < 0 || startCol + textLen - 1 >= cols) return false;
  for (let i = 0; i < textLen; i++) {
    const key = `${startCol + i},${row}`;
    if (blocked.has(key)) return false;
  }
  return true;
}

export function splitIntoTwoLines(text: string, maxLen: number): { lines: string[]; wrapped: boolean } {
  if (text.length <= maxLen) return { lines: [text], wrapped: false };
  let breakAt = -1;
  for (let i = Math.min(maxLen, text.length - 1); i >= 1; i--) {
    const ch = text[i];
    if (ch === " " || ch === "-") {
      breakAt = i;
      break;
    }
  }
  if (breakAt === -1) breakAt = maxLen;
  const first = text.slice(0, breakAt).trimEnd();
  const rest = text.slice(breakAt).replace(/^\s+/, "");
  return { lines: [first, rest], wrapped: true };
}

export function wrapTextToLines(text: string, maxCols: number, maxLines = 6): string[] {
  const words = String(text)
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const join = current.length ? current + " " + w : w;
    if (join.length <= maxCols) {
      current = join;
    } else {
      if (current.length) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current.length && lines.length < maxLines) lines.push(current);
  return lines;
}

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function placeWordIntoGrid(
  text: string,
  cols: number,
  rows: number,
  blocked: Set<string>,
  fontSize: number,
  idx: number,
  total: number,
  region: MatrixRegion,
  opts: PlaceWordIntoGridOptions = {}
): PlaceWordIntoGridResult | null {
  if (!text || !cols || !rows) return null;
  const clean = String(text);

  const margin = 1;
  const regionCols = Math.max(1, region.endCol - region.startCol + 1);
  const maxLineLen = Math.max(1, regionCols - margin * 2);

  const providedLines = opts.lines && opts.lines.length ? opts.lines.slice(0, 2) : null;
  const { lines: initialLines } = providedLines ? { lines: providedLines } : splitIntoTwoLines(clean, maxLineLen);
  const lines = initialLines.slice(0, 2);

  const LINE_GAP_ROWS = 1;
  const top = 2;
  const bottom = Math.max(3, rows - 3);
  const bands = Math.max(1, total);
  let baseRow: number;
  if (typeof opts.baseRow === "number") {
    baseRow = clampInt(opts.baseRow, top, bottom);
  } else if (bands === 1) {
    baseRow = Math.floor((top + bottom) / 2);
  } else {
    const span = bottom - top;
    baseRow = top + Math.round((idx * span) / (bands - 1));
    baseRow = clampInt(baseRow, top, bottom);
  }
  if (lines.length === 2 && baseRow + 1 > bottom) baseRow = Math.max(2, bottom - 1);

  const starts: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const len = L.length;
    const idealStart = region.startCol + Math.floor((regionCols - len) / 2);
    const minStart = region.startCol + margin;
    const maxStart = region.endCol - margin - len + 1;
    let startCol = clampInt(idealStart, minStart, Math.min(maxStart, cols - len));

    const row = baseRow + (li === 0 ? 0 : LINE_GAP_ROWS);
    const fits = canFitInRegion(len, startCol, row, blocked, region, margin, cols);
    if (!fits) {
      let placed = false;
      const sweepMax = Math.max(regionCols, 40);
      for (let off = 1; off <= sweepMax; off++) {
        const left = startCol - off;
        const right = startCol + off;
        if (
          left >= minStart &&
          left <= maxStart &&
          canFitInRegion(len, left, row, blocked, region, margin, cols)
        ) {
          startCol = left;
          placed = true;
          break;
        }
        if (
          right >= minStart &&
          right <= maxStart &&
          canFitInRegion(len, right, row, blocked, region, margin, cols)
        ) {
          startCol = right;
          placed = true;
          break;
        }
      }
      if (!placed) {
        let solved = false;
        for (let vOff = 1; vOff < rows; vOff++) {
          const candidates = [baseRow - vOff, baseRow + vOff];
          for (const cand of candidates) {
            if (lines.length === 2 && (cand < top || cand + 1 > bottom)) continue;
            const rowCand = cand + (li === 0 ? 0 : LINE_GAP_ROWS);
            if (canFitInRegion(len, startCol, rowCand, blocked, region, margin, cols)) {
              baseRow = cand;
              solved = true;
              break;
            }
          }
          if (solved) break;
        }
        if (!solved) return null;
      }
    }
    starts[li] = startCol;
  }

  const letters: MatrixLetter[] = [];
  const metaLines: MatrixMetaLine[] = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const startCol = starts[li];
    const row = baseRow + (li === 0 ? 0 : LINE_GAP_ROWS);
    metaLines.push({ text: L, startCol, row });
    for (let i = 0; i < L.length; i++) {
      const col = startCol + i;
      const x = col * fontSize;
      const y = row * fontSize;
      if (L[i] !== " ") {
        letters.push({ char: L[i], x, y, ty: -100 - Math.random() * 300, locked: false });
      }
      blocked.add(`${col},${row}`);
    }
  }

  return { text: clean, letters, meta: { lines: metaLines } };
}
