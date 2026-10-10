const preferenceKey = "midnight-mafia-locale-preference";
const supportedPreferences = ["auto", "ko", "en"];
const queryLocale = new URLSearchParams(location.search).get("lang");

let savedPreference = null;
try { savedPreference = localStorage.getItem(preferenceKey); } catch {}

const localePreference = ["ko", "en"].includes(queryLocale)
  ? queryLocale
  : supportedPreferences.includes(savedPreference) ? savedPreference : "auto";

if (["ko", "en"].includes(queryLocale)) {
  try { localStorage.setItem(preferenceKey, queryLocale); } catch {}
}

function detectedLocale() {
  const browserLocale = navigator.languages?.[0] || navigator.language || "en";
  return browserLocale.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function pagePath(targetLocale) {
  const file = location.pathname.split("/").filter(Boolean).at(-1) || "guide.html";
  return targetLocale === "en" ? `/en/${file}` : `/${file}`;
}

const currentLocale = location.pathname.startsWith("/en/") ? "en" : "ko";
const desiredLocale = localePreference === "auto" ? detectedLocale() : localePreference;

if (desiredLocale !== currentLocale) {
  location.replace(`${pagePath(desiredLocale)}${location.hash}`);
} else {
  const selector = document.querySelector("#language-select");
  if (selector) {
    selector.value = localePreference;
    selector.addEventListener("change", (event) => {
      const next = supportedPreferences.includes(event.target.value) ? event.target.value : "auto";
      try { localStorage.setItem(preferenceKey, next); } catch {}
      const targetLocale = next === "auto" ? detectedLocale() : next;
      const targetPath = pagePath(targetLocale);
      if (targetPath === location.pathname) return;
      location.assign(`${targetPath}${location.hash}`);
    });
  }
}
