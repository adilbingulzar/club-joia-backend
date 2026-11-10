"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, CheckCircle2, Flashlight, ImageUp, Keyboard, ScanLine, ShieldAlert, Star, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/joia/member-avatar";
import { TierBadge } from "@/components/joia/badges";
import { SCAN_RESULT_LABELS } from "@/domain/access";
import { scanColors } from "@/styles/design-tokens";
import { cn } from "@/lib/utils";
import type { ActionError } from "@/lib/errors";
import type { ScanOutcome } from "@/services/qr.service";
import { checkInAction, denyAction, scanAction } from "@/app/staff/actions";

type Zone = { id: string; name: string; eventName: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

const ZONE_KEY = "joia-scanner-zone"; // device preference only — no member data

/** Decode a QR code from an image (photo fallback). Downscales large phone photos first. */
async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" })?.data ?? null;
  } finally {
    bitmap.close();
  }
}

/** Live camera access needs a secure context (https or localhost) on every mobile browser. */
function liveCameraSupport(): "ok" | "insecure" | "unsupported" {
  if (typeof window === "undefined") return "ok";
  if (!window.isSecureContext) return "insecure";
  return typeof navigator.mediaDevices?.getUserMedia === "function" ? "ok" : "unsupported";
}

function readZone(zones: Zone[]) {
  try {
    const saved = window.localStorage.getItem(ZONE_KEY);
    return zones.find((z) => z.id === saved)?.id ?? zones[0].id;
  } catch {
    return zones[0].id;
  }
}

