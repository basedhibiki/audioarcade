'use client'

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react'
import {
  ConnectionState,
  LocalParticipant,
  Participant,
  RoomEvent,
  Track,
} from 'livekit-client'
import { FormEvent, use, useEffect, useMemo, useState } from 'react'

type JoinState = {
  displayName: string
  token: string
}

type AudioDevice = {
  deviceId: string
  label: string
}

type AudioSourceMode = 'interface' | 'browser'

const AUX_ATTRIBUTE = 'audioArcadeAuxClaim'

function normaliseName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 32)
}

function participantName(participant: Participant | LocalParticipant) {
  return participant.name || participant.identity
}

function auxClaim(participant: Participant | LocalParticipant) {
  const raw = participant.attributes?.[AUX_ATTRIBUTE]
  if (!raw) return null
  const timestamp = Number(raw)
  return Number.isFinite(timestamp) ? timestamp : null
}

export default function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: roomName } = use(params)
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL
  const [joinState, setJoinState] = useState<JoinState | null>(null)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  async function join(displayName: string, password: string) {
    const cleanName = normaliseName(displayName)
    if (!cleanName || !serverUrl) return

    setJoining(true)
    setJoinError('')

    try {
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ room: roomName, displayName: cleanName, password }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.token) {
        throw new Error(payload.error || 'Could not join the room.')
      }

      window.localStorage.setItem('audio-arcade-display-name', cleanName)
      setJoinState({ displayName: cleanName, token: payload.token })
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not join the room.')
    } finally {
      setJoining(false)
    }
  }

  if (!serverUrl) {
    return (
      <main className="aa-page aa-centred">
        <section className="aa-card aa-join-card">
          <p className="aa-kicker">Configuration error</p>
          <h1>Audio Arcade cannot connect</h1>
          <p>NEXT_PUBLIC_LIVEKIT_URL is missing from the deployment environment.</p>
        </section>
      </main>
    )
  }

  if (!joinState) {
    return (
      <JoinScreen
        roomName={roomName}
        joining={joining}
        error={joinError}
        onJoin={join}
      />
    )
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={joinState.token}
      connect
      audio={false}
      video={false}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={() => setJoinState(null)}
      onError={(error) => setJoinError(error.message)}
    >
      <RoomShell roomName={roomName} displayName={joinState.displayName} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

function JoinScreen({
  roomName,
  joining,
  error,
  onJoin,
}: {
  roomName: string
  joining: boolean
  error: string
  onJoin: (displayName: string, password: string) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    setDisplayName(window.localStorage.getItem('audio-arcade-display-name') || '')
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onJoin(displayName, password)
  }

  return (
    <main className="aa-page aa-centred">
      <section className="aa-card aa-join-card">
        <div className="aa-logo-mark">AA</div>
        <p className="aa-kicker">Discord beta</p>
        <h1>Enter Audio Arcade</h1>
        <p className="aa-room-name">Room / {roomName}</p>
        <p className="aa-muted">
          Stay in Discord for voice chat. Use this room only for the music feed and wear
          headphones to avoid feedback.
        </p>

        <form className="aa-form" onSubmit={submit}>
          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={32}
            autoComplete="nickname"
            placeholder="Your Discord name"
            autoFocus
          />
          <label htmlFor="roomPassword">Room password</label>
          <input
            id="roomPassword"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Enter room password"
          />
          {error ? <p className="aa-error">{error}</p> : null}
          <button type="submit" className="aa-primary" disabled={joining || !normaliseName(displayName) || !password}>
            {joining ? 'Connecting…' : 'Join room'}
          </button>
        </form>

        <div className="aa-beta-note">
          <strong>Best results:</strong> Chrome desktop, wired headphones and your audio
          interface selected as the input.
        </div>
      </section>
    </main>
  )
}

function RoomShell({ roomName, displayName }: { roomName: string; displayName: string }) {
  const room = useRoomContext()
  const connectionState = useConnectionState()
  const participants = useParticipants()
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [audioSource, setAudioSource] = useState<AudioSourceMode>('interface')
  const [browserAudioTrack, setBrowserAudioTrack] = useState<MediaStreamTrack | null>(null)
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Choose an input, then take AUX when it is free.')
  const [deviceError, setDeviceError] = useState('')
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown')
  const [requestingPermission, setRequestingPermission] = useState(false)
  const [, forceParticipantRefresh] = useState(0)

  const allParticipants = useMemo(() => {
    const unique = new Map<string, Participant | LocalParticipant>()

    for (const participant of [room.localParticipant, ...participants]) {
      const key = participant.identity || participant.sid
      if (key) unique.set(key, participant)
    }

    return Array.from(unique.values())
  }, [room.localParticipant, participants])

  const holder = useMemo(() => {
    return allParticipants
      .map((participant) => ({ participant, claim: auxClaim(participant) }))
      .filter((entry): entry is { participant: Participant | LocalParticipant; claim: number } => entry.claim !== null)
      .sort((a, b) => a.claim - b.claim || a.participant.identity.localeCompare(b.participant.identity))[0]
      ?.participant ?? null
  }, [allParticipants])

  const iHaveAux = holder?.identity === room.localParticipant.identity
  const auxAvailable = !holder
  const isConnected = connectionState === ConnectionState.Connected
  const isPublishing =
    room.localParticipant.isMicrophoneEnabled || browserAudioTrack?.readyState === 'live'

  useEffect(() => {
    const refresh = () => forceParticipantRefresh((value) => value + 1)
    room.on(RoomEvent.ParticipantAttributesChanged, refresh)
    room.on(RoomEvent.ParticipantConnected, refresh)
    room.on(RoomEvent.ParticipantDisconnected, refresh)
    room.on(RoomEvent.LocalTrackPublished, refresh)
    room.on(RoomEvent.LocalTrackUnpublished, refresh)

    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, refresh)
      room.off(RoomEvent.ParticipantConnected, refresh)
      room.off(RoomEvent.ParticipantDisconnected, refresh)
      room.off(RoomEvent.LocalTrackPublished, refresh)
      room.off(RoomEvent.LocalTrackUnpublished, refresh)
    }
  }, [room])

  useEffect(() => {
    void refreshDevices()

    const handleDeviceChange = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)

    let permissionStatus: PermissionStatus | null = null

    async function readPermissionState() {
      if (!navigator.permissions?.query) return

      try {
        permissionStatus = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        })
        setPermissionState(permissionStatus.state)

        permissionStatus.onchange = () => {
          if (permissionStatus) {
            setPermissionState(permissionStatus.state)
            void refreshDevices()
          }
        }
      } catch {
        setPermissionState('unknown')
      }
    }

    void readPermissionState()

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange)
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [])

  useEffect(() => {
    if (!iHaveAux && isPublishing) {
      void room.localParticipant.setMicrophoneEnabled(false)

      if (browserAudioTrack) {
        void room.localParticipant
          .unpublishTrack(browserAudioTrack, true)
          .catch(() => undefined)
        setBrowserAudioTrack(null)
      }
    }
  }, [browserAudioTrack, iHaveAux, isPublishing, room.localParticipant])

  useEffect(() => {
    const releaseBeforeLeaving = () => {
      if (room.localParticipant.attributes?.[AUX_ATTRIBUTE]) {
        void room.localParticipant.setAttributes({ [AUX_ATTRIBUTE]: '' })
      }
    }

    window.addEventListener('beforeunload', releaseBeforeLeaving)
    return () => window.removeEventListener('beforeunload', releaseBeforeLeaving)
  }, [room.localParticipant])

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceError('This browser does not support audio device selection.')
      return
    }

    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio input ${index + 1}`,
        }))
      setDevices(inputs)
      setSelectedDevice((current) => current || inputs[0]?.deviceId || '')
    } catch {
      setDeviceError('Allow microphone access to see your audio inputs.')
    }
  }

  async function stopBrowserAudio() {
    if (!browserAudioTrack) return

    await room.localParticipant
      .unpublishTrack(browserAudioTrack, true)
      .catch(() => undefined)

    if (browserAudioTrack.readyState !== 'ended') {
      browserAudioTrack.stop()
    }

    setBrowserAudioTrack(null)
  }

  async function requestBrowserAudio() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Browser audio sharing is not supported in this browser.')
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })

    const audioTrack = stream.getAudioTracks()[0]

    if (!audioTrack) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error(
        'No audio was shared. Choose a Chrome tab and enable “Share tab audio”.',
      )
    }

    stream.getVideoTracks().forEach((track) => track.stop())

    audioTrack.addEventListener(
      'ended',
      () => {
        void room.localParticipant
          .unpublishTrack(audioTrack, false)
          .catch(() => undefined)
        setBrowserAudioTrack((current) => (current === audioTrack ? null : current))
        setStatusMessage('Browser audio sharing stopped. Pass AUX or choose a new source.')
      },
      { once: true },
    )

    return audioTrack
  }

  async function requestAudioPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support audio input.')
    }

    setRequestingPermission(true)
    setDeviceError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      stream.getTracks().forEach((track) => track.stop())
      setPermissionState('granted')
      await refreshDevices()
      setStatusMessage('Audio input enabled. Choose an input, then take AUX.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setPermissionState('denied')
        throw new Error(
          'Microphone access is blocked. Use the browser site controls to allow microphone access, then press Enable audio input again.',
        )
      }

      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new Error('No audio input was found. Connect an input and try again.')
      }

      throw error
    } finally {
      setRequestingPermission(false)
    }
  }

  async function takeAux() {
    if (!isConnected || busy || holder) return

    setBusy(true)
    setDeviceError('')

    try {
      if (audioSource === 'interface') {
        await requestAudioPermission()
      }

      await room.localParticipant.setAttributes({
        [AUX_ATTRIBUTE]: String(Date.now()),
      })
      await new Promise((resolve) => window.setTimeout(resolve, 250))

      const currentClaims = [
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
      ]
        .flatMap((participant) => {
          const claim = auxClaim(participant)
          return claim === null ? [] : [{ participant, claim }]
        })
        .sort(
          (a, b) =>
            a.claim - b.claim ||
            a.participant.identity.localeCompare(b.participant.identity),
        )

      if (currentClaims[0]?.participant.identity !== room.localParticipant.identity) {
        await room.localParticipant.setAttributes({ [AUX_ATTRIBUTE]: '' })
        setStatusMessage(`${participantName(currentClaims[0].participant)} took AUX first.`)
        return
      }

      if (audioSource === 'interface') {
        await stopBrowserAudio()

        if (selectedDevice) {
          await room.switchActiveDevice('audioinput', selectedDevice)
        }

        await room.localParticipant.setMicrophoneEnabled(true, {
          deviceId: selectedDevice || undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        })

        await refreshDevices()
        setStatusMessage('You are live from your audio input. Pass AUX when finished.')
      } else {
        await room.localParticipant.setMicrophoneEnabled(false)
        await stopBrowserAudio()

        const audioTrack = await requestBrowserAudio()
        await room.localParticipant.publishTrack(audioTrack, {
          name: 'browser-audio',
          source: Track.Source.ScreenShareAudio,
        })
        setBrowserAudioTrack(audioTrack)
        setStatusMessage('Browser audio is live. Keep the shared tab playing, then pass AUX when finished.')
      }
    } catch (error) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
      await stopBrowserAudio()
      await room.localParticipant
        .setAttributes({ [AUX_ATTRIBUTE]: '' })
        .catch(() => undefined)
      setDeviceError(
        error instanceof Error ? error.message : 'Could not start your audio input.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function passAux() {
    if (!iHaveAux || busy) return
    setBusy(true)

    try {
      await room.localParticipant.setMicrophoneEnabled(false)
      await stopBrowserAudio()
      await room.localParticipant.setAttributes({ [AUX_ATTRIBUTE]: '' })
      setStatusMessage('AUX passed. You are listening again.')
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Could not release AUX.')
    } finally {
      setBusy(false)
    }
  }

  async function changeDevice(deviceId: string) {
    setSelectedDevice(deviceId)
    setDeviceError('')

    if (!iHaveAux || audioSource !== 'interface') return

    try {
      await room.switchActiveDevice('audioinput', deviceId)
      setStatusMessage('Input changed. Your AUX feed is still live.')
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : 'Could not change audio input.')
    }
  }

  return (
    <main className="aa-page aa-room-page">
      <header className="aa-room-header">
        <div>
          <p className="aa-kicker">Audio Arcade / live room</p>
          <h1>{roomName}</h1>
        </div>
        <div className={`aa-connection aa-connection-${connectionState.toLowerCase()}`}>
          <span /> {connectionState}
        </div>
      </header>

      <div className="aa-room-grid">
        <section className="aa-card aa-aux-card">
          <div className="aa-card-heading">
            <div>
              <p className="aa-kicker">Current signal</p>
              <h2>{holder ? participantName(holder) : 'AUX available'}</h2>
            </div>
            <div className={`aa-live-light ${holder ? 'is-live' : ''}`} aria-label={holder ? 'AUX live' : 'AUX free'} />
          </div>

          <div className={`aa-status-panel ${iHaveAux ? 'is-yours' : ''}`}>
            <strong>
              {iHaveAux
                ? 'YOU HAVE AUX'
                : holder
                  ? `${participantName(holder).toUpperCase()} IS LIVE`
                  : 'READY FOR NEXT PLAYER'}
            </strong>
            <span>{statusMessage}</span>
          </div>

          <label className="aa-device-label">Broadcast source</label>
          <div className="aa-input-tools" role="group" aria-label="Broadcast source">
            <button
              className={audioSource === 'interface' ? 'aa-primary' : 'aa-text-button'}
              type="button"
              onClick={() => setAudioSource('interface')}
              disabled={busy || iHaveAux}
            >
              Audio interface
            </button>
            <button
              className={audioSource === 'browser' ? 'aa-primary' : 'aa-text-button'}
              type="button"
              onClick={() => setAudioSource('browser')}
              disabled={busy || iHaveAux}
            >
              Browser / tab audio
            </button>
          </div>

          {audioSource === 'interface' ? (
            <>
              <label className="aa-device-label" htmlFor="audio-device">
                Audio input
              </label>
              <select
                id="audio-device"
                value={selectedDevice}
                onChange={(event) => void changeDevice(event.target.value)}
                disabled={busy || devices.length === 0}
              >
                {devices.length === 0 ? <option value="">No inputs detected</option> : null}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <div className="aa-input-tools">
                <button
                  className="aa-text-button"
                  type="button"
                  onClick={() => void requestAudioPermission()}
                  disabled={requestingPermission}
                >
                  {requestingPermission
                    ? 'Requesting access…'
                    : permissionState === 'granted'
                      ? 'Audio input enabled'
                      : 'Enable audio input'}
                </button>

                <button
                  className="aa-text-button"
                  type="button"
                  onClick={() => void refreshDevices()}
                >
                  Refresh inputs
                </button>
              </div>

              <p className="aa-muted">
                Permission: {permissionState}. The browser may not show another prompt after a
                previous Allow or Block decision.
              </p>
            </>
          ) : (
            <div className="aa-help-box">
              <strong>Share browser audio</strong>
              <p>
                Press Take AUX, choose a Chrome tab, then enable “Share tab audio”. Sharing a
                tab is more reliable than sharing a window or full screen.
              </p>
            </div>
          )}

          {deviceError ? <p className="aa-error">{deviceError}</p> : null}

          <div className="aa-actions">
            <button
              className="aa-primary aa-take-button"
              type="button"
              onClick={() => void takeAux()}
              disabled={!auxAvailable || !isConnected || busy}
            >
              {busy && !iHaveAux
                ? audioSource === 'browser'
                  ? 'Choose a tab…'
                  : 'Taking AUX…'
                : audioSource === 'browser'
                  ? 'Take AUX + choose tab'
                  : 'Take AUX'}
            </button>
            <button
              className="aa-danger"
              type="button"
              onClick={() => void passAux()}
              disabled={!iHaveAux || busy}
            >
              {busy && iHaveAux ? 'Passing…' : 'Pass AUX'}
            </button>
          </div>

          <div className="aa-signal-row">
            <span className={isPublishing ? 'is-on' : ''}>
              {audioSource === 'browser' ? 'Browser audio' : 'Input'} {isPublishing ? 'live' : 'muted'}
            </span>
            <span>Signed in as {displayName}</span>
          </div>
        </section>

        <aside className="aa-card aa-participants-card">
          <div className="aa-card-heading">
            <div>
              <p className="aa-kicker">Lobby</p>
              <h2>Players</h2>
            </div>
            <span className="aa-count">{allParticipants.length}</span>
          </div>

          <ul className="aa-participant-list">
            {allParticipants.map((participant) => {
              const participantHasAux = holder?.identity === participant.identity
              const isLocal = participant.identity === room.localParticipant.identity
              return (
                <li key={participant.identity}>
                  <span className={`aa-avatar ${participantHasAux ? 'is-live' : ''}`}>
                    {participantName(participant).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="aa-participant-name">
                    {participantName(participant)}
                    {isLocal ? <small>You</small> : null}
                  </span>
                  <span className={`aa-participant-state ${participantHasAux ? 'is-live' : ''}`}>
                    {participantHasAux ? 'AUX' : 'Listening'}
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="aa-help-box">
            <strong>Beta lobby rules</strong>
            <ol>
              <li>Keep Discord open for conversation.</li>
              <li>Only the AUX holder sends music here.</li>
              <li>Wear headphones before taking AUX.</li>
              <li>Pass AUX immediately after your turn.</li>
            </ol>
          </div>
        </aside>
      </div>
    </main>
  )
}
