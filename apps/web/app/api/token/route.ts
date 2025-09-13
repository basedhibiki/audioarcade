// apps/web/app/api/token/route.ts
import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admins (comma-separated emails in .env)
const admins = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// ---- CORS (dev: allow all) ----
function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// ---- Body schema ----
const BodySchema = z.object({
  room: z.string().min(1),
  identity: z.string().min(1).optional(),
  role: z.enum(["admin", "host", "participant", "audience"]).default("participant"),
});

export async function POST(req: Request) {
  // 1) Validate env
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return cors(
      NextResponse.json(
        { error: "LIVEKIT_API_KEY/SECRET missing" },
        { status: 500 }
      )
    );
  }

  // 2) Parse body (Zod)
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return cors(NextResponse.json({ error: "Invalid body" }, { status: 400 }));
  }
  const room = String(body.room);
  const requestedRole = body.role;
  const identityFromClient = body.identity;

  // 3) Get Supabase user (for email + admin check)
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? null;
  const isAdmin = !!email && admins.has(email);

  // 4) Choose identity and grants
  const identity =
    identityFromClient ??
    email ??
    "guest_" + Math.random().toString(36).slice(2);

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: "1h" });

  at.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    // Allow publish if admin or host/participant (tune as needed)
    canPublish: isAdmin || requestedRole === "host" || requestedRole === "participant",
    // Example: restrict sources later (music bot, etc.)
    // canPublishSources: ["microphone"],
  });

  // 5) Mint & return token
  const token = await at.toJwt();
  return cors(NextResponse.json({ token, isAdmin, email }, { status: 200 }));
}
