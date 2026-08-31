"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type ArcadeMenuProps = {
  onTakeAux: () => void | Promise<void>;
  onListen: () => void | Promise<void>;
  onClose: () => void;
};

const options = [
  "TAKE THE AUX",
  "LISTEN",
  "CANCEL",
] as const;

type MenuOption = (typeof options)[number];

export default function ArcadeMenu({
  onTakeAux,
  onListen,
  onClose,
}: ArcadeMenuProps) {
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  const runOption = useCallback(
    async (option: MenuOption): Promise<void> => {
      if (busy) return;

      if (option === "CANCEL") {
        onClose();
        return;
      }

      setBusy(true);

      try {
        if (option === "TAKE THE AUX") {
          await onTakeAux();
        }

        if (option === "LISTEN") {
          await onListen();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, onTakeAux, onListen, onClose],
  );

  const confirm = useCallback(() => {
    void runOption(options[selected]);
  }, [runOption, selected]);

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ): void {
      if (busy) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();

        setSelected((current) =>
          current === 0
            ? options.length - 1
            : current - 1,
        );
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();

        setSelected((current) =>
          current === options.length - 1
            ? 0
            : current + 1,
        );
      }

      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        confirm();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [busy, confirm, onClose]);

  return (
    <div
      className="absolute inset-0 z-20 flex items-end justify-center bg-black/20 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Audio Arcade sampler menu"
    >
      <div className="w-full max-w-xl border-4 border-black bg-[#f5dc32] p-2 shadow-[6px_6px_0_#000]">
        <div className="border-4 border-black bg-[#fff6a8] p-4 font-mono text-black">
          <p className="mb-3 font-bold">
            AUDIO ARCADE
          </p>

          {options.map((option, index) => {
            const isSelected =
              selected === index;

            return (
              <button
                key={option}
                type="button"
                disabled={busy}
                onMouseEnter={() => {
                  if (!busy) {
                    setSelected(index);
                  }
                }}
                onClick={() => {
                  setSelected(index);
                  void runOption(option);
                }}
                className="block w-full py-1 text-left disabled:opacity-50"
              >
                {isSelected ? "▶ " : "  "}
                {option}
                {busy &&
                isSelected &&
                option !== "CANCEL"
                  ? "..."
                  : ""}
              </button>
            );
          })}

          <p className="mt-4 text-xs">
            ↑ ↓ SELECT · ENTER CONFIRM
          </p>
        </div>
      </div>
    </div>
  );
}