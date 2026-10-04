const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://xkslyzdmynpmzllxyslj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_bMvLYrrT8L0bpVnnw-A4gQ_OVzfvmZJ";

const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/keep_project_active`;

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Supabase recommends a few database requests per day for low-activity
    // Free projects. The SQL function rate-limits its actual write, so these
    // lightweight calls do not create an ever-growing activity log.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rpcResponse = await fetch(RPC_URL, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8_000),
      });

      if (!rpcResponse.ok) {
        return response.status(503).json({
          ok: false,
          backendStatus: rpcResponse.status,
          error: "Supabase keepalive failed",
        });
      }
    }

    return response.status(200).json({ ok: true });
  } catch (error) {
    return response.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Supabase is unreachable",
    });
  }
}
