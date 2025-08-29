'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type RemoteParticipant,
  type TrackPublication,
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
  const [isListening, setIsListening] = useState(false) // start muted
  const [iHaveAux, setIHaveAux] = useState(false)
  const [collabAllowed, setCollabAllowed] = useState(false)
  const [collabOccupied, setCollabOccupied] = useState(false)

  // Refs
  const roomRef = useRef<Room | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)

  // --- Helpers you referenced ---

  // C) Always decide what to play (aux > collab) and (re)wire <audio> element
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
      audioElRef.current.srcObject = new MediaStream([
        target.track.mediaStreamTrack,
      ])
      if (!audioElRef.current.muted) {
        audioElRef.current
          .play()
          .catch(() => {
            /* no-op */
          })
      }
    } else {
      audioElRef.current.srcObject = null
    }
  }, [])

  // A1) v2-safe unpublish+stop by name, then recompute
 function stopNamedTrack(name: 'aux' | 'collab') {
  const room = roomRef.current
  if (!room) return

  const pubs = room.localParticipant.getTrackPublications()
  for (const pub of pubs) {
    const isAudio = pub.track?.kind === Track.Kind.Audio
    const matches =
      pub.trackName === name || pub.track?.mediaStreamTrack.label === name
    if (!isAudio || !matches) continue

    // ✔ LiveKit v2: unpublish the *track* (or the publication), not a SID string
    try {
      if (pub.track) {
       room.localParticipant.unpublishTrack(pub as any, true)

        // extra safety: stop underlying track if still present
        ;(pub.track as LocalTrack)?.stop?.()
      } else {
        // Fallback: if a track object isn’t present, try unpublishing the publication itself
        room.localParticipant.unpublishTrack(pub as any, true)
      }
    } catch {
      /* ignore */
    }
  }

  computeStateAndMaybePlay()
}


  // B2) Button-safe share tab/system with audio (Chrome picker requires video+audio)
