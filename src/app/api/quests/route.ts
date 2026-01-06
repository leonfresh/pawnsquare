import { NextResponse, type NextRequest } from "next/server";
import {
  getSupabaseAdminClient,
  getSupabaseUserFromRequest,
} from "@/lib/supabaseServer";
import { createHash } from "crypto";

type QuestPeriod = "daily" | "weekly";

type QuestKind = "play_games" | "win_games" | "moves" | "goose_moves";

type QuestTemplate = {
  id: string;
  title: string;
  kind: QuestKind;
  target: number;
  rewardCoins: number;
};

const DAILY_POOL: QuestTemplate[] = [
  {
    id: "play_games_3",
    title: "Play 3 games",
    kind: "play_games",
    target: 3,
    rewardCoins: 20,
  },
  {
    id: "win_1",
    title: "Win 1 game",
    kind: "win_games",
    target: 1,
    rewardCoins: 30,
  },
  {
    id: "moves_20",
    title: "Make 20 moves",
    kind: "moves",
    target: 20,
    rewardCoins: 15,
  },
  {
    id: "try_goose_20",
    title: "Try Goose (20 moves)",
    kind: "goose_moves",
    target: 20,
    rewardCoins: 30,
  },
];

const WEEKLY_POOL: QuestTemplate[] = [
  {
    id: "play_games_10",
    title: "Play 10 games",
    kind: "play_games",
    target: 10,
    rewardCoins: 90,
  },
  {
    id: "win_3",
    title: "Win 3 games",
    kind: "win_games",
    target: 3,
    rewardCoins: 140,
  },
  {
    id: "moves_200",
    title: "Make 200 moves",
    kind: "moves",
    target: 200,
    rewardCoins: 110,
  },
  {
    id: "goose_60",
    title: "Goose: 60 moves",
    kind: "goose_moves",
    target: 60,
    rewardCoins: 140,
  },
];

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

function nextResetAt(period: QuestPeriod, now: Date): string {
  if (period === "daily") {
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    return next.toISOString();
  }
  const start = startOfWeekUtcMonday(now);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

function hashHex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function pickDeterministic(
  userId: string,
  period: QuestPeriod,
  periodStart: string,
  pool: QuestTemplate[],
  count: number
) {
  const salt = `${userId}|${period}|${periodStart}`;
  const scored = pool
    .map((q) => ({ q, h: hashHex(`${salt}|${q.id}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  return scored.slice(0, Math.min(count, scored.length)).map((s) => s.q);
}

async function ensureAssignments(opts: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdminClient>;
  userId: string;
  period: QuestPeriod;
  periodStart: string;
  pool: QuestTemplate[];
  count: number;
}) {
  const { supabaseAdmin, userId, period, periodStart, pool, count } = opts;

  const { data: existing, error } = await supabaseAdmin
    .from("quest_assignments")
    .select("quest_id")
    .eq("user_id", userId)
    .eq("period", period)
    .eq("period_start", periodStart);

  if (error) throw new Error(error.message);

  // If assignments already exist (likely created under older tuning), keep the
  // same quest_ids but sync their reward/target/title to the latest template.
  if ((existing ?? []).length > 0) {
    const byId = new Map(pool.map((q) => [q.id, q] as const));
    for (const row of existing ?? []) {
      const questId = String((row as any)?.quest_id ?? "");
      const tpl = byId.get(questId);
      if (!tpl) continue;
      const { error: updErr } = await supabaseAdmin
        .from("quest_assignments")
        .update({
          title: tpl.title,
          target: tpl.target,
          reward_coins: tpl.rewardCoins,
          meta: { kind: tpl.kind },
        })
        .eq("user_id", userId)
        .eq("quest_id", questId)
        .eq("period_start", periodStart);
      if (updErr) throw new Error(updErr.message);
    }
    return;
  }

  const chosen = pickDeterministic(userId, period, periodStart, pool, count);
  if (chosen.length === 0) return;

  const rows = chosen.map((q) => ({
    user_id: userId,
    quest_id: q.id,
    period,
    period_start: periodStart,
    title: q.title,
    target: q.target,
    reward_coins: q.rewardCoins,
    meta: { kind: q.kind },
  }));

  const { error: insertErr } = await supabaseAdmin
    .from("quest_assignments")
    .insert(rows);
  if (insertErr) throw new Error(insertErr.message);
}

export async function GET(req: NextRequest) {
  const user = await getSupabaseUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const now = new Date();

  const dailyStart = periodStartUtcIso("daily", now);
  const weeklyStart = periodStartUtcIso("weekly", now);

  try {
    await ensureAssignments({
      supabaseAdmin,
      userId: user.id,
      period: "daily",
      periodStart: dailyStart,
      pool: DAILY_POOL,
      count: 3,
    });
    await ensureAssignments({
      supabaseAdmin,
      userId: user.id,
      period: "weekly",
      periodStart: weeklyStart,
      pool: WEEKLY_POOL,
      count: 2,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "assignment_failed", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }

  const { data: assigns, error: assignsErr } = await supabaseAdmin
    .from("quest_assignments")
    .select("quest_id,period,period_start,title,target,reward_coins")
    .eq("user_id", user.id)
    .in("period_start", [dailyStart, weeklyStart]);

  if (assignsErr) {
    return NextResponse.json(
      { error: "assignment_load_failed", detail: assignsErr.message },
      { status: 500 }
    );
  }

  const questIds = (assigns ?? []).map((a: any) => String(a.quest_id));

  const { data: progressRows } = await supabaseAdmin
    .from("quest_progress")
    .select("quest_id,period_start,progress")
    .eq("user_id", user.id)
    .in("period_start", [dailyStart, weeklyStart]);

  const progressMap = new Map<string, number>();
  for (const r of progressRows ?? []) {
    progressMap.set(`${r.quest_id}|${r.period_start}`, Number(r.progress ?? 0));
  }

  const { data: claimRows } = await supabaseAdmin
    .from("quest_claims")
    .select("quest_id,period_start")
    .eq("user_id", user.id)
    .in("period_start", [dailyStart, weeklyStart])
    .in("quest_id", questIds.length ? questIds : ["__none__"]);

  const claimedSet = new Set<string>();
  for (const c of claimRows ?? []) {
    claimedSet.add(`${c.quest_id}|${c.period_start}`);
  }

  const quests = (assigns ?? []).map((a: any) => {
    const period = a.period === "weekly" ? "weekly" : "daily";
    const periodStart = String(a.period_start);
    const key = `${a.quest_id}|${periodStart}`;
    const progress = progressMap.get(key) ?? 0;
    const target = Number(a.target ?? 0);
    return {
      id: String(a.quest_id),
      title: String(a.title ?? a.quest_id),
      period,
      coins: Number(a.reward_coins ?? 0),
      target,
      progress,
      claimed: claimedSet.has(key),
      completed: target > 0 ? progress >= target : true,
      periodStart,
      nextResetAt: nextResetAt(period, now),
    };
  });

  return NextResponse.json({ serverTime: now.toISOString(), quests });
}
