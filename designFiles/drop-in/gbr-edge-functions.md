# Drop-In — GBR Edge Function Skeletons

**Illustrative** skeletons for the 2-3 GBR edge functions FP calls. These live in the **GBR repo** (`supabase/functions/`) when implemented, deployed via git (Lovable syncs). They are modeled on GBR's existing `stripe-webhook` (HMAC verify → service-role writes). Pseudocode — not production-ready; error handling, validation, and types are abbreviated.

See [gbr-integration.md](./gbr-integration.md) for the contract and auth, and [open-questions.md](./open-questions.md) for the prerequisites flagged `⚠` below.

---

## Shared: HMAC signature verify (`_shared/fp-auth.ts`)

Mirrors Stripe's `t=<ts>,v1=<hmac>` scheme. The secret never travels the wire; stale timestamps are rejected (replay guard).

```ts
// GBR repo: supabase/functions/_shared/fp-auth.ts
const TOLERANCE_SECONDS = 300;

export async function verifyFpSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("SHUTTLEMENTOR_SHARED_SECRET");
  if (!secret) throw new Error("SHUTTLEMENTOR_SHARED_SECRET not configured");

  const header = req.headers.get("X-ShuttleMentor-Signature"); // "t=1748900000,v1=abc123..."
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false; // replay guard

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, parts.v1 ?? "");
}
```

## config.toml additions (GBR repo)

```toml
[functions.sync-player-identity]
verify_jwt = false   # auth handled in-handler via SHUTTLEMENTOR_SHARED_SECRET

[functions.submit-match-result]
verify_jwt = false

[functions.get-rankings]
verify_jwt = false
```

---

## 1. `sync-player-identity`

Resolve or lazily create+link a GBR player for an FP member. Idempotent on `(source, external_id)`.

```ts
// GBR repo: supabase/functions/sync-player-identity/index.ts
import { createClient } from "jsr:@supabase/supabase-js";
import { verifyFpSignature } from "../_shared/fp-auth.ts";

Deno.serve(async (req) => {
  const rawBody = await req.text();
  if (!(await verifyFpSignature(req, rawBody))) return json(401, { error: "bad signature" });

  const { source, externalId, firstName, lastName, gender, email } = JSON.parse(rawBody);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. Existing link? (the idempotency path for re-syncs)
  const { data: link } = await admin.from("external_player_identities")
    .select("player_id").eq("source", source).eq("external_id", externalId).maybeSingle();
  if (link) return json(200, { gbrPlayerId: link.player_id, created: false });

  // 2. ⚠ Dedup by email — players has NO email column (email is on auth.users; ghosts have none).
  //    Needs a decision: query auth.users? skip dedup? See open-questions #B2.
  let playerId: string | null = null;
  // ... (TODO per decision)

  // 3. Create a ghost player if none matched
  let created = false;
  if (!playerId) {
    const { data: ghost } = await admin.from("players").insert({
      user_id: null, is_ghost: true, ghost_source: source,   // ⚠ confirm ghost_source accepts 'facilitypresence'
      first_name: firstName, last_name: lastName, gender,     // ⚠ gender is REQUIRED on players — where from? (#B1)
    }).select("id").single();
    playerId = ghost!.id;
    created = true;
  }

  // 4. Write the link
  await admin.from("external_player_identities").insert({
    player_id: playerId, source, external_id: externalId, external_name: `${firstName} ${lastName}`,
  });

  return json(200, { gbrPlayerId: playerId, created });
});
```

## 2. `submit-match-result`

Idempotent (on `external_match_id`) self-reported match insert → triggers TrueSkill recompute.

