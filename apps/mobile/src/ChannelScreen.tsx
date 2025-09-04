// apps/mobile/src/ChannelScreen.tsx
import React, { useEffect, useRef, useState } from 'react'
import { SafeAreaView, View, Text, Button, StyleSheet } from 'react-native'

// Register WebRTC globals for RN
import { registerGlobals } from '@livekit/react-native'
registerGlobals()

// Use the web client SDK on RN
import {
  Room, RoomEvent, Track, createLocalTracks,
  type RemoteParticipant, type TrackPublication,
  type LocalTrack, type LocalAudioTrack
} from 'livekit-client'


// keep this AFTER registerGlobals() (shown above)


const LIVEKIT_URL = 'wss://YOUR-PROJECT.livekit.cloud' // <-- same as web NEXT_PUBLIC_LIVEKIT_URL
const API_BASE = 'https://YOUR-VERCEL-APP.vercel.app'  // <-- your deployed web app domain

type ControlMsg =
  | { type: 'collab:allow'; allowed: boolean }
  | { type: 'collab:close' }

export default function ChannelScreen({ roomName = 'demo' }: { roomName?: string }) {
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'publishing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)  // RN plays automatically; we mimic the web UX
  const [iHaveAux, setIHaveAux] = useState(false)
  const [collabAllowed, setCollabAllowed] = useState(false)
  const [collabOccupied, setCollabOccupied] = useState(false)

  const roomRef = useRef<Room | null>(null)
  const identityRef = useRef('mobile_' + Math.random().toString(36).slice(2))

  // compute state similar to web
  const computeState = () => {
    const room = roomRef.current; if (!room) return
    const mine = room.localParticipant.getTrackPublications()
    setIHaveAux(mine.some((p: TrackPublication) =>
      p.track?.kind === Track.Kind.Audio && (p.trackName === 'aux' || p.track?.mediaStreamTrack.label === 'aux')
    ))
    const remotes: RemoteParticipant[] = Array.from(room.remoteParticipants.values())
    const findByName = (name: 'aux'|'collab') =>
      remotes.flatMap(r => r.getTrackPublications())
             .find((p: TrackPublication) => p.track?.kind === Track.Kind.Audio && p.trackName === name)
    setCollabOccupied(Boolean(findByName('collab')))
  }

  useEffect(() => {
    const room = new Room()
    let mounted = true

    const join = async () => {
      try {
        setStatus('connecting')
        const res = await fetch(`${API_BASE}/api/livekit?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identityRef.current)}`)
        const { token } = await res.json()
        if (!token) throw new Error('No token')

        await room.connect(LIVEKIT_URL, token, )
        if (!mounted) { room.disconnect(); return }
        publishDefaults: { dtx: true }
        roomRef.current = room
        setStatus('connected')

        // events
        room.on(RoomEvent.ParticipantConnected, computeState)
        room.on(RoomEvent.ParticipantDisconnected, computeState)
        room.on(RoomEvent.TrackSubscribed, computeState)
        room.on(RoomEvent.TrackUnsubscribed, computeState)
        room.on(RoomEvent.LocalTrackPublished, computeState)
        room.on(RoomEvent.LocalTrackUnpublished, computeState)

        room.on(RoomEvent.DataReceived, (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as ControlMsg
            if (msg.type === 'collab:allow') setCollabAllowed(msg.allowed)
            if (msg.type === 'collab:close') stopNamedTrack('collab')
          } catch {}
        })

        computeState()
      } catch (e:any) {
        setError(e.message || String(e))
        setStatus('idle')
      }
    }

    join()
    return () => {
      mounted = false
      room.disconnect()
    }
  }, [roomName])

  const takeAuxMic = async () => {
    try {
      const room = roomRef.current; if (!room) return
      const [audioTrack] = await createLocalTracks({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000
        }
      })
      await room.localParticipant.publishTrack(audioTrack as LocalAudioTrack, { name: 'aux', dtx: true })
      setStatus('publishing'); setIHaveAux(true); computeState()
    } catch (e:any) { setError(e.message || String(e)) }
  }

  const passAux = async () => {
    stopNamedTrack('aux')
    if (collabAllowed) await setCollabAllowedByController(false)
    setStatus('connected'); setIHaveAux(false); computeState()
  }

  const joinCollab = async () => {
    try {
      if (iHaveAux) { setError('You already have the aux'); return }
      if (!collabAllowed) { setError('Collab is closed'); return }
      if (collabOccupied) { setError('Collab slot is occupied'); return }
      const room = roomRef.current; if (!room) return
      const [audioTrack] = await createLocalTracks({ audio: true })
      await room.localParticipant.publishTrack(audioTrack as LocalAudioTrack, { name: 'collab' })
      setStatus('publishing'); setCollabOccupied(true); computeState()
    } catch (e:any) { setError(e.message || String(e)) }
  }

  const setCollabAllowedByController = async (allowed: boolean) => {
    const room = roomRef.current; if (!room) return
    if (!iHaveAux) { setError('Only the aux holder can change collab'); return }
    setCollabAllowed(allowed)
    const enc = new TextEncoder()
    await room.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'collab:allow', allowed })), { reliable: true })
    if (!allowed) {
      await room.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'collab:close' })), { reliable: true })
    }
  }

  const stopNamedTrack = (name: 'aux'|'collab') => {
    const room = roomRef.current; if (!room) return
    for (const pub of room.localParticipant.getTrackPublications()) {
      const isAudio = pub.track?.kind === Track.Kind.Audio
      const matches = pub.trackName === name || pub.track?.mediaStreamTrack.label === name
      if (!isAudio || !matches) continue
      const t = pub.track as LocalTrack | null
      if (t) {
        room.localParticipant.unpublishTrack(t, true)
        t.stop()
      }
    }
    computeState()
  }

  return (
    <SafeAreaView style={s.container}>
      <Text style={s.h1}>Audio Arcade — {roomName} (Android)</Text>
      <Text style={s.meta}>Status: {status} • Aux: {iHaveAux ? 'You' : 'Someone else / free'} • Collab: {collabAllowed ? (collabOccupied ? 'In Use' : 'Open') : 'Closed'}</Text>
      {error ? <Text style={s.err}>Error: {error}</Text> : null}

      <View style={s.row}>
        <Button title={isListening ? 'Mute' : 'Listen'} onPress={() => setIsListening(v => !v)} />
      </View>

      <View style={s.row}>
        <Button title="Take the Aux (Mic)" onPress={takeAuxMic} disabled={status !== 'connected' || iHaveAux} />
        <Button title="Pass the Aux" onPress={passAux} disabled={!iHaveAux} />
      </View>

      <View style={s.row}>
        <Button title={collabAllowed ? 'Close Collab Slot' : 'Open Collab Slot'}
                onPress={() => setCollabAllowedByController(!collabAllowed)}
                disabled={!iHaveAux} />
        <Button title="Join Collab" onPress={joinCollab} disabled={iHaveAux || !collabAllowed || collabOccupied} />
      </View>

      <Text style={s.tip}>
        Mobile can publish mic audio (no true system audio). For beats, aux holder can open Collab and a second device can join.
      </Text>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e0e10', padding: 16 },
  h1: { color: '#fff', fontSize: 20, fontWeight: '700' },
  meta: { color: '#bbb', marginTop: 6 },
  err: { color: '#ff8484', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tip: { color: '#aaa', fontSize: 12, marginTop: 14, lineHeight: 18 }
})
