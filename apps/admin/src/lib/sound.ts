// Web Audio API and Haptic Feedback utility for fast warehouse operations

export type SoundType = 'success' | 'error' | 'warning' | 'scan';

export function playBeep(type: SoundType = 'success'): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (type === 'success' || type === 'scan') {
      // Pleasant high chime: 880Hz (A5) -> 1046.5Hz (C6)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.08);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } else if (type === 'error') {
      // Low buzz tone: 220Hz -> 180Hz (warning/not found)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(180, now + 0.22);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } else if (type === 'warning') {
      // Double short chirp: 660Hz
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(660, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.08);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(660, now + 0.1);
      gain2.gain.setValueAtTime(0.18, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc2.start(now + 0.1);
      osc2.stop(now + 0.18);
    }
  } catch {
    // AudioContext might be blocked before first user interaction
  }
}

export function triggerHaptic(type: 'success' | 'error' | 'warning' = 'success'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;

  try {
    if (type === 'success') {
      navigator.vibrate(40);
    } else if (type === 'error') {
      navigator.vibrate([80, 50, 80]);
    } else if (type === 'warning') {
      navigator.vibrate([50, 40, 50]);
    }
  } catch {
    // Ignore unsupported environments
  }
}
