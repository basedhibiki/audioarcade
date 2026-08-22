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
        displayName={
          joinState.displayName
        }
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
    browserAudioTrack,
    setBrowserAudioTrack,
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

  const fileAudioTrackRef =
    useRef<MediaStreamTrack | null>(
      null,
    )

  const fileAudioContextRef =
    useRef<AudioContext | null>(
      null,
    )

  const fileAudioUrlRef =
    useRef<string | null>(null)

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
    room.localParticipant
      .isMicrophoneEnabled ||
    browserAudioTrack?.readyState ===
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
      void room.localParticipant.setMicrophoneEnabled(
        false,
      )

      if (browserAudioTrack) {
        void room.localParticipant
          .unpublishTrack(
            browserAudioTrack,
            true,
          )
          .catch(
            () => undefined,
          )

        setBrowserAudioTrack(null)
      }

      void stopFileAudio()
    }
  }, [
    browserAudioTrack,
    iHaveAux,
    isPublishing,
    room.localParticipant,
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
   * BROWSER / TAB AUDIO
   */

  async function stopBrowserAudio() {
    if (!browserAudioTrack) {
      return
    }

    await room.localParticipant
      .unpublishTrack(
        browserAudioTrack,
        true,
      )
      .catch(() => undefined)

    if (
      browserAudioTrack.readyState !==
      'ended'
    ) {
      browserAudioTrack.stop()
    }

    setBrowserAudioTrack(null)
  }

  async function requestBrowserAudio() {
    if (
      !navigator.mediaDevices
        ?.getDisplayMedia
    ) {
      throw new Error(
        'Browser audio sharing is not supported in this browser.',
      )
    }

    const stream =
      await navigator.mediaDevices.getDisplayMedia(
        {
          video: true,
          audio: true,
        },
      )

    const audioTrack =
      stream.getAudioTracks()[0]

    if (!audioTrack) {
      stream
        .getTracks()
        .forEach((track) =>
          track.stop(),
        )

      throw new Error(
        'No audio was shared. Choose a Chrome tab and enable “Share tab audio”.',
      )
    }

    /*
     * We only need the audio.
     */
    stream
      .getVideoTracks()
      .forEach((track) =>
        track.stop(),
      )

    audioTrack.addEventListener(
      'ended',
      () => {
        void room.localParticipant
          .unpublishTrack(
            audioTrack,
            false,
          )
          .catch(
            () => undefined,
          )

        setBrowserAudioTrack(
          (current) =>
            current ===
            audioTrack
              ? null
              : current,
        )

        setStatusMessage(
          'Browser audio sharing stopped. Pass AUX or choose a new source.',
        )
      },

      {
        once: true,
      },
    )

    return audioTrack
  }

  /*
   * FILE AUDIO
   */

  async function stopFileAudio() {
    /*
     * Pull references first so
     * cleanup still works even if
     * React state changes while this
     * function is running.
     */

    const track =
      fileAudioTrackRef.current

    const audio =
      fileAudioRef.current

    const audioContext =
      fileAudioContextRef.current

    const objectUrl =
      fileAudioUrlRef.current

    /*
     * Clear refs immediately.
     */

    fileAudioTrackRef.current =
      null

    fileAudioRef.current = null

    fileAudioContextRef.current =
      null

    fileAudioUrlRef.current = null

    setFileIsPlaying(false)

    /*
     * Remove track from LiveKit.
     */

    if (track) {
      await room.localParticipant
        .unpublishTrack(
          track,
          true,
        )
        .catch(
          () => undefined,
        )

      if (
        track.readyState !==
        'ended'
      ) {
        track.stop()
      }
    }

    /*
     * Stop local playback.
     */

    if (audio) {
      audio.pause()

      try {
        audio.currentTime = 0
      } catch {
        // Some formats may not allow
        // seeking during cleanup.
      }

      audio.removeAttribute('src')

      try {
        audio.load()
      } catch {
        // Safe to ignore during
        // cleanup.
      }
    }

    /*
     * Close Web Audio.
     */

    if (
      audioContext &&
      audioContext.state !==
        'closed'
    ) {
      await audioContext
        .close()
        .catch(
          () => undefined,
        )
    }

    /*
     * Release temporary file URL.
     */

    if (objectUrl) {
      URL.revokeObjectURL(
        objectUrl,
      )
    }
  }

  async function startFileAudio() {
    if (!selectedFile) {
      throw new Error(
        'Choose an audio file first.',
      )
    }

    /*
     * Make sure an old file session
     * is gone.
     */

    await stopFileAudio()

    const objectUrl =
      URL.createObjectURL(
        selectedFile,
      )

    const audio =
      new Audio(objectUrl)

    audio.preload = 'auto'

    const audioContext =
      new AudioContext()

    const source =
      audioContext.createMediaElementSource(
        audio,
      )

    const destination =
      audioContext.createMediaStreamDestination()

    /*
     * One path goes to LiveKit.
     *
     * The second path goes to local
     * headphones so the performer can
     * hear their own file.
     */

    source.connect(destination)

    source.connect(
      audioContext.destination,
    )

    const track =
      destination.stream.getAudioTracks()[0]

    if (!track) {
      URL.revokeObjectURL(
        objectUrl,
      )

      await audioContext
        .close()
        .catch(
          () => undefined,
        )

      throw new Error(
        'Could not create an audio stream from this file.',
      )
    }

    /*
     * Store references BEFORE
     * publishing so catch/cleanup can
     * always find them.
     */

    fileAudioRef.current = audio

    fileAudioTrackRef.current =
      track

    fileAudioContextRef.current =
      audioContext

    fileAudioUrlRef.current =
      objectUrl

    try {
      /*
       * Resume while we are still
       * inside the Take AUX user
       * action.
       */

      await audioContext.resume()

      /*
       * Publish generated audio track
       * to LiveKit.
       */

      await room.localParticipant.publishTrack(
        track,
        {
          name: 'file-audio',
        },
      )

      /*
       * Start playback.
       */

      await audio.play()

      setFileIsPlaying(true)

      /*
       * Automatically stop publishing
       * once the song reaches the end.
       */

      audio.addEventListener(
        'ended',
        () => {
          setStatusMessage(
            'Audio file finished. Pass AUX or choose another source.',
          )

          void stopFileAudio()
        },
        {
          once: true,
        },
      )
    } catch (error) {
      await stopFileAudio()

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

    /*
     * ArcadeLobby can also call
     * takeAux(), so protect file mode
     * here as well as disabling the
     * main button.
     */

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
      /*
       * Ask microphone permission only
       * when using hardware input.
       */

      if (
        audioSource ===
        'interface'
      ) {
        await requestAudioPermission()
      }

      /*
       * Claim AUX.
       */

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

      /*
       * Someone else won the AUX race.
       */

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

      /*
       * AUDIO INTERFACE
       */

      if (
        audioSource ===
        'interface'
      ) {
        await stopBrowserAudio()
        await stopFileAudio()

        if (selectedDevice) {
          await room.switchActiveDevice(
            'audioinput',
            selectedDevice,
          )
        }

        await room.localParticipant.setMicrophoneEnabled(
          true,
          {
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
        )

        await refreshDevices()

        setStatusMessage(
          'You are live from your audio input. Pass AUX when finished.',
        )
      }

      /*
       * BROWSER / TAB AUDIO
       */
      else if (
        audioSource ===
        'browser'
      ) {
        await room.localParticipant.setMicrophoneEnabled(
          false,
        )

        await stopFileAudio()

        await stopBrowserAudio()

        const audioTrack =
          await requestBrowserAudio()

        await room.localParticipant.publishTrack(
          audioTrack,
          {
            name: 'browser-audio',

            source:
              Track.Source
                .ScreenShareAudio,
          },
        )

        setBrowserAudioTrack(
          audioTrack,
        )

        setStatusMessage(
          'Browser audio is live. Keep the shared tab playing, then pass AUX when finished.',
        )
      }

      /*
       * AUDIO FILE
       */
      else {
        await room.localParticipant.setMicrophoneEnabled(
          false,
        )

        await stopBrowserAudio()

        await startFileAudio()

        setStatusMessage(
          `Playing ${
            selectedFile?.name ??
            'audio file'
          } on AUX.`,
        )
      }
    } catch (error) {
      await room.localParticipant
        .setMicrophoneEnabled(
          false,
        )
        .catch(
          () => undefined,
        )

      await stopBrowserAudio()

      await stopFileAudio()

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
          : 'Could not start your audio input.',
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
      await room.localParticipant.setMicrophoneEnabled(
        false,
      )

      await stopBrowserAudio()

      await stopFileAudio()

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

    if (
      !iHaveAux ||
      audioSource !== 'interface'
    ) {
      return
    }

    try {
      await room.switchActiveDevice(
        'audioinput',
        deviceId,
      )

      setStatusMessage(
        'Input changed. Your AUX feed is still live.',
      )
    } catch (error) {
      setDeviceError(
        error instanceof Error
          ? error.message
          : 'Could not change audio input.',
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
                onClick={() =>
                  setAudioSource(
                    'file',
                  )
                }
                disabled={
                  busy || iHaveAux
                }
              >
                Audio file
              </button>
            </div>

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

                <label
                  className="aa-device-label"
                  htmlFor="audio-file"
                >
                  Audio file
                </label>

                <input
                  id="audio-file"
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aif,.aiff"
                  onChange={(
                    event,
                  ) => {
                    const file =
                      event.target
                        .files?.[0] ??
                      null

                    setSelectedFile(
                      file,
                    )

                    setDeviceError(
                      '',
                    )

                    if (file) {
                      setStatusMessage(
                        `${file.name} ready. Take AUX to play.`,
                      )
                    }
                  }}
                  disabled={
                    busy || iHaveAux
                  }
                />

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