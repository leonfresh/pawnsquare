"use client";

export function CoinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <ellipse
        cx="12"
        cy="8"
        rx="7"
        ry="3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.95"
      />
      <path
        d="M5 8v8c0 1.77 3.13 3.2 7 3.2s7-1.43 7-3.2V8"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.95"
      />
      <path
        d="M5 12c0 1.77 3.13 3.2 7 3.2s7-1.43 7-3.2"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.55"
      />
      <path
        d="M5 16c0 1.77 3.13 3.2 7 3.2s7-1.43 7-3.2"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.35"
      />
    </svg>
  );
}
