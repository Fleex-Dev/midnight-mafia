import { ROLE_ICONS } from "./role-icons.js";
import { view, visible, slot } from "./templates.js";
const phaseLabels = {
  lobby: "대기실",
  reveal: "역할 확인",
  night: "밤",
  "result-night": "밤 결과",
  day: "낮",
  vote: "투표",
  "result-day": "낮 결과",
  ended: "게임 종료",
};

function roleWas(name) {
  const last = name.charCodeAt(name.length - 1);
  const hasFinalConsonant =
    last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${name}${hasFinalConsonant ? "이었습니다" : "였습니다"}`;
}

export function createScreens({
  getState,
  getRoleRevealed,
  roleName,
  locale = "ko",
}) {
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
      if (
        ["result-day", "result-night"].includes(state().phase) &&
        player.alive
      )
        status = player.resultReady ? "결과 확인 완료" : "결과 확인 중";
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
        verb: state().you.selectedTargetId === target.id ? "현재 선택" : verb,
      });
      el.dataset.action = type;
      el.dataset.id = target.id;
      el.classList.toggle(
        "selected",
        state().you.selectedTargetId === target.id,
      );
      if (
        ["night-select", "vote-select"].includes(type) &&
        state().you.actionSubmitted
      ) {
        el.disabled = true;
      }
      return el;
    });
  }

  function mafiaSelectionRows(selections) {
    return selections.map((selection) => {
      const row = document.createElement("div");
      row.className = "mafia-selection-row";
      row.classList.toggle("self", selection.isSelf);

      const player = document.createElement("div");
      player.className = "mafia-selection-player";
      const playerName = document.createElement("span");
      playerName.textContent = selection.playerName;
      playerName.setAttribute("translate", "no");
      player.append(playerName);
      if (selection.isSelf) {
        const selfLabel = document.createElement("small");
        selfLabel.textContent = " (나)";
        player.append(selfLabel);
      }

      const target = document.createElement("div");
      target.className = "mafia-selection-target";
      const targetLabel = document.createElement("small");
      targetLabel.textContent = "선택 대상";
      const targetName = document.createElement("strong");
      targetName.textContent = selection.targetName || "아직 선택하지 않음";
      if (selection.targetName) targetName.setAttribute("translate", "no");
      else targetName.className = "pending";
      target.append(targetLabel, targetName);

      const status = document.createElement("span");
      status.className = "mafia-selection-status";
      status.classList.toggle("confirmed", selection.confirmed);
      status.textContent = selection.confirmed
        ? "확정"
        : selection.targetName
          ? "선택 중"
          : "대기";

      row.append(player, target, status);
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

    const inviteUrl = new URL(s.joinUrl, location.origin);
    inviteUrl.searchParams.set("lang", locale);
    const qrUrl = new URL(s.qrDataUrl, location.origin);
    qrUrl.searchParams.set("lang", locale);

    el.querySelector('[data-attr-src="qrDataUrl"]').src =
      `${qrUrl.pathname}${qrUrl.search}`;

    el.querySelector("#invite-link").value = inviteUrl.href;

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

  function renderWaiting(
    title,
    description,
    announcement = "",
    investigation = "",
  ) {
    const el = view("waiting", {
      phase: phaseLabels[state().phase],
      title,
      description,
      announcement,
      investigation,
    });
    visible(el, "announcement", !!announcement);
    visible(el, "investigation", !!investigation);
    visible(el, "alerts", !!announcement || !!investigation);
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
    ) {
      const investigation =
        s.you.role === "cop" && s.you.investigation
          ? `${s.you.investigation.targetName} · ${s.you.investigation.isMafia ? "마피아" : "마피아 아님"}`
          : "";
      return renderWaiting(
        investigation ? "조사 결과" : "선택을 마쳤습니다",
        "다른 역할의 선택이 끝나면 아침이 밝습니다.",
        s.announcement,
        investigation,
      );
    }
    if (s.you.role === "citizen")
      return renderWaiting(
        "조용한 밤입니다",
        "다른 역할의 선택이 끝나면 아침이 밝습니다.",
        s.announcement,
      );
    const role = s.you.role,
      names = { mafia: "마피아", cop: "경찰", doctor: "의사" },
      verbs = { mafia: "공격", cop: "조사", doctor: "보호" };
    const investigation = s.you.investigation;
    const el = view("night", {
      eyebrow: `${s.round}번째 밤 · ${names[role]}`,
      announcement: s.announcement,
      notice: s.you.privateNotice || "",
      team: `동료: ${s.you.mafiaTeam.join(", ")}`,
      investigation: investigation
        ? `${investigation.targetName} · ${investigation.isMafia ? "마피아" : "마피아 아님"}`
        : "",
      confirm: s.you.actionSubmitted ? "선택 확정 완료" : "선택 확정",
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
    visible(
      el,
      "alerts",
      !!s.announcement ||
        (role === "mafia" && !!s.you.privateNotice) ||
        (role === "cop" && !!investigation),
    );
    if (role === "mafia")
      slot(el, "mafiaSelections", mafiaSelectionRows(s.you.mafiaSelections));
    visible(el, "confirm", !!s.you.selectedTargetId);
    const confirm = el.querySelector("#night-confirm");
    if (confirm) confirm.disabled = s.you.actionSubmitted;
    slot(el, "targets", targets("night-select", verbs[role]));
    return el;
  }

  function renderDay() {
    const s = state();
    const investigation = s.you.investigation;
    const progress = s.openingDay
      ? `${s.dayReadyCount}/${s.dayReadyRequiredCount}명이 밤을 시작할 준비를 마쳤습니다.`
      : `${s.dayReadyCount}/${s.dayReadyRequiredCount}명이 투표할 준비를 마쳤습니다.`;
    const el = view("day", {
      eyebrow: s.openingDay ? `${s.round}번째 낮` : `${s.round}번째 아침`,
      announcement: s.announcement,
      investigation: investigation
        ? `${investigation.targetName} · ${investigation.isMafia ? "마피아" : "마피아 아님"}`
        : "",
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
    visible(
      el,
      "investigation",
      s.you.role === "cop" && !!investigation && !s.openingDay,
    );
    visible(el, "alerts", !!s.announcement || !!investigation);
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
      eyebrow: "낮 투표",
      announcement: s.announcement,
      confirm: s.you.selectedTargetId ? "투표 확정" : "대상을 먼저 선택하세요",
    });
    visible(el, "confirm", !!s.you.selectedTargetId);
    slot(el, "targets", targets("vote-select", "선택"));
    return el;
  }

  function setResultAppearance(
    el,
    { status: resultStatus, role, reason },
  ) {
    const status = el.querySelector('[data-text="outcome"]');
    el.dataset.resultIcon = resultStatus;

    el.classList.toggle(
      "case-danger",
      resultStatus === "day-exile" || resultStatus === "night-victim",
    );
    el.classList.toggle("case-success", resultStatus === "mafia-caught");
    el.classList.toggle("case-neutral", resultStatus === "no-elimination");
    el.classList.toggle("case-safe", resultStatus === "safe");

    const roleLabels =
      locale === "en"
        ? {
            citizen: "Citizen",
            cop: "Detective",
            doctor: "Doctor",
            mafia: "Mafia",
          }
        : { citizen: "시민", cop: "경찰", doctor: "의사", mafia: "마피아" };
    let heading;
    if (resultStatus === "mafia-caught")
      heading = locale === "en" ? "Mafia identified" : "마피아 색출";
    else if (resultStatus === "day-exile")
      heading =
        locale === "en"
          ? `${roleLabels[role] || "Player"} exiled`
          : `${roleLabels[role] || "참가자"} 추방`;
    else if (resultStatus === "no-elimination")
      heading =
        reason === "tie"
          ? locale === "en"
            ? "Tie · No exile"
            : "동률 · 추방 없음"
          : locale === "en"
            ? "No majority"
            : "과반수 미달";
    else if (resultStatus === "night-victim")
      heading =
        locale === "en"
          ? `${roleLabels[role] || "Player"} victim`
          : `${roleLabels[role] || "참가자"} 희생`;
    else heading = locale === "en" ? "All safe" : "전원 무사";
    if (status) status.textContent = heading;
  }

  function renderDayResult() {
    const s = state();
    const result = s.dayResult;
    const resultStatus = result.status;
    const hasDayResult = ["day-exile", "mafia-caught"].includes(resultStatus);
    const localizedRole =
      locale === "en"
        ? {
            mafia: "Mafia",
            cop: "Detective",
            doctor: "Doctor",
            citizen: "Citizen",
          }[result.role]
        : result.roleName;
    const progress =
      locale === "en"
        ? `${s.resultReadyCount}/${s.resultReadyRequiredCount} players reviewed the result.`
        : `${s.resultReadyCount}/${s.resultReadyRequiredCount}명이 결과를 확인했습니다.`;
    const title = hasDayResult
      ? resultStatus === "mafia-caught"
        ? locale === "en"
          ? `${result.playerName} was Mafia.`
          : `${result.playerName} 님은 마피아였습니다.`
        : locale === "en"
          ? `${result.playerName} was exiled.`
          : `${result.playerName} 님이 추방되었습니다.`
      : locale === "en"
        ? "No one was exiled."
        : "아무도 추방되지 않았습니다.";
    const reason =
      result.reason === "tie"
        ? locale === "en"
          ? "The top vote was tied."
          : "최다 득표가 동률입니다."
        : hasDayResult && resultStatus !== "mafia-caught"
          ? locale === "en"
            ? `They were ${localizedRole}. ${result.topVotes} votes reached the majority.`
            : `정체는 ${roleWas(localizedRole)}. ${result.topVotes}표를 받아 과반수를 넘었습니다.`
          : hasDayResult
            ? locale === "en"
              ? `${result.topVotes} votes reached the majority.`
              : `${result.topVotes}표를 받아 과반수를 넘었습니다.`
          : locale === "en"
            ? "No player received a majority."
            : "과반수 득표자가 없습니다.";
    const tally =
      locale === "en"
        ? `Top vote ${result.topVotes} · Majority ${result.requiredVotes}`
        : `최다 득표 ${result.topVotes}표 · 추방 기준 ${result.requiredVotes}표`;
    const el = view("result-day", {
      stamp: hasDayResult
        ? locale === "en"
          ? "VERDICT"
          : "판결 확정"
        : locale === "en"
          ? "ON HOLD"
          : "판결 보류",
      record:
        locale === "en"
          ? `── TRIAL RECORD / DAY ${String(s.round).padStart(2, "0")} ──`
          : `── 재판 기록 / DAY ${String(s.round).padStart(2, "0")} ──`,
      outcome: "",
      title,
      reason,
      tally,
      action:
        locale === "en"
          ? s.you.resultReady
            ? "Result confirmed"
            : "Confirm result"
          : s.you.resultReady
            ? "결과 확인 완료"
            : "결과 확인",
      progress,
    });

    setResultAppearance(el, {
      status: resultStatus,
      role: hasDayResult ? result.role : null,
      reason: result.reason,
    });
    visible(el, "alive", s.you.alive);
    visible(el, "dead", !s.you.alive);
    const button = el.querySelector("#confirm-result-day");
    if (button) button.disabled = s.you.resultReady;
    slot(el, "players", players());
    return el;
  }

  function renderNightResult() {
    const s = state();
    const result = s.nightResult;
    const resultStatus = result.status;
    const hasVictim = resultStatus === "night-victim";
    const localizedRole =
      locale === "en"
        ? {
            mafia: "Mafia",
            cop: "Detective",
            doctor: "Doctor",
            citizen: "Citizen",
          }[result.role]
        : result.roleName;
    const progress =
      locale === "en"
        ? `${s.resultReadyCount}/${s.resultReadyRequiredCount} players reviewed the result.`
        : `${s.resultReadyCount}/${s.resultReadyRequiredCount}명이 결과를 확인했습니다.`;
    const investigation =
      s.you.role === "cop" && s.you.investigation
        ? `${s.you.investigation.targetName} · ${
            locale === "en"
              ? s.you.investigation.isMafia
                ? "Mafia"
                : "Not Mafia"
              : s.you.investigation.isMafia
                ? "마피아"
                : "마피아 아님"
          }`
        : "";
    const el = view("result-night", {
      record:
        locale === "en"
          ? `── CASE RECORD / NIGHT ${String(s.round).padStart(2, "0")} ──`
          : `── 사건 기록 / NIGHT ${String(s.round).padStart(2, "0")} ──`,
      outcome: "",
      stamp: hasVictim
        ? locale === "en"
          ? "INCIDENT"
          : "사건 발생"
        : locale === "en"
          ? "ALL SAFE"
          : "사건 없음",
      title: hasVictim
        ? locale === "en"
          ? `${result.playerName} was the night's victim.`
          : `${result.playerName} 님이 밤사이 희생되었습니다.`
        : locale === "en"
          ? "No one disappeared."
          : "아무도 사라지지 않았습니다.",
      description: hasVictim
        ? locale === "en"
          ? `They were ${localizedRole}.`
          : `정체는 ${roleWas(localizedRole)}.`
        : locale === "en"
          ? "A peaceful night passed."
          : "평온한 밤이 지나갔습니다.",
      investigation,
      action:
        locale === "en"
          ? s.you.resultReady
            ? "Result confirmed"
            : "Confirm result"
          : s.you.resultReady
            ? "결과 확인 완료"
            : "결과 확인",
      progress,
    });
    visible(el, "investigation", !!investigation);
    setResultAppearance(el, {
      status: resultStatus,
      role: hasVictim ? result.role : null,
    });
    visible(el, "alive", s.you.alive);
    visible(el, "dead", !s.you.alive);
    const button = el.querySelector("#confirm-result-night");
    if (button) button.disabled = s.you.resultReady;
    slot(el, "players", players());
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
    renderDayResult,
    renderNightResult,
    renderEnded,
  };
}
