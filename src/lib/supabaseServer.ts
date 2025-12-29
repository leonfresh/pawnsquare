import { createClient } from "@supabase/supabase-js";

function getSupabaseServerClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function getSupabaseUserFromRequest(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = (m?.[1] ?? "").trim();
  if (!token) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}
