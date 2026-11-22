"use client";

/**
 * Browser-only pieces of the avatar upload: canvas resize and the Supabase Storage upload. The
 * decision logic and error mapping live in `avatar-upload.ts` (unit-tested).
 */
import { publicEnv, publicMediaApiUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_BUCKET,
  AVATAR_SIZE,
  STORAGE_MAX_BYTES,
  centerSquare,
  ownAvatarPath,
  uploadAvatar,
  type AvatarUploadResult,
} from "./avatar-upload";

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), type, quality);
  });
}

/** Center-crops to a square and encodes a 256 px WebP (PNG where WebP encoding is missing). */
export async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { sx, sy, size } = centerSquare(bitmap.width, bitmap.height);
    const target = Math.min(AVATAR_SIZE, size);
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, target, target);
    for (const quality of [0.9, 0.8, 0.65]) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (blob.size <= STORAGE_MAX_BYTES) return blob;
    }
    return canvasToBlob(canvas, "image/jpeg", 0.8);
  } finally {
    bitmap.close();
  }
}

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  return "webp";
}

/** Uploads the picked photo (media service or browser path) for `userId`. */
export async function uploadProfilePhoto(file: File, userId: string): Promise<AvatarUploadResult> {
  const supabase = createClient();
  return uploadAvatar(file, {
    mediaApiUrl: publicMediaApiUrl,
    getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    fetch: (input, init) => fetch(input, init),
    resize: resizeToSquare,
    uploadToStorage: async (blob) => {
      const path = `${userId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
      const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
        contentType: blob.type || "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      return { url: data.publicUrl, path };
    },
  });
}

/** Best effort: deletes a previous photo of ours from the bucket (other URLs are left alone). */
export async function deleteOldPhoto(url: string | null | undefined, userId: string): Promise<void> {
  const path = ownAvatarPath(url, publicEnv.supabaseUrl, userId);
  if (!path) return;
  try {
    await createClient().storage.from(AVATAR_BUCKET).remove([path]);
  } catch {
    // An orphaned 256 px image is harmless; never block the profile change on it.
  }
}
