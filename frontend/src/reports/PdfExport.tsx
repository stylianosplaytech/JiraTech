import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { jsPDF } from 'jspdf';
import { Modal, errorMessage, useToast } from '../components/ui';

/** CSS width the PDF layout is rendered at; it is scaled to the 190 mm printable width of A4. */
export const PDF_WIDTH_PX = 880;

type Mode = 'preview' | 'download';

/**
 * "Preview PDF" and "Download PDF" buttons for a page. `children` is the page's PDF layout,
 * built from the `data-pdf-*` markers described in reports/pdf.ts; it is only mounted (off
 * screen, at a fixed A4-proportioned width) while a PDF is being created.
 */
export function PdfExport({ filename, footer, disabled, title, children }: {
  filename: string;
  footer: string;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [preview, setPreview] = useState<{ doc: jsPDF; url: string } | null>(null);

  useEffect(() => {
    if (!mode || !root.current || running.current) return;
    running.current = true;
    const el = root.current;
    (async () => {
      try {
        await document.fonts.ready;
        // Gadgets load their own data once mounted: wait until every query has settled.
        // Timers, not requestAnimationFrame: that one pauses while the tab is in the background.
        const deadline = Date.now() + 30000;
        await new Promise((r) => setTimeout(r, 150));
        while (queryClient.isFetching() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 100));
        // Loaded on demand: the PDF libraries are large and only needed here.
        const { buildPdf } = await import('./pdf');
        const doc = await buildPdf(el, `${footer} · generated ${new Date().toLocaleString('en-GB')}`);
        if (mode === 'download') doc.save(filename);
        else setPreview({ doc, url: URL.createObjectURL(doc.output('blob')) });
      } catch (e) {
        toast(`Could not create the PDF: ${errorMessage(e)}`, 'error');
      } finally {
        running.current = false;
        setMode(null);
      }
    })();
  }, [mode, footer, filename, queryClient, toast]);

  // Release the preview's blob when it is closed or replaced.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const busy = mode !== null;
  const label = (m: Mode, idle: string) => (mode === m ? 'Creating PDF…' : idle);

  return (
    <>
      <button type="button" className="btn btn-default" onClick={() => setMode('preview')} disabled={disabled || busy}>
        {label('preview', 'Preview PDF')}
      </button>
      <button type="button" className="btn btn-primary" onClick={() => setMode('download')} disabled={disabled || busy}>
        {label('download', 'Download PDF')}
      </button>

      {mode && (
        <div ref={root} aria-hidden="true" className="fixed top-0 bg-[#F3F6F1]" style={{ left: -20000, width: PDF_WIDTH_PX }}>
          {children}
        </div>
      )}

      {preview && (
        <Modal
          title={`${title} · PDF preview`}
          width="max-w-5xl"
          onClose={() => setPreview(null)}
          footer={(
            <>
              <button type="button" className="btn btn-subtle" onClick={() => setPreview(null)}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => preview.doc.save(filename)}>Download PDF</button>
            </>
          )}
        >
          <iframe title="PDF preview" src={`${preview.url}#view=FitH`} className="w-full h-[68vh] rounded border border-jira-border bg-jira-gray" />
          <p className="text-xs text-jira-muted mt-2">A4 portrait. Charts and tables are kept whole and moved to the next page rather than cut.</p>
        </Modal>
      )}
    </>
  );
}

/** A piece of a PDF layout that is placed whole on a page, never cut. */
export function PdfBlock({ children, className = '', repeat }: { children: ReactNode; className?: string; repeat?: boolean }) {
  return <div data-pdf-block="" data-pdf-repeat={repeat ? '' : undefined} className={className}>{children}</div>;
}

/** The green banner that opens a dashboard's PDF, repeated at the top of its continuation pages. */
export function PdfBanner({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <PdfBlock repeat className="rounded-md px-5 py-4 text-white bg-gradient-to-r from-[#1F4E3D] to-[#2E8B57]">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-white/80 mt-0.5">{subtitle}</p>}
    </PdfBlock>
  );
}
