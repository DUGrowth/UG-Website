import React, { useEffect, useRef, useState } from "react";

import {
  clamp,
  clampInt,
  colorMatrix,
  computeRegion,
  drawRoundedRect,
  planServiceLayout,
  placeWordIntoGrid,
  wrapTextToLines,
  type PlaceWordIntoGridResult,
  type ServiceLayoutStep,
} from "../src/utils/serviceRain";

// ===== Component (Stage 3: focus mode + detail rain + spotlight + CTAs) ===== //
export default function MatrixServiceRain({
  // responsive font controls
  baseFontSize = 24,
  minFontSize = 16,
  maxFontSize = 36,
  fontScaleDivisor = 40,
  density = 1,
  chars = "01ABCDEFGHIKLMNOPQRSTUVWXYZ",
  trailAlpha = 0.08,
  services = [
    "Social Media",
    "Website",
    "Email",
    "Automation",
    "AI Implementation",
    "Prospecting & Pipeline",
  ],
  cadenceMs = 900,
  regionStartFrac = 0.58,
  regionEndFrac = 0.96,
  allowClickFocus = true,
  // Detail copy
  serviceDetails = {
    "Social Media": "You’re a challenger, not a content farm. Lean engine that wins attention and turns it into qualified conversations.",
    "Website": "Conversion-first sites that clarify your offer, signal credibility, and turn traffic into pipeline.",
    "Email": "Clean lists, sharp copy, and lifecycle flows that nurture buyers and drive revenue without noise.",
    "Automation": "Connect your tools, kill manual handoffs, and ship reliable automations that increase speed and reduce cost.",
    "AI Implementation": "Use AI as a force multiplier. Practical copilots, prompts, and guardrails that cut cycle times and raise quality.",
    "Prospecting & Pipeline": "Targeted outbound that finds right-fit accounts, opens doors on LinkedIn/email, and creates a repeatable path to meetings.",
  } as Record<string, string>,
  // Spotlight CTAs under the detail
  ctaFaqHref = "#faq",
  ctaServicesHref = "#services",
  ctaEnquireHref = "#enquire",
}: {
  baseFontSize?: number;
  minFontSize?: number;
  maxFontSize?: number;
  fontScaleDivisor?: number;
  density?: number;
  chars?: string;
  trailAlpha?: number;
  services?: string[];
  cadenceMs?: number;
  regionStartFrac?: number;
  regionEndFrac?: number;
  allowClickFocus?: boolean;
  serviceDetails?: Record<string, string>;
  ctaFaqHref?: string;
  ctaServicesHref?: string;
  ctaEnquireHref?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);      // background canvas
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);    // foreground canvas (focused header + detail + CTAs)

  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fgCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wRef = useRef(0);
  const hRef = useRef(0);
  const colsRef = useRef(0);
  const rowsRef = useRef(0);
  const dropsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const measuredRef = useRef(false);
  const fsRef = useRef(baseFontSize);

  const placedRef = useRef<PlaceWordIntoGridResult[]>([]);
  const blockedRef = useRef<Set<string>>(new Set());
  const placeTimerRef = useRef<any>(null);
  const planRef = useRef<ServiceLayoutStep[] | null>(null);

  // focus/interaction
  const selectedIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const detailLettersRef = useRef<any[]>([]);
  const ctaRectsRef = useRef<Array<{ label: string; href: string; x: number; y: number; w: number; h: number }>>([]);
  const ctaHoverIndexRef = useRef<number | null>(null);
  const copyShownRef = useRef(false);

  // UI state
  const [paintedOnce, setPaintedOnce] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [spotlight, setSpotlight] = useState({ cx: null as number | null, cy: null as number | null, rx: 520, ry: 220, base: 0.6, edge: 0.88 });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    if (!container || !canvas || !fgCanvas) return;

    const ctx = canvas.getContext("2d");
    const fg = fgCanvas.getContext("2d");
    if (!ctx || !fg) return;
    ctxRef.current = ctx; fgCtxRef.current = fg;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      wRef.current = w; hRef.current = h;

      // responsive fs
      const fs = clampInt(Math.round(w / fontScaleDivisor), minFontSize, maxFontSize);
      const prev = fsRef.current; fsRef.current = fs;

      // scale canvases
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      fgCanvas.width = Math.floor(w * dpr);
      fgCanvas.height = Math.floor(h * dpr);
      fgCanvas.style.width = `${w}px`;
      fgCanvas.style.height = `${h}px`;
      fg.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.max(1, Math.floor(w / fs));
      const rows = Math.max(1, Math.floor(h / fs));
      colsRef.current = cols; rowsRef.current = rows;

      // if fs changed, reflow placements
      if (prev !== fs) {
        placedRef.current = [];
        blockedRef.current = new Set();
        planRef.current = null; // recompute layout plan on next tick
        selectedIndexRef.current = null; setFocusedIdx(null); detailLettersRef.current = []; ctaRectsRef.current = [];
      }

      if (dropsRef.current.length !== cols) {
        const old = dropsRef.current;
        dropsRef.current = new Array(cols).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || (Math.random() * rows) | 0);
      }
      measuredRef.current = true;
    };

    measure();

    const ro = new ResizeObserver(() => { requestAnimationFrame(measure); });
    ro.observe(container);

    clearInterval(placeTimerRef.current);
    placeTimerRef.current = setInterval(() => {
      if (placedRef.current.length >= services.length) return;
      const cols = colsRef.current; const rows = rowsRef.current; const w = wRef.current; const fs = fsRef.current;
      const startFrac = w < 900 ? 0.52 : regionStartFrac;
      const endFrac = w < 900 ? 0.96 : regionEndFrac;
      const region = computeRegion(cols, startFrac, endFrac);

      // compute uniform vertical plan once per layout
      if (!planRef.current) {
        planRef.current = planServiceLayout(services, cols, rows, region, 1);
      }

      // temp blocked from existing placements using their meta lines
      const tmpBlocked = new Set<string>();
      placedRef.current.forEach((wObj) => {
        const lines = wObj.meta?.lines ?? [];
        if (lines.length) {
          for (const ln of lines) {
            for (let i = 0; i < ln.text.length; i++) tmpBlocked.add(`${ln.startCol + i},${ln.row}`);
          }
        } else {
          wObj.letters.forEach((letter) => {
            const col = Math.floor(letter.x / fs);
            const row = Math.floor(letter.y / fs);
            tmpBlocked.add(`${col},${row}`);
          });
        }
      });

      const idx = placedRef.current.length;
      const name = services[idx];
      const plan = planRef.current[idx];
      const placed = placeWordIntoGrid(name, cols, rows, tmpBlocked, fs, idx, services.length, region, { lines: plan?.lines, baseRow: plan?.baseRow });
      if (placed) placedRef.current.push(placed);
    }, Math.max(300, cadenceMs));

    const charArr = chars.split("");

    const hitTestWord = (mx: number, my: number) => {
      const fs = fsRef.current;
      for (let idx = 0; idx < placedRef.current.length; idx++) {
        const wObj = placedRef.current[idx];
        if (!wObj || !wObj.letters.length) continue;
        const minX = Math.min(...wObj.letters.map((L: any) => L.x));
        const maxX = Math.max(...wObj.letters.map((L: any) => L.x)) + fs;
        const minY = Math.min(...wObj.letters.map((L: any) => (L.ty ?? L.y)));
        const maxY = Math.max(...wObj.letters.map((L: any) => (L.ty ?? L.y))) + fs;
        if (mx >= minX - fs * 0.2 && mx <= maxX + fs * 0.2 && my >= minY - fs * 0.2 && my <= maxY + fs * 0.2) return idx;
      }
      return null;
    };

    function buildDetailLetters(copy: string, startRow: number) {
      const cols = colsRef.current; const fs = fsRef.current; const w = wRef.current;
      const maxWidth = Math.max(10, Math.min(cols - 4, Math.floor(cols * 0.66)));
      const lines = wrapTextToLines(copy, maxWidth, 6);
      const letters: any[] = [];
      const centerX = Math.floor(w / 2);
      lines.forEach((line, li) => {
        const startX = Math.round(centerX - (line.length * fs) / 2);
        const y = (startRow + li * 2) * fs; // 1 row gap between lines
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const x = startX + i * fs;
          if (ch !== " ") {
            letters.push({ char: ch, cx: x, tx: x, ty: -100 - Math.random() * 400, y, alpha: 0.95 });
          }
        }
      });
      (letters as any).meta = { baseRow: startRow, copy };
      detailLettersRef.current = letters;
    }

    function positionSpotlightToDetail(padX = 120, padY = 60) {
      const letters: any[] = detailLettersRef.current;
      const w = wRef.current; const h = hRef.current; const fs = fsRef.current;
      if (!letters || !letters.length) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const L of letters) {
        const x1 = L.cx, x2 = L.cx + fs;
        const y1 = L.y,  y2 = L.y + fs;
        if (x1 < minX) minX = x1; if (x2 > maxX) maxX = x2;
        if (y1 < minY) minY = y1; if (y2 > maxY) maxY = y2;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = clamp(260, Math.floor(w * 0.6), Math.floor((maxX - minX) / 2 + padX));
      const ry = clamp(120, Math.floor(h * 0.6), Math.floor((maxY - minY) / 2 + padY));
      setSpotlight((s) => ({ ...s, cx, cy, rx, ry }));
    }

    function focusWord(idx: number) {
      selectedIndexRef.current = idx; setFocusedIdx(idx);
      const rows = rowsRef.current; const w = wRef.current; const fs = fsRef.current;
      const targetRow = Math.floor(rows / 2);
      const word = placedRef.current[idx];
      if (!word) return;

      // Build unified header string (concat wrapped lines with a space)
      const headerText = (word.meta?.lines?.map((l: any) => l.text).join(" ") || word.text || "").trim();
      const lenCols = headerText.length;
      const startX = Math.round((w - lenCols * fs) / 2);
      // Map existing letter objects onto positions that include spaces
      let consume = 0;
      for (let i = 0; i < headerText.length; i++) {
        const ch = headerText[i];
        const x = startX + i * fs;
        const y = targetRow * fs;
        if (ch !== ' ') {
          const L = word.letters[consume++];
          if (!L) continue;
          L.tx = x; L.y = y; if (typeof L.cx !== 'number') L.cx = L.x; L.ty = L.ty ?? L.y; L.locked = true; L.ty = y; // snap vertical to avoid wobble
        }
      }

      // Build detail block under header
      const name = services[idx];
      const copy = (serviceDetails as any)?.[name] || "Details coming soon.";
      buildDetailLetters(copy, targetRow + 3);
      positionSpotlightToDetail();
    }

    function clearFocus() {
      const idx = selectedIndexRef.current;
      if (idx == null) return;
      const word = placedRef.current[idx];
      if (word) {
        // restore letters to their placed positions
        word.letters.forEach((L: any) => { L.tx = L.x; L.y = L.y; L.locked = false; });
      }
      detailLettersRef.current = [];
      selectedIndexRef.current = null; setFocusedIdx(null);
    }

    // events
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // CTA hits when focused
      if (selectedIndexRef.current != null && ctaRectsRef.current) {
        const hit = ctaRectsRef.current.findIndex(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
        if (hit >= 0) {
          const { href } = ctaRectsRef.current[hit];
          if (href && href !== "#") window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
      }

      if (!allowClickFocus || !copyShownRef.current) return;
      const hitIdx = hitTestWord(mx, my);
      if (hitIdx != null) focusWord(hitIdx);
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (selectedIndexRef.current != null) {
        // Hovering CTA buttons
        const idx = ctaRectsRef.current.findIndex(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
        ctaHoverIndexRef.current = idx >= 0 ? idx : null;
        canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
        hoverIndexRef.current = null;
        return;
      }

      hoverIndexRef.current = hitTestWord(mx, my);
      canvas.style.cursor = hoverIndexRef.current != null ? 'pointer' : (copyShownRef.current ? 'pointer' : 'default');
    };

    const onLeave = () => { ctaHoverIndexRef.current = null; hoverIndexRef.current = null; canvas.style.cursor = 'default'; };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    const draw = () => {
      const ctx = ctxRef.current; const fg = fgCtxRef.current; if (!ctx || !fg) return;
      if (!measuredRef.current) { rafRef.current = requestAnimationFrame(draw); return; }
      const w = wRef.current; const h = hRef.current;
      const rows = rowsRef.current; const cols = colsRef.current; const fs = fsRef.current;

      // clear foreground each frame
      fg.clearRect(0, 0, w, h);

      // rebuild blocked map from current letters (covers wrapped lines without span reconstruction)
      const blocked = new Set<string>();
      placedRef.current.forEach((wObj: any) => {
        for (const L of wObj.letters) {
          const col = Math.floor(L.x / fs);
          const row = Math.floor((L.ty ?? L.y) / fs);
          if (row >= 0) blocked.add(`${col},${row}`);
        }
      });
      blockedRef.current = blocked;

      // trail fade
      ctx.fillStyle = `rgba(10,10,10,${Math.max(0.02, trailAlpha)})`;
      ctx.fillRect(0, 0, w, h);

      // font settings
      ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`;
      ctx.textBaseline = "top";
      fg.font = ctx.font; fg.textBaseline = "top";

      // background rain - skip blocked cells
      if (dropsRef.current.length !== cols) {
        const old = dropsRef.current;
        dropsRef.current = new Array(cols).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || 0);
      }
      for (let i = 0; i < dropsRef.current.length; i++) {
        const r = dropsRef.current[i];
        const x = i * fs; const y = r * fs;
        const key = `${i},${r}`;
        if (!blockedRef.current.has(key)) {
          const ch = charArr[(Math.random() * charArr.length) | 0];
          ctx.fillStyle = colorMatrix(0.8);
          ctx.fillText(ch, x, y);
        }
        const step = 1 + ((Math.random() * density) | 0);
        if (y > h && Math.random() > 0.975) dropsRef.current[i] = 0; else dropsRef.current[i] = (r + step) % (rows + 20);
      }

      // draw and settle service words
      let allLocked = placedRef.current.length > 0;
      for (const wObj of placedRef.current) {
        for (const L of wObj.letters) {
          if (!L.locked) {
            L.ty += (L.y - L.ty) * 0.16;
            if (Math.abs(L.y - L.ty) < 0.5) { L.ty = L.y; L.locked = true; }
          }
        }
        if (!wObj.letters.every((L: any) => L.locked)) allLocked = false;
      }

      // showCopy gate for focus
      if (allLocked) copyShownRef.current = true;

      const sel = selectedIndexRef.current;
      const selectedLetters: any[] = [];

      for (let idx = 0; idx < placedRef.current.length; idx++) {
        const wObj = placedRef.current[idx];
        const baseAlpha = sel == null ? 1 : (idx === sel ? 1 : 0.18);
        for (const L of wObj.letters) {
          const y = L.ty != null ? L.ty : L.y;
          if (idx === sel) {
            selectedLetters.push(L);
          } else {
            const settled = copyShownRef.current === true;
            if (settled) {
              ctx.fillStyle = 'rgba(253,247,240,' + baseAlpha + ')';
              ctx.shadowColor = 'rgba(253,247,240,' + (0.28 * baseAlpha) + ')';
            } else {
              ctx.fillStyle = 'rgba(0,255,65,' + baseAlpha + ')';
              ctx.shadowColor = 'rgba(0,255,65,' + (0.35 * baseAlpha) + ')';
            }
            ctx.shadowBlur = 8 * 0.6;
            ctx.fillText(L.char, L.x, y);
            ctx.shadowBlur = 0;
          }
        }
      }

      // Hover chevron on service items when not focused
      if (hoverIndexRef.current != null && (sel == null || hoverIndexRef.current !== sel)) {
        const wObj = placedRef.current[hoverIndexRef.current];
        if (wObj && wObj.letters.length) {
          const rowY = wObj.letters[0].ty ?? wObj.letters[0].y;
          const minX = Math.min(...wObj.letters.map((L: any) => L.x));
          ctx.fillStyle = colorMatrix(1);
          ctx.shadowColor = 'rgba(0,255,65,0.5)';
          ctx.shadowBlur = 8;
          ctx.fillText('>', minX - fs * 0.8, rowY);
          ctx.shadowBlur = 0;
        }
      }

      // Track spotlight to detail when focused
      if (sel != null && detailLettersRef.current.length) {
        positionSpotlightToDetail();
      }

      // draw selected header on FG with neon glow
      fg.save();
      fg.globalCompositeOperation = 'lighter';
      if (selectedLetters.length) {
        for (const letter of selectedLetters) {
          const lx = (typeof letter.tx === 'number') ? letter.tx : letter.x;
          const ly = letter.ty;
          // soft glow
          fg.fillStyle = colorMatrix(0.70);
          fg.shadowColor = 'rgba(0,255,65,0.65)';
          fg.shadowBlur = 22;
          fg.fillText(letter.char, lx, ly);
          // tighter glow
          fg.fillStyle = colorMatrix(0.85);
          fg.shadowColor = 'rgba(0,255,65,0.55)';
          fg.shadowBlur = 10;
          fg.fillText(letter.char, lx, ly);
          // crisp core
          fg.shadowBlur = 0;
          fg.fillStyle = colorMatrix(1);
          fg.fillText(letter.char, lx, ly);
        }
      }

      // detail letters rain-in in ivory
      let detailMaxY = -Infinity;
      if (detailLettersRef.current.length) {
        for (const L of detailLettersRef.current) {
          L.ty += (L.y - L.ty) * 0.12;
          const la = (L.alpha != null) ? L.alpha : 1;
          // halo
          fg.fillStyle = 'rgba(253,247,240,' + (la * 0.65) + ')';
          fg.shadowColor = 'rgba(253,247,240,0.5)';
          fg.shadowBlur = 16;
          fg.fillText(L.char, L.cx, L.ty);
          // tighter
          fg.fillStyle = 'rgba(253,247,240,' + (la * 0.85) + ')';
          fg.shadowColor = 'rgba(253,247,240,0.4)';
          fg.shadowBlur = 8;
          fg.fillText(L.char, L.cx, L.ty);
          // core
          fg.shadowBlur = 0;
          fg.fillStyle = 'rgba(253,247,240,' + la + ')';
          fg.fillText(L.char, L.cx, L.ty);
          if (L.y > detailMaxY) detailMaxY = L.y;
        }
      }

      // CTA buttons under detail
      ctaRectsRef.current = [];
      if (selectedLetters.length && detailLettersRef.current.length) {
        const ctas = [
          { label: 'FAQ', href: ctaFaqHref },
          { label: 'Services', href: ctaServicesHref },
          { label: 'Enquire', href: ctaEnquireHref },
        ];
        const padX = Math.max(12, Math.floor(fs * 0.66));
        const padY = Math.max(8, Math.floor(fs * 0.45));
        const gap = Math.max(10, Math.floor(fs * 0.6));
        const btnH = Math.max(36, Math.floor(fs * 1.35));

        const widths = ctas.map(c => Math.ceil(fg.measureText(c.label).width) + padX * 2);
        const totalW = widths.reduce((a, b) => a + b, 0) + gap * (ctas.length - 1);
        const startX = Math.round((w - totalW) / 2);
        const baseY = Math.round((detailMaxY + fs * 1.6));

        let x = startX;
        fg.lineWidth = 1.5;
        for (let i = 0; i < ctas.length; i++) {
          const wBtn = widths[i];
          const y = baseY;
          const r = Math.min(14, Math.floor(btnH / 2));
          const hovered = ctaHoverIndexRef.current === i;

          drawRoundedRect(fg, x, y, wBtn, btnH, r);
          if (hovered) {
            fg.fillStyle = 'rgba(0,255,65,0.15)';
            fg.shadowColor = 'rgba(0,255,65,0.45)';
            fg.shadowBlur = 12;
            fg.fill();
          }
          fg.shadowColor = 'rgba(0,255,65,0.4)';
          fg.shadowBlur = hovered ? 14 : 8;
          fg.strokeStyle = colorMatrix(1);
          fg.stroke();

          const tx = x + Math.round((wBtn - fg.measureText(ctas[i].label).width) / 2);
          const ty = y + Math.round((btnH - fs) / 2);
          fg.shadowBlur = hovered ? 10 : 6;
          fg.fillStyle = colorMatrix(1);
          fg.fillText(ctas[i].label, tx, ty);
          fg.shadowBlur = 0;

          ctaRectsRef.current.push({ label: ctas[i].label, href: ctas[i].href, x, y, w: wBtn, h: btnH });
          x += wBtn + gap;
        }
      }

      fg.restore();

      if (!paintedOnce) setPaintedOnce(true);
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      clearInterval(placeTimerRef.current);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFontSize, minFontSize, maxFontSize, fontScaleDivisor, density, chars, trailAlpha, services, cadenceMs, regionStartFrac, regionEndFrac, allowClickFocus, ctaFaqHref, ctaServicesHref, ctaEnquireHref]);

  return (
    <div ref={containerRef} className="relative w-full h-[70vh] md:h-[85vh] bg-[#0A0A0A] overflow-hidden rounded-3xl ring-1 ring-white/10">
      {/* Focus scrim */}
      {focusedIdx != null && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            background: spotlight.cx != null
              ? `radial-gradient(${spotlight.rx}px ${spotlight.ry}px at ${spotlight.cx}px ${spotlight.cy}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,${spotlight.edge}) 100%), rgba(0,0,0,${spotlight.base})`
              : `radial-gradient(520px 220px at 50% 55%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 55%, rgba(0,0,0,0.88) 100%), rgba(0,0,0,0.6)`,
            backdropFilter: 'blur(2px)'
          }}
        />
      )}

      <canvas ref={canvasRef} className="absolute inset-0 z-[10]" />
      <canvas ref={fgCanvasRef} className="absolute inset-0 z-[25] pointer-events-none" />

      {/* Back */}
      {focusedIdx != null && (
        <div className="absolute top-3 left-3 z-30">
          <button onClick={() => { /* clear via ref-safe function */ const idx =  selectedIndexRef.current; if (idx!=null) { const ev = new Event('click'); } }}
            className="px-3 py-1.5 rounded-lg ring-1 ring-white/20 text-[#FDF7F0] hover:ring-white/40 bg-black/30 backdrop-blur-sm"
            onMouseDown={(e) => { e.stopPropagation(); }}
            onClickCapture={(e) => { e.stopPropagation(); }}
          >← back</button>
        </div>
      )}

      {!paintedOnce && (
        <div className="absolute inset-0 grid place-items-center text-center text-sm text-[#FDF7F0]/60">
          Initialising rain…
        </div>
      )}
    </div>
  );
}
