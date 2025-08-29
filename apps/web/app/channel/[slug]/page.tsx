'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Room, RoomEvent, Track, createLocalTracks,
  type LocalAudioTrack, type LocalTrack,
  type RemoteParticipant, type TrackPublication,
} from 'livekit-client'



type Msg =
  | { type: 'collab:allow'; allowed: boolean }
  | { type: 'collab:close' }

export default function ChannelPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'publishing'>('idle')
  const [identity] = useState<string>(() => 'guest_' + Math.random().toString(36).slice(2))
  const [error, setError] = useState<string | null>(null)

  // UX states
  const [isListening, setIsListening] = useState(true)
  const [iHaveAux, setIHaveAux] = useState(false)
  const [collabAllowed, setCollabAllowed] = useState(false)
  const [collabOccupied, setCollabOccupied] = useState(false)

  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const roomRef = useRef<Room | null>(null)
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!

  // Helpers
  function myAudioPubs() {
    const room = roomRef.current
    if (!room) return []
    return room.localParticipant.getTrackPublications().filter(p => p.track?.kind === Track.Kind.Audio)
  }

function refreshAuxFlags() {
  const room = roomRef.current
  if (!room) return

  // Do I have aux? (any local audio track named 'aux')
  const mine = room.localParticipant.getTrackPublications()
  setIHaveAux(
    mine.some((p: TrackPublication) =>
      p.track?.kind === Track.Kind.Audio &&
      (p.trackName === 'aux' || p.track?.mediaStreamTrack.label === 'aux')
    )
  )

  // Is collab occupied? (any remote audio track named 'collab')
  const participants: RemoteParticipant[] = Array.from(room.remoteParticipants.values())
  const anyCollab = participants.some((part: RemoteParticipant) =>
    part.getTrackPublications().some((p: TrackPublication) =>
      p.track?.kind === Track.Kind.Audio && p.trackName === 'collab'
    )
  )
  setCollabOccupied(anyCollab)
}



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

        await room.connect(livekitUrl, token, {
          // adaptiveStream: true,
        })
        if (cancelled) { room.disconnect(); return }
        roomRef.current = room
        setStatus('connected')

        // Create audio element for playback
        if (!audioElRef.current) {
          const el = document.createElement('audio')
          el.autoplay = true
          el.controls = true
          el.muted = !isListening
          el.style.position = 'fixed'
          el.style.bottom = '12px'
          el.style.left = '12px'
          el.style.zIndex = '10000'
          document.body.appendChild(el)
          audioElRef.current = el
        }

        // Subscribe playback: whenever we get a remote audio track, play it
        room.on(RoomEvent.TrackSubscribed, (_track, publication, participant) => {
          const track = publication.track
          if (track?.kind === Track.Kind.Audio) {
            const mediaStream = new MediaStream([track.mediaStreamTrack])
            if (audioElRef.current) audioElRef.current.srcObject = mediaStream
          }
          refreshAuxFlags()
        })
        room.on(RoomEvent.TrackUnsubscribed, () => {
          // When a publisher leaves/stops, clear/refresh flags
          if (audioElRef.current) audioElRef.current.srcObject = null
          refreshAuxFlags()
        })
        room.on(RoomEvent.ParticipantConnected, refreshAuxFlags)
        room.on(RoomEvent.ParticipantDisconnected, refreshAuxFlags)
        room.on(RoomEvent.LocalTrackPublished, refreshAuxFlags)
        room.on(RoomEvent.LocalTrackUnpublished, refreshAuxFlags)

        // Minimal control protocol via data messages
        room.on(RoomEvent.DataReceived, (payload, _participant, _kind, _topic) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as Msg
            if (msg.type === 'collab:allow') setCollabAllowed(msg.allowed)
            if (msg.type === 'collab:close') {
              // if I’m collaborating, stop my collab track
              stopNamedTrack('collab')
            }
          } catch { /* ignore */ }
        })

        refreshAuxFlags()
      } catch (e: any) {
        setError(e.message || String(e))
        setStatus('idle')
      }
    }

    join()
    return () => {
      cancelled = true
      const r = roomRef.current
      if (r) r.disconnect()
      if (audioElRef.current) { audioElRef.current.remove(); audioElRef.current = null }
    }
  }, [roomName, identity, livekitUrl])

  // ---- Actions ----

  async function takeAuxMic() {
    try {
      const room = roomRef.current; if (!room) return
      // publish mic as 'aux'
      const [audioTrack] = await createLocalTracks({ audio: true })
      // tag the track name via publish options
      await room.localParticipant.publishTrack(audioTrack as LocalAudioTrack, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)
    } catch (e: any) { setError(e.message || String(e)) }
  }

  async function takeAuxTab() {
    try {
      const room = roomRef.current; if (!room) return
      // capture tab/system audio (browser/OS dependent)
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ audio: true, video: false })
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('No audio track from display capture')
      await room.localParticipant.publishTrack(track, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)
    } catch (e: any) { setError(e.message || String(e)) }
  }

  async function passAux() {
    // unpublish any local audio track named 'aux'
    stopNamedTrack('aux')
    setIHaveAux(false)
    setStatus('connected')
    // also close collab if it was allowed
    if (collabAllowed) await setCollabAllowedByController(false)
  }

function toggleListen() {
  setIsListening(v => {
    const next = !v
    if (audioElRef.current) {
      audioElRef.current.muted = !next
      if (next) audioElRef.current.play().catch(() => {/* ignore */})
    }
    return next
  })
}

  // Collab controls (controlled by aux holder)
