import { roleIconMarkup } from "./role-icons.js";

for (const element of document.querySelectorAll(".role-guide-card[data-role] .role-icon")) {
  element.innerHTML = roleIconMarkup(element.closest("[data-role]").dataset.role);
}
