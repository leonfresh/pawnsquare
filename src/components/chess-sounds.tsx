"use client";

import { useCallback, useEffect, useRef } from "react";

export function useChessSounds() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFilesRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
      }

      // Load MP3s
      const load = (key: string, path: string) => {
        const a = new Audio(path);
        a.preload = "auto";
        a.volume = 0.6;
        // Kick off fetch/metadata early to reduce first-play hitch.
        try {
          a.load();
        } catch {
          // ignore
        }
        audioFilesRef.current[key] = a;
      };
      load("move", "/sounds/Move.mp3");
      load("capture", "/sounds/Capture.mp3");
      load("correct", "/sounds/correct.mp3");
      load("wrong", "/sounds/wrong.mp3");
      // Select.mp3 doesn't exist, will use fallback synth
      // load("select", "/sounds/Select.mp3");
      load("warning", "/sounds/LowTime.mp3");
      load("honk", "/sounds/Honk.mp3");
    }
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const playTone = useCallback(
    (
      freq: number,
      type: OscillatorType,
      duration: number,
      vol: number,
      slide = 0
    ) => {
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slide !== 0) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, freq + slide),
          ctx.currentTime + duration
        );
      }

      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    },
    []
  );

  const playNoise = useCallback((duration: number, vol: number) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    // Lowpass filter to make it sound more like a thud than hiss
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1000;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
  }, []);

  const playOrFallback = useCallback((key: string, fallback: () => void) => {
    const audio = audioFilesRef.current[key];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Fallback to synth if file fails (missing or autoplay blocked)
        fallback();
      });
    } else {
      fallback();
    }
  }, []);

  const playMove = useCallback(() => {
    playOrFallback("move", () => {
      // Wood thud: low sine/triangle with quick decay + bit of noise
      playTone(150, "triangle", 0.1, 0.5, -50);
      playNoise(0.05, 0.3);
    });
  }, [playOrFallback, playTone, playNoise]);

  const playCapture = useCallback(() => {
    playOrFallback("capture", () => {
      // Sharper clack: higher pitch, two tones
      playTone(200, "square", 0.1, 0.3, -50);
      playTone(300, "triangle", 0.1, 0.3, -100);
      playNoise(0.08, 0.4);
    });
  }, [playOrFallback, playTone, playNoise]);

  const playSelect = useCallback(() => {
    playOrFallback("select", () => {
      // Soft click
      playTone(400, "sine", 0.05, 0.2);
    });
  }, [playOrFallback, playTone]);

  const playWarning = useCallback(() => {
    playOrFallback("warning", () => {
      // Clock tick / warning beep
      playTone(880, "sine", 0.15, 0.3);
      setTimeout(() => {
        playTone(660, "sine", 0.15, 0.3);
      }, 150);
    });
  }, [playOrFallback, playTone]);

  const playClick = useCallback(() => {
    // Generic UI interaction click
    playOrFallback("select", () => {
      playTone(500, "sine", 0.05, 0.15);
    });
  }, [playOrFallback, playTone]);

  const playHonk = useCallback(() => {
    playOrFallback("honk", () => {
      playTone(400, "sawtooth", 0.2, 0.5, -100);
      setTimeout(() => playTone(350, "sawtooth", 0.2, 0.5, -100), 100);
    });
  }, [playOrFallback, playTone]);

  const playCorrect = useCallback(() => {
    playOrFallback("correct", () => {
      playTone(660, "sine", 0.12, 0.25);
      setTimeout(() => playTone(880, "sine", 0.12, 0.25), 90);
    });
  }, [playOrFallback, playTone]);

  const playWrong = useCallback(() => {
    playOrFallback("wrong", () => {
      playTone(220, "square", 0.12, 0.25, -60);
      playNoise(0.06, 0.25);
    });
  }, [playOrFallback, playTone, playNoise]);

  return {
    playMove,
    playCapture,
    playSelect,
    playWarning,
    playClick,
    playHonk,
    playCorrect,
    playWrong,
  };
}
