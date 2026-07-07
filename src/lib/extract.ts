import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export type ExtractedFile = { text: string; kind: string };

export async function extractText(
  filename: string,
  buffer: Buffer
): Promise<ExtractedFile> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();

  switch (ext) {
    case "pdf": {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return { text: result.text, kind: "pdf" };
      } finally {
        await parser.destroy();
      }
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, kind: "docx" };
    }
    case "md":
    case "markdown":
      return { text: buffer.toString("utf8"), kind: "md" };
    case "txt":
    case "text":
      return { text: buffer.toString("utf8"), kind: "txt" };
    default:
      throw new Error(
        `Unsupported file type ".${ext}" — supported: PDF, DOCX, TXT, MD`
      );
  }
}

/** Strip HTML tags + decode common entities (for WordPress rendered content). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
