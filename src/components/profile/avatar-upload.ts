/**
 * Profile photo upload (spec §2 profile). Two paths behind one function:
 *
 * (a) `NEXT_PUBLIC_MEDIA_API_URL` set → the CivPMS media service: `POST {base}/v1/media/avatar`,
 *     `Authorization: Bearer <Supabase access token>`, multipart field `file` (the picked file as
 *     is). It answers 201 `{url, path, width, height, bytes, content_type}` after storing a
 *     256×256 WebP in the `avatars` bucket (contract: backend/README.md → "How the web app uses
 *     it"). Network failures and 5xx answers (incl. 503 BUSY / UPSTREAM_UNAVAILABLE, 504 TIMEOUT)
 *     fall back to (b); 4xx answers are shown to the user (error envelope `{error: {code, …}}`).
 * (b) Default → the browser crops to a square, resizes to 256 px WebP (≤ 2 MB) and uploads it to
 *     the `avatars` bucket under `<uid>/…` with the signed-in Supabase client.
 *
 * The caller then saves the returned URL on the profile (`update_profile`). Everything that talks
 * to the network or the canvas is injected, so the decision and error mapping are unit-tested.
 */

export const AVATAR_SIZE = 256;
/** What the media service accepts. */
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
/** The `avatars` bucket limit (fallback path). */
export const STORAGE_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_BUCKET = "avatars";

/** File picker filter: everything the media service takes (the browser path decodes most of it). */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

export type AvatarUploadPath = "media" | "storage";

export interface AvatarUploadResult {
  url: string;
  /** Object path inside the `avatars` bucket, when known. */
  path: string | null;
  via: AvatarUploadPath;
}

export type AvatarErrorCode =
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "UNREADABLE"
  | "UNAUTHENTICATED"
  | "RATE_LIMITED"
  | "UPLOAD_FAILED";

/** A failure with a plain-language message that can be shown as is. */
export class AvatarUploadError extends Error {
  readonly code: AvatarErrorCode;
  constructor(code: AvatarErrorCode, message: string) {
    super(message);
    this.name = "AvatarUploadError";
    this.code = code;
  }
}

export const AVATAR_MESSAGES: Record<AvatarErrorCode, string> = {
  UNSUPPORTED_TYPE: "That file isn't a photo we can use. Pick a JPG, PNG, WebP, GIF or HEIC image.",
  TOO_LARGE: "This photo is larger than 15 MB. Pick a smaller one or take a screenshot of it.",
  UNREADABLE: "We couldn't read this image. Try another photo, or save it as JPG or PNG first.",
  UNAUTHENTICATED: "Your session has expired. Sign in again, then upload your photo.",
  RATE_LIMITED: "Too many uploads in a row. Wait a moment and try again.",
  UPLOAD_FAILED: "Your photo couldn't be uploaded. Check your connection and try again.",
};

function isHeic(file: { type: string; name?: string }): boolean {
  if (HEIC_TYPES.has(file.type)) return true;
  return /\.(heic|heif)$/i.test(file.name ?? "");
}

/** `null` when the file can be sent, otherwise why not (checked before any upload). */
export function validateAvatarFile(file: { type: string; size: number; name?: string }): AvatarUploadError | null {
  if (!ACCEPTED_TYPES.has(file.type) && !isHeic(file)) {
    return new AvatarUploadError("UNSUPPORTED_TYPE", AVATAR_MESSAGES.UNSUPPORTED_TYPE);
  }
  if (file.size <= 0) return new AvatarUploadError("UNREADABLE", AVATAR_MESSAGES.UNREADABLE);
  if (file.size > MEDIA_MAX_BYTES) return new AvatarUploadError("TOO_LARGE", AVATAR_MESSAGES.TOO_LARGE);
  return null;
}

/** Which path to try first. */
export function chooseUploadPath(mediaApiUrl: string | null | undefined): AvatarUploadPath {
  return mediaApiUrl ? "media" : "storage";
}

