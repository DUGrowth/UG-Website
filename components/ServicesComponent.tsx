import React, { useEffect, useRef, useState } from "react";

/**
 * MatrixServiceRain (stable + interactive)
 * - Background canvas renders Matrix rain + non-selected services.
 * - Foreground canvas renders the focused service + its raining detail copy ABOVE the spotlight scrim.
 * - Mini rain bubble sits behind the H2 by default, and tracks the focused service header when a service is selected.
 * - Service words lock into a right-side band; rain flows around them.
 * - Left copy fades in AFTER all letters finish locking and stays faint thereafter.
 * - Click a service: others fade, the clicked word recenters, and a detail block "rains in" beneath it.
 * - ESC closes the booking modal.
 * - Back pill clears focus and restores the right-hand list.
 */
export default function MatrixServiceRain({
  services = [
    "Social Media",
    "Website",
    "Email",
    "Automation",
    "AI Implementation",
    "Prospecting & Pipeline",
  ],
  cadenceMs = 1100,
  fontSize = 24,
  density = 1,
  chars = "01ABCDEFGHIKLMNOPQRSTUVWXYZ",
  finalRainAlpha = 0.2,
  fadeEase = 0.06,
  regionStartFrac = 0.58,
  regionEndFrac = 0.96,
  title = "Digital that sells for challenger SMEs",
  description = "Social, sites, and systems that convert attention into pipeline. Fast to launch. Simple to run.",
  primaryCtaLabel = "book 15 min fit call",
  primaryCtaHref = "#book",
  secondaryCtaLabel = "contact us",
  secondaryCtaHref = "#contact",
  bookingUrl = "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZssZ3xa4ln0wXh-wpTFlucNTHncIyWkijQaSivNH6yMxthHCyZMiX_DcS09XJSkHFjs3oZMI7IJo3w",
  openBookingInModal = true,
  // Spotlight CTA links (for focused service view)
  ctaFaqHref = "#faq",
  ctaServicesHref = "#services",
  ctaEnquireHref = "#enquire",
  // Interactive extras
  allowClickFocus = true,
  autoFocusService = null as string | null, // e.g. "Email" for demo/test
  serviceDetails = {
    "Social Media": "You’re a challenger, not a content farm. We build a lean social engine that wins buyer attention, turns it into qualified conversations, and compounds week after week.",
    Website: "Your website should punch above its weight and make the choice obvious. We build fast, conversion-first sites that clarify your offer, signal credibility, and turn traffic into pipeline.",
    Email: "Own your audience instead of renting it. Clean lists, sharp copy, and lifecycle flows that nurture buyers and drive revenue without noise.",
    Automation: "Free your small team to do big work. We connect your tools, kill manual handoffs, and ship reliable automations that increase speed and reduce cost.",
    "AI Implementation": "Use AI as a force multiplier, not a gimmick. We install practical copilots, prompts, and guardrails that cut cycle times and raise quality across real workflows.",
    "Prospecting & Pipeline": "Outreach that respects your time and your prospects. We build a targeted outbound system that finds right-fit accounts, opens doors on LinkedIn and email, and gives you a clear, repeatable path to meetings.",
  },
}: {
  services?: string[];
  cadenceMs?: number;
  fontSize?: number;
  density?: number;
  chars?: string;
  finalRainAlpha?: number;
  fadeEase?: number;
  regionStartFrac?: number;
  regionEndFrac?: number;
  title?: string;
  description?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  bookingUrl?: string;
  openBookingInModal?: boolean;
  ctaFaqHref?: string;
  ctaServicesHref?: string;
  ctaEnquireHref?: string;
  allowClickFocus?: boolean;
  autoFocusService?: string | null;
  serviceDetails?: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);      // background canvas
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);    // foreground canvas (focused word + details)
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);  // mini rain behind header

  // Stable refs
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fgCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const miniCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const miniColsRef = useRef(0);
  const miniRowsRef = useRef(0);
  const miniDropsRef = useRef<number[]>([]);
  const miniFontSizeRef = useRef(16);
  const miniCircleRef = useRef<{ cx: number | null; cy: number | null; r: number | null }>({ cx: null, cy: null, r: null });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const wRef = useRef(0);
  const hRef = useRef(0);
  const colsRef = useRef(0);
  const rowsRef = useRef(0);
  const dropsRef = useRef<number[]>([]); // per-column drop row indices
  const placedRef = useRef<any[]>([]);   // [{ text, letters:[{ox,oy,x,y,cx,tx,ty,char,locked}], placedAt }]
  const blockedRef = useRef<Set<string>>(new Set()); // Set of "col,row"
  const rafRef = useRef<number | null>(null);
  const placeTimerRef = useRef<any>(null);
  const copyShownRef = useRef(false);

  // Interactive
  const selectedIndexRef = useRef<number | null>(null); // focused word index
  const detailLettersRef = useRef<any[]>([]);           // letters for the raining detail block
  const pendingFocusNameRef = useRef<string | null>(autoFocusService);
  const hoverIndexRef = useRef<number | null>(null);
  const ctaRectsRef = useRef<Array<{ label: string; href: string; x: number; y: number; w: number; h: number }>>([]);
  const ctaHoverIndexRef = useRef<number | null>(null);

  // UI state
  const [showCopy, setShowCopy] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null); // drives Back hint & scrim
  const [spotlight, setSpotlight] = useState({ cx: null as number | null, cy: null as number | null, rx: 520, ry: 220, base: 0.6, edge: 0.88 });

  // Rain fade state
  const rainAlphaRef = useRef(1);
  const rainAlphaTargetRef = useRef(1);

  // spacing between focused header and body (in row units)
  const DETAIL_OFFSET_ROWS = 3;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    const miniCanvas = miniCanvasRef.current;
    if (!container || !canvas || !fgCanvas || !miniCanvas) return;

    const ctx = canvas.getContext("2d");
    const fgctx = fgCanvas.getContext("2d");
    const mctx = miniCanvas.getContext("2d");
    if (!ctx || !fgctx || !mctx) return;
    ctxRef.current = ctx; fgCtxRef.current = fgctx; miniCtxRef.current = mctx;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min((window?.devicePixelRatio || 1), 2);
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      const cols = Math.max(1, Math.floor(w / fontSize));
      const rows = Math.max(1, Math.floor(h / fontSize));

      const prevCols = colsRef.current;

      wRef.current = w; hRef.current = h; colsRef.current = cols; rowsRef.current = rows;

      // scale canvases
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      fgCanvas.width = w * dpr; fgCanvas.height = h * dpr;
      fgCanvas.style.width = `${w}px`; fgCanvas.style.height = `${h}px`;
      fgctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // size/scale mini canvas
      miniCanvas.width = w * dpr; miniCanvas.height = h * dpr;
      miniCanvas.style.width = `${w}px`; miniCanvas.style.height = `${h}px`;
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // mini rain settings
      miniFontSizeRef.current = Math.max(12, Math.floor(fontSize * 0.66));
      miniColsRef.current = Math.max(1, Math.floor(w / miniFontSizeRef.current));
      miniRowsRef.current = Math.max(1, Math.floor(h / miniFontSizeRef.current));
      if (miniDropsRef.current.length !== miniColsRef.current) {
        const old = miniDropsRef.current;
        miniDropsRef.current = new Array(miniColsRef.current).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || 0);
      }

      // position mini circle over the header (default / not focused)
      const hRect = titleRef.current?.getBoundingClientRect?.();
      if (hRect) {
        const cRect = container.getBoundingClientRect();
        const cx = (hRect.left - cRect.left) + hRect.width * 0.5;
        const cy = (hRect.top - cRect.top) + hRect.height * 0.44;
        const r = Math.max(hRect.height * 1.05, Math.min(hRect.width * 0.6, Math.min(w, h) * 0.3));
        miniCircleRef.current = { cx, cy, r };
      }

      if (cols !== prevCols) {
        // resize drops smoothly
        const old = dropsRef.current;
        dropsRef.current = new Array(cols).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || ((Math.random() * rows) | 0));
      }

      // rebuild blocked map from current letters
      rebuildBlockedFromCurrent();

      // keep focused layout centered on resize
      if (selectedIndexRef.current != null) {
        centerSelectedWordAndDetails();
        positionSpotlightToDetail();
      }
    };

    measure();

    // Debounced resize observer
    let roFrame: number | null = null;
    const ro = new ResizeObserver(() => {
      if (roFrame) cancelAnimationFrame(roFrame);
      roFrame = requestAnimationFrame(() => {
        const prevW = wRef.current, prevH = hRef.current;
        measure();
        if (Math.abs(wRef.current - prevW) < 2 && Math.abs(hRef.current - prevH) < 2) return; // ignore micro-changes
      });
    });
    ro.observe(container);

    // Placement timer (does not reset on resize)
    clearInterval(placeTimerRef.current);
    placeTimerRef.current = setInterval(() => {
      const placedCount = placedRef.current.length;
      if (placedCount >= services.length) return;

      const w = wRef.current;
      const cols = colsRef.current;
      const rows = rowsRef.current;
      const startFrac = w < 900 ? 0.52 : regionStartFrac;
      const endFrac = w < 900 ? 0.96 : regionEndFrac;
      const region = computeRegion(cols, startFrac, endFrac);

      const text = services[placedCount];
      const placed = placeWordIntoGrid(text, cols, rows, blockedRef.current, fontSize, placedCount, services.length, region);
      if (placed) {
        placed.letters.forEach((L: any) => { L.cx = L.x; });
        placedRef.current.push(placed);
      }
    }, Math.max(300, cadenceMs));

    // canvas click to focus
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // If focused, route clicks to CTA buttons first
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

    // hover tracking for chevron + CTA indicator
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (selectedIndexRef.current != null) {
        // Hovering CTA buttons
        const idx = ctaRectsRef.current.findIndex(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
        ctaHoverIndexRef.current = idx >= 0 ? idx : null;
        canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
        // do not compute list hover while focused
        hoverIndexRef.current = null;
        return;
      }

      // Not focused: hover chevron for list items
      hoverIndexRef.current = hitTestWord(mx, my);
      canvas.style.cursor = hoverIndexRef.current != null ? 'pointer' : (showCopy ? 'pointer' : 'default');
    };

    const onLeave = () => { ctaHoverIndexRef.current = null; hoverIndexRef.current = null; canvas.style.cursor = 'default'; };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    // Draw loop
    const draw = () => {
      const ctx = ctxRef.current; if (!ctx) return;
      const fg = fgCtxRef.current;
      const mctx = miniCtxRef.current;
      const w = wRef.current; const h = hRef.current; const rows = rowsRef.current;

      // clear foreground each frame (detail + focused word lives here)
      if (fg) { fg.clearRect(0, 0, w, h); }

      // --- MINI RAIN behind header (masked to faded-edge circle) ---
      if (mctx && showCopy) {
        const mfs = miniFontSizeRef.current;
        const mcols = miniColsRef.current;
        const mrows = miniRowsRef.current;
        const circ = miniCircleRef.current;

        // clear
        mctx.clearRect(0, 0, w, h);

        // subtle luminous underlay so the mini rain reads
        if (circ && circ.cx != null && circ.r != null) {
          const under = mctx.createRadialGradient(circ.cx, circ.cy, Math.max(6, (circ.r || 0) * 0.25), circ.cx, circ.cy, circ.r!);
          under.addColorStop(0, 'rgba(0,255,65,0.09)');
          under.addColorStop(0.65, 'rgba(0,255,65,0.04)');
          under.addColorStop(1, 'rgba(0,255,65,0.00)');
          mctx.fillStyle = under;
          mctx.fillRect(0, 0, w, h);
        }

        // draw subtle rain with additive blend
        mctx.save();
        mctx.globalCompositeOperation = 'lighter';
        mctx.font = `${mfs}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`;
        mctx.textBaseline = 'top';

        if (miniDropsRef.current.length !== mcols) {
          const old = miniDropsRef.current;
          miniDropsRef.current = new Array(mcols).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || 0);
        }
        const charArrMini = chars.split('');
        for (let i = 0; i < miniDropsRef.current.length; i++) {
          const r = miniDropsRef.current[i];
          const x = i * mfs; const y = r * mfs;
          const ch = charArrMini[(Math.random() * charArrMini.length) | 0];
          mctx.fillStyle = colorMatrix(0.34);
          mctx.fillText(ch, x, y);
          const step = 1 + ((Math.random() * 0.8) | 0);
          if (y > h && Math.random() > 0.985) miniDropsRef.current[i] = 0;
          else miniDropsRef.current[i] = (r + step) % (mrows + 20);
        }
        mctx.restore();

        // mask to faded-edge circle
        if (circ && circ.cx != null && circ.r != null) {
          const grad = mctx.createRadialGradient(circ.cx, circ.cy, Math.max(4, (circ.r || 0) * 0.60), circ.cx, circ.cy, circ.r!);
          grad.addColorStop(0, 'rgba(0,0,0,1)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          mctx.globalCompositeOperation = 'destination-in';
          mctx.fillStyle = grad;
          mctx.fillRect(0, 0, w, h);
          mctx.globalCompositeOperation = 'source-over';
        }
      }

      // trail fade on background
      ctx.fillStyle = "rgba(10,10,10,0.08)";
      ctx.fillRect(0, 0, w, h);

      // check lock status
      const allPlaced = placedRef.current.length >= services.length && services.length > 0;
      let allLocked = false;
      if (allPlaced) {
        allLocked = placedRef.current.every((w: any) => w.letters.every((l: any) => l.locked));
      }
      if (allLocked) {
        rainAlphaTargetRef.current = clamp01(finalRainAlpha);
        if (!copyShownRef.current) { copyShownRef.current = true; setShowCopy(true); }
        // Optional auto-focus demo
        if (pendingFocusNameRef.current) {
          const name = pendingFocusNameRef.current; pendingFocusNameRef.current = null;
          const idx = services.findIndex((s) => s === name);
          if (idx >= 0) focusWord(idx);
        }
      }

      // ease rain alpha
      rainAlphaRef.current += (rainAlphaTargetRef.current - rainAlphaRef.current) * fadeEase;

      // fonts
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`;
      ctx.textBaseline = "top";
      if (fg) { fg.font = ctx.font; fg.textBaseline = "top"; }

      const charArr = chars.split("");
      const drops = dropsRef.current; const blocked = blockedRef.current;
      const rainOpacity = 0.75 * clamp01(rainAlphaRef.current);

      if (drops.length !== colsRef.current) {
        const old = drops;
        dropsRef.current = new Array(colsRef.current).fill(0).map((_, i) => old[i % Math.max(1, old.length)] || 0);
      }

      for (let i = 0; i < dropsRef.current.length; i++) {
        const r = dropsRef.current[i];
        const x = i * fontSize; const y = r * fontSize;
        const key = `${i},${r}`;
        if (!blocked.has(key)) {
          const ch = charArr[(Math.random() * charArr.length) | 0];
          ctx.fillStyle = colorMatrix(rainOpacity);
          ctx.fillText(ch, x, y);
        }
        const step = 1 + ((Math.random() * density) | 0);
        if (y > h && Math.random() > 0.975) dropsRef.current[i] = 0;
        else dropsRef.current[i] = (r + step) % (rows + 20);
      }

      // draw & settle locked service words on background; move selected to foreground
      const sel = selectedIndexRef.current;
      const selectedLetters: any[] = [];
      placedRef.current.forEach((wObj: any, idx: number) => {
        const baseAlpha = sel == null ? 1 : (idx === sel ? 1 : 0.18);
        for (const letter of wObj.letters) {
          if (!letter.locked) {
            letter.ty += (letter.y - letter.ty) * 0.16;
            if (Math.abs(letter.y - letter.ty) < 0.5) { letter.ty = letter.y; letter.locked = true; }
          }
          if (typeof letter.tx === "number") {
            letter.cx += (letter.tx - letter.cx) * 0.16;
          }
          if (idx === sel) {
            selectedLetters.push(letter);
          } else {
            // After the menu fully settles, turn list items white; before that, matrix green
            const settled = copyShownRef.current === true;
            if (settled) {
              ctx.fillStyle = 'rgba(253,247,240,' + baseAlpha + ')';
              ctx.shadowColor = 'rgba(253,247,240,' + (0.28 * baseAlpha) + ')';
            } else {
              ctx.fillStyle = 'rgba(0,255,65,' + baseAlpha + ')';
              ctx.shadowColor = 'rgba(0,255,65,' + (0.35 * baseAlpha) + ')';
            }
            ctx.shadowBlur = 8 * 0.6;
            ctx.fillText(letter.char, (letter.cx != null ? letter.cx : letter.x), letter.ty);
            ctx.shadowBlur = 0;
          }
        }
      });

      // Hover chevron on service items
      {
        const hIdx = hoverIndexRef.current;
        if (hIdx != null && (sel == null || hIdx !== sel)) {
          const wObj = placedRef.current[hIdx];
          if (wObj && wObj.letters && wObj.letters.length) {
            const rowY = wObj.letters[0].ty;
            const minX = Math.min(...wObj.letters.map((L: any) => (L.cx ?? L.x)));
            ctx.fillStyle = colorMatrix(1);
            ctx.shadowColor = 'rgba(0,255,65,0.5)';
            ctx.shadowBlur = 8;
            ctx.fillText('>', minX - fontSize * 0.8, rowY);
            ctx.shadowBlur = 0;
          }
        }
      }

      // Track mini-rain bubble to the focused header (not too tight)
      if (sel != null && selectedLetters.length) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const letter of selectedLetters) {
          const lx = (letter.cx != null ? letter.cx : letter.x);
          const ly = letter.ty;
          if (lx < minX) minX = lx;
          if (lx > maxX) maxX = lx;
          if (ly < minY) minY = ly;
          if (ly > maxY) maxY = ly;
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
          const cx = (minX + maxX + fontSize) / 2; // include half char width
          const cy = minY + fontSize * 0.48;
          const halfW = (maxX - minX + fontSize) / 2;
          const padX = fontSize * 1.1;
          const padY = fontSize * 0.9;
          const r = Math.max(halfW + padX, fontSize / 2 + padY);
          miniCircleRef.current = { cx, cy, r };
        }
      }

      // draw selected word + detail text on FOREGROUND above scrim
      if (fg) {
        fg.save();
        fg.globalCompositeOperation = 'lighter';

        // selected word with strong glow (multi-pass neon — MATRIX GREEN)
        if (selectedLetters.length) {
          for (const letter of selectedLetters) {
            const lx = (letter.cx != null ? letter.cx : letter.x);
            const ly = letter.ty;

            // pass 1: wide soft glow
            fg.fillStyle = colorMatrix(0.70);
            fg.shadowColor = 'rgba(0,255,65,0.65)';
            fg.shadowBlur = 22;
            fg.fillText(letter.char, lx, ly);

            // pass 2: tighter glow
            fg.fillStyle = colorMatrix(0.85);
            fg.shadowColor = 'rgba(0,255,65,0.55)';
            fg.shadowBlur = 10;
            fg.fillText(letter.char, lx, ly);

            // pass 3: crisp core
            fg.shadowBlur = 0;
            fg.fillStyle = colorMatrix(1);
            fg.fillText(letter.char, lx, ly);
          }
        }

        // detail letters (rain-in) with glow (lighter)
        let detailMaxY = -Infinity; let detailMinY = Infinity;
        if (detailLettersRef.current.length) {
          for (const L of detailLettersRef.current) {
            L.ty += (L.y - L.ty) * 0.12;
            if (typeof L.tx === "number") { L.cx += (L.tx - L.cx) * 0.12; }

            const la = (L.alpha != null) ? L.alpha : 1;
            // pass 1: soft halo
            fg.fillStyle = 'rgba(253,247,240,' + (la * 0.65) + ')';
            fg.shadowColor = 'rgba(253,247,240,0.5)';
            fg.shadowBlur = 16;
            fg.fillText(L.char, L.cx, L.ty);

            // pass 2: tighter halo
            fg.fillStyle = 'rgba(253,247,240,' + (la * 0.85) + ')';
            fg.shadowColor = 'rgba(253,247,240,0.4)';
            fg.shadowBlur = 8;
            fg.fillText(L.char, L.cx, L.ty);

            // pass 3: core
            fg.shadowBlur = 0;
            fg.fillStyle = 'rgba(253,247,240,' + la + ')';
            fg.fillText(L.char, L.cx, L.ty);

            if (L.y > detailMaxY) detailMaxY = L.y;
            if (L.y < detailMinY) detailMinY = L.y;
          }
        }

        // --- CTA BUTTONS under the body ---
        ctaRectsRef.current = [];
        if (selectedLetters.length && detailLettersRef.current.length) {
          const ctas = [
            { label: 'FAQ', href: ctaFaqHref },
            { label: 'Services', href: ctaServicesHref },
            { label: 'Enquire', href: ctaEnquireHref },
          ];
          const padX = Math.max(12, Math.floor(fontSize * 0.66));
          const padY = Math.max(8, Math.floor(fontSize * 0.45));
          const gap = Math.max(10, Math.floor(fontSize * 0.6));
          const btnH = Math.max(36, Math.floor(fontSize * 1.35));

          // measure widths
          const widths = ctas.map(c => Math.ceil(fg.measureText(c.label).width) + padX * 2);
          const totalW = widths.reduce((a, b) => a + b, 0) + gap * (ctas.length - 1);
          const startX = Math.round((w - totalW) / 2);
          const baseY = Math.round((detailMaxY + fontSize * 1.6));

          let x = startX;
          fg.lineWidth = 1.5;
          for (let i = 0; i < ctas.length; i++) {
            const wBtn = widths[i];
            const y = baseY;
            const r = Math.min(14, Math.floor(btnH / 2));
            const hovered = ctaHoverIndexRef.current === i;

            // shape
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

            // label
            const tx = x + Math.round((wBtn - fg.measureText(ctas[i].label).width) / 2);
            const ty = y + Math.round((btnH - fontSize) / 2);
            fg.shadowBlur = hovered ? 10 : 6;
            fg.fillStyle = colorMatrix(1);
            fg.fillText(ctas[i].label, tx, ty);
            fg.shadowBlur = 0;

            // store rect for hit-testing
            ctaRectsRef.current.push({ label: ctas[i].label, href: ctas[i].href, x, y, w: wBtn, h: btnH });

            x += wBtn + gap;
          }
        } else {
          ctaRectsRef.current = [];
        }

        fg.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    // ESC to close booking modal
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && showBooking) setShowBooking(false); };
    window.addEventListener("keydown", onKey);

    return () => {
      ro.disconnect();
      if (roFrame) cancelAnimationFrame(roFrame);
      clearInterval(placeTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
    };
    // we intentionally set no deps; internal state handles resizes safely
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-aim mini spotlight when copy appears (header becomes visible)
  useEffect(() => {
    if (!showCopy) return;
    const container = containerRef.current; const title = titleRef.current; const miniCanvas = miniCanvasRef.current;
    const mctx = miniCtxRef.current; if (!container || !title || !miniCanvas || !mctx) return;
    const cRect = container.getBoundingClientRect();
    const hRect = title.getBoundingClientRect();
    const cx = (hRect.left - cRect.left) + hRect.width * 0.5;
    const cy = (hRect.top - cRect.top) + hRect.height * 0.44;
    const r = Math.max(hRect.height * 1.05, Math.min(hRect.width * 0.6, Math.min(cRect.width, cRect.height) * 0.3));
    miniCircleRef.current = { cx, cy, r };
  }, [showCopy]);

  // Keep mini-rain behind H2 when not focused; during focus it tracks the centered word (updated each frame)
  useEffect(() => {
    if (!showCopy) return;
    if (focusedIdx != null) return; // focus mode handled per-frame in draw()
    const container = containerRef.current; const title = titleRef.current;
    if (!container || !title) return;
    const cRect = container.getBoundingClientRect();
    const hRect = title.getBoundingClientRect();
    const cx = (hRect.left - cRect.left) + hRect.width * 0.5;
    const cy = (hRect.top - cRect.top) + hRect.height * 0.44;
    const r = Math.max(hRect.height * 1.05, Math.min(hRect.width * 0.6, Math.min(cRect.width, cRect.height) * 0.3));
    miniCircleRef.current = { cx, cy, r };
  }, [showCopy, focusedIdx]);

  // Focus helpers
  function focusWord(idx: number) {
    selectedIndexRef.current = idx;
    setFocusedIdx(idx);
    const rows = rowsRef.current; const w = wRef.current;
    const targetRow = Math.floor(rows / 2);
    const word = placedRef.current[idx];
    if (!word) return;

    const len = word.letters.length;
    const startX = Math.round((w - len * fontSize) / 2);
    word.letters.forEach((L: any, i: number) => {
      L.tx = startX + i * fontSize; // pixel-precise horizontal centering
      L.y = targetRow * fontSize;   // final Y (consistent across services)
      if (typeof L.cx !== "number") L.cx = L.x;
      // snap vertical to avoid wobble between services
      L.ty = L.y;
      L.locked = true;
    });

    // Build detail block letters from serviceDetails
    const name = services[idx];
    const copy = (serviceDetails as any)?.[name] || "Details coming soon.";
    buildDetailLetters(copy, targetRow + DETAIL_OFFSET_ROWS); // start a few rows below the word
    positionSpotlightToDetail();
  }

  function clearFocus() {
    const idx = selectedIndexRef.current;
    if (idx == null) return;
    const word = placedRef.current[idx];
    if (word) {
      word.letters.forEach((L: any) => {
        // restore targets to original slot
        L.tx = L.x;        // glide horizontally back to region x
        L.y = L.oy;        // original row y
        // unlock so vertical (ty) eases back from centre instead of staying stuck
        L.locked = false;
      });
    }
    detailLettersRef.current = [];
    selectedIndexRef.current = null;
    setFocusedIdx(null);
    // refresh the blocked grid to reflect restored positions
    rebuildBlockedFromCurrent();
  }

  function positionSpotlightToDetail(padX = 120, padY = 60) {
    const letters: any[] = detailLettersRef.current;
    const w = wRef.current; const h = hRef.current;
    if (!letters || !letters.length) {
      // fallback: center on focused word if details not ready
      const idx = selectedIndexRef.current;
      if (idx == null) return;
      const word = placedRef.current[idx];
      if (!word || !word.letters.length) return;
      const len = word.letters.length;
      const firstTx = word.letters[0].tx ?? word.letters[0].x;
      const lastTx = word.letters[len - 1].tx ?? word.letters[len - 1].x;
      const cx = (firstTx + lastTx) / 2;
      const cy = (word.letters[0].y ?? word.letters[0].ty) + fontSize * DETAIL_OFFSET_ROWS;
      const rx = clamp(320, Math.floor(w * 0.55), Math.floor(w * 0.45));
      const ry = clamp(160, Math.floor(h * 0.55), Math.floor(h * 0.32));
      setSpotlight((s) => ({ ...s, cx, cy, rx, ry }));
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const L of letters) {
      if (!Number.isFinite(L.cx) || !Number.isFinite(L.y)) continue;
      const x1 = L.cx, x2 = L.cx + fontSize;
      const y1 = L.y,  y2 = L.y + fontSize;
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

  function centerSelectedWordAndDetails() {
    const idx = selectedIndexRef.current;
    if (idx == null) return;
    const rows = rowsRef.current; const w = wRef.current;
    const targetRow = Math.floor(rows / 2);
    const word = placedRef.current[idx];
    if (word) {
      const len = word.letters.length;
      const startX = Math.round((w - len * fontSize) / 2);
      word.letters.forEach((L: any, i: number) => {
        L.tx = startX + i * fontSize; L.y = targetRow * fontSize;
        if (typeof L.cx !== "number") L.cx = L.x;
      });
    }
    // details will be rebuilt by caller if needed
  }

  function buildDetailLetters(copy: string, startRow: number) {
    const cols = colsRef.current; const w = wRef.current;
    const maxWidth = Math.max(10, Math.min(cols - 4, Math.floor(cols * 0.66)));
    const lines = wrapTextToLines(copy, maxWidth, 6);

    const letters: any[] = [];
    const centerX = Math.floor(w / 2);
    lines.forEach((line, li) => {
      const startX = Math.round(centerX - (line.length * fontSize) / 2);
      const y = (startRow + li * 2) * fontSize; // 1 row gap between lines
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const x = startX + i * fontSize;
        if (ch !== " ") {
          letters.push({ char: ch, cx: x, tx: x, ty: -100 - Math.random() * 400, y, alpha: 0.95 });
        }
      }
    });
    (letters as any).meta = { baseRow: startRow, copy };
    detailLettersRef.current = letters;
  }

  function hitTestWord(mx: number, my: number) {
    // Identify the word row & horizontal span
    for (let idx = 0; idx < placedRef.current.length; idx++) {
      const w = placedRef.current[idx];
      if (!w || !w.letters.length) continue;
      const rowY = w.letters[0].ty; // same row for all letters
      const minX = Math.min(...w.letters.map((L: any) => (L.cx ?? L.x)));
      const maxX = Math.max(...w.letters.map((L: any) => (L.cx ?? L.x))) + fontSize;
      const withinY = my >= rowY - fontSize * 0.4 && my <= rowY + fontSize * 1.2;
      const withinX = mx >= minX - fontSize * 0.4 && mx <= maxX + fontSize * 0.2;
      if (withinX && withinY) return idx;
    }
    return null;
  }

  // Rebuild blocked cells from CURRENT animated positions of all letters
  function rebuildBlockedFromCurrent() {
    const blocked = new Set<string>();
    const push = (x: number, y: number) => {
      const col = Math.floor(x / fontSize);
      const row = Math.floor(y / fontSize);
      blocked.add(`${col},${row}`);
    };
    placedRef.current.forEach((w: any) => w.letters.forEach((L: any) => {
      const x = (L.cx ?? L.x); const y = (L.ty ?? L.y);
      if (Number.isFinite(x) && Number.isFinite(y)) push(x, y);
    }));
    (detailLettersRef.current as any).forEach?.((L: any) => { if (L && Number.isFinite(L.cx) && Number.isFinite(L.y)) push(L.cx, L.y); });
    blockedRef.current = blocked;
  }

  // --- RENDER ---
  return (
    <div ref={containerRef} className="relative w-full h-[70vh] md:h-[85vh] bg-[#0A0A0A] overflow-hidden rounded-3xl ring-1 ring-white/10">
      {/* Canvas background */}
      <canvas ref={canvasRef} className={`absolute inset-0 ${showCopy ? 'cursor-pointer' : 'cursor-default'}`} />

      {/* Mini rain behind the header (masked circle) */}
      <canvas ref={miniCanvasRef} className="absolute inset-0 z-[9] pointer-events-none" />

      {/* Back hint */}
      {focusedIdx != null && (
        <div className="absolute top-3 left-3 z-30">
          <button onClick={clearFocus} className="px-3 py-1.5 rounded-lg ring-1 ring-white/20 text-[#FDF7F0] hover:ring-white/40 bg-black/30 backdrop-blur-sm">← back</button>
        </div>
      )}

      {/* Focus scrim to improve readability when a service is focused */}
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

      {/* Foreground canvas for focused word + raining detail above scrim */}
      <canvas ref={fgCanvasRef} className="absolute inset-0 z-[25] pointer-events-none" />

      {/* Left content overlay — fades in after lock */}
      <div className={`absolute inset-0 z-10 grid grid-cols-12 gap-6 p-6 md:p-8 transition-opacity duration-700 pointer-events-none select-none ${showCopy ? "opacity-100" : "opacity-0"}`}>
        <div
          className={`col-span-12 md:col-span-6 self-center max-w-xl ${showCopy ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}
        >
          <h2 ref={titleRef} className="text-[#FDF7F0] text-3xl md:text-5xl font-semibold tracking-tight">{title}</h2>
          <p className="text-[#FDF7F0]/80 mt-2 md:mt-2 text-base md:text-lg">{description}</p>
          <div className="mt-4 md:mt-4 flex flex-col sm:flex-row gap-3">
            <a
              href={bookingUrl || primaryCtaHref}
              onClick={(e) => { if (bookingUrl && openBookingInModal) { e.preventDefault(); setShowBooking(true); } }}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#FDF7F0] text-[#0A0A0A] font-medium hover:opacity-90 shadow"
              rel="noopener noreferrer"
              target={bookingUrl && !openBookingInModal ? "_blank" : undefined}
            >
              {primaryCtaLabel}
            </a>
            <a href={secondaryCtaHref} className="inline-flex items-center justify-center px-5 py-3 rounded-xl ring-1 ring-inset ring-[#FDF7F0]/30 text-[#FDF7F0] hover:ring-[#FDF7F0]">
              {secondaryCtaLabel}
            </a>
          </div>
        </div>
      </div>

      {/* Booking modal */}
      {showBooking && bookingUrl && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowBooking(false)}>
          <div className="w-full max-w-3xl rounded-2xl bg-[#0A0A0A] ring-1 ring-white/10 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[#FDF7F0] text-lg font-medium">Book a 15 min fit call</h3>
              <button onClick={() => setShowBooking(false)} className="px-3 py-1.5 rounded-lg ring-1 ring-white/20 text-[#FDF7F0] hover:ring-white/40">Close</button>
            </div>
            <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-white">
              <iframe src={bookingUrl} className="w-full h-[70vh]" loading="lazy" />
            </div>
            <div className="mt-3 flex gap-3">
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#FDF7F0] text-[#0A0A0A] font-medium hover:opacity-90">Open in Google Calendar</a>
              <button onClick={() => setShowBooking(false)} className="inline-flex items-center justify-center px-4 py-2 rounded-xl ring-1 ring-inset ring-[#FDF7F0]/30 text-[#FDF7F0] hover:ring-[#FDF7F0]">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- helpers --- //

function placeWordIntoGrid(text: string, cols: number, rows: number, blocked: Set<string>, fontSize: number, idx: number, total: number, region: { startCol: number; endCol: number; }) {
  if (!text || !cols || !rows) return null as any;
  const clean = String(text);
  const len = clean.length; // spaces do not block

  const margin = 1; // keep edges tidy inside region
  const regionCols = Math.max(1, region.endCol - region.startCol + 1);

  // Horizontal centring inside the region
  const maxLen = Math.min(len, Math.max(1, regionCols - margin * 2));
  const startCol = region.startCol + Math.max(margin, Math.floor((regionCols - maxLen) / 2));

  // Even vertical spacing across the full height (uniform bands, no drift)
  const top = 2;                    // small top margin (rows)
  const bottom = Math.max(3, rows - 3); // small bottom margin (rows)
  const bands = Math.max(1, total);
  let row: number;
  if (bands === 1) {
    row = Math.floor((top + bottom) / 2);
  } else {
    const span = bottom - top;
    const step = Math.max(1, Math.floor(span / (bands - 1))); // equal spacing including ends
    row = top + idx * step;
    row = clamp(top, bottom, row);
  }

  const tryRow = (r: number) => canFitInRegion(clean, startCol, r, blocked);
  if (!tryRow(row)) {
    for (let off = 1; off < rows; off++) {
      if (row - off > 0 && tryRow(row - off)) { row = row - off; break; }
      if (row + off < rows - 1 && tryRow(row + off)) { row = row + off; break; }
    }
  }
  if (!tryRow(row)) return null as any;

  const letters: 
