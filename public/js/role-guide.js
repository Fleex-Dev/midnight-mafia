import { createRoleIcon } from "./role-icons.js";

for (const element of document.querySelectorAll(".role-guide-card[data-role] .role-icon")) {
  const icon = createRoleIcon(element.closest("[data-role]").dataset.role);
  if (icon) element.replaceChildren(icon);
}
