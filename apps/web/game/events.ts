export type ArcadeAction =
  | "take-aux"
  | "listen"
  | "close-menu";

export const ARCADE_INTERACTION_EVENT =
  "audio-arcade:interaction";

export function emitArcadeAction(action: ArcadeAction) {
  window.dispatchEvent(
    new CustomEvent(ARCADE_INTERACTION_EVENT, {
      detail: action,
    })
  );
}