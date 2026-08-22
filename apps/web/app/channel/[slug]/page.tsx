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

import {
  FormEvent,
  type CSSProperties,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import ArcadeLobby from '@/components/arcade/ArcadeLobby'
import PlayerSprite from '../../components/PlayerSprite'

type JoinState = {
  displayName: string
  token: string
}

type AudioDevice = {
  deviceId: string
  label: string
}

type AudioSourceMode = 'interface' | 'browser' | 'file'

const AUX_ATTRIBUTE = 'audioArcadeAuxClaim'

function normaliseName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 32)
}

function participantName(
  participant: Participant | LocalParticipant,
) {
  return participant.name || participant.identity
}

function auxClaim(
  participant: Participant | LocalParticipant,
) {
  const raw = participant.attributes?.[AUX_ATTRIBUTE]

  if (!raw) return null

  const timestamp = Number(raw)

  return Number.isFinite(timestamp)
    ? timestamp
    : null
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20)
}

function FxSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const dragStartXRef =
    useRef<number | null>(null)

  const dragStartValueRef =
    useRef(value)

  const [dragging, setDragging] =
    useState(false)

  const range =
    Math.max(0.0001, max - min)

  const normalised =
    Math.min(
      1,
      Math.max(
        0,
        (value - min) / range,
      ),
    )

  const angle =
    -135 + normalised * 270

  function clampAndStep(
    nextValue: number,
  ) {
    const clamped =
      Math.min(
        max,
        Math.max(min, nextValue),
      )

    const stepped =
      min +
      Math.round(
        (clamped - min) / step,
      ) *
        step

    return Number(
      Math.min(
        max,
        Math.max(min, stepped),
      ).toFixed(4),
    )
  }

  function nudge(
    direction: number,
  ) {
    if (disabled) return

    onChange(
      clampAndStep(
        value +
          step * direction,
      ),
    )
  }

  return (
    <div
      className={`aa-fx-control ${
        dragging ? 'is-dragging' : ''
      }`}
    >
      <div className="aa-fx-label">
        <strong>{label}</strong>
        <output>{displayValue}</output>
      </div>

      <div className="aa-knob-row">
        <div
          className="aa-knob-drag-zone"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={displayValue}
          aria-disabled={disabled}
          title="Drag left/right to adjust"
          onPointerDown={(event) => {
            if (disabled) return

            dragStartXRef.current =
              event.clientX

            dragStartValueRef.current =
              value

            setDragging(true)

            event.currentTarget.setPointerCapture(
              event.pointerId,
            )
          }}
          onPointerMove={(event) => {
            if (
              disabled ||
              dragStartXRef.current ===
                null
            ) {
              return
            }

            /*
             * About 170 CSS pixels of
             * horizontal movement spans
             * the full knob range.
             */
            const deltaX =
              event.clientX -
              dragStartXRef.current

            const nextValue =
              dragStartValueRef.current +
              (deltaX / 170) * range

            onChange(
              clampAndStep(
                nextValue,
              ),
            )
          }}
          onPointerUp={(event) => {
            dragStartXRef.current =
              null

            setDragging(false)

            if (
              event.currentTarget.hasPointerCapture(
                event.pointerId,
              )
            ) {
              event.currentTarget.releasePointerCapture(
                event.pointerId,
              )
            }
          }}
          onPointerCancel={() => {
            dragStartXRef.current =
              null

            setDragging(false)
          }}
          onKeyDown={(event) => {
            if (disabled) return

            if (
              event.key ===
                'ArrowRight' ||
              event.key ===
                'ArrowUp'
            ) {
              event.preventDefault()
              nudge(1)
            }

            if (
              event.key ===
                'ArrowLeft' ||
              event.key ===
                'ArrowDown'
            ) {
              event.preventDefault()
              nudge(-1)
            }

            if (
              event.key === 'Home'
            ) {
              event.preventDefault()
              onChange(min)
            }

            if (
              event.key === 'End'
            ) {
              event.preventDefault()
              onChange(max)
            }
          }}
        >
          <div
            className="aa-knob"
            aria-hidden="true"
            style={{
              '--aa-knob-angle':
                `${angle}deg`,
              '--aa-knob-fill':
                `${normalised * 100}%`,
            } as CSSProperties}
          >
            <span className="aa-knob-cap">
              <span className="aa-knob-marker" />
            </span>
          </div>

          <span className="aa-knob-drag-hint">
            ← drag →
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug: roomName } = use(params)

  const serverUrl =
    process.env.NEXT_PUBLIC_LIVEKIT_URL

  const [joinState, setJoinState] =
    useState<JoinState | null>(null)

  const [joining, setJoining] =
    useState(false)

  const [joinError, setJoinError] =
    useState('')

  async function join(
    displayName: string,
    password: string,
  ) {
    const cleanName =
      normaliseName(displayName)

    if (!cleanName || !serverUrl) return

    setJoining(true)
    setJoinError('')

    try {
      const response = await fetch(
        '/api/token',
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json',
          },

          body: JSON.stringify({
            room: roomName,
            displayName: cleanName,
            password,
          }),
        },
      )

      const payload =
        await response.json()

      if (
        !response.ok ||
        !payload.token
      ) {
        throw new Error(
          payload.error ||
            'Could not join the room.',
        )
      }

      window.localStorage.setItem(
        'audio-arcade-display-name',
        cleanName,
      )

      setJoinState({
        displayName: cleanName,
        token: payload.token,
      })
    } catch (error) {
      setJoinError(
        error instanceof Error
          ? error.message
          : 'Could not join the room.',
      )
    } finally {
      setJoining(false)
    }
  }

  if (!serverUrl) {
    return (
      <main className="aa-page aa-centred">
        <section className="aa-card aa-join-card">
          <p className="aa-kicker">
            Configuration error
          </p>

          <h1>
            Audio Arcade cannot connect
          </h1>

          <p>
            NEXT_PUBLIC_LIVEKIT_URL is
            missing from the deployment
            environment.
          </p>
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
      options={{
        adaptiveStream: true,
        dynacast: true,
      }}
      onDisconnected={() =>
        setJoinState(null)
      }
      onError={(error: Error) =>
        setJoinError(error.message)
      }
    >
      <RoomShell
        roomName={roomName}
        displayName={joinState.displayName}
      />

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
  onJoin: (
    displayName: string,
    password: string,
  ) => Promise<void>
}) {
  const [
    displayName,
    setDisplayName,
  ] = useState('')

  const [password, setPassword] =
    useState('')

  useEffect(() => {
    setDisplayName(
      window.localStorage.getItem(
        'audio-arcade-display-name',
      ) || '',
    )
  }, [])

  function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    void onJoin(
      displayName,
      password,
    )
  }

  return (
    <main className="aa-page aa-centred">
      <section className="aa-card aa-join-card">
        <div className="aa-logo-mark">
          AA
        </div>

        <p className="aa-kicker">
          Discord beta
        </p>

        <h1>Enter Audio Arcade</h1>

        <p className="aa-room-name">
          Room / {roomName}
        </p>

        <p className="aa-muted">
          Stay in Discord for voice
          chat. Use this room only for
          the music feed and wear
          headphones to avoid feedback.
        </p>

        <form
          className="aa-form"
          onSubmit={submit}
        >
          <label htmlFor="displayName">
            Display name
          </label>

          <input
            id="displayName"
            value={displayName}
            onChange={(event) =>
              setDisplayName(
                event.target.value,
              )
            }
            maxLength={32}
            autoComplete="nickname"
            placeholder="Your Discord name"
            autoFocus
          />

          <label htmlFor="roomPassword">
            Room password
          </label>

          <input
            id="roomPassword"
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(
                event.target.value,
              )
            }
            autoComplete="current-password"
            placeholder="Enter room password"
          />

          {error ? (
            <p className="aa-error">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="aa-primary"
            disabled={
              joining ||
              !normaliseName(
                displayName,
              ) ||
              !password
            }
          >
            {joining
              ? 'Connecting…'
              : 'Join room'}
          </button>
        </form>

        <div className="aa-beta-note">
          <strong>
            Best results:
          </strong>{' '}
          Chrome desktop, wired
          headphones and your audio
          interface selected as the
          input.
        </div>
      </section>
    </main>
  )
}

