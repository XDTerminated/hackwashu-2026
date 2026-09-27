// One hidden <input> handles typing, paste and IME for every in-game text box.
// Whichever box is active "owns" it; the pixel UI just mirrors its value.

export const input = document.getElementById("type-input") as HTMLInputElement;

export interface InputOwner {
  render(): void;
  submit(): void;
  /** Still on screen and wanting keystrokes? (Used to win focus back after a click.) */
  active(): boolean;
  /** Another box took the keyboard (a window opened over this one). */
  lost?(): void;
}

let owner: InputOwner | null = null;

export function claimInput(o: InputOwner) {
  const prev = owner;
  owner = o;
  if (prev && prev !== o) prev.lost?.();
  input.value = "";
  setTimeout(() => input.focus(), 0);
}

export function releaseInput(o: InputOwner) {
  if (owner !== o) return;
  owner = null;
  input.value = "";
  input.blur();
}

export function initTextInput() {
  input.addEventListener("input", () => owner?.render());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      owner?.submit();
    }
  });
  input.addEventListener("blur", () => {
    if (owner?.active()) setTimeout(() => input.focus(), 0);
  });
}
