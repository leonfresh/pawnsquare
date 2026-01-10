import { NextResponse } from "next/server";
import { Agent } from "undici";

export const runtime = "nodejs";

const DIFFICULTIES = new Set([
  "easiest",
  "easier",
  "normal",
  "harder",
  "hardest",
]);
const COLORS = new Set(["white", "black"]);

// Some Windows/network setups cause Node/undici to hang on IPv6 attempts for lichess.org.
// Force IPv4 for this upstream call.
const lichessDispatcher = new Agent({ connect: { family: 4 } as any });

export async function GET(req: Request) {
  const url = new URL(req.url);

  const angle = (url.searchParams.get("angle") ?? "").toString();
  const difficultyRaw = (url.searchParams.get("difficulty") ?? "").toString();
  const colorRaw = (url.searchParams.get("color") ?? "").toString();

  const lichess = new URL("https://lichess.org/api/puzzle/next");

  // Match the caller-provided query as closely as possible.
  // If the caller includes `angle` (even empty), preserve it as `angle=`.
  if (url.searchParams.has("angle")) lichess.searchParams.set("angle", angle);

  // Default to "easiest" if missing/invalid.
  const difficulty = DIFFICULTIES.has(difficultyRaw)
    ? difficultyRaw
    : "easiest";
  lichess.searchParams.set("difficulty", difficulty);

  // Default to "white" if missing/invalid.
  const color = COLORS.has(colorRaw) ? colorRaw : "white";
  lichess.searchParams.set("color", color);

  try {
    const res = await fetch(lichess.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "pawnsquare/1.0",
      },
      dispatcher: lichessDispatcher,
      // Avoid caching puzzles across users/sessions.
      cache: "no-store",
    } as any);

    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type":
          res.headers.get("content-type") ?? "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Failed to reach lichess",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