function RoomShell({
  roomName,
  displayName,
}: {
  roomName: string
  displayName: string
}) {
  const room = useRoomContext()

  const connectionState =
    useConnectionState()

  const participants =
    useParticipants()

  const [devices, setDevices] =
    useState<AudioDevice[]>([])

  const [
    selectedDevice,
    setSelectedDevice,
  ] = useState('')

  const [
    audioSource,
    setAudioSource,
  ] =
    useState<AudioSourceMode>(
      'interface',
    )

  const [
    publishedAudioTrack,
    setPublishedAudioTrack,
  ] =
    useState<MediaStreamTrack | null>(
      null,
    )

  /*
   * FILE AUDIO
   */

  const [
    selectedFile,
    setSelectedFile,
  ] = useState<File | null>(null)

  const [
    fileIsPlaying,
    setFileIsPlaying,
  ] = useState(false)

  const fileAudioRef =
    useRef<HTMLAudioElement | null>(
      null,
    )

  const fileAudioUrlRef =
    useRef<string | null>(null)

  const fileInputRef =
    useRef<HTMLInputElement | null>(null)

  /*
   * LIVE AUDIO FX
   *
   * Gain is pre-FX input gain.
   * Volume is the final output level.
   * Echo is a wet delay + feedback send.
   * Glitch is a controllable digital gate/chop.
   */

  const [volume, setVolume] =
    useState(100)

  const [gainDb, setGainDb] =
    useState(0)

  const [echoAmount, setEchoAmount] =
    useState(0)

  const [glitchAmount, setGlitchAmount] =
    useState(0)

  const audioContextRef =
    useRef<AudioContext | null>(null)

  const sourceMediaTrackRef =
    useRef<MediaStreamTrack | null>(null)

  const inputGainNodeRef =
    useRef<GainNode | null>(null)

  const glitchGainNodeRef =
    useRef<GainNode | null>(null)

  const echoWetNodeRef =
    useRef<GainNode | null>(null)

  const echoFeedbackNodeRef =
    useRef<GainNode | null>(null)

  const masterGainNodeRef =
    useRef<GainNode | null>(null)

  const glitchTimerRef =
    useRef<number | null>(null)

  /*
   * GENERAL STATE
   */

  const [busy, setBusy] =
    useState(false)

  const [
    statusMessage,
    setStatusMessage,
  ] = useState(
    'Choose an input, then take AUX when it is free.',
  )

  const [
    deviceError,
    setDeviceError,
  ] = useState('')

  const [
    permissionState,
    setPermissionState,
  ] = useState<
    | 'prompt'
    | 'granted'
    | 'denied'
    | 'unknown'
  >('unknown')

  const [
    requestingPermission,
    setRequestingPermission,
  ] = useState(false)

  const [
    ,
    forceParticipantRefresh,
  ] = useState(0)

  /*
   * PARTICIPANTS
   */

  const allParticipants =
    useMemo(() => {
      const unique = new Map<
        string,
        Participant | LocalParticipant
      >()

      for (const participant of [
        room.localParticipant,
        ...participants,
      ]) {
        const key =
          participant.identity ||
          participant.sid

        if (key) {
          unique.set(
            key,
            participant,
          )
        }
      }

      return Array.from(
        unique.values(),
      )
    }, [
      room.localParticipant,
      participants,
    ])

  const holder = useMemo(() => {
    return (
      allParticipants
        .map((participant) => ({
          participant,
          claim:
            auxClaim(participant),
        }))
        .filter(
          (
            entry,
          ): entry is {
            participant:
              | Participant
              | LocalParticipant
            claim: number
          } =>
            entry.claim !== null,
        )
        .sort(
          (a, b) =>
            a.claim - b.claim ||
            a.participant.identity.localeCompare(
              b.participant.identity,
            ),
        )[0]?.participant ??
      null
    )
  }, [allParticipants])

  const iHaveAux =
    holder?.identity ===
    room.localParticipant.identity

  const auxAvailable = !holder

  const isConnected =
    connectionState ===
    ConnectionState.Connected

  const isPublishing =
    publishedAudioTrack?.readyState ===
      'live' ||
    fileIsPlaying

  /*
   * ROOM EVENTS
   */

  useEffect(() => {
    const refresh = () =>
      forceParticipantRefresh(
        (value) => value + 1,
      )

    room.on(
      RoomEvent.ParticipantAttributesChanged,
      refresh,
    )

    room.on(
      RoomEvent.ParticipantConnected,
      refresh,
    )

    room.on(
      RoomEvent.ParticipantDisconnected,
      refresh,
    )

    room.on(
      RoomEvent.LocalTrackPublished,
      refresh,
    )

    room.on(
      RoomEvent.LocalTrackUnpublished,
      refresh,
    )

    return () => {
      room.off(
        RoomEvent.ParticipantAttributesChanged,
        refresh,
      )

      room.off(
        RoomEvent.ParticipantConnected,
        refresh,
      )

      room.off(
        RoomEvent.ParticipantDisconnected,
        refresh,
      )

      room.off(
        RoomEvent.LocalTrackPublished,
        refresh,
      )

      room.off(
        RoomEvent.LocalTrackUnpublished,
        refresh,
      )
    }
  }, [room])

  /*
   * DEVICE PERMISSIONS
   */

  useEffect(() => {
    void refreshDevices()

    const handleDeviceChange =
      () =>
        void refreshDevices()

    navigator.mediaDevices?.addEventListener(
      'devicechange',
      handleDeviceChange,
    )

    let permissionStatus:
      | PermissionStatus
      | null = null

    async function readPermissionState() {
      if (
        !navigator.permissions?.query
      ) {
        return
      }

      try {
        permissionStatus =
          await navigator.permissions.query(
            {
              name: 'microphone' as PermissionName,
            },
          )

        setPermissionState(
          permissionStatus.state,
        )

        permissionStatus.onchange =
          () => {
            if (
              permissionStatus
            ) {
              setPermissionState(
                permissionStatus.state,
              )

              void refreshDevices()
            }
          }
      } catch {
        setPermissionState(
          'unknown',
        )
      }
    }

    void readPermissionState()

    return () => {
      navigator.mediaDevices?.removeEventListener(
        'devicechange',
        handleDeviceChange,
      )

      if (permissionStatus) {
        permissionStatus.onchange =
          null
      }
    }
  }, [])

  /*
   * IF USER LOSES AUX, STOP
   * ANY LOCAL BROADCAST.
   */

  useEffect(() => {
    if (
      !iHaveAux &&
      isPublishing
    ) {
      void stopProcessedAudio()
    }
  }, [
    iHaveAux,
    isPublishing,
  ])

  /*
   * RELEASE AUX ON PAGE EXIT
   */

  useEffect(() => {
    const releaseBeforeLeaving =
      () => {
        if (
          room.localParticipant
            .attributes?.[
            AUX_ATTRIBUTE
          ]
        ) {
          void room.localParticipant.setAttributes(
            {
              [AUX_ATTRIBUTE]:
                '',
            },
          )
        }
      }

    window.addEventListener(
      'beforeunload',
      releaseBeforeLeaving,
    )

    return () =>
      window.removeEventListener(
        'beforeunload',
        releaseBeforeLeaving,
      )
  }, [room.localParticipant])

  /*
   * AUDIO DEVICES
   */

  async function refreshDevices() {
    if (
      !navigator.mediaDevices
        ?.enumerateDevices
    ) {
      setDeviceError(
        'This browser does not support audio device selection.',
      )

      return
    }

    try {
      const list =
        await navigator.mediaDevices.enumerateDevices()

      const inputs = list
        .filter(
          (device) =>
            device.kind ===
            'audioinput',
        )
        .map(
          (device, index) => ({
            deviceId:
              device.deviceId,

            label:
              device.label ||
              `Audio input ${
                index + 1
              }`,
          }),
        )

      setDevices(inputs)

      setSelectedDevice(
        (current) =>
          current ||
          inputs[0]?.deviceId ||
          '',
      )
    } catch {
      setDeviceError(
        'Allow microphone access to see your audio inputs.',
      )
    }
  }

  /*
   * LIVE AUDIO PROCESSOR
   */

  function stopGlitchTimer() {
    if (
      glitchTimerRef.current !==
      null
    ) {
      window.clearInterval(
        glitchTimerRef.current,
      )

      glitchTimerRef.current =
        null
    }

    const context =
      audioContextRef.current

    const glitchNode =
      glitchGainNodeRef.current

    if (
      context &&
      glitchNode
    ) {
      const now =
        context.currentTime

      glitchNode.gain.cancelScheduledValues(
        now,
      )

      glitchNode.gain.setTargetAtTime(
        1,
        now,
        0.01,
      )
    }
  }

  function startGlitchTimer() {
    stopGlitchTimer()

    const context =
      audioContextRef.current

    const glitchNode =
      glitchGainNodeRef.current

    if (
      !context ||
      !glitchNode ||
      glitchAmount <= 0 ||
      !publishedAudioTrack
    ) {
      return
    }

    const intensity =
      glitchAmount / 100

    const intervalMs =
      Math.max(
        55,
        280 -
          glitchAmount * 2.15,
      )

    glitchTimerRef.current =
      window.setInterval(() => {
        const activeContext =
          audioContextRef.current

        const activeNode =
          glitchGainNodeRef.current

        if (
          !activeContext ||
          !activeNode
        ) {
          return
        }

        const chance =
          0.12 +
          intensity * 0.7

        if (
          Math.random() >
          chance
        ) {
          return
        }

        const now =
          activeContext.currentTime

        const cutLength =
          0.018 +
          Math.random() *
            (0.025 +
              intensity * 0.09)

        const cutLevel =
          Math.max(
            0,
            0.45 -
              intensity * 0.55,
          )

        activeNode.gain.cancelScheduledValues(
          now,
        )

        activeNode.gain.setValueAtTime(
          1,
          now,
        )

        activeNode.gain.linearRampToValueAtTime(
          cutLevel,
          now + 0.003,
        )

        activeNode.gain.setValueAtTime(
          cutLevel,
          now +
            Math.max(
              0.006,
              cutLength - 0.004,
            ),
        )

        activeNode.gain.linearRampToValueAtTime(
          1,
          now + cutLength,
        )
      }, intervalMs)
  }

  function applyFxSettings() {
    const context =
      audioContextRef.current

    if (!context) return

    const now =
      context.currentTime

    inputGainNodeRef.current?.gain.setTargetAtTime(
      dbToGain(gainDb),
      now,
      0.015,
    )

    masterGainNodeRef.current?.gain.setTargetAtTime(
      volume / 100,
      now,
      0.015,
    )

    const echo =
      echoAmount / 100

    echoWetNodeRef.current?.gain.setTargetAtTime(
      echo * 0.85,
      now,
      0.02,
    )

    echoFeedbackNodeRef.current?.gain.setTargetAtTime(
      Math.min(
        0.72,
        echo * 0.68,
      ),
      now,
      0.02,
    )
  }

  useEffect(() => {
    applyFxSettings()
  }, [
    volume,
    gainDb,
    echoAmount,
  ])

  useEffect(() => {
    startGlitchTimer()

    return () => {
      stopGlitchTimer()
    }
  }, [
    glitchAmount,
    publishedAudioTrack,
  ])

  async function buildProcessedTrack(
    context: AudioContext,
    source: AudioNode,
    monitorLocally = false,
  ) {
    const inputGain =
      context.createGain()

    const glitchGain =
      context.createGain()

    const dryGain =
      context.createGain()

    const delay =
      context.createDelay(1.5)

    const echoFeedback =
      context.createGain()

    const echoWet =
      context.createGain()

    const masterGain =
      context.createGain()

    const destination =
      context.createMediaStreamDestination()

    /*
     * Fixed echo timing. The Echo
     * slider controls wet amount and
     * feedback rather than delay time.
     */

    delay.delayTime.value =
      0.285

    dryGain.gain.value = 1
    glitchGain.gain.value = 1

    inputGain.gain.value =
      dbToGain(gainDb)

    masterGain.gain.value =
      volume / 100

    const echo =
      echoAmount / 100

    echoWet.gain.value =
      echo * 0.85

    echoFeedback.gain.value =
      Math.min(
        0.72,
        echo * 0.68,
      )

    source.connect(inputGain)
    inputGain.connect(glitchGain)

    /*
     * Dry signal.
     */

    glitchGain.connect(dryGain)
    dryGain.connect(masterGain)

    /*
     * Echo signal.
     */

    glitchGain.connect(delay)
    delay.connect(echoWet)
    echoWet.connect(masterGain)

    delay.connect(echoFeedback)
    echoFeedback.connect(delay)

    /*
     * LiveKit output.
     */

    masterGain.connect(destination)

    /*
     * Only audio-file playback is
     * monitored locally. Mic/interface
     * and shared-tab audio are not,
     * avoiding feedback.
     */

    if (monitorLocally) {
      masterGain.connect(
        context.destination,
      )
    }

    inputGainNodeRef.current =
      inputGain

    glitchGainNodeRef.current =
      glitchGain

    echoWetNodeRef.current =
      echoWet

    echoFeedbackNodeRef.current =
      echoFeedback

    masterGainNodeRef.current =
      masterGain

    await context.resume()

    const processedTrack =
      destination.stream
        .getAudioTracks()[0]

    if (!processedTrack) {
      throw new Error(
        'Could not create the processed audio track.',
      )
    }

    return processedTrack
  }

  async function stopProcessedAudio() {
    const publishedTrack =
      publishedAudioTrack

    const sourceTrack =
      sourceMediaTrackRef.current

    const audio =
      fileAudioRef.current

    const context =
      audioContextRef.current

    const objectUrl =
      fileAudioUrlRef.current

    /*
     * Clear references first so
     * repeated cleanup is safe.
     */

    sourceMediaTrackRef.current =
      null

    fileAudioRef.current =
      null

    fileAudioUrlRef.current =
      null

    audioContextRef.current =
      null

    inputGainNodeRef.current =
      null

    glitchGainNodeRef.current =
      null

    echoWetNodeRef.current =
      null

    echoFeedbackNodeRef.current =
      null

    masterGainNodeRef.current =
      null

    stopGlitchTimer()

    setPublishedAudioTrack(null)
    setFileIsPlaying(false)

    /*
     * Also disable any old raw
     * LiveKit microphone publication
     * from earlier builds.
     */

    await room.localParticipant
      .setMicrophoneEnabled(false)
      .catch(() => undefined)

    if (publishedTrack) {
      await room.localParticipant
        .unpublishTrack(
          publishedTrack,
          true,
        )
        .catch(
          () => undefined,
        )

      if (
        publishedTrack.readyState !==
        'ended'
      ) {
        publishedTrack.stop()
      }
    }

    if (
      sourceTrack &&
      sourceTrack.readyState !==
        'ended'
    ) {
      sourceTrack.stop()
    }

    if (audio) {
      audio.pause()

      try {
        audio.currentTime = 0
      } catch {
        // Safe to ignore.
      }

      audio.removeAttribute('src')

      try {
        audio.load()
      } catch {
        // Safe to ignore.
      }
    }

    if (
      context &&
      context.state !==
        'closed'
    ) {
      await context
        .close()
        .catch(
          () => undefined,
        )
    }

    if (objectUrl) {
      URL.revokeObjectURL(
        objectUrl,
      )
    }
  }

  /*
   * AUDIO INTERFACE SOURCE
   */

  async function startInterfaceAudio() {
    if (
      !navigator.mediaDevices
        ?.getUserMedia
    ) {
      throw new Error(
        'This browser does not support audio input.',
      )
    }

    await stopProcessedAudio()

    const stream =
      await navigator.mediaDevices.getUserMedia(
        {
          audio: {
            deviceId:
              selectedDevice ||
              undefined,
            echoCancellation:
              false,
            noiseSuppression:
              false,
            autoGainControl:
              false,
            channelCount: 2,
          },
        },
      )

    const sourceTrack =
      stream.getAudioTracks()[0]

    if (!sourceTrack) {
      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        )

      throw new Error(
        'No audio input track was created.',
      )
    }

    sourceMediaTrackRef.current =
      sourceTrack

    const context =
      new AudioContext()

    audioContextRef.current =
      context

    const source =
      context.createMediaStreamSource(
        stream,
      )

    const processedTrack =
      await buildProcessedTrack(
        context,
        source,
        false,
      )

    await room.localParticipant.publishTrack(
      processedTrack,
      {
        name: 'interface-audio',
        source:
          Track.Source.Microphone,
      },
    )

    setPublishedAudioTrack(
      processedTrack,
    )

    setPermissionState(
      'granted',
    )

    await refreshDevices()
  }

  /*
   * BROWSER / TAB AUDIO SOURCE
   */

  async function startBrowserAudio() {
    if (
      !navigator.mediaDevices
        ?.getDisplayMedia
    ) {
      throw new Error(
        'Browser audio sharing is not supported in this browser.',
      )
    }

    await stopProcessedAudio()

    const stream =
      await navigator.mediaDevices.getDisplayMedia(
        {
          video: true,
          audio: true,
        },
      )

    const sourceTrack =
      stream.getAudioTracks()[0]

    if (!sourceTrack) {
      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        )

      throw new Error(
        'No audio was shared. Choose a Chrome tab and enable “Share tab audio”.',
      )
    }

    stream
      .getVideoTracks()
      .forEach((track) =>
        track.stop(),
      )

    sourceMediaTrackRef.current =
      sourceTrack

    sourceTrack.addEventListener(
      'ended',
      () => {
        setStatusMessage(
          'Browser audio sharing stopped. Pass AUX or choose a new source.',
        )

        void stopProcessedAudio()
      },
      {
        once: true,
      },
    )

    const context =
      new AudioContext()

    audioContextRef.current =
      context

    const source =
      context.createMediaStreamSource(
        new MediaStream([
          sourceTrack,
        ]),
      )

    const processedTrack =
      await buildProcessedTrack(
        context,
        source,
        false,
      )

    await room.localParticipant.publishTrack(
      processedTrack,
      {
        name: 'browser-audio',
        source:
          Track.Source.ScreenShareAudio,
      },
    )

    setPublishedAudioTrack(
      processedTrack,
    )
  }

  /*
   * AUDIO FILE SOURCE
   */

  async function startFileAudio() {
    if (!selectedFile) {
      throw new Error(
        'Choose an audio file first.',
      )
    }

    await stopProcessedAudio()

    const objectUrl =
      URL.createObjectURL(
        selectedFile,
      )

    const audio =
      new Audio(objectUrl)

    audio.preload = 'auto'

    fileAudioRef.current =
      audio

    fileAudioUrlRef.current =
      objectUrl

    const context =
      new AudioContext()

    audioContextRef.current =
      context

    const source =
      context.createMediaElementSource(
        audio,
      )

    const processedTrack =
      await buildProcessedTrack(
        context,
        source,
        true,
      )

    try {
      await room.localParticipant.publishTrack(
        processedTrack,
        {
          name: 'file-audio',
        },
      )

      setPublishedAudioTrack(
        processedTrack,
      )

      await audio.play()

      setFileIsPlaying(true)

      audio.addEventListener(
        'ended',
        () => {
          setStatusMessage(
            'Audio file finished. Pass AUX or choose another source.',
          )

          void stopProcessedAudio()
        },
        {
          once: true,
        },
      )
    } catch (error) {
      await stopProcessedAudio()

      if (
        error instanceof Error
      ) {
        throw new Error(
          `Could not play audio file: ${error.message}`,
        )
      }

      throw new Error(
        'Could not play the selected audio file.',
      )
    }
  }

  /*
   * MICROPHONE / INTERFACE
   */

  async function requestAudioPermission() {
    if (
      !navigator.mediaDevices
        ?.getUserMedia
    ) {
      throw new Error(
        'This browser does not support audio input.',
      )
    }

    setRequestingPermission(
      true,
    )

    setDeviceError('')

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: true,
          },
        )

      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        )

      setPermissionState(
        'granted',
      )

      await refreshDevices()

      setStatusMessage(
        'Audio input enabled. Choose an input, then take AUX.',
      )
    } catch (error) {
      if (
        error instanceof
          DOMException &&
        error.name ===
          'NotAllowedError'
      ) {
        setPermissionState(
          'denied',
        )

        throw new Error(
          'Microphone access is blocked. Use the browser site controls to allow microphone access, then press Enable audio input again.',
        )
      }

      if (
        error instanceof
          DOMException &&
        error.name ===
          'NotFoundError'
      ) {
        throw new Error(
          'No audio input was found. Connect an input and try again.',
        )
      }

      throw error
    } finally {
      setRequestingPermission(
        false,
      )
    }
  }

  /*
   * TAKE AUX
   */

  async function takeAux() {
    if (
      !isConnected ||
      busy ||
      holder
    ) {
      return
    }

    if (
      audioSource === 'file' &&
      !selectedFile
    ) {
      setDeviceError(
        'Choose an audio file before taking AUX.',
      )

      return
    }

    setBusy(true)
    setDeviceError('')

    try {
      await room.localParticipant.setAttributes(
        {
          [AUX_ATTRIBUTE]:
            String(Date.now()),
        },
      )

      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            250,
          ),
      )

      const currentClaims = [
        room.localParticipant,
        ...Array.from(
          room.remoteParticipants.values(),
        ),
      ]
        .flatMap(
          (participant) => {
            const claim =
              auxClaim(
                participant,
              )

            return claim === null
              ? []
              : [
                  {
                    participant,
                    claim,
                  },
                ]
          },
        )
        .sort(
          (a, b) =>
            a.claim - b.claim ||
            a.participant.identity.localeCompare(
              b.participant.identity,
            ),
        )

      if (
        currentClaims[0]
          ?.participant
          .identity !==
        room.localParticipant
          .identity
      ) {
        await room.localParticipant.setAttributes(
          {
            [AUX_ATTRIBUTE]:
              '',
          },
        )

        setStatusMessage(
          `${participantName(
            currentClaims[0]
              .participant,
          )} took AUX first.`,
        )

        return
      }

      if (
        audioSource ===
        'interface'
      ) {
        await startInterfaceAudio()

        setStatusMessage(
          'You are live from your audio input. Volume, gain and FX can be changed while playing.',
        )
      } else if (
        audioSource ===
        'browser'
      ) {
        await startBrowserAudio()

        setStatusMessage(
          'Browser audio is live. Volume, gain and FX can be changed while playing.',
        )
      } else {
        await startFileAudio()

        setStatusMessage(
          `Playing ${
            selectedFile?.name ??
            'audio file'
          } on AUX. Volume, gain and FX are live.`,
        )
      }
    } catch (error) {
      await stopProcessedAudio()

      await room.localParticipant
        .setAttributes({
          [AUX_ATTRIBUTE]:
            '',
        })
        .catch(
          () => undefined,
        )

      setDeviceError(
        error instanceof Error
          ? error.message
          : 'Could not start your audio source.',
      )
    } finally {
      setBusy(false)
    }
  }

  /*
   * PASS AUX
   */

  async function passAux() {
    if (!iHaveAux || busy) {
      return
    }

    setBusy(true)

    try {
      await stopProcessedAudio()

      await room.localParticipant.setAttributes(
        {
          [AUX_ATTRIBUTE]: '',
        },
      )

      setStatusMessage(
        'AUX passed. You are listening again.',
      )
    } catch (error) {
      setDeviceError(
        error instanceof Error
          ? error.message
          : 'Could not release AUX.',
      )
    } finally {
      setBusy(false)
    }
  }

  /*
   * LISTEN
   */

  async function startListening() {
    setStatusMessage(
      holder
        ? `Listening to ${participantName(
            holder,
          )} on AUX.`
        : 'AUX is currently available.',
    )
  }

  /*
   * CHANGE HARDWARE INPUT
   */

  async function changeDevice(
    deviceId: string,
  ) {
    setSelectedDevice(deviceId)
    setDeviceError('')

    if (iHaveAux) {
      setStatusMessage(
        'Pass AUX before changing the hardware input.',
      )
    }
  }

  /*
   * UI
   */

  return (
    <>
      <ArcadeLobby
        takeAux={takeAux}
        startListening={
          startListening
        }
      />

      <main className="aa-page aa-room-page">
        <header className="aa-room-header">
          <div>
            <p className="aa-kicker">
              Audio Arcade / live room
            </p>

            <h1>{roomName}</h1>
          </div>

          <div
            className={`aa-connection aa-connection-${connectionState.toLowerCase()}`}
          >
            <span />{' '}
            {connectionState}
          </div>
        </header>

        <div className="aa-room-grid">
          <section className="aa-card aa-aux-card">
            <div className="aa-card-heading">
              <div>
                <p className="aa-kicker">
                  Current signal
                </p>

                <h2>
                  {holder
                    ? participantName(
                        holder,
                      )
                    : 'AUX available'}
                </h2>
              </div>

              <div
                className={`aa-live-light ${
                  holder
                    ? 'is-live'
                    : ''
                }`}
                aria-label={
                  holder
                    ? 'AUX live'
                    : 'AUX free'
                }
              />
            </div>

            <div
              className={`aa-status-panel ${
                iHaveAux
                  ? 'is-yours'
                  : ''
              }`}
            >
              <strong>
                {iHaveAux
                  ? 'YOU HAVE AUX'
                  : holder
                    ? `${participantName(
                        holder,
                      ).toUpperCase()} IS LIVE`
                    : 'READY FOR NEXT PLAYER'}
              </strong>

              <span>
                {statusMessage}
              </span>
            </div>

            {/*
             * SOURCE SELECTOR
             */}

            <label className="aa-device-label">
              Broadcast source
            </label>

            <div
              className="aa-input-tools"
              role="group"
              aria-label="Broadcast source"
            >
              <button
                className={
                  audioSource ===
                  'interface'
                    ? 'aa-primary'
                    : 'aa-text-button'
                }
                type="button"
                onClick={() =>
                  setAudioSource(
                    'interface',
                  )
                }
                disabled={
                  busy || iHaveAux
                }
              >
                Audio interface
              </button>

              <button
                className={
                  audioSource ===
                  'browser'
                    ? 'aa-primary'
                    : 'aa-text-button'
                }
                type="button"
                onClick={() =>
                  setAudioSource(
                    'browser',
                  )
                }
                disabled={
                  busy || iHaveAux
                }
              >
                Browser / tab audio
              </button>

              <button
                className={
                  audioSource ===
                  'file'
                    ? 'aa-primary'
                    : 'aa-text-button'
                }
                type="button"
                onClick={() => {
                  setAudioSource('file')
                  setDeviceError('')
                  fileInputRef.current?.click()
                }}
                disabled={
                  busy || iHaveAux
                }
              >
                Audio file
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aif,.aiff"
              style={{ display: 'none' }}
              disabled={busy || iHaveAux}
              onChange={(event) => {
                const file =
                  event.currentTarget.files?.[0] ??
                  null

                setSelectedFile(file)
                setDeviceError('')

                if (file) {
                  setAudioSource('file')
                  setStatusMessage(
                    `${file.name} ready. Take AUX to play.`,
                  )
                }

                event.currentTarget.value = ''
              }}
            />

            {/*
             * INTERFACE SOURCE
             */}

            {audioSource ===
            'interface' ? (
              <>
                <label
                  className="aa-device-label"
                  htmlFor="audio-device"
                >
                  Audio input
                </label>

                <select
                  id="audio-device"
                  value={
                    selectedDevice
                  }
                  onChange={(
                    event,
                  ) =>
                    void changeDevice(
                      event.target
                        .value,
                    )
                  }
                  disabled={
                    busy ||
                    iHaveAux ||
                    devices.length ===
                      0
                  }
                >
                  {devices.length ===
                  0 ? (
                    <option value="">
                      No inputs
                      detected
                    </option>
                  ) : null}

                  {devices.map(
                    (device) => (
                      <option
                        key={
                          device.deviceId
                        }
                        value={
                          device.deviceId
                        }
                      >
                        {
                          device.label
                        }
                      </option>
                    ),
                  )}
                </select>

                <div className="aa-input-tools">
                  <button
                    className="aa-text-button"
                    type="button"
                    onClick={() =>
                      void requestAudioPermission()
                    }
                    disabled={
                      requestingPermission
                    }
                  >
                    {requestingPermission
                      ? 'Requesting access…'
                      : permissionState ===
                          'granted'
                        ? 'Audio input enabled'
                        : 'Enable audio input'}
                  </button>

                  <button
                    className="aa-text-button"
                    type="button"
                    onClick={() =>
                      void refreshDevices()
                    }
                  >
                    Refresh inputs
                  </button>
                </div>

                <p className="aa-muted">
                  Permission:{' '}
                  {permissionState}.
                  The browser may not
                  show another prompt
                  after a previous Allow
                  or Block decision.
                </p>
              </>
            ) : audioSource ===
              'browser' ? (
              /*
               * BROWSER SOURCE
               */

              <div className="aa-help-box">
                <strong>
                  Share browser audio
                </strong>

                <p>
                  Press Take AUX,
                  choose a Chrome tab,
                  then enable “Share tab
                  audio”. Sharing a tab
                  is more reliable than
                  sharing a window or
                  full screen.
                </p>
              </div>
            ) : (
              /*
               * FILE SOURCE
               */

              <div className="aa-help-box">
                <strong>
                  Play an audio file
                </strong>

                <p>
                  Choose a track from
                  your computer. It will
                  start automatically
                  when you take AUX.
                </p>

                <button
                  type="button"
                  className="aa-text-button"
                  onClick={() =>
                    fileInputRef.current?.click()
                  }
                  disabled={
                    busy || iHaveAux
                  }
                >
                  {selectedFile
                    ? 'Choose another file'
                    : 'Choose audio file'}
                </button>

                {selectedFile ? (
                  <p className="aa-muted">
                    Selected:{' '}
                    {
                      selectedFile.name
                    }
                  </p>
                ) : (
                  <p className="aa-muted">
                    No audio file
                    selected.
                  </p>
                )}
              </div>
            )}

            <div className="aa-fx-panel">
              <div className="aa-fx-heading">
                <div>
                  <p className="aa-kicker">
                    Live mixer
                  </p>
                  <strong>
                    Player controls
                  </strong>
                </div>

                <button
                  className="aa-text-button aa-fx-reset"
                  type="button"
                  onClick={() => {
                    setVolume(100)
                    setGainDb(0)
                    setEchoAmount(0)
                    setGlitchAmount(0)
                  }}
                  disabled={busy}
                >
                  Reset FX
                </button>
              </div>

              <div className="aa-fx-grid">
                <FxSlider
                  label="Volume"
                  value={volume}
                  min={0}
                  max={100}
                  step={1}
                  displayValue={`${volume}%`}
                  onChange={setVolume}
                  disabled={busy}
                />

                <FxSlider
                  label="Gain"
                  value={gainDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  displayValue={`${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`}
                  onChange={setGainDb}
                  disabled={busy}
                />

                <FxSlider
                  label="Echo"
                  value={echoAmount}
                  min={0}
                  max={100}
                  step={1}
                  displayValue={`${echoAmount}%`}
                  onChange={setEchoAmount}
                  disabled={busy}
                />

                <FxSlider
                  label="Glitch"
                  value={glitchAmount}
                  min={0}
                  max={100}
                  step={1}
                  displayValue={`${glitchAmount}%`}
                  onChange={setGlitchAmount}
                  disabled={busy}
                />
              </div>

              <p className="aa-muted aa-fx-note">
                Set these before taking AUX or adjust them live while you are playing.
                Echo adds a short delay tail; Glitch creates digital chops/dropouts.
              </p>
            </div>

            {deviceError ? (
              <p className="aa-error">
                {deviceError}
              </p>
            ) : null}

            {/*
             * AUX CONTROLS
             */}

            <div className="aa-actions">
              <button
                className="aa-primary aa-take-button"
                type="button"
                onClick={() =>
                  void takeAux()
                }
                disabled={
                  !auxAvailable ||
                  !isConnected ||
                  busy ||
                  (audioSource ===
                    'file' &&
                    !selectedFile)
                }
              >
                {busy && !iHaveAux
                  ? audioSource ===
                    'browser'
                    ? 'Choose a tab…'
                    : audioSource ===
                        'file'
                      ? 'Starting file…'
                      : 'Taking AUX…'
                  : audioSource ===
                      'browser'
                    ? 'Take AUX + choose tab'
                    : audioSource ===
                        'file'
                      ? 'Take AUX + play file'
                      : 'Take AUX'}
              </button>

              <button
                className="aa-danger"
                type="button"
                onClick={() =>
                  void passAux()
                }
                disabled={
                  !iHaveAux ||
                  busy
                }
              >
                {busy && iHaveAux
                  ? 'Passing…'
                  : 'Pass AUX'}
              </button>
            </div>

            <div className="aa-signal-row">
              <span
                className={
                  isPublishing
                    ? 'is-on'
                    : ''
                }
              >
                {audioSource ===
                'browser'
                  ? 'Browser audio'
                  : audioSource ===
                      'file'
                    ? 'Audio file'
                    : 'Input'}{' '}
                {isPublishing
                  ? 'live'
                  : 'muted'}
              </span>

              <span>
                Signed in as{' '}
                {displayName}
              </span>
            </div>
          </section>

          {/*
           * PARTICIPANTS
           */}

          <aside className="aa-card aa-participants-card">
            <div className="aa-card-heading">
              <div>
                <p className="aa-kicker">
                  Lobby
                </p>

                <h2>
                  Players
                </h2>
              </div>

              <span className="aa-count">
                {
                  allParticipants.length
                }
              </span>
            </div>

            <ul className="aa-participant-list">
              {allParticipants.map(
                (participant) => {
                  const participantHasAux =
                    holder?.identity ===
                    participant.identity

                  const isLocal =
                    participant.identity ===
                    room.localParticipant
                      .identity

                  return (
                    <li
                      key={
                        participant.identity
                      }
                    >
                      <PlayerSprite
                        identity={
                          participant.identity ||
                          participant.sid
                        }
                        isLive={
                          participantHasAux
                        }
                      />

                      <span className="aa-participant-name">
                        {participantName(
                          participant,
                        )}

                        {isLocal ? (
                          <small>
                            You
                          </small>
                        ) : null}
                      </span>

                      <span
                        className={`aa-participant-state ${
                          participantHasAux
                            ? 'is-live'
                            : ''
                        }`}
                      >
                        {participantHasAux
                          ? 'AUX'
                          : 'Listening'}
                      </span>
                    </li>
                  )
                },
              )}
            </ul>

            <div className="aa-help-box">
              <strong>
                Beta lobby rules
              </strong>

              <ol>
                <li>
                  Keep Discord open for
                  conversation.
                </li>

                <li>
                  Only the AUX holder
                  sends music here.
                </li>

                <li>
                  Wear headphones before
                  taking AUX.
                </li>

                <li>
                  Pass AUX immediately
                  after your turn.
                </li>
              </ol>
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}