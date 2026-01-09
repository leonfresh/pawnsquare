import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 64,
          background: "#000",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.05 }}>
          PawnSquare
        </div>
        <div style={{ marginTop: 18, fontSize: 30, opacity: 0.9 }}>
          Chess variants in a chill browser world
        </div>
        <div style={{ marginTop: 26, fontSize: 22, opacity: 0.75 }}>
          Chess • 4‑Player Chess • Goose Chess • Checkers
        </div>
      </div>
    ),
    size
  );
}
