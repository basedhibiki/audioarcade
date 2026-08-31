"use client";

import {
  useCallback,
  useRef,
  useState,
} from "react";

import ArcadeCanvas from "./ArcadeCanvas";
import ArcadeMenu from "./ArcadeMenu";

type ArcadeLobbyProps = {
  takeAux: () => Promise<void>;
  startListening: () => Promise<void>;
};

export default function ArcadeLobby({
  takeAux,
  startListening,
}: ArcadeLobbyProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeGameMenuRef = useRef<
    (() => void) | null
  >(null);

  const handleOpenMenu = useCallback(
    (closeGameMenu: () => void) => {
      closeGameMenuRef.current = closeGameMenu;
      setMenuOpen(true);
    },
    [],
  );

  const closeMenu = useCallback(() => {
    setMenuOpen(false);

    closeGameMenuRef.current?.();
    closeGameMenuRef.current = null;
  }, []);

  const handleTakeAux = useCallback(async () => {
    try {
      await takeAux();
      closeMenu();
    } catch (error) {
      console.error(
        "Failed to take the AUX:",
        error,
      );
    }
  }, [takeAux, closeMenu]);

  const handleListen = useCallback(async () => {
    try {
      await startListening();
      closeMenu();
    } catch (error) {
      console.error(
        "Failed to start listening:",
        error,
      );
    }
  }, [startListening, closeMenu]);

  return (
    <section className="relative flex min-h-screen items-center justify-center bg-black p-4 text-yellow-400">
      <ArcadeCanvas
        onOpenMenu={handleOpenMenu}
      />

      {menuOpen && (
        <ArcadeMenu
          onTakeAux={handleTakeAux}
          onListen={handleListen}
          onClose={closeMenu}
        />
      )}
    </section>
  );
}