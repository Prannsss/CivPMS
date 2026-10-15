import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_MESSAGES,
  AvatarUploadError,
  MEDIA_MAX_BYTES,
  STORAGE_MAX_BYTES,
  centerSquare,
  chooseUploadPath,
  interpretMediaResponse,
  ownAvatarPath,
  retryAfterText,
  uploadAvatar,
  validateAvatarFile,
  type AvatarUploadDeps,
} from "./avatar-upload";

const SUPABASE = "https://ref.supabase.co";
const UID = "11111111-2222-3333-4444-555555555555";
const STORED = { url: `${SUPABASE}/storage/v1/object/public/avatars/${UID}/a.webp`, path: `${UID}/a.webp` };

function photo(type = "image/jpeg", size = 1000, name = "me.jpg"): File {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function deps(overrides: Partial<AvatarUploadDeps> = {}): AvatarUploadDeps {
  return {
    mediaApiUrl: "https://media.example.test",
    getAccessToken: async () => "token-123",
    fetch: vi.fn(async () => json(201, { url: "https://cdn.example.test/a.webp", path: `${UID}/b.webp`, width: 256, height: 256 })),
    resize: vi.fn(async () => new Blob([new Uint8Array(10)], { type: "image/webp" })),
    uploadToStorage: vi.fn(async () => STORED),
    ...overrides,
  };
}

describe("validateAvatarFile", () => {
  it("accepts the photo types the media service takes", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]) {
      expect(validateAvatarFile(photo(type))).toBeNull();
    }
    expect(validateAvatarFile(photo("", 10, "IMG_0001.HEIC"))).toBeNull();
  });

  it("rejects other files, empty files and files over 15 MB", () => {
    expect(validateAvatarFile(photo("application/pdf", 10, "plan.pdf"))?.code).toBe("UNSUPPORTED_TYPE");
    expect(validateAvatarFile(photo("image/svg+xml", 10, "logo.svg"))?.code).toBe("UNSUPPORTED_TYPE");
    expect(validateAvatarFile(photo("image/png", 0))?.code).toBe("UNREADABLE");
    expect(validateAvatarFile(photo("image/png", MEDIA_MAX_BYTES + 1))?.code).toBe("TOO_LARGE");
    expect(validateAvatarFile(photo("image/png", MEDIA_MAX_BYTES))).toBeNull();
  });
});

describe("chooseUploadPath", () => {
  it("uses the media service only when its URL is configured", () => {
    expect(chooseUploadPath("https://media.example.test")).toBe("media");
    expect(chooseUploadPath(null)).toBe("storage");
    expect(chooseUploadPath("")).toBe("storage");
    expect(chooseUploadPath(undefined)).toBe("storage");
  });
});

describe("interpretMediaResponse", () => {
  it("returns the stored URL on success", () => {
    expect(interpretMediaResponse(201, { url: "https://x.test/a.webp", path: "u/a.webp" })).toEqual({
      ok: true,
      url: "https://x.test/a.webp",
      path: "u/a.webp",
    });
    expect(interpretMediaResponse(200, { url: "https://x.test/a.webp" })).toEqual({ ok: true, url: "https://x.test/a.webp", path: null });
  });

  it("falls back on 5xx and malformed success bodies", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(interpretMediaResponse(status, { error: { code: "UPSTREAM_UNAVAILABLE" } })).toEqual({ ok: false, fallback: true });
    }
    expect(interpretMediaResponse(201, { path: "x" })).toEqual({ ok: false, fallback: true });
    expect(interpretMediaResponse(201, { url: "javascript:alert(1)" })).toEqual({ ok: false, fallback: true });
  });

  it("maps client errors to plain-language messages without falling back", () => {
    const cases: [number, unknown, string][] = [
      [401, { error: { code: "UNAUTHENTICATED" } }, "UNAUTHENTICATED"],
      [413, { error: { code: "PAYLOAD_TOO_LARGE" } }, "TOO_LARGE"],
      [415, { error: { code: "UNSUPPORTED_MEDIA_TYPE" } }, "UNSUPPORTED_TYPE"],
      [422, { error: { code: "IMAGE_TOO_LARGE" } }, "TOO_LARGE"],
      [422, { error: { code: "VALIDATION" } }, "UNREADABLE"],
      [429, { error: { code: "RATE_LIMITED" } }, "RATE_LIMITED"],
      [400, null, "UPLOAD_FAILED"],
    ];
    for (const [status, body, code] of cases) {
      const outcome = interpretMediaResponse(status, body, status === 429 ? "30" : null);
      expect(outcome.ok).toBe(false);
      if (outcome.ok || outcome.fallback) throw new Error("expected a final error");
      expect(outcome.error.code).toBe(code);
      expect(outcome.error.message).not.toMatch(/IMAGE_TOO_LARGE|VALIDATION|request_id/);
    }
    const limited = interpretMediaResponse(429, null, "30");
    if (limited.ok || limited.fallback) throw new Error("expected a final error");
    expect(limited.error.message).toBe("Too many uploads in a row. Try again in 30 seconds.");
  });
});

