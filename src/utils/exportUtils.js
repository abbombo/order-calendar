import { toJpeg, toPng } from 'html-to-image';

// ---------------------------------------------------------------------------
// Color resolution helper
// ---------------------------------------------------------------------------
// html-to-image serialises computed CSS into SVG foreignObject.
// SVG renderers don't honour CSS `oklch()` syntax, so any Tailwind arbitrary
// colour like `bg-[oklch(93%_0.04_148.98)]` comes out transparent in the export.
//
// Fix: before capture we walk every element, detect oklch (or any non-rgb/hex)
// background-color / color values, convert them to plain `rgb()` using a 1×1
// offscreen canvas (the browser does the maths for us), and set them as inline
// styles.  After capture we restore the originals.

function buildColorCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.getContext('2d');
}

/**
 * Convert any CSS color string to `rgb(r, g, b)` via canvas rendering.
 * Returns null if the color is transparent / cannot be resolved.
 */
function resolveColorViaCanvas(ctx, cssColor) {
  if (!cssColor || cssColor === 'transparent') return null;
  // Already a plain rgb/rgba/hex value — no conversion needed
  if (/^(rgb|rgba|#)/.test(cssColor)) return null;
  // transparent keyword variants
  if (cssColor === 'rgba(0, 0, 0, 0)') return null;

  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = cssColor;      // browser resolves oklch → sRGB here
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;      // fully transparent
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

/**
 * Walk all descendants of rootEl and force-resolve any oklch background-color
 * / color values to plain rgb() inline styles so the SVG renderer can paint them.
 *
 * Returns a restore callback that reverts every inline-style change.
 */
function resolveOklchColors(rootEl) {
  const ctx = buildColorCanvas();
  const restoreList = []; // [{ el, prop, prev }]

  const els = [rootEl, ...rootEl.querySelectorAll('*')];
  for (const el of els) {
    const computed = window.getComputedStyle(el);

    for (const prop of ['backgroundColor', 'color']) {
      const raw = computed[prop];
      const resolved = resolveColorViaCanvas(ctx, raw);
      if (resolved) {
        restoreList.push({ el, prop, prev: el.style[prop] });
        el.style[prop] = resolved;
      }
    }
  }

  return function restore() {
    for (const { el, prop, prev } of restoreList) {
      el.style[prop] = prev;
    }
  };
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export the calendar card as a JPG or PNG image.
 * Captures #export-card (full white card: stats badges + nav + grid).
 * Falls back to #calendar-root if #export-card is not found.
 *
 * @param {'jpg'|'png'} format
 * @param {string}      title   - filename prefix
 */
export async function exportToImage(format = 'jpg', title = 'transactions') {
  const element =
    document.getElementById('export-card') ||
    document.getElementById('calendar-root');

  if (!element) {
    console.error('exportToImage: #export-card / #calendar-root not found');
    return;
  }

  // 1. Hide UI-only controls (view-mode buttons, export button row)
  const noExportEls = element.querySelectorAll('[data-no-export]');
  noExportEls.forEach(el => {
    el.dataset._prevDisplay = el.style.display;
    el.style.display = 'none';
  });

  // 2. Resolve oklch / wide-gamut colors to plain rgb() so the SVG renderer
  //    can paint them correctly in the exported image
  const restoreColors = resolveOklchColors(element);

  try {
    const opts = {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    };

    const dataUrl =
      format === 'png'
        ? await toPng(element, opts)
        : await toJpeg(element, opts);

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${title}-${dateStr}.${format}`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.error('exportToImage failed:', err);
  } finally {
    // Restore colors and hidden elements
    restoreColors();
    noExportEls.forEach(el => {
      el.style.display = el.dataset._prevDisplay || '';
      delete el.dataset._prevDisplay;
    });
  }
}

// Legacy alias kept for any stale references
export const exportToJPG = (title) => exportToImage('jpg', title);
