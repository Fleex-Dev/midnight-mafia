// Change icon filenames here to update both the game and role guide pages.
export const ROLE_ICONS = Object.freeze({
  mafia: "mafia.svg",
  cop: "cop.svg",
  doctor: "doctor.svg",
  citizen: "citizen.svg",
});

export function createRoleIcon(role) {
  const filename = ROLE_ICONS[role];
  if (!filename) return null;
  const icon = document.createElement("span");
  icon.className = "role-svg";
  icon.style.setProperty("--icon-url", `url('/icons/game/${filename}')`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}
