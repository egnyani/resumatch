import AdmZip from "adm-zip";
import { Document, Packer, Paragraph, TextRun } from "docx";
import mammoth from "mammoth";

import type { Modification, ParsedResume, Section } from "@/types";

const DOCUMENT_XML_PATH = "word/document.xml";
const SECTION_NAMES = new Set(["EXPERIENCE", "EDUCATION", "SKILLS", "PROJECTS"]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function encodeXmlEntities(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getDocumentXml(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(DOCUMENT_XML_PATH);

  if (!entry) {
    throw new Error("The .docx file is missing word/document.xml.");
  }

  return entry.getData().toString("utf8");
}

function extractParagraphTexts(xml: string) {
  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  const textNodeRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  const paragraphs: Array<{ text: string; startIndex: number; endIndex: number }> = [];

  for (const match of xml.matchAll(paragraphRegex)) {
    const paragraphXml = match[0];
    const text = normalizeText(
      [...paragraphXml.matchAll(textNodeRegex)]
        .map((textMatch) => decodeXmlEntities(textMatch[1]))
        .join("")
    );

    paragraphs.push({
      text,
      startIndex: match.index ?? 0,
      endIndex: (match.index ?? 0) + paragraphXml.length,
    });
  }

  return paragraphs;
}

type ParagraphTextNode = {
  startIndex: number;
  endIndex: number;
  text: string;
};

type ParagraphSegment = {
  startIndex: number;
  endIndex: number;
  text: string;
  textNodes: ParagraphTextNode[];
};

function extractParagraphSegments(xml: string): ParagraphSegment[] {
  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  const textNodeRegex = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
  const segments: ParagraphSegment[] = [];

  for (const paragraphMatch of xml.matchAll(paragraphRegex)) {
    const paragraphXml = paragraphMatch[0];
    const paragraphStart = paragraphMatch.index ?? 0;
    const textNodes: ParagraphTextNode[] = [];

    for (const textNodeMatch of paragraphXml.matchAll(textNodeRegex)) {
      const fullNode = textNodeMatch[0];
      const nodeStart = paragraphStart + (textNodeMatch.index ?? 0);
      const contentStart = fullNode.indexOf(">") + 1;
      const contentEnd = fullNode.lastIndexOf("</w:t>");

      textNodes.push({
        startIndex: nodeStart + contentStart,
        endIndex: nodeStart + contentEnd,
        text: decodeXmlEntities(fullNode.slice(contentStart, contentEnd)),
      });
    }

    segments.push({
      startIndex: paragraphStart,
      endIndex: paragraphStart + paragraphXml.length,
      text: textNodes.map((node) => node.text).join(""),
      textNodes,
    });
  }

  return segments;
}

function distributeTextAcrossRuns(text: string, originalTexts: string[]) {
  if (originalTexts.length === 0) {
    return [];
  }

  if (originalTexts.length === 1) {
    return [text];
  }

  const result: string[] = [];
  let cursor = 0;

  for (let index = 0; index < originalTexts.length; index += 1) {
    if (index === originalTexts.length - 1) {
      result.push(text.slice(cursor));
      break;
    }

    const length = originalTexts[index].length;
    result.push(text.slice(cursor, cursor + length));
    cursor += length;
  }

  while (result.length < originalTexts.length) {
    result.push("");
  }

  return result;
}

function applyModificationToXml(xml: string, modification: Modification) {
  const paragraphs = extractParagraphSegments(xml);
  const paragraph = paragraphs.find((item) => item.text.includes(modification.findText));

  if (!paragraph) {
    return null;
  }

  const updatedParagraphText = paragraph.text.replace(modification.findText, modification.replaceText);

  if (updatedParagraphText === paragraph.text) {
    return null;
  }

  const distributedTexts = distributeTextAcrossRuns(
    updatedParagraphText,
    paragraph.textNodes.map((node) => node.text)
  );

  let updatedXml = xml;

  for (let index = paragraph.textNodes.length - 1; index >= 0; index -= 1) {
    const node = paragraph.textNodes[index];
    updatedXml =
      updatedXml.slice(0, node.startIndex) +
      encodeXmlEntities(distributedTexts[index] || "") +
      updatedXml.slice(node.endIndex);
  }

  return updatedXml;
}

export async function parseDocx(buffer: Buffer): Promise<{ text: string; xml: string }> {
  const [{ value }, xml] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    Promise.resolve(getDocumentXml(buffer)),
  ]);

  return {
    text: value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    xml,
  };
}

