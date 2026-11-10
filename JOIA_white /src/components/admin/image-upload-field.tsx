"use client";

import { useEffect, useId, useState } from "react";
import { ImageUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Image upload for admin forms. Images are always uploaded as files (JPG / PNG / WebP, validated
 * again on the server by size and magic bytes) — never entered as URLs.
 * Submits `<name>File` (the file) and `<name>Remove` ("on") when the current image is cleared.
 */
export function ImageUploadField({
  name,
  label,
  currentUrl,
  hint = "JPG, PNG or WebP · up to 8 MB",
  aspect = "aspect-[16/9]",
  className,
  disabled,
}: {
  name: string;
  label: string;
  currentUrl?: string | null;
  hint?: string;
  aspect?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview ?? (removed ? null : currentUrl);

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-[0.16em] text-black/60">
        {label}
      </label>
      <div className={cn("relative overflow-hidden rounded-xl border border-dashed border-black/20 bg-black/[0.02]", aspect)}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview / authorised upload
          <img src={shown} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center text-xs text-black/45">
            <span>
              <ImageUp className="mx-auto mb-1.5 size-6" aria-hidden />
              No image
            </span>
          </div>
        )}
        {shown && !disabled && (
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setRemoved(true);
              setInputKey((k) => k + 1);
            }}
            className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            aria-label="Remove image"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <input
        key={inputKey}
        id={id}
        type="file"
        name={`${name}File`}
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          setPreview(f ? URL.createObjectURL(f) : null);
          if (f) setRemoved(false);
        }}
        className="block w-full text-xs text-black/60 file:mr-3 file:rounded-full file:border file:border-black/15 file:bg-white file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-black/5"
        aria-describedby={`${id}-hint`}
      />
      {removed && !preview && <input type="hidden" name={`${name}Remove`} value="on" />}
      <p id={`${id}-hint`} className="text-xs text-black/50">
        {hint}
      </p>
    </div>
  );
}
