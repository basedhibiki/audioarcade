# Audio Arcade Discord Beta

## What changed

- Added a display-name join screen.
- Added a selectable audio input list.
- Replaced the prototype request/chat interface with Take AUX and Pass AUX controls.
- AUX ownership is stored in LiveKit participant attributes so late joiners can see the current holder and the claim disappears when its participant disconnects.
- Only the elected AUX holder keeps a microphone track published.
- Added current-holder, connection, publishing and participant status displays.
- Disabled browser voice processing for the AUX feed (echo cancellation, noise suppression and automatic gain control).
- Simplified the token route for a guest beta and enabled participant attribute updates.

## Deployment checks

Required environment variables:

- `NEXT_PUBLIC_LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Recommended beta setup:

- Chrome desktop
- Wired headphones
- Discord for conversation
- Audio Arcade for music only
- 5–10 testers for the first session

## Important limitation

The AUX lock is a deterministic peer-state lock using LiveKit participant attributes. It is suitable for a moderated beta, but a production version should move AUX arbitration to an authoritative server endpoint or room agent.
