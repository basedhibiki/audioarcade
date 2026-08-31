import { NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  room: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
})

function cors(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  response.headers.set('Access-Control-Max-Age', '86400')
  return response
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const roomPassword = process.env.AUDIO_ARCADE_ROOM_PASSWORD

  if (!apiKey || !apiSecret || !roomPassword) {
    return cors(
      NextResponse.json(
        { error: 'The LiveKit credentials or room password are missing.' },
        { status: 500 },
      ),
    )
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return cors(NextResponse.json({ error: 'Enter a valid room and display name.' }, { status: 400 }))
  }

  const { room, displayName, password } = parsed.data

  if (password !== roomPassword) {
    return cors(NextResponse.json({ error: 'Incorrect room password.' }, { status: 401 }))
  }
  const identity = `web_${crypto.randomUUID()}`
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: '2h',
  })

  token.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  })

  return cors(NextResponse.json({ token: await token.toJwt() }))
}
