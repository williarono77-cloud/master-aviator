import { supabase } from "../supabaseClient.js";

/**
 * Read-only fetch of the current active round.
 */
export async function fetchActiveRound() {
  const { data, error } = await supabase
    .from("game_rounds")
    .select(
      "id, round_id, round_number, burst_point, status, created_at, starts_at, ended_at, winning_side"
    )
    .eq("status", "active")
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/**
 * Public-safe round advancement.
 * One caller wins; others should receive the already-active round.
 */
export async function advanceRound() {
  const { data, error } = await supabase.rpc("advance_round_public");

  if (error) throw error;
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return data[0];
}