export function Scanner({ zones, checkedInToday }: { zones: Zone[]; checkedInToday: number }) {
  const [zoneId, setZoneId] = useState(zones[0].id);
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [admitted, setAdmitted] = useState(checkedInToday);
  const [pending, start] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busy = useRef(false);
  const lastToken = useRef<{ value: string; at: number } | null>(null);

  useEffect(() => {
    // Restore this device's checkpoint after mount (localStorage is browser-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoneId(readZone(zones));
  }, [zones]);

  const submit = useCallback(
    (input: { token?: string; ticketNumber?: string }) => {
      busy.current = true;
      setError(null);
      start(async () => {
        const res = await scanAction({ ...input, zoneId, deviceInfo: navigator.userAgent.slice(0, 200) });
        if (res.ok) {
          setOutcome(res.data);
          setShowAccess(false);
          navigator.vibrate?.(res.data.severity === "success" ? 60 : [80, 60, 80]);
        } else {
          setError(res.error);
          busy.current = false;
        }
      });
    },
    [zoneId],
  );

  // Camera loop: native BarcodeDetector where available, jsQR fallback elsewhere (e.g. iOS Safari).
  useEffect(() => {
    if (mode !== "camera" || outcome) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !busy.current) {
        let text: string | null = null;
        try {
          if (detector) {
            text = (await detector.detect(video))[0]?.rawValue ?? null;
          } else {
            const canvas = canvasRef.current!;
            const w = (canvas.width = Math.min(video.videoWidth, 720));
            const h = (canvas.height = Math.round((video.videoHeight / video.videoWidth) * w));
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0, w, h);
            text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
        } catch {
          /* frame not ready */
        }
        const recent = lastToken.current && lastToken.current.value === text && Date.now() - lastToken.current.at < 4000;
        if (text && !recent) {
          lastToken.current = { value: text, at: Date.now() };
          submit({ token: text });
        }
      }
      raf = window.setTimeout(tick, detector ? 120 : 220) as unknown as number;
    }

    (async () => {
      const support = liveCameraSupport();
      if (support !== "ok") {
        setCameraError(
          support === "insecure"
            ? "The live camera only works over a secure (https) connection. Use “Photo of QR” below, or open the scanner via its https address."
            : "This browser can’t open a live camera. Use “Photo of QR” below or manual lookup.",
        );
        return;
      }
      try {
        try {
          // Rear camera on phones; ideal (not exact) so laptops and single-camera devices still work.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        } catch (e) {
          if ((e as DOMException)?.name !== "OverconstrainedError") throw e;
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        // iOS Safari only renders camera streams inline when these are set as attributes before play().
        video.muted = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("muted", "");
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch({ available: Boolean(caps.torch), on: false });
        setCameraError(null);
        tick();
      } catch (e) {
        const name = (e as DOMException)?.name;
        setCameraError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access for this site in the browser settings, or use “Photo of QR” / manual lookup."
            : name === "NotReadableError"
              ? "The camera is in use by another app. Close it and try again, or use “Photo of QR”."
              : "No camera available. Use “Photo of QR” or manual ticket lookup.",
        );
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(raf);
      trackRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, outcome, submit]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ available: true, on });
    } catch {
      setTorch({ available: false, on: false });
    }
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const text = await decodeQrFromFile(file);
      if (text) submit({ token: text });
      else setError({ code: "VALIDATION", message: "No QR code found in that photo. Hold the phone closer so the code fills most of the frame, and try again." });
    } catch {
      setError({ code: "VALIDATION", message: "That photo couldn’t be read. Try again or use manual lookup." });
    } finally {
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  function reset() {
    setOutcome(null);
    setError(null);
    busy.current = false;
  }

  function doCheckIn() {
    if (!outcome) return;
    start(async () => {
      const res = await checkInAction(outcome.scanLogId);
      if (res.ok) {
        setOutcome(res.data);
        if (res.data.result === "VALID") {
          setAdmitted((n) => n + 1);
          navigator.vibrate?.(120);
        }
      } else setError(res.error);
    });
  }

  function doDeny() {
    if (!outcome) return;
    start(async () => {
      await denyAction({ scanLogId: outcome.scanLogId });
      reset();
    });
  }

  const zone = zones.find((z) => z.id === zoneId)!;

  if (outcome) return <ResultView outcome={outcome} pending={pending} error={error} showAccess={showAccess} onToggleAccess={() => setShowAccess((s) => !s)} onCheckIn={doCheckIn} onDeny={doDeny} onNext={reset} />;

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <label className="flex-1">
          <span className="eyebrow mb-1.5 block">Checkpoint</span>
          <select
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value);
              try {
                window.localStorage.setItem(ZONE_KEY, e.target.value);
              } catch {}
            }}
            className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-pearl"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} — {z.eventName}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl border border-line px-3 py-2 text-center">
          <p className="font-display text-2xl leading-none tabular-nums">{admitted}</p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-pearl-dim">Today</p>
        </div>
      </div>

      <div role="tablist" className="grid grid-cols-2 gap-2">
        {(["camera", "manual"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn("flex h-11 items-center justify-center gap-2 rounded-xl border text-xs uppercase tracking-[0.16em]", mode === m ? "border-pearl bg-pearl text-ink" : "border-line text-pearl-muted")}
          >
            {m === "camera" ? <Camera className="size-4" aria-hidden /> : <Keyboard className="size-4" aria-hidden />}
            {m === "camera" ? "Scan QR" : "Ticket number"}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-ruby/40 bg-ruby/10 px-4 py-3 text-sm">
          {error.message}
        </p>
      )}

      {mode === "camera" ? (
        <div className="on-dark relative aspect-[3/4] overflow-hidden rounded-3xl border border-line bg-black text-pearl">
          <video ref={videoRef} playsInline muted autoPlay className="size-full object-cover" aria-label={`Camera viewfinder for ${zone.name}`} />
          <canvas ref={canvasRef} className="hidden" />
          {!cameraError && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
              <div className="relative size-60 rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                <ScanLine className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white/40" />
              </div>
            </div>
          )}
          {cameraError && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div>
                <CameraOff className="mx-auto size-8 text-pearl-muted" aria-hidden />
                <p className="mt-3 text-sm text-pearl-muted">{cameraError}</p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => setMode("manual")}>
                  Manual lookup
                </Button>
              </div>
            </div>
          )}
          {torch.available && !cameraError && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch.on}
              aria-label={torch.on ? "Turn torch off" : "Turn torch on"}
              className={cn("absolute right-3 top-3 grid size-11 place-items-center rounded-full border", torch.on ? "border-pearl bg-pearl text-ink" : "border-white/30 bg-black/50 text-white")}
            >
              <Flashlight className="size-5" aria-hidden />
            </button>
          )}
          {pending && <div className="absolute inset-x-0 bottom-0 bg-black/70 py-3 text-center text-xs uppercase tracking-[0.2em]">Validating…</div>}
        </div>
      ) : null}

      {mode === "camera" ? (
        <div>
          {/* Works on every phone, even where the live camera is unavailable: the OS camera takes a photo and it is decoded on this device. */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" id="qr-photo" onChange={(e) => onPhoto(e.target.files?.[0])} />
          <label htmlFor="qr-photo" className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line text-xs uppercase tracking-[0.16em] text-pearl-muted hover:text-pearl">
            <ImageUp className="size-4" aria-hidden /> Photo of QR
          </label>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("ticketNumber");
            if (typeof value === "string" && value.trim()) submit({ ticketNumber: value });
          }}
        >
          <label htmlFor="ticketNumber" className="eyebrow block">
            Ticket number
          </label>
          <input
            id="ticketNumber"
            name="ticketNumber"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="AD26-FRI-XXXXXX"
            className="h-14 w-full rounded-xl border border-line bg-surface px-4 font-mono text-lg uppercase tracking-[0.14em] text-pearl outline-none focus:border-ruby"
          />
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Look up
          </Button>
        </form>
      )}
    </div>
  );
}