async function takeAuxTab(ev?: React.MouseEvent<HTMLButtonElement>) {
  try {
    const room = roomRef.current
    if (!room) return

    // Request video+audio so Chrome shows the system-audio checkbox in the picker.
    const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: { displaySurface: 'monitor' } as any, // 'browser' also fine; cast keeps TS happy
      audio: true,
    } as any)

    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('No audio track from display capture')

    // Drop video to save CPU
    stream.getVideoTracks().forEach((t) => t.stop())

    await room.localParticipant.publishTrack(audioTrack, { name: 'aux' })
    setStatus('publishing')
    setIHaveAux(true)
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


  // Stub: broadcast collab allow/close to others (data channel)
  async function setCollabAllowedByController(allowed: boolean) {
    setCollabAllowed(allowed)
    const room = roomRef.current
    if (!room) return
    const msg: Msg = allowed
      ? { type: 'collab:allow', allowed: true }
      : { type: 'collab:close' }
    try {
      await room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(msg)),
        { reliable: true },
      )
    } catch {
      /* ignore */
    }
    computeStateAndMaybePlay()
  }

  // A2) Pass the AUX: drop now, close collab if open, recompute
  async function passAux() {
    stopNamedTrack('aux')
    if (collabAllowed) await setCollabAllowedByController(false)
    setIHaveAux(false)
    setStatus('connected')
    computeStateAndMaybePlay()
  }

  // Listen/unmute toggle (client playback)
  function toggleListening() {
    const el = audioElRef.current
    if (!el) return
    const next = !isListening
    setIsListening(next)
    el.muted = !next
    if (next) {
      el.play().catch(() => {
        /* ignore */
      })
    } else {
      el.pause()
    }
  }

  // --- LiveKit connection lifecycle ---

  // You likely already have an API route that mints access tokens.
  // Adjust this to your own endpoint if different.
  async function fetchToken(room: string, userId: string): Promise<string> {
    const qs = new URLSearchParams({ room, identity: userId })
    const res = await fetch(`/api/token?${qs.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch LiveKit token')
    const { token } = await res.json()
    return token
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatus('connecting')
        setError(null)

        const token = await fetchToken(roomName, identity)
        if (cancelled) return

        const room = new Room({
          // your client options here if any (e.g., adaptiveStream, dynacast, etc.)
        })
        roomRef.current = room

        // Recompute on relevant events (C & A)
        room.on(RoomEvent.TrackSubscribed, computeStateAndMaybePlay)
        room.on(RoomEvent.TrackUnsubscribed, computeStateAndMaybePlay)
        room.on(RoomEvent.ParticipantConnected, computeStateAndMaybePlay)
        room.on(RoomEvent.ParticipantDisconnected, computeStateAndMaybePlay)
        room.on(RoomEvent.LocalTrackPublished, computeStateAndMaybePlay)
        room.on(RoomEvent.LocalTrackUnpublished, computeStateAndMaybePlay)

        // Handle data messages for collab state (optional, keeps everyone in sync)
        room.on(RoomEvent.DataReceived, (payload, _participant, _kind) => {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as Msg
            if (parsed.type === 'collab:allow') {
              setCollabAllowed(parsed.allowed)
            } else if (parsed.type === 'collab:close') {
              setCollabAllowed(false)
              stopNamedTrack('collab')
            }
            computeStateAndMaybePlay()
          } catch {
            /* ignore */
          }
        })

        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token)
        if (cancelled) return

        setStatus('connected')
        // initial compute after connect
        computeStateAndMaybePlay()
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || String(e))
          setStatus('idle')
        }
      }
    })()

    return () => {
      cancelled = true
      const room = roomRef.current
      if (room) {
        try {
          room.disconnect()
        } catch {
          /* ignore */
        }
        roomRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, identity])

  // --- UI ---

  return (
    <div className="mx-auto w-full max-w-3xl p-4 space-y-4">
      <h1 className="text-xl font-semibold">Channel: {roomName}</h1>

      <div className="rounded-lg border p-3 text-sm">
        <div>Status: <span className="font-medium">{status}</span></div>
        <div>Identity: <span className="font-mono">{identity}</span></div>
        <div>I have AUX: <span className="font-medium">{iHaveAux ? 'Yes' : 'No'}</span></div>
        <div>Collab allowed: <span className="font-medium">{collabAllowed ? 'Yes' : 'No'}</span></div>
        <div>Collab occupied: <span className="font-medium">{collabOccupied ? 'Yes' : 'No'}</span></div>
        {error && (
          <div className="mt-2 rounded bg-red-600/10 p-2 text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={takeAuxTab}
          className="rounded-lg border px-3 py-2 hover:bg-white/5"
          disabled={status !== 'connected' && status !== 'publishing'}
          title="Share a tab or entire screen with system audio"
        >
          Take AUX (Share Tab/System)
        </button>

        <button
          onClick={passAux}
          className="rounded-lg border px-3 py-2 hover:bg-white/5"
          disabled={!iHaveAux}
          title="Unpublish & stop AUX immediately"
        >
          Pass the AUX
        </button>

        <button
          onClick={() => setCollabAllowedByController(!collabAllowed)}
          className="rounded-lg border px-3 py-2 hover:bg-white/5"
          title="Toggle collaborator mic publishing permission"
        >
          {collabAllowed ? 'Close Collab' : 'Open Collab'}
        </button>

        <button
          onClick={toggleListening}
          className="rounded-lg border px-3 py-2 hover:bg-white/5"
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
        <h3 className="text-base font-semibold">Notes (Mac/Mobile realities)</h3>
        <ul className="list-disc pl-6">
          <li>
            <strong>Windows (Chrome/Edge)</strong>: choose <em>Entire Screen</em> and tick <em>Share system audio</em>.
          </li>
          <li>
            <strong>macOS</strong>: browsers can’t capture true system audio; use Tab Audio or a virtual device (BlackHole/Loopback).
          </li>
          <li>
            <strong>Mobile</strong>: no system audio capture; use Mic or a “Play File” button that publishes via WebAudio.
          </li>
        </ul>
      </div>
    </div>
  )
}
