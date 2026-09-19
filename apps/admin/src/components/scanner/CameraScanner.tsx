'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, CameraOff, RefreshCw, Zap, ZapOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Supported BarcodeDetector type definition for TypeScript
declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): {
        detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>;
      };
      getSupportedFormats?(): Promise<string[]>;
    };
  }
}

interface CameraScannerProps {
  onScan: (code: string) => void;
  active?: boolean;
  cooldownMs?: number;
  showTorch?: boolean;
  showCameraSwitch?: boolean;
  className?: string;
  overlayText?: string;
}

export function CameraScanner({
  onScan,
  active = true,
  cooldownMs = 1500,
  showTorch = true,
  showCameraSwitch = true,
  className = '',
  overlayText = 'وجّه الكاميرا نحو رمز QR أو الباركود',
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchAvailable, setTorchAvailable] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [scanFlash, setScanFlash] = useState<boolean>(false);

  const lastScannedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const detectorRef = useRef<unknown>(null);

  // Play synthetic pleasant beep using Web Audio API
  const playBeep = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } catch {
      // Audio context might be restricted before interaction
    }
  }, []);

  // Trigger haptic vibration
  const triggerHaptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {
        // Ignore
      }
    }
  }, []);

  // Process detected code
  const handleDetected = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;

      const now = Date.now();
      const isSameCode = code === lastScannedRef.current.code;
      const isWithinCooldown = now - lastScannedRef.current.time < cooldownMs;

      if (isSameCode && isWithinCooldown) {
        return; // Ignore duplicate scan within cooldown
      }

      lastScannedRef.current = { code, time: now };

      // Visual flash
      setScanFlash(true);
      setTimeout(() => setScanFlash(false), 300);

      // Sound & vibration
      playBeep();
      triggerHaptic();

      // Callback
      onScan(code);
    },
    [cooldownMs, onScan, playBeep, triggerHaptic]
  );

  // Stop current camera stream
  const stopStream = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  // Initialize camera stream
  const startStream = useCallback(async () => {
    stopStream();
    setErrorMessage(null);

    if (!navigator?.mediaDevices?.getUserMedia) {
      setHasPermission(false);
      setErrorMessage('متصفحك لا يدعم الوصول المباشر إلى الكاميرا.');
      return;
    }

    try {
      // First try with preferred facingMode
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        // Fallback to basic video constraint if ideal facingMode fails
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      streamRef.current = stream;
      setHasPermission(true);

      // Check if torch/flashlight is available
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities ? (track.getCapabilities() as { torch?: boolean }) : {};
        setTorchAvailable(!!caps.torch);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari strictly requires playsInline and muted
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play();
      }
    } catch (err: unknown) {
      const error = err as Error;
      setHasPermission(false);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setErrorMessage(
          'تم رفض الإذن للوصول إلى الكاميرا. يرجى تفعيل إذن الكاميرا من إعدادات المتصفح.'
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setErrorMessage('لم يتم العثور على أي كاميرا متصلة بالجهاز.');
      } else {
        setErrorMessage(`تعذر تشغيل الكاميرا: ${error.message || 'خطأ غير معروف'}`);
      }
    }
  }, [facingMode, stopStream]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current || !torchAvailable) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && track.applyConstraints) {
      try {
        const next = !torchOn;
        await track.applyConstraints({
          advanced: [{ torch: next } as MediaTrackConstraintSet],
        });
        setTorchOn(next);
      } catch {
        // Ignore torch toggle error
      }
    }
  };

  // Toggle Front/Back Camera
  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Setup BarcodeDetector
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window && window.BarcodeDetector) {
      try {
        detectorRef.current = new window.BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'],
        });
      } catch {
        detectorRef.current = null;
      }
    }
  }, []);

  // Main Detection Loop
  useEffect(() => {
    if (!active || !hasPermission) {
      return;
    }

    let isRunning = true;

    const detectFrame = async () => {
      if (!isRunning) return;

      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Native BarcodeDetector (Supported on Android Chrome & Safari iOS 17+)
        if (detectorRef.current) {
          try {
            const detector = detectorRef.current as {
              detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
            };
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length > 0) {
              handleDetected(barcodes[0].rawValue);
            }
          } catch {
            // Ignore frame detection glitch
          }
        }
      }

      if (isRunning) {
        // Throttle scanning to ~12 FPS to maintain battery and smooth UI
        setTimeout(() => {
          animFrameRef.current = requestAnimationFrame(detectFrame);
        }, 80);
      }
    };

    animFrameRef.current = requestAnimationFrame(detectFrame);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [active, hasPermission, handleDetected]);

  // Start / Stop on mount or facingMode change
  useEffect(() => {
    if (active) {
      startStream();
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [active, facingMode, startStream, stopStream]);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`}>
      {/* Video Stream Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />

      {/* Hidden canvas for fallback processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Target Scanning Reticle Overlay */}
      {hasPermission && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
          <div
            className={`relative w-64 h-64 sm:w-72 sm:h-72 rounded-2xl border-2 transition-all duration-300 ${
              scanFlash
                ? 'border-[var(--emerald)] bg-[var(--emerald)]/20 scale-105 shadow-[0_0_25px_rgba(0,196,120,0.6)]'
                : 'border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
            }`}
          >
            {/* Corner styling */}
            <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[var(--gold)] rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[var(--gold)] rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[var(--gold)] rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[var(--gold)] rounded-br-lg" />

            {/* Scanning line animation */}
            <div className="absolute inset-x-2 top-2 bottom-2 overflow-hidden pointer-events-none">
              <div
                className="w-full h-0.5 bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent animate-pulse"
                style={{
                  boxShadow: '0 0 8px var(--gold)',
                  animation: 'scannerMove 2s ease-in-out infinite alternate',
                }}
              />
            </div>
          </div>

          <p className="mt-4 text-xs sm:text-sm font-medium text-white/90 bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm">
            {overlayText}
          </p>
        </div>
      )}

      {/* Quick Controls Bar */}
      {hasPermission && (
        <div className="absolute top-3 inset-x-3 flex items-center justify-between pointer-events-auto">
          {showTorch && torchAvailable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleTorch}
              className={`h-9 w-9 p-0 rounded-full border-none backdrop-blur-md ${
                torchOn ? 'bg-[var(--gold)] text-black' : 'bg-black/50 text-white hover:bg-black/70'
              }`}
              title="تشغيل الفلاش"
            >
              {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
            </Button>
          ) : (
            <div />
          )}

          {showCameraSwitch && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleCamera}
              className="h-9 w-9 p-0 rounded-full bg-black/50 text-white hover:bg-black/70 border-none backdrop-blur-md"
              title="تبديل الكاميرا"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {/* Permission Denied or Error State */}
      {hasPermission === false && (
        <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--crimson)]/20 text-[var(--crimson)] flex items-center justify-center mb-3">
            <CameraOff className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-white mb-2">تعذر تشغيل الكاميرا</h3>
          <p className="text-xs text-zinc-400 max-w-sm mb-4 leading-relaxed">
            {errorMessage || 'يرجى التحقق من إذن الكاميرا وتفعيله للاستمرار.'}
          </p>
          <div className="text-[11px] text-zinc-500 bg-zinc-900/80 p-3 rounded-lg border border-zinc-800 text-start max-w-xs space-y-1 mb-4">
            <div className="font-bold text-zinc-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 text-[var(--gold)]" />
              لمستخدمي iPhone و Safari:
            </div>
            <p>1. اضغط على رمز "aA" أو أيقونة الموقع في شريط العناوين بالأسفل.</p>
            <p>2. اختر "إعدادات موقع الويب" (Website Settings).</p>
            <p>3. اضبط "الكاميرا" (Camera) على "سماح" (Allow).</p>
          </div>
          <Button
            size="sm"
            onClick={() => startStream()}
            style={{ background: 'var(--gold)', color: 'var(--void)' }}
            className="font-bold"
          >
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* CSS Keyframes for scanner laser animation */}
      <style jsx>{`
        @keyframes scannerMove {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(240px);
          }
        }
      `}</style>
    </div>
  );
}
