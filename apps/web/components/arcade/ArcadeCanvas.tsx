// components/arcade/ArcadeCanvas.tsx

"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";

type ArcadeCanvasProps = {
  onOpenMenu: (closeGameMenu: () => void) => void;
};

export default function ArcadeCanvas({
  onOpenMenu,
}: ArcadeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: Phaser.Game | undefined;

    async function startGame(): Promise<void> {
  const PhaserModule = await import("phaser");
  const Phaser = PhaserModule.default;

  const LobbySceneModule = await import(
    "../../game/scenes/LobbyScene"
  );

  const LobbyScene = LobbySceneModule.default;

  if (!containerRef.current) return;

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerRef.current,
    width: 480,
    height: 320,
    pixelArt: true,
    backgroundColor: "#000000",
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [LobbyScene],
  });

  game.events.on(
    "open-aux-menu",
    ({ close }: { close: () => void }) => {
      onOpenMenu(close);
    },
  );
}

    void startGame();

    return () => {
      game?.destroy(true);
    };
  }, [onOpenMenu]);

  return (
    <div
      ref={containerRef}
      className="aspect-[3/2] w-full max-w-4xl overflow-hidden border-4 border-yellow-400 bg-black"
    />
  );
}