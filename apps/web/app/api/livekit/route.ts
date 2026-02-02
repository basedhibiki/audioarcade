// apps/web/app/api/livekit/route.ts
import { NextRequest } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'
import '@livekit/components-styles/dist/styles.css';


export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const room = url.searchParams.get('room') || 'default'
  const identity = url.searchParams.get('identity') || `user_${Math.random().toString(36).slice(2)}`

  const apiKey = process.env.LIVEKIT_API_KEY!
  const apiSecret = process.env.LIVEKIT_API_SECRET!
  if (!apiKey || !apiSecret) {
    return new Response(JSON.stringify({ error: 'LIVEKIT_API_KEY/SECRET missing' }), { status: 500 })
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: '1h',
  })
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true })
  const token = await at.toJwt()

  return new Response(JSON.stringify({ token }), {
    headers: { 'content-type': 'application/json' },
  })
}