async function setCollabAllowedByController(allowed: boolean) {
  const room = roomRef.current; if (!room) return
  if (!iHaveAux) { setError('Only the aux holder can change collab'); return }

  setCollabAllowed(allowed)

  const enc = new TextEncoder()

  // announce allowed/closed state
  const allowMsg = { type: 'collab:allow', allowed }
  await room.localParticipant.publishData(enc.encode(JSON.stringify(allowMsg)), { reliable: true })

  // if closing, tell any collaborator to stop
  if (!allowed) {
    const closeMsg = { type: 'collab:close' }
    await room.localParticipant.publishData(enc.encode(JSON.stringify(closeMsg)), { reliable: true })
  }
}

async function takeAuxFile() {
  try {
    const room = roomRef.current; if (!room) return

    // 1) Pick a file
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      const url = URL.createObjectURL(file)

      // 2) Create an <audio> element and a WebAudio graph
      const el = new Audio(url)
      el.loop = false
      await el.play().catch(() => {/* user gesture might be needed */})

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const src = ctx.createMediaElementSource(el)
      const dest = ctx.createMediaStreamDestination()  // <-- gives us a MediaStream track
      src.connect(dest)
      src.connect(ctx.destination) // also play locally

      const track = dest.stream.getAudioTracks()[0]
      await room.localParticipant.publishTrack(track, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)

      // when the song ends, clean up
      el.onended = () => {
        const pubs = room.localParticipant.getTrackPublications()
        const pub = pubs.find(p => p.trackName === 'aux')
        if (pub) {
          const sid = (pub as any).trackSid ?? (pub as any).sid
          room.localParticipant.unpublishTrack(sid, true)
        }
        track.stop()
        ctx.close()
        setStatus('connected'); setIHaveAux(false)
      }
    }
    input.click()
  } catch (e:any) { setError(e.message || String(e)) }
}


  async function joinCollab() {
    try {
      if (iHaveAux) { setError('You already have the aux'); return }
      if (!collabAllowed) { setError('Collab is closed'); return }
      if (collabOccupied) { setError('Collab slot is occupied'); return }
      const room = roomRef.current; if (!room) return
      const [audioTrack] = await createLocalTracks({ audio: true })
      await room.localParticipant.publishTrack(audioTrack as LocalAudioTrack, { name: 'collab' })
      setStatus('publishing')
      setCollabOccupied(true)
    } catch (e: any) { setError(e.message || String(e)) }
  }

  // Utility: stop and unpublish a local track by "name" (aux/collab)
  function stopNamedTrack(name: 'aux' | 'collab') {
    const room = roomRef.current; if (!room) return
    for (const pub of room.localParticipant.getTrackPublications()) {
      const isAudio = pub.track?.kind === Track.Kind.Audio
      const matchesName = pub.trackName === name || pub.track?.mediaStreamTrack.label === name
      if (isAudio && matchesName) {
        const t = pub.track as LocalTrack | null
        // unpublish using SID to avoid TS complaints
        const sid = (pub as any).trackSid ?? (pub as any).sid
        room.localParticipant.unpublishTrack(sid, true) // stopOnUnpublish = true
        if (t) t.stop()
      }
    }
    refreshAuxFlags()
  }

  // ---- UI ----
  const canTakeAux = status === 'connected' && !iHaveAux
  const canPassAux = iHaveAux
  const canStartCollab = iHaveAux
  const canJoinCollab = !iHaveAux && collabAllowed && !collabOccupied

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, width: '100%', background: '#0e0e10', color: '#eee', padding: 16, borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.3)' }}>
        <h1 style={{ marginTop: 0 }}>Audio Arcade — {roomName}</h1>
        <p style={{ opacity: 0.8, marginTop: 4 }}>
          Status: <strong>{status}</strong>{' '}
          • Aux: <strong>{iHaveAux ? 'You' : 'Someone else / free'}</strong>{' '}
          • Collab: <strong>{collabAllowed ? (collabOccupied ? 'In Use' : 'Open') : 'Closed'}</strong>
        </p>
        {error && <p style={{ color: '#ff8484' }}>Error: {error}</p>}

        {/* Row 1: Listening */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={toggleListen}>{isListening ? 'Mute (Stop Listening)' : 'Listen'}</button>
        </div>

        {/* Row 2: Aux control wording */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={takeAuxMic} disabled={!canTakeAux}>Take the Aux (Mic)</button>
          <button onClick={takeAuxTab} disabled={!canTakeAux}>Take the Aux (Share Tab)</button>
          <button onClick={passAux} disabled={!canPassAux}>Pass the Aux</button>
          <button onClick={takeAuxFile} disabled={!canTakeAux}>Take the Aux (Play File)</button>

        </div>

        {/* Row 3: Collab controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {/* Aux holder opens/closes the collab slot */}
          <button onClick={() => setCollabAllowedByController(!collabAllowed)} disabled={!canStartCollab}>
            {collabAllowed ? 'Close Collab Slot' : 'Open Collab Slot'}
          </button>
          {/* Non-aux user joins the collab slot (if open & free) */}
          <button onClick={joinCollab} disabled={!canJoinCollab}>Join Collab</button>
          {/* Aux can also close any active collab */}
          <button onClick={() => setCollabAllowedByController(false)} disabled={!iHaveAux || !collabAllowed}>
            End Collab
          </button>
        </div>

        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10, lineHeight: 1.4 }}>
          “Take the Aux” publishes your mic or tab audio to the room. “Pass the Aux” stops your aux track.
          The aux holder can open a single **Collab** slot so another person can publish a second mic (beats + vocals).
        </p>
      </div>
    </main>
  )
}
