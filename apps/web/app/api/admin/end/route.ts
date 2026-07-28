import { NextResponse } from 'next/server'
import { RoomServiceClient } from 'livekit-server-sdk'
import { createServerSupabase } from '@/lib/supabase/server'

function cors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Access-Control-Max-Age', '86400')
  return res
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 204 })) }

export async function POST(req: Request) {
  const { room } = await req.json()

  const supabase = await createServerSupabase()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const admins = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean))
  if (!user?.email || !admins.has(user.email)) {
    return cors(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
  }

  const svc = new RoomServiceClient(
    process.env.NEXT_PUBLIC_LIVEKIT_URL!.replace('wss://','https://'),
    process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!
  )
  await svc.deleteRoom(room)

  return cors(NextResponse.json({ ok: true }))
}



