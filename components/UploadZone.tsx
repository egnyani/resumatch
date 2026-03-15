"use client";

import { useRef, useState } from "react";
import { FileText, UploadCloud } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UploadedFile } from "@/types";

type UploadZoneProps = {
  onUpload: (file: File) => Promise<void>;
  uploadedFile: UploadedFile | null;
};

export function UploadZone({ onUpload, uploadedFile }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      throw new Error("Please upload a .docx resume.");
    }

    await onUpload(file);
  }

  return (
    <Card className="border-slate-200 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle>Resume Upload</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={[
            "flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed px-6 py-10 text-center transition",
            dragActive
              ? "border-amber-500 bg-amber-50"
              : "border-slate-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 hover:border-amber-400 hover:bg-amber-50/70",
          ].join(" ")}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={async (event) => {
            event.preventDefault();
            setDragActive(false);
            await handleFiles(event.dataTransfer.files);
          }}
        >
          <div className="mb-4 rounded-full bg-slate-950 p-4 text-white">
            {uploadedFile ? <FileText className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
          </div>
          <h2 className="text-xl font-semibold text-slate-950">
            {uploadedFile ? uploadedFile.name : "Drop your resume here"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            Upload a Word `.docx` resume. Resumatch reads the file, compares it against the role, and
            writes a tailored `.docx` output to Supabase storage.
          </p>
          <button
            type="button"
            className="mt-6 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Choose Resume
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={async (event) => {
              await handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