export function extractSections(xml: string): Section[] {
  const paragraphs = extractParagraphTexts(xml);
  const detectedSections: Array<{ name: string; startIndex: number }> = [];

  for (const paragraph of paragraphs) {
    const normalized = paragraph.text.replace(/[:\s]+$/g, "").trim();

    if (SECTION_NAMES.has(normalized) && !detectedSections.some((section) => section.startIndex === paragraph.startIndex)) {
      detectedSections.push({
        name: normalized,
        startIndex: paragraph.startIndex,
      });
    }
  }

  return detectedSections.map((section, index) => {
    const nextSection = detectedSections[index + 1];
    const endIndex = nextSection ? nextSection.startIndex : xml.length;
    const content = xml.slice(section.startIndex, endIndex);

    return {
      name: section.name,
      startIndex: section.startIndex,
      endIndex,
      content,
    };
  });
}

export async function modifyDocx(originalBuffer: Buffer, modifications: Modification[]): Promise<Buffer> {
  const zip = new AdmZip(originalBuffer);
  const entry = zip.getEntry(DOCUMENT_XML_PATH);

  if (!entry) {
    throw new Error("The .docx file is missing word/document.xml.");
  }

  let xml = entry.getData().toString("utf8");

  for (const modification of modifications) {
    if (!modification.findText) {
      continue;
    }

    const updatedXml = applyModificationToXml(xml, modification);

    if (updatedXml) {
      xml = updatedXml;
      continue;
    }

    xml = xml.replace(new RegExp(escapeRegExp(modification.findText), "g"), modification.replaceText);
  }

  zip.updateFile(DOCUMENT_XML_PATH, Buffer.from(xml, "utf8"));
  return zip.toBuffer();
}

export function applyModificationsToText(text: string, modifications: Modification[]) {
  let updatedText = text;
  const appliedModifications: Modification[] = [];

  for (const modification of modifications) {
    if (!modification.findText || !updatedText.includes(modification.findText)) {
      continue;
    }

    updatedText = updatedText.replace(modification.findText, modification.replaceText);
    appliedModifications.push(modification);
  }

  return {
    text: updatedText,
    appliedModifications,
  };
}

export function docxToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export async function parseResume(buffer: Buffer): Promise<ParsedResume> {
  const { text, xml } = await parseDocx(buffer);

  return {
    rawText: text,
    xmlContent: xml,
    sections: extractSections(xml),
  };
}

type BuildOptions = {
  title?: string;
  sourceName?: string;
};

export async function buildDocx(text: string, options: BuildOptions = {}) {
  const lines = text.split(/\r?\n/);
  const children: Paragraph[] = [];

  if (options.title) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: options.title, bold: true, size: 32 })],
      })
    );
  }

  if (options.sourceName) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: `Source file: ${options.sourceName}`, italics: true, size: 18 })],
      })
    );
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    children.push(
      new Paragraph({
        bullet: /^[-*•]\s+/.test(trimmed) ? { level: 0 } : undefined,
        spacing: { after: 120 },
        children: [new TextRun({ text: trimmed.replace(/^[-*•]\s+/, ""), size: 22 })],
      })
    );
  }

  const document = new Document({
    sections: [{ properties: {}, children }],
  });

  return Buffer.from(await Packer.toBuffer(document));
}
