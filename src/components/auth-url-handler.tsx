"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export function AuthUrlHandler() {
  useEffect(() => {
    // Ensures Supabase can process OAuth / magic-link redirects when returning to the app.
    // The Supabase client is configured with detectSessionInUrl=true.
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getSession();
    } catch {
      // If Supabase env vars aren't configured, do nothing.
    }
  }, []);

  return null;
}
