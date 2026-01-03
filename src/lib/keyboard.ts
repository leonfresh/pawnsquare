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
    const isTyping = (target: EventTarget | null) => {
      const ae = (target as HTMLElement | null) ?? document.activeElement;
      if (!ae) return false;
      const tag = ae.tagName;
      const editable = (ae as HTMLElement).isContentEditable;
      return (
        editable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.repeat) return;
      if (typeof e.key !== "string") return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") keysRef.current.forward = true;
      if (k === "s" || k === "arrowdown") keysRef.current.back = true;
      if (k === "a" || k === "arrowleft") keysRef.current.left = true;
      if (k === "d" || k === "arrowright") keysRef.current.right = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
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
