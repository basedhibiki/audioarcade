'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type RemoteParticipant,
  type TrackPublication,
   
  type LocalTrackPublication,
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
  const [isListening, setIsListening] = useState(false) // start muted (autoplay)
  const [iHaveAux, setIHaveAux] = useState(false)
  const [collabAllowed, setCollabAllowed] = useState(false)
  const [collabOccupied, setCollabOccupied] = useState(false)
  const [iOccupyCollab, setIOccupyCollab] = useState(false)

  // Refs
  const roomRef = useRef<Room | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Decide what to play (aux > collab) and wire <audio> element
  const computeStateAndMaybePlay = useCallback(() => {
    const room = roomRef.current
    if (!room) return

    const myPubs = room.localParticipant.getTrackPublications()
    setIHaveAux(
      myPubs.some(
        (p: TrackPublication) =>
          p.track?.kind === Track.Kind.Audio &&
          (p.trackName === 'aux' || p.track?.mediaStreamTrack.label === 'aux'),
      ),
    )
    setIOccupyCollab(
      myPubs.some(
        (p: TrackPublication) =>
          p.track?.kind === Track.Kind.Audio && p.trackName === 'collab',
      ),
    )

    const remotes: RemoteParticipant[] = Array.from(room.remoteParticipants.values())
    const findByName = (name: 'aux' | 'collab') =>
      remotes
        .flatMap((r) => r.getTrackPublications())
        .find(
          (p: TrackPublication) =>
            p.track?.kind === Track.Kind.Audio && p.trackName === name,
        )

    const target = findByName('aux') ?? findByName('collab')
    setCollabOccupied(Boolean(findByName('collab')))

    if (!audioElRef.current) return
    if (target?.track) {
      audioElRef.current.srcObject = new MediaStream([target.track.mediaStreamTrack])
      if (isListening) audioElRef.current.play().catch(() => {})
    } else {
      audioElRef.current.srcObject = null
    }
  }, [isListening])

  // v2-safe unpublish+stop by name, then recompute
  function stopNamedTrack(name: 'aux' | 'collab') {
  const room = roomRef.current
  if (!room) return

  // Narrow to LocalTrackPublication so .track is a LocalTrack
  const pubs = room.localParticipant.getTrackPublications() as LocalTrackPublication[]

  for (const pub of pubs) {
    const track = pub.track as LocalTrack | undefined
    const isAudio = track?.kind === Track.Kind.Audio
    const matches =
      pub.trackName === name || track?.mediaStreamTrack.label === name
    if (!isAudio || !matches) continue

    try {
      if (track) {
        // ✅ TS now knows this is a LocalTrack
        room.localParticipant.unpublishTrack(track, true) // stopOnUnpublish = true
        track.stop?.()
      } else {
        // Fallback: unpublish the publication object if track is missing
        room.localParticipant.unpublishTrack(pub as any, true)
      }
    } catch {
      /* ignore */
    }
  }

  computeStateAndMaybePlay()
}

  // Share Tab/System (desktop)
  async function takeAuxTab(ev?: React.MouseEvent<HTMLButtonElement>) {
    try {
      const room = roomRef.current
      if (!room) return

      // Must be called in click handler; request video+audio so Chrome shows checkbox
      const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { displaySurface: 'monitor' } as any, // or 'browser'
        audio: true,
      } as any)

      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) throw new Error('No audio track from display capture')
      // Drop video to save CPU
      stream.getVideoTracks().forEach((t) => t.stop())

      await room.localParticipant.publishTrack(audioTrack, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)
      computeStateAndMaybePlay()
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.includes('Not allowed') || msg.includes('permission')) {
        setError('Screen share was blocked. Ensure the iframe has display-capture permission and try again.')
      } else if (msg.includes('Not supported')) {
        setError('Screen capture audio not supported in this browser/context. Try Chrome/Edge desktop and share Entire Screen + system audio.')
      } else {
        setError(msg)
      }
    }
  }

  // Publish a local audio file as AUX (mobile-friendly)
  function triggerAuxFile() {
    fileInputRef.current?.click()
  }
  async function onAuxFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const room = roomRef.current; if (!room) return
      const file = e.target.files?.[0]
      if (!file) return

      const el = new Audio()
      el.src = URL.createObjectURL(file)
      el.loop = false
      el.crossOrigin = 'anonymous'
      await el.play().catch(() => {})

      const Ctx: any = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      const src = ctx.createMediaElementSource(el)
      const dest = ctx.createMediaStreamDestination()
      src.connect(dest)
      src.connect(ctx.destination) // local monitor
      const track = dest.stream.getAudioTracks()[0]
      if (!track) throw new Error('Could not create audio track')
      await room.localParticipant.publishTrack(track, { name: 'aux' })
      setStatus('publishing'); setIHaveAux(true)
      computeStateAndMaybePlay()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Collab open/close (AUX holder broadcasts)
  async function setCollabAllowedByController(allowed: boolean) {
    setCollabAllowed(allowed)
    const room = roomRef.current
    if (!room) return
    const msg: Msg = allowed ? { type: 'collab:allow', allowed: true } : { type: 'collab:close' }
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true })
    } catch {}
    computeStateAndMaybePlay()
  }

  // Occupy/Leave collab (mic)
  async function occupyCollab() {
    const room = roomRef.current; if (!room) return
    if (iHaveAux) { setError('You already hold AUX.'); return }
    if (!collabAllowed) { setError('Collab is closed by AUX holder.'); return }
    if (collabOccupied && !iOccupyCollab) { setError('Collab is already occupied.'); return }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const mic = stream.getAudioTracks()[0]
      if (!mic) throw new Error('No microphone available')
      await room.localParticipant.publishTrack(mic, { name: 'collab' })
      computeStateAndMaybePlay()
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }
  function leaveCollab() { stopNamedTrack('collab') }

  // Pass AUX: drop now & close collab
  async function passAux() {
    stopNamedTrack('aux')
    if (collabAllowed) await setCollabAllowedByController(false)
    setIHaveAux(false)
    setStatus('connected')
    computeStateAndMaybePlay()
  }

  // Local listen/mute
  function toggleListening() {
    const el = audioElRef.current
    if (!el) return
    const next = !isListening
    setIsListening(next)
    el.muted = !next
    if (next) {
      const tryPlay = () => el.play().catch(() => {})
      tryPlay(); setTimeout(tryPlay, 50); setTimeout(tryPlay, 300)
    } else {
      el.pause()
    }
  }

  // Token fetch
  async function fetchToken(room: string, userId: string): Promise<string> {
    const qs = new URLSearchParams({ room, identity: userId })
    const res = await fetch(`/api/token?${qs.toString()}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j?.error || `Token HTTP ${res.status}`)
    }
    const { token } = await res.json()
    return token
  }

  // Connect lifecycle
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatus('connecting'); setError(null)
        const token = await fetchToken(roomName, identity)
        if (cancelled) return

        const room = new Room({})
        roomRef.current = room

        room.on(RoomEvent.TrackSubscribed, computeStateAndMaybePlay)
        room.on(RoomEvent.TrackUnsubscribed, computeStateAndMaybePlay)
        room.on(RoomEvent.ParticipantConnected, computeStateAndMaybePlay)
        room.on(RoomEvent.ParticipantDisconnected, computeStateAndMaybePlay)
        room.on(RoomEvent.LocalTrackPublished, computeStateAndMaybePlay)
        room.on(RoomEvent.LocalTrackUnpublished, computeStateAndMaybePlay)

        room.on(RoomEvent.DataReceived, (payload) => {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as Msg
            if (parsed.type === 'collab:allow') {
              setCollabAllowed(parsed.allowed)
            } else if (parsed.type === 'collab:close') {
              setCollabAllowed(false)
              stopNamedTrack('collab')
            }
            computeStateAndMaybePlay()
          } catch {}
        })

        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token)
        if (cancelled) return
        setStatus('connected')
        computeStateAndMaybePlay()
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || String(e)); setStatus('idle') }
      }
    })()
    return () => {
      cancelled = true
      const room = roomRef.current
      if (room) { try { room.disconnect() } catch {} }
      roomRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, identity])

  // UI
  return (
    <div className="mx-auto w-full max-w-3xl p-4 space-y-4">
      <h1 className="text-xl font-semibold">Channel: {roomName}</h1>

      <div className="rounded-lg border p-3 text-sm">
        <div>Status: <span className="font-medium">{status}</span></div>
        <div>Identity: <span className="font-mono">{identity}</span></div>
        <div>I have AUX: <span className="font-medium">{iHaveAux ? 'Yes' : 'No'}</span></div>
        <div>Collab allowed: <span className="font-medium">{collabAllowed ? 'Yes' : 'No'}</span></div>
        <div>Collab occupied: <span className="font-medium">{collabOccupied ? 'Yes' : 'No'}</span></div>
        <div>I occupy collab: <span className="font-medium">{iOccupyCollab ? 'Yes' : 'No'}</span></div>
        {error && <div className="mt-2 rounded bg-red-600/10 p-2 text-red-700">{error}</div>}
      </div>

    {/* Hidden file input for "Play File to AUX" */}
<input
  ref={fileInputRef}
  type="file"
  accept="audio/*"
  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: -9999, top: 0 }}
  onChange={onAuxFilePicked}
/>


      <div className="ps2-grid">
        {/* AUX controls */}
        <button
          onClick={takeAuxTab}
          className="ps2-btn"
          disabled={status !== 'connected' && status !== 'publishing'}
          title="Share a tab or entire screen with system audio"
        >
          Take AUX
        </button>

        <button
          onClick={passAux}
          className="ps2-btn"
          disabled={!iHaveAux}
          title="Unpublish & stop AUX immediately"
        >
          Pass the AUX
        </button>

        <button
          onClick={triggerAuxFile}
          className="ps2-btn"
          disabled={status !== 'connected'}
          title="Publish a local audio file as AUX (mobile-friendly)"
        >
          Play File to AUX
        </button>

        {/* Collab gate: only AUX holder can open/close collab */}
        <button
          onClick={() => setCollabAllowedByController(!collabAllowed)}
          className="ps2-btn"
          disabled={!iHaveAux}
          title="Only AUX holder can open or close collab"
        >
          {collabAllowed ? 'Close Collab' : 'Open Collab'}
        </button>

        {/* Occupy/Leave Collab: only non-AUX can occupy, one at a time */}
        {collabAllowed && !iHaveAux && (
          iOccupyCollab ? (
            <button onClick={leaveCollab} className="ps2-btn" title="Stop sending your mic">
              Leave Collab
            </button>
          ) : (
            <button
              onClick={occupyCollab}
              className="ps2-btn"
              disabled={collabOccupied}
              title={collabOccupied ? 'Someone else is on collab' : 'Send your mic to the room'}
            >
              {collabOccupied ? 'Collab Occupied' : 'Occupy Collab'}
            </button>
          )
        )}

        {/* Local playback */}
        <button
          onClick={toggleListening}
          className="ps2-btn"
          title="Toggle local playback (client-side)"
        >
          {isListening ? 'Mute' : 'Listen'}
        </button>
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 text-sm opacity-80">
          Listener output (auto-switches to AUX or falls back to COLLAB):
        </div>
        <audio
          ref={audioElRef}
          autoPlay
          muted={!isListening}
          className="w-full"
          controls
        />
      </div>

      <div className="prose prose-invert max-w-none text-sm opacity-80">
        <h3 className="text-base font-semibold">Notes (Desktop vs Mobile)</h3>
        <ul className="list-disc pl-6">
          <li><strong>Windows (Chrome/Edge):</strong> Entire Screen + “Share system audio”.</li>
          <li><strong>macOS:</strong> no true system mix; use Tab Audio or a virtual device (BlackHole/Loopback).</li>
          <li><strong>Mobile:</strong> browsers can’t share system audio; use <em>Play File to AUX</em> or <em>Collab (Mic)</em>.</li>
        </ul>
      </div>
    </div>
  )
}
