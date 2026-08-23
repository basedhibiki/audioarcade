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

type TapeRecordMode =
  | 'new'
  | 'overdub'

type TapeLayer = {
  id: string
  buffer: AudioBuffer
  reversedBuffer: AudioBuffer
  offsetSeconds: number
}

type PadSample = {
  id: string
  name: string
  buffer: AudioBuffer
  reversedBuffer: AudioBuffer
}

const TAPE_MAX_SECONDS = 8
const TAPE_MAX_LAYERS = 4
const DRUM_PAD_COUNT = 4
const DRUM_STEP_COUNT = 8

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

function formatTapeTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '0.0'
  }

  return Math.max(0, seconds)
    .toFixed(1)
}

function createTapeCurve(
  wearPercent: number,
) {
  const points = 2048
  const curve =
    new Float32Array(points)

  const wear =
    Math.min(
      1,
      Math.max(
        0,
        wearPercent / 100,
      ),
    )

  const drive =
    1 + wear * 7

  const normaliser =
    Math.tanh(drive)

  for (
    let index = 0;
    index < points;
    index += 1
  ) {
    const x =
      (index / (points - 1)) *
        2 -
      1

    curve[index] =
      wear <= 0.001
        ? x
        : Math.tanh(
            x * drive,
          ) / normaliser
  }

  return curve
}

function copyBufferToDuration(
  context: AudioContext,
  source: AudioBuffer,
  seconds: number,
) {
  const length =
    Math.max(
      1,
      Math.round(
        seconds *
          source.sampleRate,
      ),
    )

  const buffer =
    context.createBuffer(
      source.numberOfChannels,
      length,
      source.sampleRate,
    )

  for (
    let channel = 0;
    channel <
    source.numberOfChannels;
    channel += 1
  ) {
    const sourceData =
      source.getChannelData(
        channel,
      )

    const targetData =
      buffer.getChannelData(
        channel,
      )

    targetData.set(
      sourceData.subarray(
        0,
        Math.min(
          sourceData.length,
          targetData.length,
        ),
      ),
    )
  }

  return buffer
}

function reverseAudioBuffer(
  context: AudioContext,
  source: AudioBuffer,
) {
  const reversed =
    context.createBuffer(
      source.numberOfChannels,
      source.length,
      source.sampleRate,
    )

  for (
    let channel = 0;
    channel <
    source.numberOfChannels;
    channel += 1
  ) {
    const sourceData =
      source.getChannelData(
        channel,
      )

    const targetData =
      reversed.getChannelData(
        channel,
      )

    for (
      let index = 0;
      index <
      sourceData.length;
      index += 1
    ) {
      targetData[index] =
        sourceData[
          sourceData.length -
            1 -
            index
        ]
    }
  }

  return reversed
}

