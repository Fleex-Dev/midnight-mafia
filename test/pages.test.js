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
    "vote-result",
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
  await access(join(root, "public", "images", "social-card-base.png"));
  await Promise.all([
    access(join(root, "public", "fonts", "inter-700.ttf")),
    access(join(root, "public", "fonts", "pretendard-700.woff2")),
    access(join(root, "public", "fonts", "OFL.txt")),
  ]);
});

test("Cloudflare Worker and Durable Object configuration is present", async () => {
  const [worker, config, packageFile] = await Promise.all([
    read("src/worker.js"),
    read("wrangler.jsonc"),
    read("package.json"),
  ]);
  assert.match(worker, /class RoomDurableObject/);
  assert.match(worker, /acceptWebSocket/);
  assert.match(worker, /DISCONNECT_GRACE_MS = 30 \* 60 \* 1000/);
  assert.match(config, /"new_sqlite_classes"/);
  assert.match(config, /"run_worker_first": true/);
  assert.match(config, /"binding": "IMAGES"/);
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
  assert.match(app, /searchParams\.set\("lang", locale\)/);
  assert.match(app, /navigator\.clipboard\.writeText\(inviteUrl\.href\)/);
  assert.doesNotMatch(app, /navigator\.share/);
});

test("information pages exist in Korean and English", async () => {
  for (const page of ["guide", "rules", "roles", "privacy"]) {
    const [ko, en] = await Promise.all([
      read(`public/pages/ko/${page}.html`),
      read(`public/pages/en/${page}.html`),
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
    read("public/css/style.css"),
  ]);
  assert.match(index, /viewport-fit=cover/);
  assert.match(app, /setLocalePreference/);
  assert.match(app, /© 2026 FLEEX/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /window\.addEventListener\("pageshow", resumeConnection\)/);
  assert.match(app, /window\.addEventListener\("online", resumeConnection\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});

test("search metadata, sitemap, verification, and private room indexing rules are present", async () => {
  const [index, robots, sitemap, verification, worker] = await Promise.all([
    read("public/index.html"),
    read("public/robots.txt"),
    read("public/sitemap.xml"),
    read("public/googlee55a4c2f1506c8a3.html"),
    read("src/worker.js"),
  ]);
  assert.match(index, /rel="canonical" href="https:\/\/midnight-mafia\.fleex\.app\/"/);
  assert.match(index, /name="robots"[\s\S]*content="index, follow, max-image-preview:large, max-snippet:-1"/);
  assert.match(index, /property="og:locale" content="ko_KR"/);
  assert.match(index, /property="og:image" content="https:\/\/midnight-mafia\.fleex\.app\/og\/default\.jpg\?lang=ko&amp;v=2"/);
  assert.match(index, /property="og:image:secure_url"/);
  assert.match(index, /property="og:image:width" content="1200"/);
  assert.match(index, /property="og:image:height" content="630"/);
  assert.match(index, /name="twitter:card" content="summary_large_image"/);
  assert.match(index, /rel="icon" type="image\/svg\+xml" href="\/icons\/site-icon\.svg"/);
  assert.doesNotMatch(index, /name="keywords"/i);
  const structuredData = JSON.parse(
    index.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )[1],
  );
  assert.equal(structuredData["@context"], "https://schema.org");
  assert.ok(
    structuredData["@graph"].some(
      (entry) => entry["@type"] === "WebApplication",
    ),
  );
  assert.ok(
    structuredData["@graph"].some((entry) => entry["@type"] === "WebSite"),
  );
  assert.match(robots, /Sitemap: https:\/\/midnight-mafia\.fleex\.app\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(sitemap, /<loc>https:\/\/midnight-mafia\.fleex\.app\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/midnight-mafia\.fleex\.app\/en\/rules\.html<\/loc>/);
  assert.doesNotMatch(sitemap, /\?room=/);
  assert.equal(
    verification.trim(),
    "google-site-verification: googlee55a4c2f1506c8a3.html",
  );
  assert.match(worker, /"x-robots-tag": "noindex"/);
  assert.match(worker, /socialImageResponse/);
  assert.match(worker, /env\.IMAGES\.text\("CASE FILE"/);
  assert.match(worker, /\["\/rules\.html", "\/pages\/ko\/rules\.html"\]/);
  assert.match(worker, /\["\/en\/rules\.html", "\/pages\/en\/rules\.html"\]/);

  for (const page of ["guide", "rules", "roles", "privacy"]) {
    const [ko, en] = await Promise.all([
      read(`public/pages/ko/${page}.html`),
      read(`public/pages/en/${page}.html`),
    ]);
    assert.match(
      ko,
      new RegExp(`rel="canonical" href="https://midnight-mafia\\.fleex\\.app/${page}\\.html"`),
    );
    assert.match(
      en,
      new RegExp(`rel="canonical" href="https://midnight-mafia\\.fleex\\.app/en/${page}\\.html"`),
    );
    for (const document of [ko, en]) {
      assert.match(document, /name="robots" content="index, follow, max-snippet:-1"/);
      assert.match(document, /property="og:title" content="[^"]+"/);
      assert.match(document, /property="og:description" content="[^"]+"/);
      assert.match(document, /property="og:url" content="https:\/\//);
      assert.match(document, /property="og:image" content="https:\/\//);
      assert.match(document, /name="twitter:card" content="summary_large_image"/);
    }
  }
});

test("phase UI includes confirmation flows, Mafia coordination, and vote results", async () => {
  const [night, day, vote, voteResult, waiting, app, screens, i18n, styles] =
    await Promise.all([
      read("public/templates/night.html"),
      read("public/templates/day.html"),
      read("public/templates/vote.html"),
      read("public/templates/vote-result.html"),
      read("public/templates/waiting.html"),
      read("public/app.js"),
      read("public/js/screens.js"),
      read("public/js/i18n.js"),
      read("public/css/style.css"),
    ]);
  assert.match(night, /data-if="mafiaSelections"/);
  assert.match(night, /data-text="announcement"/);
  assert.match(night, /data-if="notice"/);
  assert.match(night, /data-if="investigation"/);
  assert.match(night, /id="night-confirm"/);
  assert.match(day, /지난밤 조사 결과/);
  assert.match(day, /data-if="investigation"/);
  assert.match(day, /data-text="announcement"/);
  assert.match(vote, /id="vote-confirm"/);
  assert.match(vote, /class="phase-alerts"/);
  assert.match(voteResult, /id="confirm-vote-result"/);
  assert.match(voteResult, /data-text="title"/);
  assert.match(voteResult, /data-if="eliminated"/);
  assert.match(voteResult, /data-text="tally"/);
  assert.match(waiting, /data-text="announcement"/);
  assert.match(waiting, /data-if="investigation"/);
  assert.match(app, /type: "night-confirm"/);
  assert.match(app, /type: "vote-confirm"/);
  assert.match(app, /type: "confirm-vote-result"/);
  assert.match(app, /"vote-result": screens\.renderVoteResult/);
  assert.match(screens, /mafiaSelectionRows/);
  assert.match(screens, /targets\("night-select"/);
  assert.match(screens, /targets\("vote-select"/);
  assert.match(i18n, /"마피아 선택 현황": "Mafia selections"/);
  assert.match(i18n, /"지난밤 조사 결과": "Last night's investigation"/);
  assert.match(i18n, /"조사 결과": "Investigation result"/);
  assert.match(i18n, /"\(나\)": "\(You\)"/);
  assert.match(i18n, /"투표 확정": "Confirm vote"/);
  assert.match(styles, /\.mafia-selection-row/);
  assert.match(styles, /\.mafia-selection-status/);
  assert.match(styles, /\.phase-alerts/);
});
