import { useEffect, useRef } from "react";

export type KeyState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
};

export function useWASDKeys() {
  const keysRef = useRef<KeyState>({
    forward: false,
    back: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (typeof e.key !== "string") return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keysRef.current.forward = true;
      if (k === "s" || k === "arrowdown") keysRef.current.back = true;
      if (k === "a" || k === "arrowleft") keysRef.current.left = true;
      if (k === "d" || k === "arrowright") keysRef.current.right = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (typeof e.key !== "string") return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keysRef.current.forward = false;
      if (k === "s" || k === "arrowdown") keysRef.current.back = false;
      if (k === "a" || k === "arrowleft") keysRef.current.left = false;
      if (k === "d" || k === "arrowright") keysRef.current.right = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return keysRef;
}
