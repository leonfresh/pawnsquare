import { NextResponse, type NextRequest } from "next/server";
import {
  getSupabaseAdminClient,
  getSupabaseUserFromRequest,
} from "@/lib/supabaseServer";

type QuestPeriod = "daily" | "weekly";

function toIsoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekUtcMonday(d: Date): Date {
  const utcDay = d.getUTCDay(); // 0=Sun
  const daysSinceMonday = (utcDay + 6) % 7;
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

function periodStartUtcIso(period: QuestPeriod, now: Date): string {
  if (period === "daily") return toIsoDateUTC(now);
  return toIsoDateUTC(startOfWeekUtcMonday(now));
}

export async function POST(req: NextRequest) {
  const user = await getSupabaseUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const questId =
    typeof (body as any)?.questId === "string" ? (body as any).questId : null;
  if (!questId) {
    return NextResponse.json({ error: "missing_questId" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const now = new Date();
  const dailyStart = periodStartUtcIso("daily", now);
  const weeklyStart = periodStartUtcIso("weekly", now);

  const { data: assignments, error: assignErr } = await supabaseAdmin
    .from("quest_assignments")
    .select("period_start")
    .eq("user_id", user.id)
    .eq("quest_id", questId)
    .in("period_start", [dailyStart, weeklyStart])
    .limit(1);

  if (assignErr) {
    return NextResponse.json(
      { error: "assignment_load_failed", detail: assignErr.message },
      { status: 500 }
    );
  }
  const periodStart = assignments?.[0]?.period_start
    ? String(assignments[0].period_start)
    : null;
  if (!periodStart) {
    return NextResponse.json({ error: "unknown_quest" }, { status: 400 });
  }

  const { data: newCoins, error } = await supabaseAdmin.rpc("claim_quest", {
    p_user_id: user.id,
    p_quest_id: questId,
    p_period_start: periodStart,
  });

  if (error) {
    const msg = String((error as any)?.message ?? "").toLowerCase();
    const code = (error as any)?.code;
    if (code === "23505" || msg.includes("duplicate key")) {
      return NextResponse.json(
        { ok: false, error: "already_claimed" },
        { status: 409 }
      );
    }
    if (msg.includes("not complete")) {
      return NextResponse.json(
        { ok: false, error: "not_complete" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "claim_failed", detail: (error as any)?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, questId, newCoins });
}
