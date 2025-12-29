import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { getSupabaseUserFromRequest } from "@/lib/supabaseServer";

const COIN_PACKS = {
  p80: { coins: 80, amountCents: 100, label: "80 Coins" },
  p450: { coins: 450, amountCents: 500, label: "450 Coins" },
  p1000: { coins: 1000, amountCents: 1000, label: "1000 Coins" },
} as const;

type PackId = keyof typeof COIN_PACKS;

export async function POST(req: Request) {
  const stripe = getStripe();

  const user = await getSupabaseUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized (sign in required)" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { packId?: string; roomId?: string; playerId?: string }
    | null;

  const packId = (body?.packId ?? "") as PackId;
  const roomId = body?.roomId ?? "";
  const playerId = body?.playerId ?? "";

  if (!packId || !(packId in COIN_PACKS)) {
    return NextResponse.json({ error: "Invalid packId" }, { status: 400 });
  }
  if (!roomId) {
    return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
  }
  // playerId is optional: purchases are credited to the signed-in Supabase user.

  const pack = COIN_PACKS[packId];

  const priceIdByPack: Partial<Record<PackId, string>> = {
    p80: process.env.STRIPE_PRICE_P80,
    p450: process.env.STRIPE_PRICE_P450,
    p1000: process.env.STRIPE_PRICE_P1000,
  };
  const catalogPriceId = (priceIdByPack[packId] ?? "").trim();

  const h = await headers();
  const origin = h.get("origin") ?? "";
  if (!origin) {
    return NextResponse.json({ error: "Missing origin" }, { status: 400 });
  }

  const successUrl = `${origin}/room/${encodeURIComponent(roomId)}?stripe_session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/room/${encodeURIComponent(roomId)}`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    line_items: [
      catalogPriceId
        ? {
            quantity: 1,
            price: catalogPriceId,
          }
        : {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: pack.amountCents,
              product_data: {
                name: `PawnSquare ${pack.label}`,
              },
            },
          },
    ],
    metadata: {
      packId,
      coins: String(pack.coins),
      playerId,
      roomId,
      userId: user.id,
    },
  });

  return NextResponse.json({ url: session.url });
}
