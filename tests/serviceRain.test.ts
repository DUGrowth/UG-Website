import {
  canFitInRegion,
  computeRegion,
  placeWordIntoGrid,
  wrapTextToLines,
} from "../src/utils/serviceRain";

export function runMatrixServiceRainTests() {
  const region = computeRegion(100, 0.5, 0.8);
  console.assert(region.startCol === 50 && region.endCol === 80, "computeRegion failed");

  const testRegion = computeRegion(120, 0.6, 0.9);
  const okBasic = canFitInRegion(4, testRegion.startCol + 2, 10, new Set(), testRegion, 1, 120);
  console.assert(okBasic === true, "canFitInRegion basic should be true");

  const bad = canFitInRegion(8, testRegion.endCol - 2, 10, new Set(), testRegion, 1, 120);
  console.assert(bad === false, "canFitInRegion should fail when exceeding region");

  const cols = 120;
  const rows = 40;
  const fs = 24;
  const placed = placeWordIntoGrid("Prospecting & Pipeline", cols, rows, new Set(), fs, 5, 6, testRegion);
  console.assert(!!placed, "placeWordIntoGrid should return a placement");
  if (placed) {
    const lines = placed.meta.lines;
    console.assert(lines.length >= 1 && lines.length <= 2, "should have 1 or 2 lines");
  }

  const narrowRegion = computeRegion(40, 0.6, 0.9);
  const placedWrap = placeWordIntoGrid("ABCDEFGHIJKLMNOP", 40, 20, new Set(), 20, 1, 3, narrowRegion);
  console.assert(!!placedWrap, "wrapped placement should succeed");
  if (placedWrap) {
    console.assert(placedWrap.meta.lines.length === 2, "should wrap to two lines");
  }

  const wrapped = wrapTextToLines("a ".repeat(200), 10, 5);
  console.assert(wrapped.length <= 5, "wrapTextToLines should respect maxLines");
}

if (typeof window !== "undefined") {
  const w = window as any;
  if (!w.__MSR_TESTS_RUN__) {
    w.__MSR_TESTS_RUN__ = true;
    runMatrixServiceRainTests();
  }
}
