import { ROLE_ICONS } from "./role-icons.js";
import { view, visible, slot } from "./templates.js";
const phaseLabels = {
  lobby: "대기실",
  reveal: "역할 확인",
  night: "밤",
  day: "낮",
  vote: "투표",
  ended: "게임 종료",
};

export function createScreens({ getState, getRoleRevealed, roleName }) {
  const state = () => getState();
  function players(revealRoles = false) {
    return state().players.map((player) => {
      let status = "";
      if (state().phase === "reveal")
        status = player.ready ? "준비 완료" : "확인 중";
      if (state().phase === "day" && player.alive) {
        if (state().openingDay)
          status = player.dayReady ? "밤 준비" : "대화 중";
        else status = player.dayReady ? "투표 준비" : "토론 중";
      }
      const el = view("player", {
        name: player.name,
        role: revealRoles && player.role ? roleName(player.role) : "",
        status,
      });
      el.classList.toggle("dead", !player.alive);
      const presence = el.querySelector(".presence");
      presence.classList.toggle("online", !!player.connected);
      presence.setAttribute(
        "aria-label",
        player.connected ? "접속 중" : "연결 끊김",
      );
      visible(el, "host", player.isHost);
      visible(
        el,
        "kick",
        state().phase === "lobby" && state().you.isHost && !player.isHost,
      );
      el.querySelector('[data-text="status"]')?.toggleAttribute(
        "hidden",
        !status,
      );
      el.querySelector('[data-text="role"]')?.toggleAttribute(
        "hidden",
        !(revealRoles && player.role),
      );
      const kick = el.querySelector(".kick");
      if (kick) {
        kick.dataset.id = player.id;
        kick.setAttribute("aria-label", `${player.name} 내보내기`);
      }
      return el;
    });
  }
  function targets(type, verb) {
    return state().targets.map((target) => {
      const el = view("target", {
        initial: target.name.slice(0, 1),
        name: target.name,
        verb:
          state().you.selectedTargetId === target.id ? "현재 선택" : verb,
      });
      el.dataset.action = type;
      el.dataset.id = target.id;
      el.classList.toggle(
        "selected",
        state().you.selectedTargetId === target.id,
      );
      return el;
    });
  }

  function mafiaSelectionRows(selections) {
    return selections.map((selection) => {
      const row = document.createElement("div");
      row.className = "mafia-selection-row";
      row.classList.toggle("self", selection.isSelf);

      const player = document.createElement("span");
      const playerName = document.createElement("span");
      playerName.textContent = selection.playerName;
      playerName.setAttribute("translate", "no");
      player.append(playerName);
      if (selection.isSelf) {
        const selfLabel = document.createElement("small");
        selfLabel.textContent = " (나)";
        player.append(selfLabel);
      }

      const target = document.createElement("strong");
      target.textContent = selection.targetName || "선택 전";
      if (selection.targetName) target.setAttribute("translate", "no");
      else target.className = "pending";

      row.append(player, target);
      return row;
    });
  }

  function renderLobby() {
    const s = state();
    const count = s.players.length;
    const summary = s.roleSummary;

    const el = view("lobby", {
      code: s.code,
      count: `${count}/12명`,
      mafia: `마피아 ${summary.mafia}`,
      cop: `경찰 ${summary.cop}`,
      doctor: `의사 ${summary.doctor}`,
      citizen: `시민 ${summary.citizen}`,
      start: count >= 4 ? "게임 시작" : `${4 - count}명 더 필요해요`,
    });

    el.classList.add(s.you.isHost ? "lobby-host" : "lobby-guest");

    el.querySelector('[data-attr-src="qrDataUrl"]').src = s.qrDataUrl;

    el.querySelector("#invite-link").value = s.joinUrl;

    el.querySelector('[data-text="cop"]').classList.toggle("off", !summary.cop);

    el.querySelector('[data-text="doctor"]').classList.toggle(
      "off",
      !summary.doctor,
    );

    // 방장 전용 요소 표시 여부
    visible(el, "host", s.you.isHost);
    visible(el, "guest", !s.you.isHost);

    // 방장에게만 존재하는 설정 요소
    if (s.you.isHost) {
      const copSetting = el.querySelector("#setting-cop");
      const doctorSetting = el.querySelector("#setting-doctor");
      const startButton = el.querySelector("#start");

      if (copSetting) {
        copSetting.checked = s.settings.copEnabled;
      }

      if (doctorSetting) {
        doctorSetting.checked = s.settings.doctorEnabled;
      }

      if (startButton) {
        startButton.disabled = count < 4;
      }
    }

    slot(el, "players", players());

    return el;
  }

  function renderReveal() {
    if (!getRoleRevealed()) return view("reveal-hidden");
    const s = state(),
      info = s.you.roleInfo;
    const el = view("reveal", {
      name: info.name,
      description: info.description,
      team: s.you.mafiaTeam.join(", "),
      ready: s.you.ready ? "다른 사람을 기다리는 중" : "확인했어요",
    });
    el.classList.add(`role-${s.you.role}`);
    const icon = document.createElement("span");
    icon.className = "role-svg";
    icon.style.setProperty(
      "--icon-url",
      `url('/icons/game/${ROLE_ICONS[s.you.role]}')`,
    );
    icon.setAttribute("aria-hidden", "true");
    slot(el, "icon", icon);
    visible(el, "team", !!s.you.mafiaTeam.length);
    el.querySelector("#ready").disabled = !!s.you.ready;
    slot(el, "players", players());
    return el;
  }
  function renderWaiting(title, description, announcement = "") {
    const el = view("waiting", {
      phase: phaseLabels[state().phase],
      title,
      description,
      announcement,
    });
    visible(el, "announcement", !!announcement);
    return el;
  }
  function renderNight() {
    const s = state();
    if (!s.you.alive)
      return renderWaiting(
        "당신은 탈락했습니다",
        "게임이 끝날 때까지 다른 사람의 화면을 보지 말고 지켜봐 주세요.",
        s.announcement,
      );
    if (
      s.you.actionSubmitted &&
      (s.you.role !== "mafia" || s.you.mafiaSelections.length < 2)
    )
      return renderWaiting(
        "선택을 마쳤습니다",
        "다른 역할의 선택이 끝나면 아침이 밝습니다.",
        s.announcement,
      );
    if (s.you.role === "citizen")
      return renderWaiting(
        "조용한 밤입니다",
        "다른 역할의 선택이 끝나면 아침이 밝습니다.",
        s.announcement,
      );
    const role = s.you.role,
      names = { mafia: "마피아", cop: "경찰", doctor: "의사" },
      verbs = { mafia: "제거", cop: "조사", doctor: "보호" };
    const investigation = s.you.investigation;
    const el = view("night", {
      eyebrow: `${s.round}번째 밤 · ${names[role]}`,
      announcement: s.announcement,
      notice: s.you.privateNotice || "",
      team: `동료: ${s.you.mafiaTeam.join(", ")}`,
      investigation: investigation
        ? `${investigation.targetName} · ${investigation.isMafia ? "마피아" : "마피아 아님"}`
        : "",
    });
    el.classList.add(`role-${role}`);
    const h = document.createElement("span");
    h.append("누구를", document.createElement("br"), `${verbs[role]}할까요?`);
    slot(el, "title", h);
    visible(el, "notice", role === "mafia" && !!s.you.privateNotice);
    visible(el, "team", role === "mafia" && !!s.you.mafiaTeam.length);
    visible(
      el,
      "mafiaSelections",
      role === "mafia" && s.you.mafiaSelections.length > 1,
    );
    visible(el, "investigation", role === "cop" && !!investigation);
    if (role === "mafia")
      slot(el, "mafiaSelections", mafiaSelectionRows(s.you.mafiaSelections));
    slot(el, "targets", targets("night-action", verbs[role]));
    return el;
  }
  function renderDay() {
    const s = state();
    const progress = s.openingDay
      ? `${s.dayReadyCount}/${s.dayReadyRequiredCount}명이 밤을 시작할 준비를 마쳤습니다.`
      : `${s.dayReadyCount}/${s.dayReadyRequiredCount}명이 투표할 준비를 마쳤습니다.`;
    const el = view("day", {
      eyebrow: s.openingDay ? `${s.round}번째 낮` : `${s.round}번째 아침`,
      announcement: s.announcement,
      survivors: `생존자 ${s.players.filter((p) => p.alive).length}명`,
      progress,
      action: s.openingDay
        ? s.you.dayReady
          ? "밤 준비 취소"
          : "밤으로 넘어가기"
        : s.you.dayReady
          ? "투표 준비 취소"
          : "투표하러 가기",
    });
    visible(el, "alive", s.you.alive);
    visible(el, "dead", !s.you.alive);
    if (s.you.dayReady && s.you.alive) {
      const button = el.querySelector("#day-ready");
      button.classList.remove("primary");
      button.classList.add("secondary");
    }
    slot(el, "players", players());
    return el;
  }
  function renderVote() {
    const s = state();
    if (!s.you.alive)
      return renderWaiting(
        "투표가 진행 중입니다",
        "탈락한 사람은 투표할 수 없습니다.",
      );
    if (s.you.actionSubmitted)
      return renderWaiting(
        "투표했습니다",
        `${s.submittedCount}/${s.requiredCount}명이 선택을 마쳤습니다.`,
      );
    const el = view("vote", {
      eyebrow: s.voteRound > 1 ? `${s.voteRound}차 재투표` : "낮 투표",
      announcement: s.announcement,
    });
    slot(el, "targets", targets("vote", "투표"));
    return el;
  }
  function renderEnded() {
    const s = state(),
      mafia = s.winner === "mafia";
    const el = view("ended", {
      symbol: mafia ? "◆" : "●",
      title: mafia ? "마피아 승리" : "시민 팀 승리",
      announcement: s.announcement,
    });
    el.classList.add(mafia ? "mafia-wins" : "citizen-wins");
    visible(el, "host", s.you.isHost);
    visible(el, "guest", !s.you.isHost);
    slot(el, "players", players(true));
    return el;
  }
  return {
    renderLobby,
    renderReveal,
    renderNight,
    renderDay,
    renderVote,
    renderEnded,
  };
}
