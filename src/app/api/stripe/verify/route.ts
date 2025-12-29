import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdminClient } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const stripe = getStripe();

  const url = new URL(req.url);
  const sessionId =
    url.searchParams.get("session_id") ||
    url.searchParams.get("stripe_session_id");
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
  const coinsToAdd = Math.max(0, Number.parseInt(coinsRaw, 10) || 0);
  const userId = session.client_reference_id;

  if (userId && coinsToAdd > 0) {
    const supabase = getSupabaseAdminClient();

    // Fetch current profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profile) {
      const processed = new Set((profile.processed_sessions as string[]) || []);

      if (!processed.has(session.id)) {
        // Update profile
        const newProcessed = Array.from(processed).concat(session.id);
        const newCoins = (profile.coins || 0) + coinsToAdd;

        await supabase
          .from("profiles")
          .update({
            coins: newCoins,
            processed_sessions: newProcessed,
          })
          .eq("id", userId);
      }
    }
  }

  return NextResponse.json({
    paid: true,
    sessionId: session.id,
    coins: coinsToAdd,
    playerId: session.metadata?.playerId ?? null,
    roomId: session.metadata?.roomId ?? null,
    packId: session.metadata?.packId ?? null,
  });
}
