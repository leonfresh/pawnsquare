import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function GET(req: Request) {
  const stripe = getStripe();

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id") || url.searchParams.get("stripe_session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { paid: false, payment_status: session.payment_status },
      { status: 200 }
    );
  }

  const coinsRaw = session.metadata?.coins ?? "0";
  const coins = Math.max(0, Number.parseInt(coinsRaw, 10) || 0);

  return NextResponse.json({
    paid: true,
    sessionId: session.id,
    coins,
    playerId: session.metadata?.playerId ?? null,
    roomId: session.metadata?.roomId ?? null,
    packId: session.metadata?.packId ?? null,
  });
}
