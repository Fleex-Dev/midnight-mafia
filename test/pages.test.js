import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");

test("all application templates and role icons exist", async () => {
  const templates = [
    "player",
    "target",
    "lobby",
    "reveal-hidden",
    "reveal",
    "waiting",
    "night",
    "day",
    "vote",
    "ended",
    "header",
    "footer",
    "landing-start",
    "landing-create",
    "landing-join",
  ];
  await Promise.all(
    templates.map((name) =>
      access(join(root, "public", "templates", `${name}.html`)),
    ),
  );
  await Promise.all(
    ["crosshair.svg", "whistle.svg", "stethoscope.svg", "users-round.svg"].map(
      (name) => access(join(root, "public", "icons", "game", name)),
    ),
  );
});

test("Cloudflare Worker and Durable Object configuration is present", async () => {
  const [worker, config, packageFile] = await Promise.all([
    read("src/worker.js"),
    read("wrangler.jsonc"),
    read("package.json"),
  ]);
  assert.match(worker, /class RoomDurableObject/);
  assert.match(worker, /acceptWebSocket/);
  assert.match(config, /"new_sqlite_classes"/);
  assert.match(config, /"run_worker_first": true/);
  assert.match(packageFile, /wrangler deploy/);
});

test("lobby includes QR, share icon, and host controls", async () => {
  const [lobby, app] = await Promise.all([
    read("public/templates/lobby.html"),
    read("public/app.js"),
  ]);
  assert.match(lobby, /id="share"/);
  assert.match(lobby, /초대 링크 복사/);
  assert.match(lobby, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(lobby, /id="setting-cop"/);
  assert.match(lobby, /id="setting-doctor"/);
  assert.match(lobby, /id="start"/);
  assert.match(app, /addEventListener\("click", copyInvite\)/);
  assert.doesNotMatch(app, /navigator\.share/);
});

test("information pages exist in Korean and English", async () => {
  for (const page of ["guide", "rules", "roles", "privacy"]) {
    const [ko, en] = await Promise.all([
      read(`public/${page}.html`),
      read(`public/en/${page}.html`),
    ]);
    assert.match(ko, /<title>.+<\/title>/);
    assert.match(en, /<title>.+<\/title>/);
    assert.match(ko, /© 2026 FLEEX/);
    assert.match(en, /© 2026 FLEEX/);
  }
});

test("the application keeps localization and responsive styles wired", async () => {
  const [index, app, styles] = await Promise.all([
    read("public/index.html"),
    read("public/app.js"),
    read("public/style.css"),
  ]);
  assert.match(index, /viewport-fit=cover/);
  assert.match(app, /setLocalePreference/);
  assert.match(app, /© 2026 FLEEX/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});

test("night UI includes localized Mafia coordination and vote results", async () => {
  const [night, day, waiting, app, screens, i18n, styles] = await Promise.all([
    read("public/templates/night.html"),
    read("public/templates/day.html"),
    read("public/templates/waiting.html"),
    read("public/app.js"),
    read("public/js/screens.js"),
    read("public/i18n.js"),
    read("public/style.css"),
  ]);
  assert.match(night, /data-if="mafiaSelections"/);
  assert.match(night, /data-text="announcement"/);
  assert.match(night, /id="night-confirm"/);
  assert.match(day, /지난밤 조사 결과/);
  assert.match(day, /data-if="investigation"/);
  assert.match(waiting, /data-text="announcement"/);
  assert.match(app, /type: "night-confirm"/);
  assert.match(screens, /mafiaSelectionRows/);
  assert.match(screens, /targets\("night-select"/);
  assert.match(i18n, /"마피아 선택 현황": "Mafia selections"/);
  assert.match(i18n, /"지난밤 조사 결과": "Last night's investigation"/);
  assert.match(i18n, /"\(나\)": "\(You\)"/);
  assert.match(styles, /\.mafia-selection-row/);
});