```ts
// GBR repo: supabase/functions/submit-match-result/index.ts
Deno.serve(async (req) => {
  const rawBody = await req.text();
  if (!(await verifyFpSignature(req, rawBody))) return json(401, { error: "bad signature" });

  const { externalMatchId, teamType, sideA, sideB, winnerSide, sets, datePlayed, weight } = JSON.parse(rawBody);
  // sets = per-game scores, e.g. [{a:21,b:18},{a:19,b:21},{a:21,b:15}] — REQUIRED (GBR's rating uses margin, A14)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. Idempotency — never double-count a retry
  const { data: existing } = await admin.from("matches")
    .select("id").eq("external_match_id", externalMatchId).maybeSingle();
  if (existing) return json(200, { matchId: existing.id, idempotent: true });

  // 2. Resolve/create teams (1 player for singles, 2 for doubles/mixed)
  const teamAId = await upsertTeam(admin, sideA, teamType); // sideA/sideB = GBR player ids
  const teamBId = await upsertTeam(admin, sideB, teamType);
  const winnerTeamId = winnerSide === "A" ? teamAId : teamBId;

  // 3. Insert a CONFIRMED self-reported match.
  //    FP already did the two-party confirmation, so we write 'confirmed' directly.
  //    Do NOT set is_imported (that applies the 2.0x weight) — we want self-reported 1.0x.
  const { data: match } = await admin.from("matches").insert({
    team_a_id: teamAId, team_b_id: teamBId, winner_team_id: winnerTeamId,
    verification_status: "confirmed",
    match_weight: weight ?? 1.0,
    external_match_id: externalMatchId,
    submitted_by: Deno.env.get("FP_SERVICE_USER_ID"), // the ShuttleMentor service account's auth.users id (#F2)
    date_played: datePlayed,
    // GBR derives the rating CATEGORY from team_type → a doubles match feeds the doubles rating (C1)
  }).select("id").single();

  // 3b. Insert per-set scores — GBR's TrueSkill uses margin-of-victory, so the actual gaps matter (A14)
  await admin.from("match_sets").insert(
    sets.map((s: {a: number; b: number}, i: number) =>
      ({ match_id: match!.id, set_number: i + 1, team_a_score: s.a, team_b_score: s.b })),
  );

  // 4. Recompute ratings (same call GBR's own client makes); reads match_sets for the margin multiplier
  await admin.functions.invoke("calculate-ratings", { body: { match_id: match!.id } });

  return json(200, { matchId: match!.id });
});
```

## 3. `get-rankings` (optional — avoids the anon key)

Public-data read; lets FP fetch global ratings without holding the anon key.

```ts
// GBR repo: supabase/functions/get-rankings/index.ts
Deno.serve(async (req) => {
  const rawBody = await req.text();
  if (!(await verifyFpSignature(req, rawBody))) return json(401, { error: "bad signature" });

  const { playerIds } = JSON.parse(rawBody);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data } = await admin.from("players").select("id, mu, sigma").in("id", playerIds);
  const rankings = (data ?? []).map((p) => ({
    gbrPlayerId: p.id,
    displayRating: Math.max(100, Math.min(500, Math.round(100 + (p.mu - 3 * p.sigma) * 8))),
    // ⚠ "rank" (a position #) is NOT a stored column — define it (global order? category? percentile?) (#C3)
  }));
  return json(200, { rankings });
});
```

---

## FP-side caller (the signing half)

Lives in FP's Next backend (server-only) — never the browser.

```ts
// FP repo: src/server/gbr/client.ts
import { createHmac } from "node:crypto";

const SECRET = process.env.SHUTTLEMENTOR_SHARED_SECRET!;
const GBR_FN_BASE = "https://avzjeysdljfzjmjpxvur.supabase.co/functions/v1";

export async function callGbr<T>(fn: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  const res = await fetch(`${GBR_FN_BASE}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ShuttleMentor-Signature": `t=${t},v1=${v1}` },
    body,
  });
  if (!res.ok) throw new Error(`GBR ${fn} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
```

---

## Deployment checklist

1. **Add to GBR repo:** `_shared/fp-auth.ts` + the three function dirs; `config.toml` blocks (`verify_jwt = false`).
2. **Saved Secret:** add `SHUTTLEMENTOR_SHARED_SECRET` (and `FP_SERVICE_USER_ID` if used) in GBR's secrets manager — same place as `STRIPE_WEBHOOK_SECRET`/`RESEND_WEBHOOK_SECRET`.
3. **Deploy:** push via git so Lovable syncs/deploys to the managed project. **⚠ Verify new functions actually deploy this way on Lovable Cloud (#F1).**
4. **FP env:** set the same `SHUTTLEMENTOR_SHARED_SECRET` in FP's backend.
5. **GBR prerequisites:** create the **ShuttleMentor service account** — `submitted_by` references `auth.users(id)`, so it must be a real auth user (sign it up via GBR, or Dashboard "Add user"); set its `auth.users.id` as the `FP_SERVICE_USER_ID` secret (#F2). Confirm `ghost_source` accepts `'facilitypresence'`. (Scores resolved — per-set → `match_sets`, A14.)
