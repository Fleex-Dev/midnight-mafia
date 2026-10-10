// Change icon filenames here to update both the game and role guide pages.
export const ROLE_ICONS = Object.freeze({
  mafia: "crosshair.svg",
  cop: "whistle.svg",
  doctor: "stethoscope.svg",
  citizen: "users-round.svg",
});

export function roleIconMarkup(role) {
  const filename = ROLE_ICONS[role];
  if (!filename) return "";
  return `<span class="role-svg" style="--icon-url: url('/icons/game/${filename}')" aria-hidden="true"></span>`;
}
