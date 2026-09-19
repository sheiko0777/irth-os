'use client';

import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
  minChars?: number;
  maxIntervalMs?: number;
}

/**
 * Hook to listen for hardware barcode scanners (USB / Bluetooth / Handheld PDA).
 * Detects high-speed keystroke bursts (< 50ms interval) terminated with 'Enter'.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minChars = 3,
  maxIntervalMs = 50,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore modifier keys
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;

      // Allow barcode capture if not in an input, or if explicitly opted in
      const allowCapture = !isInputFocused || activeEl.getAttribute('data-barcode-capture') === 'true';

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // If keys take longer than maxIntervalMs, reset buffer (it's human typing)
      if (timeSinceLastKey > maxIntervalMs) {
        bufferRef.current = '';
      }

      if (event.key === 'Enter') {
        const candidate = bufferRef.current.trim();
        if (candidate.length >= minChars && allowCapture) {
          event.preventDefault();
          event.stopPropagation();
          onScanRef.current(candidate);
        }
        bufferRef.current = '';
        return;
      }

      // Collect single character keys
      if (event.key.length === 1 && allowCapture) {
        bufferRef.current += event.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, minChars, maxIntervalMs]);
}
