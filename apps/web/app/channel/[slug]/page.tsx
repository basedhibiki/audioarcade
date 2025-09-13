'use client'

import { useEffect, useState } from 'react'
import {
  LiveKitRoom,
  useRoomContext,
  useParticipants,
  useDataChannel,
  RoomAudioRenderer,
} from '@livekit/components-react'
import '@livekit/components-styles'

export default function ChannelPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!

  async function getToken() {
    const r = await fetch('/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        room: roomName,
        identity: 'web_' + Math.random().toString(36).slice(2),
      }),
    })
    const { token } = await r.json()
    return token
  }

  return (
    <LiveKitRoom serverUrl={serverUrl} tokenGetter={getToken} connect>
      <RoomShell roomName={roomName} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

function RoomShell({ roomName }: { roomName: string }) {
  const room = useRoomContext()
  const { participants } = useParticipants()
  const data = useDataChannel()
  const [log, setLog] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!data) return
    const onMsg = (_p: any, m: Uint8Array) => {
      const t = new TextDecoder().decode(m)
      setLog((l) => [...l.slice(-99), t])
    }
    data.on('message', onMsg)
    return () => {
      data.off('message', onMsg)
    }
  }, [data])

  function sendChat() {
    if (!msg.trim()) return
    const payload = {
      t: 'chat',
      from: room.localParticipant?.identity,
      text: msg.trim(),
    }
    data?.publish(new TextEncoder().encode(JSON.stringify(payload)))
    setMsg('')
  }

  function requestAux() {
    const payload = {
      t: 'request-aux',
      from: room.localParticipant?.identity,
    }
    data?.publish(new TextEncoder().encode(JSON.stringify(payload)))
  }

  return (
    <div className="grid grid-cols-3 h-screen">
      <div className="col-span-2 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Room: {roomName}</div>
          <button className="px-3 py-2 border rounded" onClick={requestAux}>
            Request Aux
          </button>
        </div>
        <div>
          <div className="font-semibold mb-1">Participants</div>
          <ul className="text-sm">
            {[room.localParticipant, ...participants]
              .filter(Boolean)
              .map((p: any) => (
                <li key={p.identity}>{p.name ?? p.identity}</li>
              ))}
          </ul>
        </div>
      </div>

      <div className="border-l p-4 flex flex-col">
        <div className="font-semibold mb-2">Chat</div>
        <div className="flex-1 overflow-auto text-sm border rounded p-2 bg-white/30">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 border p-2 rounded"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Type message…"
          />
          <button className="px-3 py-2 border rounded" onClick={sendChat}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
