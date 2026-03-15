import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { UploadedFile } from "@/types";

export const resumeBucket = "resumes";
export const outputBucket = "outputs";

function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  return { url, anonKey };
}

export function getBrowserSupabaseClient() {
  const { url, anonKey } = getPublicEnv();
  return createClient(url, anonKey);
}

export function getAdminSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin environment variables are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function uploadResumeToStorage(file: File): Promise<UploadedFile> {
  const supabase = getBrowserSupabaseClient();
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `uploads/${timestamp}-${sanitizedName}`;

  const { error } = await supabase.storage.from(resumeBucket).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(resumeBucket).getPublicUrl(path);

  return {
    name: file.name,
    url: data.publicUrl,
    path,
    size: file.size,
  };
}

export async function downloadStorageFile(bucket: string, path: string) {
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.storage.from(bucket).download(path);

  if (error || !data) {
    throw new Error(error?.message || "Unable to download file from Supabase storage.");
  }

  return Buffer.from(await data.arrayBuffer());
}
