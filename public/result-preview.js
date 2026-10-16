import { createScreens } from "./js/screens.js";
import { loadTemplates } from "./js/templates.js";

// 실제 결과 템플릿과 화면 렌더러를 사용해 다양한 결과를 재현하는 미리보기
const container = document.querySelector("#preview-container");
const caseSelect = document.querySelector("#case-select");
const playButton = document.querySelector("#preview-play");
const nextButton = document.querySelector("#preview-next");
const autoToggle = document.querySelector("#preview-auto");
const status = document.querySelector("#preview-status");

const FILES = {
  day: ["/templates/result-day.html", "/result-day.html"],
  night: ["/templates/result-night.html", "/result-night.html"],
};

const PLAYERS = ["현진", "지수", "민준", "서연", "도윤"];
const ROLE_NAMES = {
  mafia: "마피아",
  cop: "경찰",
  doctor: "의사",
  citizen: "시민",
};

const metric = (key, score, max, earned, possible) => ({
  key,
  score,
  max,
  earned,
  possible,
});

const END_CASES = {
  "end-citizen": {
    winner: "citizen",
    round: 4,
    analysis: {
      rounds: 4,
      participantCount: 6,
      dayExiles: 2,
      nightVictims: 1,
      mvpIds: ["cop"],
      players: [
        {
          id: "cop",
          name: "지수",
          role: "cop",
          team: "citizen",
          alive: true,
          score: 94,
          metrics: [
            metric("investigation-success", 45, 45, 2, 2),
            metric("mafia-vote-hit", 10, 10, 2, 2),
            metric("mafia-exile-contribution", 15, 15, 2, 2),
            metric("survival", 9, 15, 3, 4),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "citizen-1",
          name: "현진",
          role: "citizen",
          team: "citizen",
          alive: true,
          score: 81,
          metrics: [
            metric("mafia-vote-hit", 45, 45, 2, 2),
            metric("mafia-exile-contribution", 15, 25, 1, 2),
            metric("survival", 6, 15, 2, 4),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "doctor",
          name: "민서",
          role: "doctor",
          team: "citizen",
          alive: true,
          score: 74,
          metrics: [
            metric("attack-prevention", 25, 25, 1, 1),
            metric("rescue-maintained", 10, 10, 1, 1),
            metric("mafia-vote-hit", 10, 20, 1, 2),
            metric("mafia-exile-contribution", 7.5, 15, 1, 2),
            metric("survival", 6.5, 15, 2, 4),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "mafia-1",
          name: "용혁",
          role: "mafia",
          team: "mafia",
          alive: false,
          score: 68,
          metrics: [
            metric("night-attack-success", 45, 45, 3, 3),
            metric("citizen-exile-contribution", 12.5, 25, 1, 2),
            metric("survival", 10.5, 15, 3, 4),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
        {
          id: "citizen-2",
          name: "서연",
          role: "citizen",
          team: "citizen",
          alive: false,
          score: 52.5,
          metrics: [
            metric("mafia-vote-hit", 22.5, 45, 1, 2),
            metric("mafia-exile-contribution", 12.5, 25, 1, 2),
            metric("survival", 2.5, 15, 1, 4),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "mafia-2",
          name: "도윤",
          role: "mafia",
          team: "mafia",
          alive: false,
          score: 45,
          metrics: [
            metric("night-attack-success", 30, 45, 2, 3),
            metric("citizen-exile-contribution", 7.5, 25, 1, 3),
            metric("survival", 7.5, 15, 2, 4),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
      ],
    },
  },
  "end-mafia": {
    winner: "mafia",
    round: 3,
    analysis: {
      rounds: 3,
      participantCount: 6,
      dayExiles: 1,
      nightVictims: 2,
      mvpIds: ["mafia-1"],
      players: [
        {
          id: "mafia-1",
          name: "용혁",
          role: "mafia",
          team: "mafia",
          alive: true,
          score: 90,
          metrics: [
            metric("night-attack-success", 45, 45, 2, 2),
            metric("citizen-exile-contribution", 15, 25, 1, 2),
            metric("survival", 15, 15, 3, 3),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "mafia-2",
          name: "도윤",
          role: "mafia",
          team: "mafia",
          alive: true,
          score: 81.7,
          metrics: [
            metric("night-attack-success", 45, 45, 2, 2),
            metric("citizen-exile-contribution", 6.7, 25, 1, 3),
            metric("survival", 15, 15, 3, 3),
            metric("team-win", 15, 15, 1, 1),
          ],
        },
        {
          id: "cop",
          name: "지수",
          role: "cop",
          team: "citizen",
          alive: false,
          score: 65,
          metrics: [
            metric("investigation-success", 45, 45, 2, 2),
            metric("mafia-vote-hit", 10, 10, 2, 2),
            metric("mafia-exile-contribution", 0, 15, 0, 0),
            metric("survival", 10, 15, 2, 3),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
        {
          id: "doctor",
          name: "민서",
          role: "doctor",
          team: "citizen",
          alive: false,
          score: 45,
          metrics: [
            metric("attack-prevention", 25, 25, 1, 1),
            metric("rescue-maintained", 10, 10, 1, 1),
            metric("mafia-vote-hit", 0, 20, 0, 2),
            metric("mafia-exile-contribution", 0, 15, 0, 0),
            metric("survival", 10, 15, 2, 3),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
        {
          id: "citizen-1",
          name: "현진",
          role: "citizen",
          team: "citizen",
          alive: true,
          score: 37.5,
          metrics: [
            metric("mafia-vote-hit", 22.5, 45, 1, 2),
            metric("mafia-exile-contribution", 0, 25, 0, 0),
            metric("survival", 15, 15, 3, 3),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
        {
          id: "citizen-2",
          name: "서연",
          role: "citizen",
          team: "citizen",
          alive: false,
          score: 27.5,
          metrics: [
            metric("mafia-vote-hit", 22.5, 45, 1, 2),
            metric("mafia-exile-contribution", 0, 25, 0, 0),
            metric("survival", 5, 15, 1, 3),
            metric("team-win", 0, 15, 0, 1),
          ],
        },
      ],
    },
  },
};

const CASES = [
  {
    id: "day-citizen",
    label: "낮 · 시민 추방",
    phase: "day",
    status: "day-exile",
    stamp: "판결 확정",
    title: "지수 님이 추방되었습니다.",
    reason: "정체는 시민이었습니다. 4표를 받아 과반수를 넘었습니다.",
    tally: "최다 득표 4표 · 추방 기준 4표",
    victim: "지수",
  },
  {
    id: "day-mafia",
    label: "낮 · 마피아 색출",
    phase: "day",
    status: "mafia-caught",
    stamp: "판결 확정",
    title: "도윤 님은 마피아였습니다.",
    reason: "정체는 마피아였습니다. 5표를 받아 과반수를 넘었습니다.",
    tally: "최다 득표 5표 · 추방 기준 4표",
    victim: "도윤",
  },
  {
    id: "day-tie",
    label: "낮 · 동률로 추방 없음",
    phase: "day",
    status: "vote-tie",
    stamp: "판결 보류",
    title: "아무도 추방되지 않았습니다.",
    reason: "최다 득표자가 두 명 이상입니다.",
    tally: "최다 득표 2표 · 추방 기준 4표",
  },
  {
    id: "day-short",
    label: "낮 · 과반수 미달",
    phase: "day",
    status: "no-majority",
    stamp: "판결 보류",
    title: "아무도 추방되지 않았습니다.",
    reason: "과반수에 도달하지 못했습니다.",
    tally: "최다 득표 3표 · 추방 기준 4표",
  },
  {
    id: "night-citizen",
    label: "밤 · 시민 희생",
    phase: "night",
    status: "night-victim",
    stamp: "사건 발생",
    title: "지수 님이 밤사이 희생되었습니다.",
    description: "정체는 시민이었습니다.",
    victim: "지수",
  },
  {
    id: "night-cop",
    label: "밤 · 경찰 희생",
    phase: "night",
    status: "night-victim",
    stamp: "사건 발생",
    title: "민준 님이 밤사이 희생되었습니다.",
    description: "정체는 경찰이었습니다.",
    victim: "민준",
  },
  {
    id: "night-doctor",
    label: "밤 · 의사 희생",
    phase: "night",
    status: "night-victim",
    stamp: "사건 발생",
    title: "서연 님이 밤사이 희생되었습니다.",
    description: "정체는 의사였습니다.",
    victim: "서연",
  },
  {
    id: "night-safe",
    label: "밤 · 희생자 없음",
    phase: "night",
    status: "safe",
    stamp: "사건 없음",
    title: "지난밤에는 아무도 사라지지 않았습니다.",
    description: "모든 참가자가 무사히 아침을 맞았습니다.",
  },
  {
    id: "night-investigation",
    label: "밤 · 조사 결과 있음",
    phase: "night",
    status: "safe",
    stamp: "사건 없음",
    title: "지난밤에는 아무도 사라지지 않았습니다.",
    description: "모든 참가자가 무사히 아침을 맞았습니다.",
    investigation: "도윤 님은 마피아입니다.",
  },
  {
    id: "night-investigation-loss",
    label: "밤 · 희생 + 조사 결과",
    phase: "night",
    status: "night-victim",
    stamp: "사건 발생",
    title: "서연 님이 밤사이 희생되었습니다.",
    description: "정체는 의사였습니다.",
    victim: "서연",
    investigation: "현진 님은 마피아가 아닙니다.",
  },
  {
    id: "end-citizen",
    label: "게임 종료 · 시민 팀 승리",
    phase: "ended",
  },
  {
    id: "end-mafia",
    label: "게임 종료 · 마피아 팀 승리",
    phase: "ended",
  },
];

let index = 0;
let timer = null;
let renderSequence = 0;
const htmlCache = new Map();
let templatesReady = null;

function setText(root, key, value) {
  root.querySelectorAll(`[data-text="${key}"]`).forEach((node) => {
    node.textContent = value ?? "";
  });
}

async function loadTemplate(phase) {
  if (htmlCache.has(phase)) return htmlCache.get(phase);
  const attempts = [];
  for (const path of FILES[phase]) {
    try {
      const response = await fetch(path, { cache: "no-cache" });
      if (response.ok) {
        const html = await response.text();
        if (!html.includes("data-result-scene"))
          throw new Error("결과 화면 마크업이 없습니다.");
        htmlCache.set(phase, html);
        return html;
      }
      attempts.push(`${path} (${response.status})`);
    } catch (error) {
      attempts.push(`${path} (${error.message})`);
    }
  }
  throw new Error(`결과 HTML을 찾지 못했습니다: ${attempts.join(", ")}`);
}

async function renderEndedCase(scene) {
  templatesReady ||= loadTemplates();
  await templatesReady;
  const example = END_CASES[scene.id];
  const mockState = {
    phase: "ended",
    winner: example.winner,
    round: example.round,
    announcement: "",
    analysis: example.analysis,
    you: { isHost: true },
  };
  const screens = createScreens({
    getState: () => mockState,
    getRoleRevealed: () => true,
    roleName: (role) => ROLE_NAMES[role] || role,
    locale: "ko",
  });
  return screens.renderEnded();
}

function populatePlayers(root, scene) {
  const list = root.querySelector('[data-slot="players"]');
  if (!list) return;
  list.replaceChildren();
  const hasRemovedPlayer = [
    "day-exile",
    "mafia-caught",
    "night-victim",
  ].includes(scene.status);
  for (const [i, name] of PLAYERS.entries()) {
    const dead = hasRemovedPlayer && name === scene.victim;
    const li = document.createElement("li");
    if (dead) li.classList.add("dead");
    const presence = document.createElement("span");
    presence.className = dead ? "presence" : "presence online";
    const nameBox = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = name;
    nameBox.append(strong);
    const mark = document.createElement("span");
    mark.className = "ready-mark";
    mark.textContent = dead
      ? "탈락"
      : i === 0
        ? "결과 확인 완료"
        : "결과 확인 중";
    li.append(presence, nameBox, mark);
    list.append(li);
  }
}

function toggleCondition(root, key, shown) {
  root.querySelectorAll(`[data-if="${key}"]`).forEach((node) => {
    node.hidden = !shown;
    node.style.display = shown ? "" : "none";
  });
}

async function renderCase() {
  const sequence = ++renderSequence;
  const scene = CASES[index];
  caseSelect.value = scene.id;
  status.textContent = `${index + 1} / ${CASES.length} · ${scene.label}`;
  try {
    if (scene.phase === "ended") {
      const root = await renderEndedCase(scene);
      if (sequence !== renderSequence) return;
      root.dataset.case = scene.id;
      root.querySelector("#restart")?.addEventListener("click", (event) => {
        event.currentTarget.textContent = "새 게임 준비 완료";
        event.currentTarget.disabled = true;
      });
      container.replaceChildren(root);
      return;
    }

    const markup = await loadTemplate(scene.phase);
    if (sequence !== renderSequence) return;

    // 주석에 남은 구형 마크업은 화면에 삽입하지 않음
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const element = doc.querySelector("[data-result-scene]");
    if (!element) throw new Error("data-result-scene 요소가 없습니다.");
    const root = document.importNode(element, true);
    // 사건 종류와 직업을 개별적으로 구분하는 시각 상태
    root.dataset.case = scene.id;
    root.classList.toggle(
      "case-danger",
      scene.status === "day-exile" || scene.status === "night-victim",
    );
    root.classList.toggle("case-success", scene.status === "mafia-caught");
    root.classList.toggle(
      "case-neutral",
      scene.status === "vote-tie" || scene.status === "no-majority",
    );
    root.classList.toggle("case-safe", scene.status === "safe");
    root.dataset.resultIcon = scene.status;

    const outcome = root.querySelector(".case-record__status");
    const headings = {
      "day-citizen": "시민 추방",
      "day-mafia": "마피아 색출",
      "day-tie": "동률 · 추방 없음",
      "day-short": "과반수 미달",
      "night-citizen": "시민 희생",
      "night-cop": "경찰 희생",
      "night-doctor": "의사 희생",
      "night-safe": "전원 무사",
      "night-investigation": "전원 무사",
      "night-investigation-loss": "의사 희생",
    };
    if (outcome) {
      const label = outcome.querySelector('[data-text="outcome"]');
      if (label) label.textContent = headings[scene.id];
    }
    setText(
      root,
      "record",
      `${scene.phase === "day" ? "── 재판 기록 / DAY" : "── 사건 기록 / NIGHT"} 03 ──`,
    );
    for (const key of ["stamp", "title", "reason", "tally", "description"]) {
      setText(root, key, scene[key] ?? "");
    }
    setText(root, "investigation", scene.investigation ?? "");
    setText(root, "action", "결과 확인");
    setText(root, "progress", "1/5명이 결과를 확인했습니다.");
    toggleCondition(root, "investigation", !!scene.investigation);
    toggleCondition(root, "alive", true);
    toggleCondition(root, "dead", false);
    populatePlayers(root, scene);

    root.querySelector("[data-result-skip]")?.addEventListener("click", () => {
      root.classList.remove("is-revealing");
    });
    root
      .querySelector(".result-confirm")
      ?.addEventListener("click", (event) => {
        event.currentTarget.textContent = "결과 확인 완료";
        event.currentTarget.disabled = true;
      });
    container.replaceChildren(root);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (sequence === renderSequence) root.classList.add("is-revealing");
      }),
    );
  } catch (error) {
    if (sequence !== renderSequence) return;
    container.replaceChildren();
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent =
      error.message + " · 개발 서버와 HTML 경로를 확인하세요.";
    container.append(message);
  }
}

function selectCase(nextIndex) {
  index = (nextIndex + CASES.length) % CASES.length;
  renderCase();
}

function syncAuto() {
  if (timer) clearInterval(timer);
  timer = autoToggle.checked
    ? setInterval(() => selectCase(index + 1), 5000)
    : null;
}

CASES.forEach((scene) => {
  const option = document.createElement("option");
  option.value = scene.id;
  option.textContent = scene.label;
  caseSelect.append(option);
});
caseSelect.addEventListener("change", () => {
  selectCase(CASES.findIndex((scene) => scene.id === caseSelect.value));
  syncAuto();
});
nextButton.addEventListener("click", () => selectCase(index + 1));
playButton.addEventListener("click", renderCase);
autoToggle.addEventListener("change", syncAuto);
renderCase();
syncAuto();
