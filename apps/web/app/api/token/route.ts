import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // always run server-side

// Allow mobile dev to hit this endpoint.
// In production, set a strict origin list.
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_WEB_ORIGIN,      // e.g. https://yourdomain.com
  "http://localhost:3000",                 // next dev
  "http://localhost:8081",                 // rn dev server (optional)
  "http://127.0.0.1:3000"
].filter(Boolean) as string[];

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.join(",") || "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

const BodySchema = z.object({
  room: z.string().min(1),
  identity: z.string().min(1),
  role: z.enum(["admin", "host", "participant", "audience"]).default("participant")
});

export async function POST(req: Request) {
  // Validate env
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return cors(
      NextResponse.json({ error: "LIVEKIT_API_KEY/SECRET missing" }, { status: 500 })
    );
  }

  // Parse body
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return cors(NextResponse.json({ error: "Invalid body" }, { status: 400 }));
  }

  const { room, identity, role } = body;

  // Build token
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: "1h" // adjust if needed
  });

  // Grant room permissions (tune to your alpha rules)
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,      // set false for listeners
    canSubscribe: true,
    // canPublishSources: ["microphone"], // optionally restrict sources
    // canUpdateOwnMetadata: true,
  });

  const token = await at.toJwt();
  return cors(NextResponse.json({ token }, { status: 200 }));
}
