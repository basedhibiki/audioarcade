'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Room } from 'livekit-client'
import { connect, RoomEvent, Track } from 'livekit-client'

export default function ChannelPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'publishing'>('idle')
  const [identity, setIdentity] = useState<string>(() => 'guest_' + Math.random().toString(36).slice(2))
  const [error, setError] = useState<string | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const roomRef = useRef<Room | null>(null)
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!

  // Join when page loads
  useEffect(() => {
    let cancelled = false

    async function join() {
      try {
        setStatus('connecting')
        const res = await fetch(`/api/livekit?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`)
        const { token } = await res.json()
        if (!token) throw new Error('No token from LiveKit API')
        const room = await connect(livekitUrl, token)
        if (cancelled) { room.disconnect(); return }
        roomRef.current = room
        setStatus('connected')

        // Auto-subscribe to audio and play it
        room.on(RoomEvent.TrackSubscribed, (_track, publication, participant) => {
          const track = publication.track
          if (track?.kind === Track.Kind.Audio) {
            const mediaStream = new MediaStream([track.mediaStreamTrack])
            if (!audioElRef.current) {
              audioElRef.current = document.createElement('audio')
              audioElRef.current.autoplay = true
              audioElRef.current.controls = true
              audioElRef.current.style.position = 'fixed'
              audioElRef.current.style.bottom = '12px'
              audioElRef.current.style.left = '12px'
              audioElRef.current.style.zIndex = '10000'
              document.body.appendChild(audioElRef.current)
            }
            audioElRef.current.srcObject = mediaStream
          }
        })

        // Helpful: clean up audio element if the publisher leaves
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === Track.Kind.Audio && audioElRef.current) {
            audioElRef.current.srcObject = null
          }
        })
      } catch (e:any) {
        setError(e.message)
        setStatus('idle')
      }
    }

    join()
    return () => {
      cancelled = true
      const r = roomRef.current
      if (r) r.disconnect()
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
      // Publish default mic
      const { createLocalTracks } = await import('livekit-client')
      const [audioTrack] = await createLocalTracks({ audio: true })
      await room.localParticipant.publishTrack(audioTrack)
      setStatus('publishing')
    } catch (e:any) {
      setError(e.message)
    }
  }

  async function shareTabAudio() {
    try {
      const room = roomRef.current
      if (!room) return
      // Get tab/system audio (Chrome/Edge allow tab audio; system audio support varies by OS)
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ audio: true, video: false })
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('No audio track from display capture')
      await room.localParticipant.publishTrack(track)
      setStatus('publishing')
    } catch (e:any) {
      setError(e.message)
    }
  }

  async function stopPublishing() {
    const room = roomRef.current
    if (!room) return
    room.localParticipant.tracks.forEach(pub => {
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
    <main style={{minHeight:'100vh', display:'grid', placeItems:'center', padding:24}}>
      <div style={{maxWidth:480, width:'100%', background:'#0e0e10', color:'#eee', padding:16, borderRadius:16, boxShadow:'0 10px 30px rgba(0,0,0,.3)'}}>
        <h1 style={{marginTop:0}}>Audio Arcade — {roomName}</h1>
        <p style={{opacity:.8, marginTop:4}}>Status: <strong>{status}</strong></p>
        {error && <p style={{color:'#ff8484'}}>Error: {error}</p>}

        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:12}}>
          <button onClick={startMic} disabled={status!=='connected'}>Start Mic</button>
          <button onClick={shareTabAudio} disabled={status!=='connected'}>Share Tab Audio</button>
          <button onClick={stopPublishing} disabled={status!=='publishing'}>Stop Publishing</button>
          <button onClick={leave} disabled={status==='idle'}>Leave</button>
        </div>

        <p style={{fontSize:12, opacity:.7, marginTop:10}}>
          Tip: “Share Tab Audio” works best on Chromium browsers. Use Mic for universal support.
        </p>
      </div>
    </main>
  )
}
