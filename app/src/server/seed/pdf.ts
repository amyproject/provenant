// Tiny deterministic PDF writer for seeded evidence documents (one page, Helvetica, Info dict).
// Same input -> same bytes -> same sha256, which flag 3 (reused certificate) relies on.

export interface PdfSpec {
  title: string;
  author: string;
  producer: string;
  /** PDF date string, e.g. D:20260912103000Z */
  creationDate: string;
  lines: string[];
}

const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");

export function makePdf(spec: PdfSpec): Buffer {
  const content = [
    "BT",
    "/F1 15 Tf",
    "72 730 Td",
    `(${esc(spec.lines[0] ?? spec.title)}) Tj`,
    "/F1 10.5 Tf",
    ...spec.lines.slice(1).flatMap((l) => ["0 -20 Td", `(${esc(l)}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    `<< /Title (${esc(spec.title)}) /Author (${esc(spec.author)}) /Producer (${esc(spec.producer)}) /CreationDate (${esc(spec.creationDate)}) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