function mixTapeLayersToBuffer(
  context: AudioContext,
  layers: TapeLayer[],
  seconds: number,
) {
  const sampleRate =
    context.sampleRate

  const length =
    Math.max(
      1,
      Math.round(
        seconds * sampleRate,
      ),
    )

  const channelCount =
    Math.max(
      1,
      Math.min(
        2,
        layers.reduce(
          (count, layer) =>
            Math.max(
              count,
              layer.buffer
                .numberOfChannels,
            ),
          1,
        ),
      ),
    )

  const mixed =
    context.createBuffer(
      channelCount,
      length,
      sampleRate,
    )

  for (const layer of layers) {
    const offsetFrames =
      Math.round(
        layer.offsetSeconds *
          sampleRate,
      ) % length

    for (
      let channel = 0;
      channel < channelCount;
      channel += 1
    ) {
      const source =
        layer.buffer.getChannelData(
          Math.min(
            channel,
            layer.buffer
              .numberOfChannels -
              1,
          ),
        )

      const target =
        mixed.getChannelData(
          channel,
        )

      for (
        let index = 0;
        index <
        Math.min(
          source.length,
          length,
        );
        index += 1
      ) {
        target[
          (offsetFrames + index) %
            length
        ] += source[index]
      }
    }
  }

  let peak = 0

  for (
    let channel = 0;
    channel < channelCount;
    channel += 1
  ) {
    const data =
      mixed.getChannelData(
        channel,
      )

    for (
      let index = 0;
      index < data.length;
      index += 1
    ) {
      peak = Math.max(
        peak,
        Math.abs(data[index]),
      )
    }
  }

  if (peak > 0.98) {
    const scale = 0.98 / peak

    for (
      let channel = 0;
      channel < channelCount;
      channel += 1
    ) {
      const data =
        mixed.getChannelData(
          channel,
        )

      for (
        let index = 0;
        index < data.length;
        index += 1
      ) {
        data[index] *= scale
      }
    }
  }

  return mixed
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

  const publishedAudioTrackRef =
    useRef<MediaStreamTrack | null>(
      null,
    )

  const [
    processedAudioTrack,
    setProcessedAudioTrack,
  ] =
    useState<MediaStreamTrack | null>(
      null,
    )

  const processedAudioTrackRef =
    useRef<MediaStreamTrack | null>(
      null,
    )

  const [
    preparedSource,
    setPreparedSource,
  ] =
    useState<AudioSourceMode | null>(
      null,
    )

  const preparedSourceRef =
    useRef<AudioSourceMode | null>(
      null,
    )

  const [
    preparingDeck,
    setPreparingDeck,
  ] = useState(false)

  /*
   * FILE AUDIO
   */

  const [
    selectedFile,
    setSelectedFile,
  ] = useState<File | null>(null)

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
   * SHORT TAPE SAMPLER
   *
   * Records the currently selected
   * raw source into a short local tape
   * buffer. The tape output is routed
   * back through Gain / Echo / Glitch /
   * Volume before LiveKit.
   */

  const [
    tapeLayers,
    setTapeLayers,
  ] =
    useState<TapeLayer[]>([])

  const tapeLayersRef =
    useRef<TapeLayer[]>([])

  const [
    tapeLoopSeconds,
    setTapeLoopSeconds,
  ] = useState(0)

  const tapeLoopSecondsRef =
    useRef(0)

  const [
    tapePlaying,
    setTapePlaying,
  ] = useState(false)

  const tapePlayingRef =
    useRef(false)

  const [
    tapeRecording,
    setTapeRecording,
  ] =
    useState<TapeRecordMode | null>(
      null,
    )

  const [
    tapeProgress,
    setTapeProgress,
  ] = useState(0)

  const [
    tapeSpeed,
    setTapeSpeed,
  ] = useState(1)

  const tapeSpeedRef =
    useRef(1)

  const [
    tapeWear,
    setTapeWear,
  ] = useState(18)

  const [
    tapeReverse,
    setTapeReverse,
  ] = useState(false)

  const tapeReverseRef =
    useRef(false)

  const [
    tapeMonitor,
    setTapeMonitor,
  ] = useState(true)

  const [
    tapeMessage,
    setTapeMessage,
  ] = useState(
    'Prepare a source, then capture up to 8 seconds privately while you wait for AUX.',
  )

  const samplerCaptureDestinationRef =
    useRef<MediaStreamAudioDestinationNode | null>(
      null,
    )

  const samplerCaptureStreamRef =
    useRef<MediaStream | null>(
      null,
    )

  const samplerBusNodeRef =
    useRef<GainNode | null>(null)

  const tapeFilterNodeRef =
    useRef<BiquadFilterNode | null>(
      null,
    )

  const tapeDriveNodeRef =
    useRef<WaveShaperNode | null>(
      null,
    )

  const tapeMonitorGainRef =
    useRef<GainNode | null>(
      null,
    )

  const mainOutputMonitoredRef =
    useRef(false)

  const tapeSourcesRef =
    useRef<AudioBufferSourceNode[]>(
      [],
    )

  const tapeWowOscillatorRef =
    useRef<OscillatorNode | null>(
      null,
    )

  const tapeWowGainRef =
    useRef<GainNode | null>(
      null,
    )

  const tapeFlutterOscillatorRef =
    useRef<OscillatorNode | null>(
      null,
    )

  const tapeFlutterGainRef =
    useRef<GainNode | null>(
      null,
    )

  const tapeAnchorTimeRef =
    useRef(0)

  const tapeAnchorPhaseRef =
    useRef(0)

  const tapeProgressTimerRef =
    useRef<number | null>(
      null,
    )

  const tapeRecorderRef =
    useRef<MediaRecorder | null>(
      null,
    )

  const tapeRecordChunksRef =
    useRef<Blob[]>([])

  const tapeRecordModeRef =
    useRef<TapeRecordMode | null>(
      null,
    )

  const tapeRecordOffsetRef =
    useRef(0)

  const tapeRecordTimerRef =
    useRef<number | null>(
      null,
    )

  const tapeDiscardRecordingRef =
    useRef(false)

  /*
   * MINI DRUM MACHINE
   *
   * Each pad stores a snapshot of the
   * current tape stack. Pads can be
   * finger-drummed or sequenced across
   * a compact eight-step pattern.
   */

  const [
    padSamples,
    setPadSamples,
  ] = useState<(PadSample | null)[]>(
    () =>
      Array.from(
        { length: DRUM_PAD_COUNT },
        () => null,
      ),
  )

  const padSamplesRef =
    useRef<(PadSample | null)[]>(
      Array.from(
        { length: DRUM_PAD_COUNT },
        () => null,
      ),
    )

  const [
    drumPattern,
    setDrumPattern,
  ] = useState<boolean[][]>(
    () =>
      Array.from(
        { length: DRUM_PAD_COUNT },
        () =>
          Array.from(
            { length: DRUM_STEP_COUNT },
            () => false,
          ),
      ),
  )

  const drumPatternRef =
    useRef<boolean[][]>(
      Array.from(
        { length: DRUM_PAD_COUNT },
        () =>
          Array.from(
            { length: DRUM_STEP_COUNT },
            () => false,
          ),
      ),
    )

  const [tempo, setTempo] =
    useState(92)

  const [
    sequencerPlaying,
    setSequencerPlaying,
  ] = useState(false)

  const sequencerPlayingRef =
    useRef(false)

  const [
    currentDrumStep,
    setCurrentDrumStep,
  ] = useState(-1)

  const drumStepRef =
    useRef(0)

  const drumTimerRef =
    useRef<number | null>(null)

  const drumSourcesRef =
    useRef<AudioBufferSourceNode[]>(
      [],
    )

  /*
   * GENERAL STATE
   */

  const [busy, setBusy] =
    useState(false)

  const [
    statusMessage,
    setStatusMessage,
  ] = useState(
    'Prepare a private deck, build a tape or sequence, then take AUX when it is free.',
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
      'live'

  const deckReady =
    processedAudioTrack?.readyState ===
      'live'

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
   * IF USER LOSES AUX, CLOSE ONLY
   * THE ROOM BROADCAST. Their private
   * deck, tape and pads stay alive.
   */

  useEffect(() => {
    if (
      !iHaveAux &&
      isPublishing
    ) {
      void stopBroadcastOnly()
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
   * SHORT TAPE SAMPLER
   */

  function setTapeLayersSafe(
    nextLayers: TapeLayer[],
  ) {
    tapeLayersRef.current =
      nextLayers

    setTapeLayers(nextLayers)
  }

  function setTapeLengthSafe(
    seconds: number,
  ) {
    tapeLoopSecondsRef.current =
      seconds

    setTapeLoopSeconds(seconds)
  }

  function clearTapeProgressTimer() {
    if (
      tapeProgressTimerRef.current !==
      null
    ) {
      window.clearInterval(
        tapeProgressTimerRef.current,
      )

      tapeProgressTimerRef.current =
        null
    }
  }

  function clearTapeRecordTimer() {
    if (
      tapeRecordTimerRef.current !==
      null
    ) {
      window.clearTimeout(
        tapeRecordTimerRef.current,
      )

      tapeRecordTimerRef.current =
        null
    }
  }

  function getTapePhase(
    atTime?: number,
  ) {
    const context =
      audioContextRef.current

    const loopSeconds =
      tapeLoopSecondsRef.current

    if (
      !context ||
      loopSeconds <= 0
    ) {
      return 0
    }

    const now =
      atTime ??
      context.currentTime

    if (
      !tapePlayingRef.current ||
      now <
        tapeAnchorTimeRef.current
    ) {
      return (
        tapeAnchorPhaseRef.current %
        loopSeconds
      )
    }

    const elapsed =
      now -
      tapeAnchorTimeRef.current

    const moved =
      elapsed *
      tapeSpeedRef.current

    return (
      (tapeAnchorPhaseRef.current +
        moved) %
      loopSeconds
    )
  }

  function updateTapeProgressNow() {
    const loopSeconds =
      tapeLoopSecondsRef.current

    if (
      loopSeconds <= 0 ||
      !tapePlayingRef.current
    ) {
      setTapeProgress(0)
      return
    }

    const phase =
      getTapePhase()

    setTapeProgress(
      phase / loopSeconds,
    )
  }

  function startTapeProgressTimer() {
    clearTapeProgressTimer()

    updateTapeProgressNow()

    tapeProgressTimerRef.current =
      window.setInterval(
        updateTapeProgressNow,
        80,
      )
  }

  function stopTapeNodesOnly() {
    for (
      const source of
      tapeSourcesRef.current
    ) {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }

      try {
        source.disconnect()
      } catch {
        // Safe to ignore.
      }
    }

    tapeSourcesRef.current = []

    if (
      tapeWowOscillatorRef.current
    ) {
      try {
        tapeWowOscillatorRef.current.stop()
      } catch {
        // Already stopped.
      }

      tapeWowOscillatorRef.current =
        null
    }

    if (
      tapeFlutterOscillatorRef.current
    ) {
      try {
        tapeFlutterOscillatorRef.current.stop()
      } catch {
        // Already stopped.
      }

      tapeFlutterOscillatorRef.current =
        null
    }

    tapeWowGainRef.current = null

    tapeFlutterGainRef.current =
      null
  }

  function applyTapeSettings() {
    const context =
      audioContextRef.current

    if (!context) return

    const now =
      context.currentTime

    const wear =
      Math.min(
        1,
        Math.max(
          0,
          tapeWear / 100,
        ),
      )

    tapeFilterNodeRef.current?.frequency.setTargetAtTime(
      18000 -
        wear * 11500,
      now,
      0.03,
    )

    if (
      tapeDriveNodeRef.current
    ) {
      tapeDriveNodeRef.current.curve =
        createTapeCurve(
          tapeWear,
        )

      tapeDriveNodeRef.current.oversample =
        '2x'
    }

    tapeWowGainRef.current?.gain.setTargetAtTime(
      wear * 0.012,
      now,
      0.05,
    )

    tapeFlutterGainRef.current?.gain.setTargetAtTime(
      wear * 0.0035,
      now,
      0.05,
    )

    const shouldMonitor =
      !mainOutputMonitoredRef.current &&
      tapeMonitor

    tapeMonitorGainRef.current?.gain.setTargetAtTime(
      shouldMonitor ? 0.9 : 0,
      now,
      0.02,
    )
  }

  useEffect(() => {
    applyTapeSettings()
  }, [
    tapeWear,
    tapeMonitor,
  ])

  useEffect(() => {
    const context =
      audioContextRef.current

    const loopSeconds =
      tapeLoopSecondsRef.current

    const previousRate =
      tapeSpeedRef.current

    if (
      context &&
      tapePlayingRef.current &&
      loopSeconds > 0
    ) {
      const now =
        context.currentTime

      const previousPhase =
        getTapePhase(now)

      tapeAnchorPhaseRef.current =
        previousPhase

      tapeAnchorTimeRef.current =
        now

      for (
        const source of
        tapeSourcesRef.current
      ) {
        source.playbackRate.setTargetAtTime(
          tapeSpeed,
          now,
          0.025,
        )
      }
    }

    tapeSpeedRef.current =
      tapeSpeed

    if (
      previousRate !== tapeSpeed
    ) {
      updateTapeProgressNow()
    }
  }, [tapeSpeed])

  function connectTapeModulation(
    source:
      AudioBufferSourceNode,
  ) {
    tapeWowGainRef.current?.connect(
      source.playbackRate,
    )

    tapeFlutterGainRef.current?.connect(
      source.playbackRate,
    )
  }

  function createTapeLayerSource(
    layer: TapeLayer,
    startAt: number,
    basePhase: number,
  ) {
    const context =
      audioContextRef.current

    const samplerBus =
      samplerBusNodeRef.current

    const loopSeconds =
      tapeLoopSecondsRef.current

    if (
      !context ||
      !samplerBus ||
      loopSeconds <= 0
    ) {
      return null
    }

    const source =
      context.createBufferSource()

    source.buffer =
      tapeReverseRef.current
        ? layer.reversedBuffer
        : layer.buffer

    source.loop = true

    source.playbackRate.value =
      tapeSpeedRef.current

    source.connect(
      samplerBus,
    )

    connectTapeModulation(
      source,
    )

    const forwardOffset =
      ((basePhase -
        layer.offsetSeconds) %
        loopSeconds +
        loopSeconds) %
      loopSeconds

    const playbackOffset =
      tapeReverseRef.current
        ? (loopSeconds -
            forwardOffset) %
          loopSeconds
        : forwardOffset

    source.start(
      startAt,
      playbackOffset,
    )

    tapeSourcesRef.current.push(
      source,
    )

    return source
  }

  function startTapeModulation(
    context: AudioContext,
  ) {
    const wow =
      context.createOscillator()

    const wowGain =
      context.createGain()

    wow.type = 'sine'
    wow.frequency.value = 0.55

    const flutter =
      context.createOscillator()

    const flutterGain =
      context.createGain()

    flutter.type = 'sine'
    flutter.frequency.value = 6.4

    wow.connect(wowGain)
    flutter.connect(
      flutterGain,
    )

    tapeWowOscillatorRef.current =
      wow

    tapeWowGainRef.current =
      wowGain

    tapeFlutterOscillatorRef.current =
      flutter

    tapeFlutterGainRef.current =
      flutterGain

    applyTapeSettings()

    wow.start()
    flutter.start()
  }

  async function startTapePlayback(
    layersOverride?:
      TapeLayer[],
    phaseOverride = 0,
  ) {
    const context =
      audioContextRef.current

    const samplerBus =
      samplerBusNodeRef.current

    const layers =
      layersOverride ??
      tapeLayersRef.current

    const loopSeconds =
      tapeLoopSecondsRef.current

    if (
      !context ||
      !samplerBus
    ) {
      throw new Error(
        'Take AUX first so the sampler has an active audio source.',
      )
    }

    if (
      layers.length === 0 ||
      loopSeconds <= 0
    ) {
      throw new Error(
        'Record a tape layer first.',
      )
    }

    await context.resume()

    stopTapeNodesOnly()

    startTapeModulation(
      context,
    )

    const startAt =
      context.currentTime +
      0.03

    const phase =
      ((phaseOverride %
        loopSeconds) +
        loopSeconds) %
      loopSeconds

    tapeAnchorTimeRef.current =
      startAt

    tapeAnchorPhaseRef.current =
      phase

    tapePlayingRef.current =
      true

    setTapePlaying(true)

    for (
      const layer of layers
    ) {
      createTapeLayerSource(
        layer,
        startAt,
        phase,
      )
    }

    startTapeProgressTimer()

    setTapeMessage(
      `${layers.length} tape ${
        layers.length === 1
          ? 'layer'
          : 'layers'
      } looping.`,
    )
  }

  function stopTapePlayback(
    resetProgress = true,
  ) {
    if (
      tapePlayingRef.current
    ) {
      tapeAnchorPhaseRef.current =
        getTapePhase()
    }

    stopTapeNodesOnly()
    clearTapeProgressTimer()

    tapePlayingRef.current =
      false

    setTapePlaying(false)

    if (resetProgress) {
      tapeAnchorPhaseRef.current =
        0

      setTapeProgress(0)
    }
  }

  function preferredTapeMimeType() {
    if (
      typeof MediaRecorder ===
      'undefined'
    ) {
      return ''
    }

    const types = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/webm',
    ]

    return (
      types.find((type) =>
        MediaRecorder.isTypeSupported(
          type,
        ),
      ) ?? ''
    )
  }

  function stopTapeRecording(
    discard = false,
  ) {
    const recorder =
      tapeRecorderRef.current

    clearTapeRecordTimer()

    tapeDiscardRecordingRef.current =
      discard

    if (
      recorder &&
      recorder.state !==
        'inactive'
    ) {
      recorder.stop()
    } else {
      tapeRecorderRef.current =
        null

      tapeRecordModeRef.current =
        null

      setTapeRecording(null)
    }
  }

  async function finaliseTapeRecording(
    mode: TapeRecordMode,
    chunks: Blob[],
    mimeType: string,
    recordOffset: number,
  ) {
    const context =
      audioContextRef.current

    if (
      tapeDiscardRecordingRef.current
    ) {
      tapeDiscardRecordingRef.current =
        false

      return
    }

    if (!context) {
      return
    }

    const blob =
      new Blob(
        chunks,
        mimeType
          ? {
              type: mimeType,
            }
          : undefined,
      )

    if (
      blob.size === 0
    ) {
      throw new Error(
        'The tape recorder did not receive any audio.',
      )
    }

    const arrayBuffer =
      await blob.arrayBuffer()

    const decoded =
      await context.decodeAudioData(
        arrayBuffer.slice(0),
      )

    if (
      decoded.duration <
      0.12
    ) {
      throw new Error(
        'That recording was too short. Hold REC a little longer.',
      )
    }

    if (mode === 'new') {
      const duration =
        Math.min(
          TAPE_MAX_SECONDS,
          decoded.duration,
        )

      const buffer =
        copyBufferToDuration(
          context,
          decoded,
          duration,
        )

      const layer: TapeLayer = {
        id:
          crypto.randomUUID(),
        buffer,
        reversedBuffer:
          reverseAudioBuffer(
            context,
            buffer,
          ),
        offsetSeconds: 0,
      }

      const nextLayers = [
        layer,
      ]

      setTapeLengthSafe(
        buffer.duration,
      )

      setTapeLayersSafe(
        nextLayers,
      )

      tapeAnchorPhaseRef.current =
        0

      await startTapePlayback(
        nextLayers,
        0,
      )

      setTapeMessage(
        `Tape captured: ${formatTapeTime(
          buffer.duration,
        )} sec. Add up to ${
          TAPE_MAX_LAYERS - 1
        } overdubs.`,
      )

      return
    }

    const loopSeconds =
      tapeLoopSecondsRef.current

    if (
      loopSeconds <= 0
    ) {
      throw new Error(
        'Record the first tape layer before overdubbing.',
      )
    }

    const buffer =
      copyBufferToDuration(
        context,
        decoded,
        loopSeconds,
      )

    const layer: TapeLayer = {
      id: crypto.randomUUID(),
      buffer,
      reversedBuffer:
        reverseAudioBuffer(
          context,
          buffer,
        ),
      offsetSeconds:
        recordOffset,
    }

    const nextLayers = [
      ...tapeLayersRef.current,
      layer,
    ].slice(
      0,
      TAPE_MAX_LAYERS,
    )

    setTapeLayersSafe(
      nextLayers,
    )

    if (
      tapePlayingRef.current
    ) {
      const phase =
        getTapePhase()

      createTapeLayerSource(
        layer,
        audioContextRef.current
          ?.currentTime ??
          0,
        phase,
      )
    }

    setTapeMessage(
      `Overdub added. ${nextLayers.length}/${TAPE_MAX_LAYERS} layers active.`,
    )
  }

  async function beginTapeRecording(
    mode: TapeRecordMode,
  ) {
    const context =
      audioContextRef.current

    const captureStream =
      samplerCaptureStreamRef.current

    if (
      !context ||
      !captureStream ||
      !processedAudioTrack
    ) {
      throw new Error(
        'Prepare a source first. The tape sampler records privately from your active deck input.',
      )
    }

    if (
      typeof MediaRecorder ===
      'undefined'
    ) {
      throw new Error(
        'This browser does not support the tape recorder.',
      )
    }

    if (
      tapeRecorderRef.current
    ) {
      return
    }

    if (
      mode === 'overdub'
    ) {
      if (
        tapeLayersRef.current.length ===
        0
      ) {
        throw new Error(
          'Record a new tape before overdubbing.',
        )
      }

      if (
        tapeLayersRef.current.length >=
        TAPE_MAX_LAYERS
      ) {
        throw new Error(
          `The short tape is full at ${TAPE_MAX_LAYERS} layers. Undo a layer or start a new tape.`,
        )
      }

      if (
        Math.abs(
          tapeSpeedRef.current -
            1,
        ) > 0.001
      ) {
        throw new Error(
          'Set Tape Speed to 1.00x before overdubbing so the new layer stays in sync.',
        )
      }

      if (
        !tapePlayingRef.current
      ) {
        await startTapePlayback()
      }
    } else {
      stopTapePlayback()

      setTapeLayersSafe([])
      setTapeLengthSafe(0)
    }

    await context.resume()

    const mimeType =
      preferredTapeMimeType()

    const recorder =
      mimeType
        ? new MediaRecorder(
            captureStream,
            {
              mimeType,
            },
          )
        : new MediaRecorder(
            captureStream,
          )

    const chunks: Blob[] = []

    tapeRecordChunksRef.current =
      chunks

    tapeRecordModeRef.current =
      mode

    tapeRecordOffsetRef.current =
      mode === 'overdub'
        ? getTapePhase(
            context.currentTime,
          )
        : 0

    tapeDiscardRecordingRef.current =
      false

    recorder.addEventListener(
      'dataavailable',
      (event) => {
        if (
          event.data.size > 0
        ) {
          chunks.push(
            event.data,
          )
        }
      },
    )

    recorder.addEventListener(
      'stop',
      () => {
        const stoppedMode =
          tapeRecordModeRef.current

        const stoppedOffset =
          tapeRecordOffsetRef.current

        const stoppedChunks = [
          ...tapeRecordChunksRef.current,
        ]

        const stoppedMime =
          recorder.mimeType

        tapeRecorderRef.current =
          null

        tapeRecordModeRef.current =
          null

        setTapeRecording(null)

        if (!stoppedMode) {
          return
        }

        void finaliseTapeRecording(
          stoppedMode,
          stoppedChunks,
          stoppedMime,
          stoppedOffset,
        ).catch((error) => {
          setDeviceError(
            error instanceof Error
              ? error.message
              : 'Could not create the tape loop.',
          )

          setTapeMessage(
            'Tape capture failed. Try again with a shorter recording.',
          )
        })
      },
      {
        once: true,
      },
    )

    tapeRecorderRef.current =
      recorder

    setTapeRecording(mode)

    recorder.start()

    const recordSeconds =
      mode === 'new'
        ? TAPE_MAX_SECONDS
        : tapeLoopSecondsRef.current

    tapeRecordTimerRef.current =
      window.setTimeout(
        () => {
          stopTapeRecording()
        },
        Math.max(
          120,
          recordSeconds * 1000,
        ),
      )

    setTapeMessage(
      mode === 'new'
        ? `Recording new tape… press REC again to stop early. Maximum ${TAPE_MAX_SECONDS} seconds.`
        : `Overdubbing one ${formatTapeTime(
            tapeLoopSecondsRef.current,
          )}-second pass…`,
    )
  }

  async function toggleTapePlay() {
    if (
      tapeLayersRef.current.length ===
      0
    ) {
      setDeviceError(
        'Record a tape layer first.',
      )

      return
    }

    if (
      !processedAudioTrack ||
      !samplerBusNodeRef.current
    ) {
      setDeviceError(
        'Prepare a source before playing the tape sampler.',
      )

      return
    }

    setDeviceError('')

    if (
      tapePlayingRef.current
    ) {
      stopTapePlayback()

      setTapeMessage(
        'Tape stopped.',
      )
    } else {
      try {
        await startTapePlayback()
      } catch (error) {
        setDeviceError(
          error instanceof Error
            ? error.message
            : 'Could not start tape playback.',
        )
      }
    }
  }

  async function undoTapeLayer() {
    if (
      tapeRecording
    ) {
      return
    }

    const current =
      tapeLayersRef.current

    if (
      current.length === 0
    ) {
      return
    }

    const next =
      current.slice(
        0,
        -1,
      )

    const wasPlaying =
      tapePlayingRef.current

    const phase =
      getTapePhase()

    stopTapePlayback(false)

    setTapeLayersSafe(next)

    if (
      next.length === 0
    ) {
      setTapeLengthSafe(0)

      tapeAnchorPhaseRef.current =
        0

      setTapeProgress(0)

      setTapeMessage(
        'Tape is empty.',
      )

      return
    }

    if (
      wasPlaying &&
      samplerBusNodeRef.current
    ) {
      await startTapePlayback(
        next,
        phase,
      )
    }

    setTapeMessage(
      `Removed last overdub. ${next.length}/${TAPE_MAX_LAYERS} layers remain.`,
    )
  }

  function clearTape() {
    stopTapeRecording(true)
    stopTapePlayback()

    setTapeLayersSafe([])
    setTapeLengthSafe(0)

    setTapeMessage(
      'Tape cleared. Ready to capture a new loop.',
    )
  }

  async function toggleTapeReverse() {
    const nextReverse =
      !tapeReverseRef.current

    const wasPlaying =
      tapePlayingRef.current

    const phase =
      getTapePhase()

    tapeReverseRef.current =
      nextReverse

    setTapeReverse(
      nextReverse,
    )

    if (
      wasPlaying &&
      tapeLayersRef.current.length >
        0
    ) {
      stopTapePlayback(false)

      try {
        await startTapePlayback(
          tapeLayersRef.current,
          phase,
        )
      } catch (error) {
        setDeviceError(
          error instanceof Error
            ? error.message
            : 'Could not reverse the tape.',
        )
      }
    }

    setTapeMessage(
      nextReverse
        ? 'Tape direction reversed.'
        : 'Tape direction forward.',
    )
  }

  /*
   * MINI DRUM MACHINE
   */

  function setPadSamplesSafe(
    next: (PadSample | null)[],
  ) {
    padSamplesRef.current = next
    setPadSamples(next)
  }

  function setDrumPatternSafe(
    next: boolean[][],
  ) {
    drumPatternRef.current = next
    setDrumPattern(next)
  }

  function stopDrumSources() {
    for (
      const source of
      drumSourcesRef.current
    ) {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }

      try {
        source.disconnect()
      } catch {
        // Safe to ignore.
      }
    }

    drumSourcesRef.current = []
  }

  function triggerPad(
    padIndex: number,
    when?: number,
  ) {
    const context =
      audioContextRef.current

    const bus =
      samplerBusNodeRef.current

    const sample =
      padSamplesRef.current[
        padIndex
      ]

    if (
      !context ||
      !bus ||
      !sample
    ) {
      return false
    }

    const source =
      context.createBufferSource()

    source.buffer = sample.buffer
    source.connect(bus)

    source.addEventListener(
      'ended',
      () => {
        drumSourcesRef.current =
          drumSourcesRef.current.filter(
            (entry) =>
              entry !== source,
          )
      },
      { once: true },
    )

    drumSourcesRef.current.push(
      source,
    )

    source.start(
      Math.max(
        context.currentTime,
        when ??
          context.currentTime,
      ),
    )

    return true
  }

  function loadTapeIntoPad(
    padIndex: number,
  ) {
    const context =
      audioContextRef.current

    const layers =
      tapeLayersRef.current

    const seconds =
      tapeLoopSecondsRef.current

    if (
      !context ||
      !samplerBusNodeRef.current
    ) {
      setDeviceError(
        'Prepare a source before loading a drum pad.',
      )

      return
    }

    if (
      layers.length === 0 ||
      seconds <= 0
    ) {
      setDeviceError(
        'Record a tape first, then load it into a pad.',
      )

      return
    }

    const mixed =
      mixTapeLayersToBuffer(
        context,
        layers,
        seconds,
      )

    const forwardBuffer =
      tapeReverseRef.current
        ? reverseAudioBuffer(
            context,
            mixed,
          )
        : mixed

    const sample: PadSample = {
      id: crypto.randomUUID(),
      name: `TAPE ${padIndex + 1}`,
      buffer: forwardBuffer,
      reversedBuffer:
        reverseAudioBuffer(
          context,
          forwardBuffer,
        ),
    }

    const next = [
      ...padSamplesRef.current,
    ]

    next[padIndex] = sample

    setPadSamplesSafe(next)
    setDeviceError('')

    setTapeMessage(
      `Tape snapshot loaded to Pad ${padIndex + 1}.`,
    )
  }

  function clearPad(
    padIndex: number,
  ) {
    const next = [
      ...padSamplesRef.current,
    ]

    next[padIndex] = null
    setPadSamplesSafe(next)

    const nextPattern =
      drumPatternRef.current.map(
        (row, index) =>
          index === padIndex
            ? row.map(() => false)
            : [...row],
      )

    setDrumPatternSafe(
      nextPattern,
    )
  }

  function toggleDrumStep(
    padIndex: number,
    stepIndex: number,
  ) {
    const next =
      drumPatternRef.current.map(
        (row) => [...row],
      )

    next[padIndex][stepIndex] =
      !next[padIndex][stepIndex]

    setDrumPatternSafe(next)
  }

  function clearDrumPattern() {
    const next =
      Array.from(
        { length: DRUM_PAD_COUNT },
        () =>
          Array.from(
            { length: DRUM_STEP_COUNT },
            () => false,
          ),
      )

    setDrumPatternSafe(next)
  }

  function stopSequencerClock() {
    if (
      drumTimerRef.current !== null
    ) {
      window.clearInterval(
        drumTimerRef.current,
      )

      drumTimerRef.current = null
    }

    sequencerPlayingRef.current =
      false

    setSequencerPlaying(false)
    setCurrentDrumStep(-1)
  }

  function runDrumStep(
    stepIndex: number,
  ) {
    const context =
      audioContextRef.current

    if (!context) return

    setCurrentDrumStep(
      stepIndex,
    )

    for (
      let padIndex = 0;
      padIndex < DRUM_PAD_COUNT;
      padIndex += 1
    ) {
      if (
        drumPatternRef.current[
          padIndex
        ]?.[stepIndex]
      ) {
        triggerPad(
          padIndex,
          context.currentTime +
            0.01,
        )
      }
    }
  }

  function startSequencerClock() {
    const context =
      audioContextRef.current

    if (
      !context ||
      !samplerBusNodeRef.current
    ) {
      setDeviceError(
        'Prepare a source before starting the drum sequencer.',
      )

      return
    }

    if (
      padSamplesRef.current.every(
        (sample) => !sample,
      )
    ) {
      setDeviceError(
        'Load at least one tape sample into a pad first.',
      )

      return
    }

    stopSequencerClock()

    sequencerPlayingRef.current =
      true

    setSequencerPlaying(true)

    drumStepRef.current = 0
    runDrumStep(0)

    const intervalMs =
      (60_000 / tempo) / 2

    drumTimerRef.current =
      window.setInterval(
        () => {
          const nextStep =
            (drumStepRef.current +
              1) %
            DRUM_STEP_COUNT

          drumStepRef.current =
            nextStep

          runDrumStep(
            nextStep,
          )
        },
        intervalMs,
      )
  }

  useEffect(() => {
    if (
      !sequencerPlaying
    ) {
      return
    }

    startSequencerClock()

    return () => {
      if (
        drumTimerRef.current !==
        null
      ) {
        window.clearInterval(
          drumTimerRef.current,
        )

        drumTimerRef.current =
          null
      }
    }
  }, [tempo])

  useEffect(() => {
    const handlePadKeys = (
      event: KeyboardEvent,
    ) => {
      const target =
        event.target as
          | HTMLElement
          | null

      if (
        target?.matches(
          'input, textarea, select, button',
        )
      ) {
        return
      }

      const padIndex =
        ['1', '2', '3', '4'].indexOf(
          event.key,
        )

      if (padIndex >= 0) {
        triggerPad(padIndex)
      }
    }

    window.addEventListener(
      'keydown',
      handlePadKeys,
    )

    return () =>
      window.removeEventListener(
        'keydown',
        handlePadKeys,
      )
  }, [])

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
      !processedAudioTrack
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
    processedAudioTrack,
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
     * A separate capture tap records
     * only the currently selected raw
     * source. Existing tape playback is
     * not baked into overdubs, so each
     * pass remains an editable layer.
     */

    const samplerCaptureDestination =
      context.createMediaStreamDestination()

    const samplerBus =
      context.createGain()

    const tapeFilter =
      context.createBiquadFilter()

    const tapeDrive =
      context.createWaveShaper()

    const tapeMonitorGain =
      context.createGain()

    tapeFilter.type = 'lowpass'
    tapeFilter.Q.value = 0.35

    tapeDrive.oversample = '2x'

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

    source.connect(
      samplerCaptureDestination,
    )

    source.connect(inputGain)

    /*
     * Tape playback rejoins the same
     * player mixer, so Volume / Gain /
     * Echo / Glitch affect the tape as
     * well as the live source.
     */

    samplerBus.connect(
      tapeFilter,
    )

    tapeFilter.connect(
      tapeDrive,
    )

    tapeDrive.connect(
      inputGain,
    )

    tapeDrive.connect(
      tapeMonitorGain,
    )

    tapeMonitorGain.connect(
      context.destination,
    )

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

    mainOutputMonitoredRef.current =
      monitorLocally

    samplerCaptureDestinationRef.current =
      samplerCaptureDestination

    samplerCaptureStreamRef.current =
      samplerCaptureDestination.stream

    samplerBusNodeRef.current =
      samplerBus

    tapeFilterNodeRef.current =
      tapeFilter

    tapeDriveNodeRef.current =
      tapeDrive

    tapeMonitorGainRef.current =
      tapeMonitorGain

    applyTapeSettings()

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

  async function stopBroadcastOnly() {
    const track =
      publishedAudioTrackRef.current

    if (!track) {
      setPublishedAudioTrack(null)
      return
    }

    publishedAudioTrackRef.current =
      null

    setPublishedAudioTrack(null)

    await room.localParticipant
      .unpublishTrack(
        track,
        false,
      )
      .catch(() => undefined)
  }

  async function publishPreparedDeck() {
    const track =
      processedAudioTrackRef.current

    if (
      !track ||
      track.readyState !== 'live'
    ) {
      throw new Error(
        'Prepare your deck before going on AUX.',
      )
    }

    if (
      publishedAudioTrackRef.current ===
      track
    ) {
      return
    }

    await stopBroadcastOnly()

    await room.localParticipant.publishTrack(
      track,
      preparedSourceRef.current === 'interface'
        ? {
            name: 'interface-audio',
            source:
              Track.Source.Microphone,
          }
        : preparedSourceRef.current ===
            'browser'
          ? {
              name: 'browser-audio',
              source:
                Track.Source.ScreenShareAudio,
            }
          : {
              name: 'deck-audio',
            },
    )

    publishedAudioTrackRef.current =
      track

    setPublishedAudioTrack(track)
  }

  async function stopProcessedAudio() {
    /*
     * Full deck cleanup. This is used
     * when changing source or leaving
     * the room. Passing AUX uses
     * stopBroadcastOnly instead so the
     * private sampler remains alive.
     */

    stopTapeRecording(true)
    stopTapePlayback()
    stopSequencerClock()
    stopDrumSources()

    const publishedTrack =
      publishedAudioTrackRef.current

    const processedTrack =
      processedAudioTrackRef.current

    const sourceTrack =
      sourceMediaTrackRef.current

    const audio =
      fileAudioRef.current

    const context =
      audioContextRef.current

    const objectUrl =
      fileAudioUrlRef.current

    publishedAudioTrackRef.current =
      null

    processedAudioTrackRef.current =
      null

    sourceMediaTrackRef.current =
      null

    fileAudioRef.current = null
    fileAudioUrlRef.current = null
    audioContextRef.current = null

    inputGainNodeRef.current = null
    glitchGainNodeRef.current = null
    echoWetNodeRef.current = null
    echoFeedbackNodeRef.current = null
    masterGainNodeRef.current = null

    samplerCaptureDestinationRef.current =
      null

    samplerCaptureStreamRef.current =
      null

    samplerBusNodeRef.current = null
    tapeFilterNodeRef.current = null
    tapeDriveNodeRef.current = null
    tapeMonitorGainRef.current = null

    mainOutputMonitoredRef.current =
      false

    stopGlitchTimer()

    setPublishedAudioTrack(null)
    setProcessedAudioTrack(null)
    preparedSourceRef.current =
      null

    setPreparedSource(null)

    await room.localParticipant
      .setMicrophoneEnabled(false)
      .catch(() => undefined)

    if (publishedTrack) {
      await room.localParticipant
        .unpublishTrack(
          publishedTrack,
          false,
        )
        .catch(() => undefined)
    }

    if (
      processedTrack &&
      processedTrack.readyState !==
        'ended'
    ) {
      processedTrack.stop()
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
      context.state !== 'closed'
    ) {
      await context
        .close()
        .catch(() => undefined)
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
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

    sourceTrack.addEventListener(
      'ended',
      () => {
        setStatusMessage(
          'USB / audio input disconnected.',
        )

        void stopProcessedAudio()
      },
      { once: true },
    )

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

    processedAudioTrackRef.current =
      processedTrack

    setProcessedAudioTrack(
      processedTrack,
    )

    preparedSourceRef.current =
      'interface'

    setPreparedSource(
      'interface',
    )

    setPermissionState(
      'granted',
    )

    await refreshDevices()

    setStatusMessage(
      'Private deck ready from USB / Audio Input. Build your tape or pads while waiting for AUX.',
    )
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
        'No audio was shared. Choose a Chrome tab or screen and enable audio sharing.',
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
          'Browser audio sharing stopped.',
        )

        void stopProcessedAudio()
      },
      { once: true },
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

    processedAudioTrackRef.current =
      processedTrack

    setProcessedAudioTrack(
      processedTrack,
    )

    preparedSourceRef.current =
      'browser'

    setPreparedSource(
      'browser',
    )

    setStatusMessage(
      'Browser audio is prepared privately. Build your tape or pads before you take AUX.',
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

    fileAudioRef.current = audio
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

    processedAudioTrackRef.current =
      processedTrack

    setProcessedAudioTrack(
      processedTrack,
    )

    preparedSourceRef.current =
      'file'

    setPreparedSource('file')

    try {
      await audio.play()

      audio.addEventListener(
        'ended',
        () => {
      
          setStatusMessage(
            'Audio file finished. Your tape and pad snapshots stay in the private deck.',
          )
        },
        { once: true },
      )

      setStatusMessage(
        `${selectedFile.name} is playing in your private deck. Capture it to tape or pads before taking AUX.`,
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

  async function prepareSelectedSource() {
    if (preparingDeck) {
      return
    }

    if (
      audioSource === 'file' &&
      !selectedFile
    ) {
      throw new Error(
        'Choose an audio file before preparing the deck.',
      )
    }

    setPreparingDeck(true)
    setDeviceError('')

    try {
      if (
        audioSource ===
        'interface'
      ) {
        await startInterfaceAudio()
      } else if (
        audioSource ===
        'browser'
      ) {
        await startBrowserAudio()
      } else {
        await startFileAudio()
      }
    } finally {
      setPreparingDeck(false)
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
        'Audio input enabled. Choose the input, then prepare your private deck.',
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

    setBusy(true)
    setDeviceError('')

    try {
      if (
        !processedAudioTrackRef.current ||
        processedAudioTrackRef.current
          .readyState !== 'live' ||
        preparedSourceRef.current !==
          audioSource
      ) {
        await prepareSelectedSource()
      }

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
              auxClaim(participant)

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
          ?.participant.identity !==
        room.localParticipant.identity
      ) {
        await room.localParticipant.setAttributes(
          {
            [AUX_ATTRIBUTE]: '',
          },
        )

        setStatusMessage(
          `${participantName(
            currentClaims[0]
              .participant,
          )} took AUX first. Your private deck is still ready.`,
        )

        return
      }

      await publishPreparedDeck()

      setStatusMessage(
        'ON AIR — your prepared deck, tape and drum pads are now feeding the room.',
      )
    } catch (error) {
      await stopBroadcastOnly()

      await room.localParticipant
        .setAttributes({
          [AUX_ATTRIBUTE]: '',
        })
        .catch(() => undefined)

      setDeviceError(
        error instanceof Error
          ? error.message
          : 'Could not take AUX.',
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
      await stopBroadcastOnly()

      await room.localParticipant.setAttributes(
        {
          [AUX_ATTRIBUTE]: '',
        },
      )

      setStatusMessage(
        'AUX passed. Your private deck stays active so you can keep sampling and sequencing.',
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

  /*
   * CHANGE HARDWARE INPUT
   */

  async function changeDevice(
    deviceId: string,
  ) {
    if (iHaveAux) {
      setStatusMessage(
        'Pass AUX before changing the hardware input.',
      )

      return
    }

    setSelectedDevice(deviceId)
    setDeviceError('')

    if (
      preparedSourceRef.current ===
      'interface'
    ) {
      await stopProcessedAudio()

      setStatusMessage(
        'Input changed. Press Prepare deck to reconnect the new device.',
      )
    }
  }

  /*
   * UI
   */

  return (
    <>
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

            <div className="aa-source-section">
              <div className="aa-section-heading">
                <div>
                  <p className="aa-kicker">
                    Private deck source
                  </p>
                  <strong>
                    Choose an input, prepare it privately, then take AUX
                  </strong>
                </div>
              </div>

              <div
                className="aa-source-grid"
                role="group"
                aria-label="Private deck source"
              >
                <button
                  className={`aa-source-card ${
                    audioSource ===
                    'interface'
                      ? 'is-active'
                      : ''
                  }`}
                  type="button"
                  onClick={() =>
                    setAudioSource(
                      'interface',
                    )
                  }
                  disabled={
                    busy ||
                    preparingDeck ||
                    iHaveAux
                  }
                >
                  <span className="aa-source-tag">
                    USB
                  </span>

                  <span className="aa-source-card-title">
                    USB / Audio Input
                  </span>

                  <span className="aa-source-card-meta">
                    Interface, mixer, SP-404 or mic
                  </span>
                </button>

                <button
                  className={`aa-source-card ${
                    audioSource ===
                    'browser'
                      ? 'is-active'
                      : ''
                  }`}
                  type="button"
                  onClick={() =>
                    setAudioSource(
                      'browser',
                    )
                  }
                  disabled={
                    busy ||
                    preparingDeck ||
                    iHaveAux
                  }
                >
                  <span className="aa-source-tag">
                    Desktop
                  </span>

                  <span className="aa-source-card-title">
                    Browser / Screen
                  </span>

                  <span className="aa-source-card-meta">
                    Share tab or computer audio
                  </span>
                </button>

                <button
                  className={`aa-source-card ${
                    audioSource ===
                    'file'
                      ? 'is-active'
                      : ''
                  }`}
                  type="button"
                  onClick={() => {
                    setAudioSource(
                      'file',
                    )
                    setDeviceError('')
                    fileInputRef.current?.click()
                  }}
                  disabled={
                    busy ||
                    preparingDeck ||
                    iHaveAux
                  }
                >
                  <span className="aa-source-tag">
                    File
                  </span>

                  <span className="aa-source-card-title">
                    Audio File
                  </span>

                  <span className="aa-source-card-meta">
                    MP3, WAV and other audio
                  </span>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aif,.aiff"
                style={{
                  display: 'none',
                }}
                disabled={
                  busy ||
                  preparingDeck ||
                  iHaveAux
                }
                onChange={(event) => {
                  const file =
                    event.currentTarget.files?.[0] ??
                    null

                  setSelectedFile(file)
                  setDeviceError('')

                  if (file) {
                    if (
                      preparedSourceRef.current ===
                      'file'
                    ) {
                      void stopProcessedAudio()
                    }

                    setAudioSource(
                      'file',
                    )

                    setStatusMessage(
                      `${file.name} selected. Prepare the deck to preview and sample it.`,
                    )
                  }

                  event.currentTarget.value =
                    ''
                }}
              />

              {audioSource ===
              'interface' ? (
                <div className="aa-source-panel">
                  <div className="aa-source-panel-copy">
                    <strong>
                      USB / Audio Input
                    </strong>

                    <p>
                      Connect your audio interface, mixer,
                      SP-404 or other USB-C audio device.
                      Enable audio access, refresh the
                      inputs, then choose the device below.
                    </p>
                  </div>

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
                        No inputs detected
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

                  <div className="aa-source-actions">
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
                      Detect / refresh inputs
                    </button>
                  </div>

                  <p className="aa-source-tip">
                    Mobile tip: connect the USB-C audio
                    device before pressing Detect /
                    refresh inputs.
                  </p>
                </div>
              ) : audioSource ===
                'browser' ? (
                <div className="aa-source-panel">
                  <div className="aa-source-panel-copy">
                    <div className="aa-source-panel-title-row">
                      <strong>
                        Share computer audio
                      </strong>

                      <span className="aa-desktop-badge">
                        Chrome desktop
                      </span>
                    </div>

                    <p>
                      Use this when your music is playing
                      in a browser, DAW, media player or
                      another desktop app.
                    </p>
                  </div>

                  <div className="aa-browser-tutorial">
                    <strong>
                      How to share audio
                    </strong>

                    <ol>
                      <li>
                        Press{' '}
                        <b>
                          Prepare deck
                        </b>.
                      </li>

                      <li>
                        In Chrome&apos;s share window,
                        select{' '}
                        <b>
                          Entire Screen
                        </b>{' '}
                        for whole-computer audio.
                      </li>

                      <li>
                        Turn on the{' '}
                        <b>
                          Share system audio
                        </b>{' '}
                        or{' '}
                        <b>
                          Share audio
                        </b>{' '}
                        switch at the bottom before
                        continuing.
                      </li>

                      <li>
                        Press{' '}
                        <b>
                          Share
                        </b>{' '}
                        and return to Audio Arcade.
                      </li>
                    </ol>

                    <p>
                      Sharing only one Chrome tab? Choose{' '}
                      <b>
                        Chrome Tab
                      </b>{' '}
                      instead and make sure{' '}
                      <b>
                        Share tab audio
                      </b>{' '}
                      is switched on.
                    </p>
                  </div>

                  <p className="aa-source-warning">
                    Browser / screen audio sharing is
                    primarily a desktop feature. On mobile,
                    use USB / Audio Input or Audio File.
                  </p>
                </div>
              ) : (
                <div className="aa-source-panel">
                  <div className="aa-source-panel-copy">
                    <strong>
                      Play an audio file
                    </strong>

                    <p>
                      Choose a track stored on your device.
                      It starts in your private deck so you can
                      sample it before you take AUX.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="aa-file-button"
                    onClick={() =>
                      fileInputRef.current?.click()
                    }
                    disabled={
                      busy ||
                      preparingDeck ||
                      iHaveAux
                    }
                  >
                    {selectedFile
                      ? 'Choose another file'
                      : 'Choose audio file'}
                  </button>

                  {selectedFile ? (
                    <p className="aa-selected-file">
                      <span>
                        Selected
                      </span>
                      {
                        selectedFile.name
                      }
                    </p>
                  ) : (
                    <p className="aa-source-tip">
                      No audio file selected.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`aa-deck-ready-bar ${
              deckReady
                ? iHaveAux
                  ? 'is-live'
                  : 'is-ready'
                : ''
            }`}>
              <div>
                <span className="aa-deck-dot" />
                <div>
                  <strong>
                    {deckReady
                      ? iHaveAux
                        ? 'DECK ON AIR'
                        : 'PRIVATE DECK READY'
                      : 'DECK NOT PREPARED'}
                  </strong>
                  <small>
                    {deckReady
                      ? `${preparedSource ?? audioSource} source • tape + pads available`
                      : 'Prepare a source to sample while you wait for AUX'}
                  </small>
                </div>
              </div>

              <div className="aa-deck-ready-actions">
                <button
                  type="button"
                  className="aa-prepare-button"
                  onClick={() =>
                    void prepareSelectedSource().catch(
                      (error) => {
                        setDeviceError(
                          error instanceof Error
                            ? error.message
                            : 'Could not prepare the deck.',
                        )
                      },
                    )
                  }
                  disabled={
                    busy ||
                    preparingDeck ||
                    iHaveAux ||
                    (audioSource === 'file' &&
                      !selectedFile)
                  }
                >
                  {preparingDeck
                    ? 'Preparing…'
                    : deckReady &&
                        preparedSource ===
                          audioSource
                      ? 'Re-prepare'
                      : 'Prepare deck'}
                </button>

                {deckReady && !iHaveAux ? (
                  <button
                    type="button"
                    className="aa-deck-close"
                    onClick={() =>
                      void stopProcessedAudio()
                    }
                    disabled={busy || preparingDeck}
                  >
                    Close
                  </button>
                ) : null}
              </div>
            </div>

            <div className="aa-tool-grid">
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
                Drag knobs left or right. These affect your private deck and the same signal when you go on air.
              </p>
            </div>

            <div className="aa-tape-panel">
              <div className="aa-tape-heading">
                <div>
                  <p className="aa-kicker">
                    Short sampler
                  </p>

                  <strong>
                    AA Tape Deck
                  </strong>
                </div>

                <span
                  className={`aa-tape-status ${
                    tapeRecording
                      ? 'is-recording'
                      : tapePlaying
                        ? 'is-playing'
                        : ''
                  }`}
                >
                  {tapeRecording
                    ? tapeRecording ===
                      'new'
                      ? 'REC'
                      : 'DUB'
                    : tapePlaying
                      ? 'PLAY'
                      : tapeLayers.length >
                          0
                        ? 'READY'
                        : 'EMPTY'}
                </span>
              </div>

              <div
                className={`aa-tape-machine ${
                  tapePlaying
                    ? 'is-playing'
                    : ''
                }`}
              >
                <div className="aa-tape-reels">
                  <span className="aa-tape-reel" />
                  <span className="aa-tape-window">
                    <span>
                      {tapeLayers.length}/
                      {TAPE_MAX_LAYERS}
                    </span>
                    <small>
                      LAYERS
                    </small>
                  </span>
                  <span className="aa-tape-reel" />
                </div>

                <div className="aa-tape-counter">
                  <span>
                    {formatTapeTime(
                      tapeProgress *
                        tapeLoopSeconds,
                    )}
                  </span>

                  <span>
                    {tapeLoopSeconds >
                    0
                      ? formatTapeTime(
                          tapeLoopSeconds,
                        )
                      : `${TAPE_MAX_SECONDS}.0`}
                    s
                  </span>
                </div>

                <div
                  className="aa-tape-progress"
                  aria-label="Tape playhead"
                  style={{
                    '--aa-tape-progress':
                      `${Math.min(
                        100,
                        Math.max(
                          0,
                          tapeProgress *
                            100,
                        ),
                      )}%`,
                  } as CSSProperties}
                >
                  <span />
                </div>

                <div className="aa-tape-layer-lights">
                  {Array.from({
                    length:
                      TAPE_MAX_LAYERS,
                  }).map(
                    (_, index) => (
                      <span
                        key={index}
                        className={
                          index <
                          tapeLayers.length
                            ? 'is-filled'
                            : ''
                        }
                      >
                        L{index + 1}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div className="aa-tape-transport">
                <button
                  type="button"
                  className={`aa-tape-button aa-tape-record ${
                    tapeRecording ===
                    'new'
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() => {
                    setDeviceError('')

                    if (
                      tapeRecording ===
                      'new'
                    ) {
                      stopTapeRecording()
                      return
                    }

                    void beginTapeRecording(
                      'new',
                    ).catch(
                      (error) => {
                        setDeviceError(
                          error instanceof
                            Error
                            ? error.message
                            : 'Could not start tape recording.',
                        )
                      },
                    )
                  }}
                  disabled={
                    (!deckReady &&
                      tapeRecording !==
                        'new') ||
                    tapeRecording ===
                      'overdub'
                  }
                >
                  <span />
                  {tapeRecording ===
                  'new'
                    ? 'Stop REC'
                    : 'New REC'}
                </button>

                <button
                  type="button"
                  className={`aa-tape-button ${
                    tapeRecording ===
                    'overdub'
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() => {
                    setDeviceError('')

                    void beginTapeRecording(
                      'overdub',
                    ).catch(
                      (error) => {
                        setDeviceError(
                          error instanceof
                            Error
                            ? error.message
                            : 'Could not overdub the tape.',
                        )
                      },
                    )
                  }}
                  disabled={
                    !deckReady ||
                    tapeLayers.length ===
                      0 ||
                    tapeLayers.length >=
                      TAPE_MAX_LAYERS ||
                    tapeRecording !==
                      null ||
                    Math.abs(
                      tapeSpeed - 1,
                    ) > 0.001
                  }
                >
                  Overdub
                </button>

                <button
                  type="button"
                  className={`aa-tape-button ${
                    tapePlaying
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() =>
                    void toggleTapePlay()
                  }
                  disabled={
                    !deckReady ||
                    tapeLayers.length ===
                      0 ||
                    tapeRecording ===
                      'new'
                  }
                >
                  {tapePlaying
                    ? 'Stop'
                    : 'Play'}
                </button>

                <button
                  type="button"
                  className={`aa-tape-button ${
                    tapeReverse
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() =>
                    void toggleTapeReverse()
                  }
                  disabled={
                    tapeLayers.length ===
                      0 ||
                    tapeRecording !==
                      null
                  }
                >
                  Reverse
                </button>

                <button
                  type="button"
                  className="aa-tape-button"
                  onClick={() =>
                    void undoTapeLayer()
                  }
                  disabled={
                    tapeLayers.length ===
                      0 ||
                    tapeRecording !==
                      null
                  }
                >
                  Undo
                </button>

                <button
                  type="button"
                  className="aa-tape-button"
                  onClick={
                    clearTape
                  }
                  disabled={
                    tapeLayers.length ===
                      0 &&
                    tapeRecording ===
                      null
                  }
                >
                  Clear
                </button>
              </div>

              <div className="aa-tape-knobs">
                <FxSlider
                  label="Tape speed"
                  value={tapeSpeed}
                  min={0.5}
                  max={1.5}
                  step={0.01}
                  displayValue={`${tapeSpeed.toFixed(
                    2,
                  )}x`}
                  onChange={
                    setTapeSpeed
                  }
                  disabled={
                    tapeRecording !==
                    null
                  }
                />

                <FxSlider
                  label="Tape wear"
                  value={tapeWear}
                  min={0}
                  max={100}
                  step={1}
                  displayValue={`${tapeWear}%`}
                  onChange={
                    setTapeWear
                  }
                />
              </div>

              <div className="aa-tape-footer">
                <button
                  type="button"
                  className={`aa-tape-monitor ${
                    tapeMonitor ||
                    (preparedSource ===
                      'file' &&
                      deckReady)
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() =>
                    setTapeMonitor(
                      (current) =>
                        !current,
                    )
                  }
                  disabled={
                    !deckReady ||
                    preparedSource ===
                      'file'
                  }
                >
                  {preparedSource ===
                    'file' &&
                  deckReady
                    ? 'Monitor auto'
                    : tapeMonitor
                      ? 'Monitor on'
                      : 'Monitor off'}
                </button>

                <p>
                  {tapeMessage}
                </p>
              </div>

              <p className="aa-tape-note">
                Private until you own AUX. New REC replaces the current tape; Overdub adds a layer. Load any tape state into a drum pad below. Return Tape Speed to 1.00x before overdubbing.
              </p>
            </div>

            </div>

            <div className="aa-drum-panel">
              <div className="aa-drum-heading">
                <div>
                  <p className="aa-kicker">
                    Tape pads / sequencer
                  </p>

                  <strong>
                    AA-04
                  </strong>
                </div>

                <div className="aa-tempo-control">
                  <label htmlFor="aa-tempo">
                    BPM
                    <strong>{tempo}</strong>
                  </label>

                  <input
                    id="aa-tempo"
                    type="range"
                    min={60}
                    max={180}
                    step={1}
                    value={tempo}
                    onChange={(event) =>
                      setTempo(
                        Number(
                          event.target.value,
                        ),
                      )
                    }
                    aria-label="Sequencer tempo"
                  />
                </div>
              </div>

              <div className="aa-drum-pads">
                {padSamples.map(
                  (sample, padIndex) => (
                    <div
                      className="aa-drum-pad-cell"
                      key={padIndex}
                    >
                      <button
                        type="button"
                        className={`aa-drum-pad ${
                          sample
                            ? 'is-loaded'
                            : ''
                        }`}
                        onClick={() => {
                          if (sample) {
                            triggerPad(
                              padIndex,
                            )
                          }
                        }}
                        disabled={
                          !sample ||
                          !deckReady
                        }
                        aria-label={`Trigger pad ${
                          padIndex + 1
                        }`}
                      >
                        <span>
                          {String(
                            padIndex + 1,
                          ).padStart(
                            2,
                            '0',
                          )}
                        </span>

                        <strong>
                          {sample
                            ? sample.name
                            : 'EMPTY'}
                        </strong>

                        <small>
                          {sample
                            ? `${formatTapeTime(
                                sample.buffer
                                  .duration,
                              )}s`
                            : 'SET TAPE'}
                        </small>
                      </button>

                      <div className="aa-drum-pad-tools">
                        <button
                          type="button"
                          onClick={() =>
                            loadTapeIntoPad(
                              padIndex,
                            )
                          }
                          disabled={
                            !deckReady ||
                            tapeLayers.length ===
                              0 ||
                            tapeRecording !==
                              null
                          }
                        >
                          Set
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            clearPad(
                              padIndex,
                            )
                          }
                          disabled={!sample}
                        >
                          −
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="aa-sequencer-bar">
                <button
                  type="button"
                  className={`aa-seq-play ${
                    sequencerPlaying
                      ? 'is-active'
                      : ''
                  }`}
                  onClick={() => {
                    if (
                      sequencerPlaying
                    ) {
                      stopSequencerClock()
                    } else {
                      startSequencerClock()
                    }
                  }}
                  disabled={!deckReady}
                >
                  {sequencerPlaying
                    ? '■ Stop'
                    : '▶ Seq'}
                </button>

                <span>
                  8 steps / 1⁄8
                </span>

                <button
                  type="button"
                  className="aa-seq-clear"
                  onClick={
                    clearDrumPattern
                  }
                >
                  Clear pattern
                </button>
              </div>

              <div
                className="aa-step-grid"
                aria-label="Drum step sequencer"
              >
                {drumPattern.map(
                  (row, padIndex) => (
                    <div
                      className="aa-step-row"
                      key={padIndex}
                    >
                      <span>
                        P{padIndex + 1}
                      </span>

                      {row.map(
                        (
                          active,
                          stepIndex,
                        ) => (
                          <button
                            type="button"
                            key={stepIndex}
                            className={`${
                              active
                                ? 'is-active'
                                : ''
                            } ${
                              currentDrumStep ===
                              stepIndex
                                ? 'is-playhead'
                                : ''
                            }`}
                            onClick={() =>
                              toggleDrumStep(
                                padIndex,
                                stepIndex,
                              )
                            }
                            disabled={
                              !padSamples[
                                padIndex
                              ]
                            }
                            aria-label={`Pad ${
                              padIndex + 1
                            }, step ${
                              stepIndex + 1
                            }`}
                            aria-pressed={
                              active
                            }
                          >
                            {stepIndex + 1}
                          </button>
                        ),
                      )}
                    </div>
                  ),
                )}
              </div>

              <p className="aa-drum-note">
                SET stores a snapshot of the current tape on a pad. Tap pads or use keys 1–4. The 8-step sequence follows the BPM slider and stays private until you take AUX.
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
                  ? 'Taking AUX…'
                  : deckReady &&
                      preparedSource ===
                        audioSource
                    ? 'Take AUX'
                    : 'Prepare + Take AUX'}
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
                    : deckReady
                      ? 'is-private'
                      : ''
                }
              >
                {(preparedSource ??
                  audioSource) ===
                'browser'
                  ? 'Browser audio'
                  : (preparedSource ??
                        audioSource) ===
                      'file'
                    ? 'Audio file'
                    : 'Input'}{' '}
                {isPublishing
                  ? 'ON AIR'
                  : deckReady
                    ? 'PRIVATE'
                    : 'OFF'}
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