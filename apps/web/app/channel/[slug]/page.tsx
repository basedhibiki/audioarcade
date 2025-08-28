'use client'

import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client'

export default function ChannelPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'publishing'>('idle')
  const [identity] = useState<string>(() => 'guest_' + Math.random().toString(36).slice(2))
  const [error, setError] = useState<string | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const roomRef = useRef<Room | null>(null)
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!

  useEffect(() => {
    let cancelled = false
    const room = new Room()

    async function join() {
      try {
        setStatus('connecting')
        const res = await fetch(
          `/api/livekit?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`
        )
        const { token } = await res.json()
        if (!token) throw new Error('No token from LiveKit API')

        // Single options object (optional). You can add reconnect, adaptiveStream, etc. here.
        await room.connect(livekitUrl, token, {
          // reconnect: true,
          // adaptiveStream: true,
        })
        if (cancelled) {
          room.disconnect()
          return
        }
        roomRef.current = room
        setStatus('connected')

        room.on(RoomEvent.TrackSubscribed, (_track, publication) => {
          const track = publication.track
          if (track?.kind === Track.Kind.Audio) {
            const mediaStream = new MediaStream([track.mediaStreamTrack])
            if (!audioElRef.current) {
              const el = document.createElement('audio')
              el.autoplay = true
              el.controls = true
              el.style.position = 'fixed'
              el.style.bottom = '12px'
              el.style.left = '12px'
              el.style.zIndex = '10000'
              document.body.appendChild(el)
              audioElRef.current = el
            }
            audioElRef.current.srcObject = mediaStream
          }
        })

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === Track.Kind.Audio && audioElRef.current) {
            audioElRef.current.srcObject = null
          }
        })
      } catch (e: any) {
        setError(e.message || String(e))
        setStatus('idle')
      }
    }

    join()
    return () => {
      cancelled = true
      if (roomRef.current) roomRef.current.disconnect()
      if (audioElRef.current) {
        audioElRef.current.remove()
        audioElRef.current = null
      }
    }
  }, [roomName, identity, livekitUrl])

  async function startMic() {
    try {
      const room = roomRef.current
      if (!room) return
      const [audioTrack] = await createLocalTracks({ audio: true })
      await room.localParticipant.publishTrack(audioTrack)
      setStatus('publishing')
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  async function shareTabAudio() {
    try {
      const room = roomRef.current
      if (!room) return
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ audio: true, video: false })
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('No audio track from display capture')
      await room.localParticipant.publishTrack(track)
      setStatus('publishing')
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  async function stopPublishing() {
    const room = roomRef.current
    if (!room) return
    room.localParticipant.tracks.forEach((pub) => {
      if (pub.track?.kind === Track.Kind.Audio) {
        room.localParticipant.unpublishTrack(pub.track, true)
        pub.track.stop()
      }
    })
    setStatus('connected')
  }

  function leave() {
    const room = roomRef.current
    if (room) room.disconnect()
    setStatus('idle')
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, width: '100%', background: '#0e0e10', color: '#eee', padding: 16, borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.3)' }}>
        <h1 style={{ marginTop: 0 }}>Audio Arcade — {roomName}</h1>
        <p style={{ opacity: 0.8, marginTop: 4 }}>Status: <strong>{status}</strong></p>
        {error && <p style={{ color: '#ff8484' }}>Error: {error}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={startMic} disabled={status !== 'connected'}>Start Mic</button>
          <button onClick={shareTabAudio} disabled={status !== 'connected'}>Share Tab Audio</button>
          <button onClick={stopPublishing} disabled={status !== 'publishing'}>Stop Publishing</button>
          <button onClick={leave} disabled={status === 'idle'}>Leave</button>
        </div>

        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
          Tip: “Share Tab Audio” works best on Chromium browsers. Use Mic for universal support.
        </p>
      </div>
    </main>
  )
}
