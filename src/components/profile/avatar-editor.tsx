"use client";

import { useRef, useState } from "react";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";
import { setAvatar } from "@/server/actions/profile";
import { deleteOldPhoto, uploadProfilePhoto } from "./avatar-image";
import { AVATAR_ACCEPT, AvatarUploadError } from "./avatar-upload";

const UNDO_WINDOW_MS = 8_000;

/** Profile photo: upload (media service or browser resize), replace and remove with Undo. */
export function AvatarEditor({ userId, name, initialUrl }: { userId: string; name: string; initialUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    const previous = url;
    try {
      const uploaded = await uploadProfilePhoto(file, userId);
      const saved = await setAvatar({ avatarUrl: uploaded.url });
      if (!saved.ok) {
        // Don't leave the new file behind when the profile refused it.
        await deleteOldPhoto(uploaded.url, userId);
        toast.error("Your photo couldn't be saved", { description: saved.error.message });
        return;
      }
      setUrl(saved.data.avatarUrl);
      if (previous && previous !== saved.data.avatarUrl) void deleteOldPhoto(previous, userId);
      toast.success(previous ? "Photo updated" : "Photo added", { description: "Your teammates will see it next to your name." });
    } catch (error) {
      const message = error instanceof AvatarUploadError ? error.message : "Your photo couldn't be uploaded. Try again.";
      toast.error("Photo not uploaded", { description: message });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onRemove() {
    const previous = url;
    if (!previous) return;
    setBusy("remove");
    const result = await setAvatar({ avatarUrl: null });
    setBusy(null);
    if (!result.ok) {
      toast.error("Your photo couldn't be removed", { description: result.error.message });
      return;
    }
    setUrl(null);
    let undone = false;
    const cleanup = window.setTimeout(() => {
      if (!undone) void deleteOldPhoto(previous, userId);
    }, UNDO_WINDOW_MS + 500);
    toast.undo(
      "Photo removed",
      async () => {
        undone = true;
        window.clearTimeout(cleanup);
        const restored = await setAvatar({ avatarUrl: previous });
        if (restored.ok) {
          setUrl(restored.data.avatarUrl);
          toast.success("Photo restored");
        } else {
          toast.error("Couldn't restore your photo", { description: restored.error.message });
        }
      },
      { description: "Your initials show instead.", duration: UNDO_WINDOW_MS },
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy !== null}
        className="group relative size-20 shrink-0 self-start rounded-full focus-ring disabled:cursor-progress sm:self-center"
        aria-label={url ? "Change profile photo" : "Add profile photo"}
      >
        <Avatar name={name || "?"} src={url} size="xl" className="size-20 text-2xl" />
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Camera className="size-5" />
        </span>
        {busy ? (
          <span aria-hidden className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white">
            <Spinner size="md" label={null} />
          </span>
        ) : null}
      </button>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm leading-6 font-medium text-foreground">Profile photo</span>
          <span className="text-[13px] leading-5 text-muted-foreground">
            JPG, PNG, WebP, GIF or HEIC up to 15 MB. We crop it to a square.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="max-sm:h-11"
            onClick={() => inputRef.current?.click()}
            loading={busy === "upload"}
            loadingText="Uploading…"
            disabled={busy !== null}
          >
            <ImageUp aria-hidden />
            {url ? "Change photo" : "Upload photo"}
          </Button>
          {url ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger-text hover:bg-danger-soft hover:text-danger-text max-sm:h-11"
              onClick={onRemove}
              loading={busy === "remove"}
              disabled={busy !== null}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="avatar-file-input"
        onChange={(event) => void onFile(event.target.files?.[0])}
      />
    </div>
  );
}