describe("retryAfterText", () => {
  it("reads seconds and HTTP dates", () => {
    expect(retryAfterText("1")).toBe("Try again in 1 second.");
    expect(retryAfterText("90")).toBe("Try again in 2 minutes.");
    expect(retryAfterText(new Date(1_000_000 + 45_000).toUTCString(), 1_000_000)).toBe("Try again in 45 seconds.");
    expect(retryAfterText(null)).toBe("Wait a moment and try again.");
    expect(retryAfterText("soon")).toBe("Wait a moment and try again.");
    expect(retryAfterText("0")).toBe("Wait a moment and try again.");
  });
});

describe("uploadAvatar", () => {
  it("uploads through the media service with the bearer token and the raw file", async () => {
    const d = deps();
    const file = photo("image/heic", 5_000_000, "IMG_1.HEIC");
    const result = await uploadAvatar(file, d);
    expect(result).toEqual({ url: "https://cdn.example.test/a.webp", path: `${UID}/b.webp`, via: "media" });
    const [url, init] = vi.mocked(d.fetch).mock.calls[0];
    expect(url).toBe("https://media.example.test/v1/media/avatar");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer token-123" });
    expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
    expect(d.resize).not.toHaveBeenCalled();
    expect(d.uploadToStorage).not.toHaveBeenCalled();
  });

  it("falls back to the browser path on a network error or 503", async () => {
    for (const failing of [
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      vi.fn(async () => json(503, { error: { code: "BUSY", message: "busy", request_id: "r1" } })),
    ]) {
      const d = deps({ fetch: failing as unknown as typeof fetch });
      const result = await uploadAvatar(photo(), d);
      expect(result).toEqual({ ...STORED, via: "storage" });
      expect(d.resize).toHaveBeenCalledOnce();
    }
  });

  it("does not fall back on a final media error", async () => {
    const d = deps({ fetch: vi.fn(async () => json(415, { error: { code: "UNSUPPORTED_MEDIA_TYPE" } })) as unknown as typeof fetch });
    await expect(uploadAvatar(photo(), d)).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(d.uploadToStorage).not.toHaveBeenCalled();
  });

  it("asks to sign in again when there is no session", async () => {
    const d = deps({ getAccessToken: async () => null });
    await expect(uploadAvatar(photo(), d)).rejects.toMatchObject({ code: "UNAUTHENTICATED", message: AVATAR_MESSAGES.UNAUTHENTICATED });
  });

  it("uses the browser path when no media URL is set", async () => {
    const d = deps({ mediaApiUrl: null });
    expect(await uploadAvatar(photo("image/png"), d)).toEqual({ ...STORED, via: "storage" });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("explains HEIC and decode failures on the browser path", async () => {
    const d = deps({ mediaApiUrl: null, resize: vi.fn(async () => Promise.reject(new Error("decode"))) });
    await expect(uploadAvatar(photo("image/heic", 10, "a.heic"), d)).rejects.toThrow(/can't read HEIC/);
    await expect(uploadAvatar(photo("image/png"), d)).rejects.toMatchObject({ code: "UNREADABLE" });
  });

  it("refuses resized images over the bucket limit and maps storage failures", async () => {
    const big = deps({ mediaApiUrl: null, resize: vi.fn(async () => new Blob([new Uint8Array(STORAGE_MAX_BYTES + 1)])) });
    await expect(uploadAvatar(photo(), big)).rejects.toMatchObject({ code: "TOO_LARGE" });
    const broken = deps({ mediaApiUrl: null, uploadToStorage: vi.fn(async () => Promise.reject(new Error("row-level security"))) });
    const error = await uploadAvatar(photo(), broken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarUploadError);
    expect((error as AvatarUploadError).message).toBe(AVATAR_MESSAGES.UPLOAD_FAILED);
  });

  it("validates before any network call", async () => {
    const d = deps();
    await expect(uploadAvatar(photo("text/plain", 10, "a.txt"), d)).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe("ownAvatarPath", () => {
  it("only returns paths inside the user's own folder of the avatars bucket", () => {
    expect(ownAvatarPath(STORED.url, SUPABASE, UID)).toBe(`${UID}/a.webp`);
    expect(ownAvatarPath(`${STORED.url}?v=2`, `${SUPABASE}/`, UID)).toBe(`${UID}/a.webp`);
    expect(ownAvatarPath(`${SUPABASE}/storage/v1/object/public/avatars/other/a.webp`, SUPABASE, UID)).toBeNull();
    expect(ownAvatarPath(`${SUPABASE}/storage/v1/object/public/avatars/${UID}/../x.webp`, SUPABASE, UID)).toBeNull();
    expect(ownAvatarPath("https://lh3.googleusercontent.com/a/photo", SUPABASE, UID)).toBeNull();
    expect(ownAvatarPath(null, SUPABASE, UID)).toBeNull();
  });
});

describe("centerSquare", () => {
  it("crops the middle of landscape and portrait images", () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
    expect(centerSquare(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 });
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 });
  });
});
