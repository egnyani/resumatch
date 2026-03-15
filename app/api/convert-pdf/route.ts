import { promisify } from "util";

import libre from "libreoffice-convert";
import mammoth from "mammoth";
import { NextResponse } from "next/server";

import { launchHeadlessBrowser } from "@/lib/browser";

const libreConvert = promisify(libre.convert);

async function convertWithLibreOffice(docxBuffer: Buffer) {
  return Buffer.from(await libreConvert(docxBuffer, ".pdf", undefined));
}

async function convertWithPuppeteer(docxBuffer: Buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer });
  const browser = await launchHeadlessBrowser();

  try {
    const page = await browser.newPage();

    await page.setContent(
      `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: Arial, Helvetica, sans-serif;
              color: #111827;
              line-height: 1.45;
              font-size: 11pt;
              margin: 0;
            }
            p {
              margin: 0 0 0.75rem;
            }
            ul, ol {
              margin: 0 0 0.9rem 1.2rem;
              padding: 0;
            }
            h1, h2, h3, h4 {
              margin: 1rem 0 0.4rem;
            }
          </style>
        </head>
        <body>${html}</body>
      </html>`,
      { waitUntil: "networkidle0" }
    );

    return Buffer.from(
      await page.pdf({
        format: "Letter",
        margin: {
          top: "0.5in",
          bottom: "0.5in",
          left: "0.4in",
          right: "0.4in",
        },
      })
    );
  } finally {
    await browser.close();
  }
}

export async function POST(request: Request) {
  try {
    const { docxBase64 } = (await request.json()) as { docxBase64?: string };

    if (!docxBase64) {
      return NextResponse.json({ error: "docxBase64 is required." }, { status: 400 });
    }

    const docxBuffer = Buffer.from(docxBase64, "base64");

    try {
      const pdfBuffer = await convertWithLibreOffice(docxBuffer);
      return NextResponse.json({ pdfBase64: pdfBuffer.toString("base64") });
    } catch {
      // For best PDF fidelity beyond this fallback, consider a dedicated external
      // converter such as the Google Docs API or a DocxToPDF API if HTML-to-PDF
      // output diverges too much from the original Word layout.
      const pdfBuffer = await convertWithPuppeteer(docxBuffer);
      return NextResponse.json({ pdfBase64: pdfBuffer.toString("base64") });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to convert document." },
      { status: 500 }
    );
  }
}
