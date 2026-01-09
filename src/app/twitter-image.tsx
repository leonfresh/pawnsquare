import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 600,
};

export const contentType = "image/png";

export default function TwitterImage() {
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
        <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05 }}>
          PawnSquare
        </div>
        <div style={{ marginTop: 18, fontSize: 28, opacity: 0.9 }}>
          Frictionless multiplayer in your browser
        </div>
      </div>
    ),
    size
  );
}