export type MediaOutcome =
  | { ok: true; url: string; path: string | null }
  | { ok: false; fallback: true }
  | { ok: false; fallback: false; error: AvatarUploadError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCodeOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

/** "Try again in 30 seconds." from a Retry-After header (seconds or an HTTP date). */
export function retryAfterText(retryAfter: string | null, now: number = Date.now()): string {
  if (!retryAfter) return "Wait a moment and try again.";
  let seconds = Number(retryAfter);
  if (!Number.isFinite(seconds)) {
    const at = Date.parse(retryAfter);
    seconds = Number.isNaN(at) ? Number.NaN : Math.round((at - now) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return "Wait a moment and try again.";
  if (seconds < 60) return `Try again in ${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * Maps a media-service answer to an outcome. `fallback: true` means "use the browser path
 * instead" (5xx and malformed success bodies); everything else is final.
 */
export function interpretMediaResponse(status: number, body: unknown, retryAfter: string | null = null): MediaOutcome {
  if (status === 200 || status === 201) {
    if (isRecord(body) && typeof body.url === "string" && /^https?:\/\//.test(body.url)) {
      return { ok: true, url: body.url, path: typeof body.path === "string" ? body.path : null };
    }
    return { ok: false, fallback: true };
  }
  if (status >= 500) return { ok: false, fallback: true };

  const code = errorCodeOf(body);
  const final = (errorCode: AvatarErrorCode, message = AVATAR_MESSAGES[errorCode]): MediaOutcome => ({
    ok: false,
    fallback: false,
    error: new AvatarUploadError(errorCode, message),
  });
  switch (status) {
    case 401:
      return final("UNAUTHENTICATED");
    case 403:
      // Storage policy refused the write (FORBIDDEN): not a session problem the user can fix by waiting.
      return final("UPLOAD_FAILED", "Your photo couldn't be saved to your account. Sign out, sign in again and try once more.");
    case 413:
      return final("TOO_LARGE");
    case 415:
      return final("UNSUPPORTED_TYPE");
    case 422:
      return code === "IMAGE_TOO_LARGE"
        ? final("TOO_LARGE", "This photo's dimensions are too large. Pick a smaller image.")
        : final("UNREADABLE");
    case 429:
      return final("RATE_LIMITED", `Too many uploads in a row. ${retryAfterText(retryAfter)}`);
    default:
      return final("UPLOAD_FAILED");
  }
}

export interface AvatarUploadDeps {
  mediaApiUrl: string | null;
  /** The Supabase access token of the signed-in user, or null. */
  getAccessToken: () => Promise<string | null>;
  fetch: typeof fetch;
  /** Crop to a square and resize (browser canvas). Throws when the image can't be decoded. */
  resize: (file: File) => Promise<Blob>;
  /** Uploads to the `avatars` bucket and returns the public URL and object path. */
  uploadToStorage: (blob: Blob) => Promise<{ url: string; path: string }>;
}

async function viaMedia(file: File, deps: AvatarUploadDeps): Promise<MediaOutcome> {
  const token = await deps.getAccessToken();
  if (!token) return { ok: false, fallback: false, error: new AvatarUploadError("UNAUTHENTICATED", AVATAR_MESSAGES.UNAUTHENTICATED) };
  const form = new FormData();
  form.append("file", file, file.name || "avatar");
  let response: Response;
  try {
    response = await deps.fetch(`${deps.mediaApiUrl}/v1/media/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    return { ok: false, fallback: true };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return interpretMediaResponse(response.status, body, response.headers.get("Retry-After"));
}

async function viaStorage(file: File, deps: AvatarUploadDeps): Promise<AvatarUploadResult> {
  let blob: Blob;
  try {
    blob = await deps.resize(file);
  } catch {
    throw new AvatarUploadError(
      "UNREADABLE",
      isHeic(file)
        ? "This browser can't read HEIC photos. Save it as JPG or PNG (or take a screenshot), then upload it."
        : AVATAR_MESSAGES.UNREADABLE,
    );
  }
  if (blob.size > STORAGE_MAX_BYTES) throw new AvatarUploadError("TOO_LARGE", AVATAR_MESSAGES.TOO_LARGE);
  try {
    const stored = await deps.uploadToStorage(blob);
    return { url: stored.url, path: stored.path, via: "storage" };
  } catch (error) {
    if (error instanceof AvatarUploadError) throw error;
    throw new AvatarUploadError("UPLOAD_FAILED", AVATAR_MESSAGES.UPLOAD_FAILED);
  }
}

/** Uploads a picked photo through the media service or the browser path. Throws `AvatarUploadError`. */
export async function uploadAvatar(file: File, deps: AvatarUploadDeps): Promise<AvatarUploadResult> {
  const invalid = validateAvatarFile(file);
  if (invalid) throw invalid;
  if (chooseUploadPath(deps.mediaApiUrl) === "media") {
    const outcome = await viaMedia(file, deps);
    if (outcome.ok) return { url: outcome.url, path: outcome.path, via: "media" };
    if (!outcome.fallback) throw outcome.error;
  }
  return viaStorage(file, deps);
}

/**
 * The object path of an avatar URL in this project's public `avatars` bucket, but only inside the
 * signed-in user's own folder (`<uid>/…`) — anything else (Google photos, other folders) is null.
 */
export function ownAvatarPath(url: string | null | undefined, supabaseUrl: string, userId: string): string | null {
  if (!url) return null;
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const path = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return null;
  return path;
}

/** Center square of a `width × height` image (the crop the browser path uses). */
export function centerSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.round((width - size) / 2), sy: Math.round((height - size) / 2), size };
}
