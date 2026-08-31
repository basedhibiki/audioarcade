'use client'

const PLACEHOLDER_SPRITES = [
  '/sprites/players/player-01.png',
  '/sprites/players/player-02.png',
  '/sprites/players/player-03.png',
  '/sprites/players/player-04.png',
  '/sprites/players/player-05.png',
  '/sprites/players/player-06.png',
  '/sprites/players/player-07.png',
  '/sprites/players/player-08.png',
  '/sprites/players/player-09.png',
  '/sprites/players/player-10.png',
  '/sprites/players/player-11.png',
  '/sprites/players/player-12.png',
  '/sprites/players/player-13.png',
  '/sprites/players/player-14.png',
  '/sprites/players/player-15.png',
  '/sprites/players/player-16.png',
]

function spriteForIdentity(identity: string) {
  let hash = 2166136261

  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return PLACEHOLDER_SPRITES[(hash >>> 0) % PLACEHOLDER_SPRITES.length]
}

export default function PlayerSprite({
  identity,
  isLive = false,
}: {
  identity: string
  isLive?: boolean
}) {
  return (
    <span className={`aa-avatar ${isLive ? 'is-live' : ''}`}>
      <img
        className="aa-avatar-sprite"
        src={spriteForIdentity(identity)}
        alt=""
        width={48}
        height={48}
        draggable={false}
      />
    </span>
  )
}
