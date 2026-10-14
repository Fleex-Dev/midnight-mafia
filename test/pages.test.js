import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");

test("all application templates and game icons exist", async () => {
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
    "result-day",
    "result-night",
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
    ["mafia.svg", "cop.svg", "doctor.svg", "citizen.svg"].map((name) =>
      access(join(root, "public", "icons", "game", name)),
    ),
  );
  await Promise.all(
    [
      "day-exile.svg",
      "night-victim.svg",
      "mafia-caught.svg",
      "no-elimination.svg",
      "safe.svg",
      "investigation.svg",
    ].map((name) => access(join(root, "public", "icons", "results", name))),
  );
  await Promise.all([
    access(join(root, "public", "images", "social-card-default.png")),
    access(join(root, "public", "images", "social-card-default-en.png")),
    access(join(root, "public", "images", "social-card-invite.png")),
    access(join(root, "public", "images", "social-card-invite-en.png")),
    access(join(root, "public", "icons", "favicon-32.png")),
    access(join(root, "public", "icons", "apple-touch-icon.png")),
  ]);
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

  const [koPrivacy, enPrivacy] = await Promise.all([
    read("public/pages/ko/privacy.html"),
    read("public/pages/en/privacy.html"),
  ]);
  assert.match(koPrivacy, /Google Search Console/);
  assert.match(enPrivacy, /Google Search Console/);
  assert.match(
    koPrivacy,
    /방문자\s*추적 스크립트나 쿠키는[^.]*포함되어 있지 않습니다/,
  );
  assert.match(
    enPrivacy,
    /does not add a separate Search Console[\s\S]*tracking script or cookie/,
  );
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
  assert.match(
    index,
    /rel="canonical" href="https:\/\/midnight-mafia\.fleex\.app\/"/,
  );
  assert.match(
    index,
    /name="robots"[\s\S]*content="index, follow, max-image-preview:large, max-snippet:-1"/,
  );
  assert.match(index, /property="og:locale" content="ko_KR"/);
  assert.match(
    index,
    /property="og:image" content="https:\/\/midnight-mafia\.fleex\.app\/og\/default\.png\?lang=ko&amp;v=9"/,
  );
  assert.match(index, /property="og:image:secure_url"/);
  assert.match(index, /property="og:image:width" content="1200"/);
  assert.match(index, /property="og:image:height" content="630"/);
  assert.match(index, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    index,
    /rel="icon" type="image\/svg\+xml" href="\/icons\/site-icon\.svg"/,
  );
  assert.doesNotMatch(index, /name="keywords"/i);
  const structuredData = JSON.parse(
    index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
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
  assert.match(
    robots,
    /Sitemap: https:\/\/midnight-mafia\.fleex\.app\/sitemap\.xml/,
  );
  assert.match(robots, /Disallow: \/api\//);
  assert.match(sitemap, /<loc>https:\/\/midnight-mafia\.fleex\.app\/<\/loc>/);
  assert.match(
    sitemap,
    /<loc>https:\/\/midnight-mafia\.fleex\.app\/en\/rules\.html<\/loc>/,
  );
  assert.doesNotMatch(sitemap, /\?room=/);
  assert.equal(
    verification.trim(),
    "google-site-verification: googlee55a4c2f1506c8a3.html",
  );
  assert.match(worker, /"x-robots-tag": "noindex"/);
  assert.match(worker, /socialImageResponse/);
  assert.match(worker, /social-card-invite-en\.png/);
  assert.match(worker, /social-card-default\.png/);
  assert.doesNotMatch(worker, /env\.IMAGES/);
  assert.doesNotMatch(worker, /ROOM CODE|초대 코드|CASE FILE/);
  assert.match(worker, /\["\/rules\.html", "\/pages\/ko\/rules\.html"\]/);
  assert.match(worker, /\["\/en\/rules\.html", "\/pages\/en\/rules\.html"\]/);

  for (const page of ["guide", "rules", "roles", "privacy"]) {
    const [ko, en] = await Promise.all([
      read(`public/pages/ko/${page}.html`),
      read(`public/pages/en/${page}.html`),
    ]);
    assert.match(
      ko,
      new RegExp(
        `rel="canonical"[\\s\\S]*?href="https://midnight-mafia\\.fleex\\.app/${page}\\.html"`,
      ),
    );
    assert.match(
      en,
      new RegExp(
        `rel="canonical"[\\s\\S]*?href="https://midnight-mafia\\.fleex\\.app/en/${page}\\.html"`,
      ),
    );
    for (const document of [ko, en]) {
      assert.match(
        document,
        /name="robots" content="index, follow, max-snippet:-1"/,
      );
      assert.match(document, /property="og:title"[\s\S]*?content="[^"]+"/);
      assert.match(
        document,
        /property="og:description"[\s\S]*?content="[^"]+"/,
      );
      assert.match(document, /property="og:url"[\s\S]*?content="https:\/\//);
      assert.match(
        document,
        /property="og:image"[\s\S]*?content="https:\/\//,
      );
      assert.match(
        document,
        /name="twitter:card" content="summary_large_image"/,
      );
    }
  }
});

test("phase UI includes confirmation flows, Mafia coordination, and result scenes", async () => {
  const [
    night,
    day,
    vote,
    dayResult,
    nightResult,
    waiting,
    app,
    screens,
    preview,
    i18n,
    styles,
  ] = await Promise.all([
    read("public/templates/night.html"),
    read("public/templates/day.html"),
    read("public/templates/vote.html"),
    read("public/templates/result-day.html"),
    read("public/templates/result-night.html"),
    read("public/templates/waiting.html"),
    read("public/app.js"),
    read("public/js/screens.js"),
    read("public/result-preview.js"),
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
  assert.match(dayResult, /id="confirm-result-day"/);
  assert.match(dayResult, /data-result-scene/);
  assert.match(dayResult, /class="case-record__status-icon"/);
  assert.match(dayResult, /data-text="outcome"/);
  assert.match(dayResult, /data-text="tally"/);
  assert.match(nightResult, /id="confirm-result-night"/);
  assert.match(nightResult, /data-result-scene/);
  assert.match(nightResult, /지난밤 조사 결과/);
  assert.match(waiting, /data-text="announcement"/);
  assert.match(waiting, /data-if="investigation"/);
  assert.match(app, /type: "night-confirm"/);
  assert.match(app, /type: "vote-confirm"/);
  assert.match(app, /type: "confirm-result-day"/);
  assert.match(app, /type: "confirm-result-night"/);
  assert.match(app, /"result-day": screens\.renderDayResult/);
  assert.match(app, /"result-night": screens\.renderNightResult/);
  assert.match(screens, /mafiaSelectionRows/);
  assert.match(screens, /targets\("night-select"/);
  assert.match(screens, /targets\("vote-select"/);
  assert.match(screens, /TRIAL RECORD \/ DAY/);
  assert.match(screens, /CASE RECORD \/ NIGHT/);
  assert.match(screens, /Tie · No exile/);
  assert.doesNotMatch(screens, /No victim · Investigation result/);
  assert.match(screens, /el\.dataset\.resultIcon = resultStatus/);
  assert.match(preview, /root\.dataset\.resultIcon = scene\.status/);
  for (const status of [
    "day-exile",
    "investigation",
    "mafia-caught",
    "night-victim",
    "no-elimination",
    "safe",
  ]) {
    assert.match(`${screens}\n${preview}\n${i18n}`, new RegExp(status));
  }
  assert.match(screens, /"case-danger"/);
  assert.match(i18n, /"마피아 선택 현황": "Mafia selections"/);
  assert.match(i18n, /"지난밤 조사 결과": "Last night's investigation"/);
  assert.match(i18n, /"조사 결과": "Investigation result"/);
  assert.match(i18n, /"\(나\)": "\(You\)"/);
  assert.match(i18n, /"투표 확정": "Confirm vote"/);
  assert.match(styles, /\.mafia-selection-row/);
  assert.match(styles, /\.mafia-selection-status/);
  assert.match(styles, /\.phase-alerts/);
  assert.match(styles, /\.result-panel\.is-revealing/);
  assert.match(styles, /@keyframes case-stamp-impact/);
  assert.match(styles, /\.result-panel\.case-danger/);
  assert.match(styles, /\[data-result-icon="day-exile"\]/);
  assert.match(styles, /\[data-result-icon="night-victim"\]/);
  assert.match(styles, /\[data-result-icon="mafia-caught"\]/);
  assert.match(styles, /\.case-record__status-icon/);
  assert.doesNotMatch(styles, /\.result-stage/);
});
