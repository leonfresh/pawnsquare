import { NextResponse, type NextRequest } from "next/server";
import {
  getSupabaseAdminClient,
  getSupabaseUserFromRequest,
} from "@/lib/supabaseServer";
import { createHash } from "crypto";

type EventType = "moves" | "game_end";
type Mode = "chess" | "goose" | "checkers";

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

function periodStarts(now: Date) {
  return {
    daily: toIsoDateUTC(now),
    weekly: toIsoDateUTC(startOfWeekUtcMonday(now)),
  } as const;
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

  // If assignments exist (possibly created with older tuning), sync them to the
  // latest reward/target/title so users see updated rewards immediately.
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
  if (rows.length === 0) return;
  const { error: insertErr } = await supabaseAdmin
    .from("quest_assignments")
    .insert(rows);
  if (insertErr) throw new Error(insertErr.message);
}

export async function POST(req: NextRequest) {
  const user = await getSupabaseUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const eventId = typeof body?.eventId === "string" ? body.eventId : null;
  const type: EventType | null =
    body?.type === "moves" || body?.type === "game_end" ? body.type : null;
  const mode: Mode | null =
    body?.mode === "chess" ||
    body?.mode === "goose" ||
    body?.mode === "checkers"
      ? body.mode
      : null;
  const count = Number.isFinite(body?.count)
    ? Math.max(0, Math.floor(body.count))
    : 0;
  const didWin =
    body?.didWin === true ? true : body?.didWin === false ? false : null;
  const hadOpponent = body?.hadOpponent === true;

  if (!eventId || !type || !mode) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  // De-dupe.
  const { error: dedupeErr } = await supabaseAdmin
    .from("quest_events")
    .insert({ user_id: user.id, event_id: eventId });

  if (dedupeErr) {
    const code = (dedupeErr as any)?.code;
    if (code === "23505") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    return NextResponse.json(
      { ok: false, error: "dedupe_failed", detail: dedupeErr.message },
      { status: 500 }
    );
  }

  const now = new Date();
  const starts = periodStarts(now);

  try {
    await ensureAssignments({
      supabaseAdmin,
      userId: user.id,
      period: "daily",
      periodStart: starts.daily,
      pool: DAILY_POOL,
      count: 3,
    });
    await ensureAssignments({
      supabaseAdmin,
      userId: user.id,
      period: "weekly",
      periodStart: starts.weekly,
      pool: WEEKLY_POOL,
      count: 2,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "assignment_failed",
        detail: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }

  // Load active assignments for both periods.
  const { data: assignments, error: assignErr } = await supabaseAdmin
    .from("quest_assignments")
    .select("quest_id,period,period_start,target,meta")
    .eq("user_id", user.id)
    .in("period_start", [starts.daily, starts.weekly]);

  if (assignErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "assignments_load_failed",
        detail: assignErr.message,
      },
      { status: 500 }
    );
  }

  const incByQuest: Array<{
    quest_id: string;
    period_start: string;
    delta: number;
  }> = [];

  for (const a of assignments ?? []) {
    const questId = String((a as any).quest_id);
    const periodStart = String((a as any).period_start);
    const meta = ((a as any).meta ?? {}) as any;
    const kind = typeof meta?.kind === "string" ? meta.kind : "";

    if (type === "moves") {
      const delta = count || 1;
      if (kind === "moves") {
        incByQuest.push({
          quest_id: questId,
          period_start: periodStart,
          delta,
        });
      }
      if (kind === "goose_moves" && mode === "goose") {
        incByQuest.push({
          quest_id: questId,
          period_start: periodStart,
          delta,
        });
      }
    }

    if (type === "game_end" && hadOpponent) {
      if (kind === "play_games") {
        incByQuest.push({
          quest_id: questId,
          period_start: periodStart,
          delta: 1,
        });
      }
      if (kind === "win_games" && didWin === true) {
        incByQuest.push({
          quest_id: questId,
          period_start: periodStart,
          delta: 1,
        });
      }
    }
  }

  if (incByQuest.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // Additive updates per quest_id/period_start.
  for (const i of incByQuest) {
    const { error } = await supabaseAdmin.rpc("_quests_increment_progress", {
      p_user_id: user.id,
      p_quest_id: i.quest_id,
      p_period_start: i.period_start,
      p_delta: i.delta,
    });
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "progress_increment_failed",
          detail: error.message,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, updated: incByQuest.length });
}
