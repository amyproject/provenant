// Minimal PDF parsing for metadata (flag 4) and text of simple, uncompressed PDFs (fixture fallback).

function pdfString(src: string, key: string): string | undefined {
  const m = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(src);
  return m ? m[1].replace(/\\([\\()])/g, "$1") : undefined;
}

export function parsePdfMetadata(bytes: Buffer): Record<string, unknown> {
  const src = bytes.toString("latin1");
  const meta: Record<string, unknown> = { byteLength: bytes.length, isPdf: src.startsWith("%PDF-") };
  const version = /^%PDF-(\d\.\d)/.exec(src);
  if (version) meta.pdfVersion = version[1];
  for (const key of ["Producer", "Creator", "Author", "Title", "CreationDate", "ModDate"]) {
    const v = pdfString(src, key);
    if (v !== undefined) meta[key[0].toLowerCase() + key.slice(1)] = v;
  }
  const template = /Template:\s*([A-Za-z0-9-]+)/.exec(extractPdfText(bytes).join("\n"));
  if (template) meta.templateId = template[1];
  return meta;
}

/** Text shown with Tj operators, in order. Works for the uncompressed PDFs we generate. */
export function extractPdfText(bytes: Buffer): string[] {
  const src = bytes.toString("latin1");
  return [...src.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([\\()])/g, "$1"));
}
