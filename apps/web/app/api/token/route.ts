import { NextRequest, NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'

export const runtime = 'nodejs' // required: server SDK needs Node, not Edge

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const roomName = url.searchParams.get('room')
    const identity = url.searchParams.get('identity')

    if (!roomName || !identity) {
      return NextResponse.json({ error: 'Missing room or identity' }, { status: 400 })
    }

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const lkUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL // client uses this to connect

    if (!apiKey || !apiSecret || !lkUrl) {
      return NextResponse.json(
        { error: 'LiveKit env vars not set' },
        { status: 500 }
      )
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      // optional metadata: metadata: JSON.stringify({ role: 'guest' })
    })
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    const token = await at.toJwt()
    return NextResponse.json({ token })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
