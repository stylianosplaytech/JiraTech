import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

/**
 * Turns a rendered report pack into an A4 portrait PDF.
 *
 * The DOM under `root` is marked up with:
 *   [data-pdf-section]  a report; each one starts on a new page
 *   [data-pdf-block]    a piece placed whole, stacked top to bottom (never split)
 *   [data-pdf-repeat]   a block (the report banner) repeated at the top of continuation pages
 *   [data-pdf-table]    a block containing a <table>; split between rows, header repeated
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const TOP = 14; // leaves room for the page-number tab
const BOTTOM = 12; // leaves room for the footer
const GAP = 4;
const CONTENT_W = PAGE_W - MARGIN * 2;
const PAGE_BG = '#F3F6F1';
const ACCENT = '#1F4E3D';
const PIXEL_RATIO = 2;

const capture = (el: HTMLElement) =>
  toCanvas(el, { pixelRatio: PIXEL_RATIO, backgroundColor: PAGE_BG, cacheBust: true });

export async function exportReportPdf(root: HTMLElement, opts: { filename: string; footer: string }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const mmPerPx = CONTENT_W / root.offsetWidth;
  const usable = PAGE_H - TOP - BOTTOM;
  let y = TOP;
  let first = true;
  let repeat: HTMLCanvasElement | null = null;

  const paintBackground = () => {
    doc.setFillColor(PAGE_BG);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  };
  const draw = (canvas: HTMLCanvasElement, heightMm: number, widthMm = CONTENT_W) => {
    doc.addImage(canvas, 'JPEG', MARGIN, y, widthMm, heightMm, undefined, 'FAST');
    y += heightMm + GAP;
  };
  const newPage = (continuation: boolean) => {
    if (first) first = false;
    else doc.addPage();
    paintBackground();
    y = TOP;
    if (continuation && repeat) draw(repeat, (repeat.height / PIXEL_RATIO) * mmPerPx);
  };
  const ensureRoom = (heightMm: number) => {
    if (y + heightMm > PAGE_H - BOTTOM) newPage(true);
  };

  for (const section of root.querySelectorAll<HTMLElement>('[data-pdf-section]')) {
    repeat = null;
    newPage(false);
    for (const block of section.querySelectorAll<HTMLElement>('[data-pdf-block]')) {
      if (block.hasAttribute('data-pdf-table')) {
        await placeTable(block);
        continue;
      }
      const canvas = await capture(block);
      let h = (canvas.height / PIXEL_RATIO) * mmPerPx;
      let w = CONTENT_W;
      if (h > usable) {
        // Taller than a page: shrink it to fit rather than cut it.
        w *= usable / h;
        h = usable;
      }
      ensureRoom(h);
      draw(canvas, h, w);
      if (block.hasAttribute('data-pdf-repeat')) repeat = canvas;
    }
  }

  /** Captures the table one page-sized run of rows at a time, hiding the other rows. */
  async function placeTable(block: HTMLElement) {
    const rows = [...block.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    const head = block.querySelector('thead');
    const headMm = (head?.getBoundingClientRect().height ?? 0) * mmPerPx;
    const rowMm = rows.map((r) => r.getBoundingClientRect().height * mmPerPx);
    const extraMm = block.getBoundingClientRect().height * mmPerPx - headMm - rowMm.reduce((a, b) => a + b, 0);

    let start = 0;
    while (start < rows.length) {
      // Start a new page if not even the header and one row fit here.
      if (y + headMm + rowMm[start] + extraMm > PAGE_H - BOTTOM) newPage(true);
      let end = start;
      let height = headMm + extraMm;
      while (end < rows.length && (end === start || y + height + rowMm[end] <= PAGE_H - BOTTOM)) {
        height += rowMm[end];
        end++;
      }
      rows.forEach((r, i) => { r.style.display = i >= start && i < end ? '' : 'none'; });
      const canvas = await capture(block);
      draw(canvas, Math.min((canvas.height / PIXEL_RATIO) * mmPerPx, usable));
      start = end;
    }
    rows.forEach((r) => { r.style.display = ''; });
  }

  // Page numbers and footer, once the page count is known.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const label = `Page ${p} of ${pages}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const tabW = doc.getTextWidth(label) + 8;
    doc.setFillColor(ACCENT);
    doc.roundedRect(PAGE_W - MARGIN - tabW, 3, tabW, 7, 1.2, 1.2, 'F');
    doc.setTextColor('#FFFFFF');
    doc.text(label, PAGE_W - MARGIN - tabW / 2, 7.6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor('#6B778C');
    doc.text(opts.footer, MARGIN, PAGE_H - 5);
  }

  doc.save(opts.filename);
}
