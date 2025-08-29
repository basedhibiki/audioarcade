'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Room, RoomEvent, Track, createLocalTracks,
  type LocalAudioTrack, type LocalTrack,
  type RemoteParticipant, type TrackPublication,
} from 'livekit-client'

type ControlMsg =
  | { type: 'collab:allow'; allowed: boolean }
  | { type: 'collab:close' }

export default function ChannelPage({ params }: { params: { slug: string } }) {
  const roomName = params.slug
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'publishing'>('idle')
  const [identity] = useState<string>(() => 'guest_' + Math.random().toString(36).slice(2))
  const [error, setError] = useState<string | null>(null)

  // UX state
  const [isListening, setIsListening] = useState(false) // start muted; require click
  const [iHaveAux, setIHaveAux] = useState(false)
  const [collabAllowed, setCollabAllowed] = useState(false)
  const [collabOccupied, setCollabOccupied] = useState(false)

  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const roomRef = useRef<Room | null>(null)
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!

  // ----- helpers -----

  function computeStateAndMaybePlay() {
    const room = roomRef.current
    if (!room) return

    // Do I have aux?
    const myPubs = room.localParticipant.getTrackPublications()
    setIHaveAux(
      myPubs.some((p: TrackPublication) =>
        p.track?.kind === Track.Kind.Audio &&
        (p.trackName === 'aux' || p.track?.mediaStreamTrack.label === 'aux'))
    )

    // Find remote aux (or collab)
    const remotes: RemoteParticipant[] = Array.from(room.remoteParticipants.values())
    const findByName = (name: 'aux' | 'collab') =>
      remotes
        .flatMap(r => r.getTrackPublications())
        .find((p: TrackPublication) => p.track?.kind === Track.Kind.Audio && p.trackName === name)

    const target = findByName('aux') ?? findByName('collab')
    setCollabOccupied(Boolean(findByName('collab')))

    if (!audioElRef.current) return
    if (target?.track) {
      audioElRef.current.srcObject = new MediaStream([target.track.mediaStreamTrack])
      if (!audioElRef.current.muted) {
        audioElRef.current.play().catch(() => {/* requires user gesture; handled by Listen button */})
      }
    } else {
      audioElRef.current.srcObject = null
    }
  }

function stopNamedTrack(name: 'aux' | 'collab') {
  const room = roomRef.current; if (!room) return

  for (const pub of room.localParticipant.getTrackPublications()) {
    const isAudio = pub.track?.kind === Track.Kind.Audio
    const matches = pub.trackName === name || pub.track?.mediaStreamTrack.label === name
    if (!isAudio || !matches) continue

    // ✅ use the LocalTrack, not SID
    const t = pub.track as LocalTrack | null
    if (t) {
      try {
        room.localParticipant.unpublishTrack(t, true) // stopOnUnpublish = true
        t.stop()
      } catch {}
    }
  }
  computeStateAndMaybePlay()
}

let rafId: number | null = null
function computeStateAndMaybePlayRAF() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    computeStateAndMaybePlay()
    rafId = null
  })
}

  // ----- lifecycle -----

  useEffect(() => {
    let cancelled = false
    const room = new Room()

    async function join() {
      try {
        setStatus('connecting')
        const res = await fetch(`/api/livekit?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`)
        const { token } = await res.json()
        if (!token) throw new Error('No token from LiveKit API')

        await room.connect(livekitUrl, token)
        if (cancelled) { room.disconnect(); return }
        roomRef.current = room
        setStatus('connected')

        // audio element (start muted)
        if (!audioElRef.current) {
          const el = document.createElement('audio')
          el.autoplay = true
          el.controls = true
          el.muted = true
          el.style.position = 'fixed'
          el.style.bottom = '12px'
          el.style.left = '12px'
          el.style.zIndex = '10000'
          document.body.appendChild(el)
          audioElRef.current = el
        }

        // events → recompute + (maybe) play
        room.on(RoomEvent.TrackSubscribed, computeStateAndMaybePlayRAF)
room.on(RoomEvent.TrackUnsubscribed, computeStateAndMaybePlayRAF)
room.on(RoomEvent.ParticipantConnected, computeStateAndMaybePlayRAF)
room.on(RoomEvent.ParticipantDisconnected, computeStateAndMaybePlayRAF)
room.on(RoomEvent.LocalTrackPublished, computeStateAndMaybePlayRAF)
room.on(RoomEvent.LocalTrackUnpublished, computeStateAndMaybePlayRAF)

        // room.on(RoomEvent.TrackSubscribed, computeStateAndMaybePlay)
        // room.on(RoomEvent.TrackUnsubscribed, computeStateAndMaybePlay)
        // room.on(RoomEvent.ParticipantConnected, computeStateAndMaybePlay)
        // room.on(RoomEvent.ParticipantDisconnected, computeStateAndMaybePlay)
        // room.on(RoomEvent.LocalTrackPublished, computeStateAndMaybePlay)
        // room.on(RoomEvent.LocalTrackUnpublished, computeStateAndMaybePlay)

        // control protocol via data messages
        room.on(RoomEvent.DataReceived, (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as ControlMsg
            if (msg.type === 'collab:allow') setCollabAllowed(msg.allowed)
            if (msg.type === 'collab:close') stopNamedTrack('collab')
          } catch {}
        })

        computeStateAndMaybePlay()
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

  // ----- actions -----

  async function listenNow() {
    const room = roomRef.current; if (!room) return
    try { await room.startAudio() } catch {}
    if (audioElRef.current) {
      audioElRef.current.muted = false
      try { await audioElRef.current.play() } catch {}
    }
    setIsListening(true)
  }

  function muteNow() {
    if (audioElRef.current) audioElRef.current.muted = true
    setIsListening(false)
  }

  async function takeAuxMic() {
    try {
      const room = roomRef.current; if (!room) return
      const [audioTrack] = await createLocalTracks({ audio: true })
      await room.localParticipant.publishTrack(audioTrack as LocalAudioTrack, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)
      computeStateAndMaybePlay()
    } catch (e: any) { setError(e.message || String(e)) }
  }

  // Must be called directly from the button click (Chrome requirement)
  async function takeAuxTab() {
  try {
    const room = roomRef.current; if (!room) return

    // Cast once to avoid TS complaints; call directly in the click handler
    const md: any = navigator.mediaDevices
    const stream: MediaStream = await md.getDisplayMedia({
      video: { displaySurface: 'monitor' }, // Chrome hint; harmless elsewhere
      audio: true,
    })

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('No audio track from display capture')
    stream.getVideoTracks().forEach(t => t.stop())

    await room.localParticipant.publishTrack(audioTrack, { name: 'aux' })
    setStatus('publishing'); setIHaveAux(true)
    computeStateAndMaybePlay()
  } catch (e:any) {
    const msg = String(e?.message || e)
    if (msg.toLowerCase().includes('not supported')) {
      setError('Screen capture audio not supported in this browser/context. Use desktop Chrome/Edge, and share Entire Screen + system audio.')
    } else if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('allowed')) {
      setError('Screen share was blocked. Ensure the iframe includes display-capture permission.')
    } else {
      setError(msg)
    }
  }
}


  async function takeAuxFile() {
    try {
      const room = roomRef.current; if (!room) return
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return
        const url = URL.createObjectURL(file)

        const el = new Audio(url)
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const src = ctx.createMediaElementSource(el)
        const dest = ctx.createMediaStreamDestination()
        src.connect(dest)
        src.connect(ctx.destination)

        await el.play().catch(() => {/* user gesture already */})
        const track = dest.stream.getAudioTracks()[0]
        await room.localParticipant.publishTrack(track, { name: 'aux' })
        setStatus('publishing'); setIHaveAux(true)
        computeStateAndMaybePlay()

     el.onended = () => {
  const pub = room.localParticipant.getTrackPublications().find(p => p.trackName === 'aux')
  const t = pub?.track as LocalTrack | null
  if (t) {
    room.localParticipant.unpublishTrack(t, true)
    t.stop()
  }
  track.stop()
  ctx.close()
  setStatus('connected'); setIHaveAux(false)
  computeStateAndMaybePlay()
}

      }
      input.click()
    } catch (e: any) { setError(e.message || String(e)) }
  }

  async function passAux() {
    stopNamedTrack('aux')
    if (collabAllowed) await setCollabAllowedByController(false) // also close collab if open
    setIHaveAux(false)
    setStatus('connected')
    computeStateAndMaybePlay()
  }

  async function setCollabAllowedByController(allowed: boolean) {
    const room = roomRef.current; if (!room) return
    if (!iHaveAux) { setError('Only the aux holder can change collab'); return }
    setCollabAllowed(allowed)
    const enc = new TextEncoder()
    await room.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'collab:allow', allowed })), { reliable: true })
    if (!allowed) {
      await room.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'collab:close' })), { reliable: true })
    }
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
      computeStateAndMaybePlay()
    } catch (e: any) { setError(e.message || String(e)) }
  }

  const canTakeAux = status === 'connected' && !iHaveAux
  const canPassAux = iHaveAux
  const canStartCollab = iHaveAux
  const canJoinCollab = !iHaveAux && collabAllowed && !collabOccupied

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 560, width: '100%', background: '#0e0e10', color: '#eee', padding: 16, borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.3)' }}>
        <h1 style={{ marginTop: 0 }}>Audio Arcade — {roomName}</h1>
        <p style={{ opacity: 0.8, marginTop: 4 }}>
          Status: <strong>{status}</strong> • Aux: <strong>{iHaveAux ? 'You' : 'Someone else / free'}</strong> • Collab: <strong>{collabAllowed ? (collabOccupied ? 'In Use' : 'Open') : 'Closed'}</strong>
        </p>
        {error && <p style={{ color: '#ff8484' }}>Error: {error}</p>}

        {/* Listen / Mute */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={listenNow} disabled={isListening}>Listen</button>
          <button onClick={muteNow} disabled={!isListening}>Mute</button>
        </div>

        {/* Aux controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={takeAuxMic} disabled={!canTakeAux}>Take the Aux (Mic)</button>
          <button onClick={takeAuxTab} disabled={!canTakeAux}>Take the Aux (Share Tab/System)</button>
          <button onClick={takeAuxFile} disabled={!canTakeAux}>Take the Aux (Play File)</button>
          <button onClick={passAux} disabled={!canPassAux}>Pass the Aux</button>
        </div>

        {/* Collab controls */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={() => setCollabAllowedByController(!collabAllowed)} disabled={!canStartCollab}>
            {collabAllowed ? 'Close Collab Slot' : 'Open Collab Slot'}
          </button>
          <button onClick={joinCollab} disabled={!canJoinCollab}>Join Collab</button>
          <button onClick={() => setCollabAllowedByController(false)} disabled={!iHaveAux || !collabAllowed}>End Collab</button>
        </div>

        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 10, lineHeight: 1.4 }}>
          “Take the Aux” publishes your mic, tab/system audio (desktop Chrome/Edge), or a local file. “Pass the Aux” stops your aux track immediately for everyone.
          The aux holder can open one **Collab** slot (beats + vocals). Mobile browsers can’t publish system audio—use Mic or Play File.
        </p>
      </div>
    </main>
  )
}
