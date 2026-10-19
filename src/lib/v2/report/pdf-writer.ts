import type { ReportFormat } from "./report-doc";

export type ImagePdfPage = {
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
};

type PageSize = { width: number; height: number };

const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;
const PAGE_SIZES: Record<ReportFormat, PageSize> = {
  wide: { width: 13.333 * POINTS_PER_INCH, height: 7.5 * POINTS_PER_INCH },
  a3: { width: (420 / MILLIMETERS_PER_INCH) * POINTS_PER_INCH, height: (297 / MILLIMETERS_PER_INCH) * POINTS_PER_INCH },
  a4: { width: (297 / MILLIMETERS_PER_INCH) * POINTS_PER_INCH, height: (210 / MILLIMETERS_PER_INCH) * POINTS_PER_INCH },
};

const encoder = new TextEncoder();

function ascii(value: string): Uint8Array {
  return encoder.encode(value);
}

function formatPoint(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** 쪽마다 JPEG 하나만 담는 최소 PDF 1.4를 직접 작성한다. */
export function writeImagePdf(pages: ImagePdfPage[], format: ReportFormat): Uint8Array {
  const size = PAGE_SIZES[format];
  const pageObject = (index: number) => 3 + index * 3;
  const contentObject = (index: number) => pageObject(index) + 1;
  const imageObject = (index: number) => pageObject(index) + 2;
  const objectCount = 3 + pages.length * 3;
  const chunks: Uint8Array[] = [];
  const offsets = new Array<number>(objectCount).fill(0);
  let byteOffset = 0;

  const append = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    byteOffset += chunk.byteLength;
  };
  const addObject = (number: number, body: string): void => {
    offsets[number] = byteOffset;
    append(ascii(`${number} 0 obj\n${body}\nendobj\n`));
  };
  const addStreamObject = (number: number, dictionary: string, data: Uint8Array): void => {
    offsets[number] = byteOffset;
    append(ascii(`${number} 0 obj\n${dictionary}\nstream\n`));
    append(data);
    append(ascii("\nendstream\nendobj\n"));
  };

  append(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  for (const [index, page] of pages.entries()) {
    const pageRef = pageObject(index);
    const contentRef = contentObject(index);
    const imageRef = imageObject(index);
    addObject(pageRef, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPoint(size.width)} ${formatPoint(size.height)}] /Resources << /XObject << /Im0 ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`);
    addStreamObject(contentRef, `<< /Length ${ascii(`q\n${formatPoint(size.width)} 0 0 ${formatPoint(size.height)} 0 0 cm\n/Im0 Do\nQ\n`).byteLength} >>`, ascii(`q\n${formatPoint(size.width)} 0 0 ${formatPoint(size.height)} 0 0 cm\n/Im0 Do\nQ\n`));
    addStreamObject(imageRef, `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>`, page.jpeg);
  }

  const xrefOffset = byteOffset;
  append(ascii(`xref\n0 ${objectCount}\n0000000000 65535 f \n`));
  for (let number = 1; number < objectCount; number += 1) {
    append(ascii(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`));
  }
  append(ascii(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return concatBytes(chunks);
}