function ResultView({
  outcome,
  pending,
  error,
  showAccess,
  onToggleAccess,
  onCheckIn,
  onDeny,
  onNext,
}: {
  outcome: ScanOutcome;
  pending: boolean;
  error: ActionError | null;
  showAccess: boolean;
  onToggleAccess: () => void;
  onCheckIn: () => void;
  onDeny: () => void;
  onNext: () => void;
}) {
  const colors = scanColors[outcome.severity];
  const Icon = outcome.severity === "success" ? CheckCircle2 : outcome.severity === "warning" ? TriangleAlert : XCircle;
  const admittedNow = outcome.result === "VALID" && !outcome.canCheckIn;
  return (
    <div className="space-y-4" aria-live="assertive">
      <section className="rounded-3xl p-6" style={{ background: colors.bg, color: colors.fg }}>
        <div className="flex items-center gap-3">
          <Icon className="size-9 shrink-0" aria-hidden />
          <div>
            <p className="text-3xl font-semibold uppercase tracking-[0.06em]">{admittedNow ? "Checked in" : SCAN_RESULT_LABELS[outcome.result]}</p>
            <p className="mt-0.5 text-sm opacity-90">{outcome.message}</p>
          </div>
        </div>
        {outcome.zone && <p className="mt-3 text-[11px] uppercase tracking-[0.2em] opacity-80">Checkpoint · {outcome.zone.name}</p>}
      </section>

      {outcome.member && outcome.ticket && (
        <section className="rounded-3xl border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <MemberAvatar firstName={outcome.member.name.split(" ")[0]} lastName={outcome.member.name.split(" ").slice(-1)[0]} photoUrl={outcome.member.photoUrl} size={84} className="rounded-2xl" />
            <div className="min-w-0">
              <p className="font-display text-3xl leading-tight">{outcome.member.name}</p>
              <p className="mt-1 font-mono text-xs tracking-[0.14em] text-pearl-muted">{outcome.member.membershipNumber}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {outcome.member.tier && <TierBadge name={outcome.member.tier} theme={outcome.member.tierTheme} />}
                {outcome.member.priority && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-warning">
                    <Star className="size-3" aria-hidden /> Priority
                  </span>
                )}
              </div>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="eyebrow">Access</dt>
              <dd className="mt-1">{outcome.ticket.typeName}</dd>
            </div>
            <div>
              <dt className="eyebrow">Event</dt>
              <dd className="mt-1">{outcome.event?.name}</dd>
            </div>
            <div>
              <dt className="eyebrow">Ticket</dt>
              <dd className="mt-1 font-mono text-xs">{outcome.ticket.ticketNumber}</dd>
            </div>
            <div>
              <dt className="eyebrow">Membership</dt>
              <dd className="mt-1 capitalize">{outcome.member.membershipStatus?.toLowerCase() ?? "—"}</dd>
            </div>
          </dl>
          {showAccess && (
            <ul className="mt-5 divide-y divide-line border-y border-line text-sm">
              {outcome.access.map((a) => {
                const ok = a.onTicket && a.entitled;
                return (
                  <li key={a.zoneId} className="flex items-center justify-between py-2.5">
                    <span>{a.name}</span>
                    <span className={cn("text-xs uppercase tracking-[0.14em]", ok ? "text-success" : "text-pearl-dim")}>
                      {ok ? (a.checkedIn ? "Allowed · entered" : "Allowed") : !a.onTicket ? "Not on ticket" : "Tier excluded"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {!outcome.member && (
        <p className="flex items-center gap-2 rounded-2xl border border-line p-4 text-sm text-pearl-muted">
          <ShieldAlert className="size-4 shrink-0" aria-hidden /> No member information is shown for unrecognised codes.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-ruby/40 bg-ruby/10 px-4 py-3 text-sm">
          {error.message}
        </p>
      )}

      <div className="grid gap-2">
        {outcome.canCheckIn && (
          <Button size="lg" className="w-full bg-[#0E7A4F] hover:bg-[#119160]" onClick={onCheckIn} loading={pending}>
            Check in
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {outcome.member && (
            <Button variant="secondary" size="lg" onClick={onToggleAccess}>
              {showAccess ? "Hide access" : "View access"}
            </Button>
          )}
          {outcome.canCheckIn ? (
            <Button variant="secondary" size="lg" onClick={onDeny} disabled={pending} className={cn(!outcome.member && "col-span-2")}>
              Deny
            </Button>
          ) : (
            <Button variant="pearl" size="lg" onClick={onNext} className={cn(!outcome.member && "col-span-2")}>
              Scan next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
