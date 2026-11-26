const STORAGE_KEY = "rally-pickleball-state";
const THEME_KEY = "rally-theme";
const COLORS = ["#eaf1df", "#edf0ff", "#fff0e9", "#e7f4f1", "#f7ecdc", "#f4e9f2"];
const GAME_TARGETS = [11, 15, 21];

function isValidLosingScore(score, gameTo) {
  return Number.isInteger(score) && score >= 0 && score < gameTo;
}

const playerList = document.querySelector("#player-list");
const courtGrid = document.querySelector("#court-grid");
const notice = document.querySelector("#notice");
const editDialog = document.querySelector("#edit-dialog");
const replaceDialog = document.querySelector("#replace-dialog");
const choosePlayersDialog = document.querySelector("#choose-players-dialog");
const changeUpNextDialog = document.querySelector("#change-up-next-dialog");
const resultsDialog = document.querySelector("#results-dialog");
const recordDialog = document.querySelector("#record-dialog");
const confirmDialog = document.querySelector("#confirm-dialog");
let noticeTimeout;
let activeRecord = null;
let activeReplacement = null;
let choosingCourtId = null;
let changingUpNext = null;
let pendingConfirmation = null;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSavedState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    const value = JSON.parse(saved);
    if (!value || !Array.isArray(value.players) || !Array.isArray(value.courts)) {
      throw new TypeError("Saved Rally data has an invalid shape.");
    }
    return value;
  } catch (error) {
    console.error("Could not load saved Rally data.", error);
    return null;
  }
}

const savedState = readSavedState();
const savedMatches = Array.isArray(savedState?.matches) ? savedState.matches : [];
const state = {
  players: savedState?.players?.filter((player) => player && typeof player.id === "string" && typeof player.name === "string").map((player) => {
    const wins = Number.isInteger(player.wins) && player.wins > 0 ? player.wins : 0;
    const losses = Number.isInteger(player.losses) && player.losses > 0 ? player.losses : 0;
    return {
      id: player.id,
      name: player.name,
      wins,
      losses,
      gamesPlayed: Number.isInteger(player.gamesPlayed) && player.gamesPlayed >= 0
        ? Math.max(player.gamesPlayed, wins + losses)
        : wins + losses
    };
  }) ?? [],
  format: savedState?.format === "singles" ? "singles" : "doubles",
  courts: savedState?.courts?.filter((court) => court && typeof court.id === "string").map((court) => ({
    id: court.id,
    round: Number.isInteger(court.round) && court.round > 0 ? court.round : 0,
    playerIds: Array.isArray(court.playerIds) ? court.playerIds.filter((id) => typeof id === "string") : [],
    winner: court.winner === "team-a" || court.winner === "team-b" ? court.winner : null,
    matchId: typeof court.matchId === "string" ? court.matchId : null,
    startedAt: Number.isInteger(court.startedAt) && court.startedAt > 0 ? court.startedAt : null
  })) ?? [],
  matches: savedMatches.filter((match) => match
    && typeof match.id === "string"
    && Number.isInteger(match.number) && match.number > 0
    && (match.winner === "team-a" || match.winner === "team-b")
    && (match.teamSize === 1 || match.teamSize === 2)
    && Array.isArray(match.playerIds) && match.playerIds.every((id) => typeof id === "string")
    && Array.isArray(match.playerNames) && match.playerNames.every((name) => typeof name === "string")
    && match.playerIds.length === match.playerNames.length
    && match.playerIds.length === match.teamSize * 2
    && ((match.gameTo === null && match.losingScore === null)
      || (GAME_TARGETS.includes(match.gameTo) && isValidLosingScore(match.losingScore, match.gameTo))))
    .map((match) => ({
      id: match.id,
      number: match.number,
      courtId: typeof match.courtId === "string" ? match.courtId : "",
      playerIds: [...match.playerIds],
      playerNames: [...match.playerNames],
      teamSize: match.teamSize,
      winner: match.winner,
      gameTo: match.gameTo,
      losingScore: match.losingScore
    })) ?? [],
  nextMatchNumber: Math.max(
    Number.isInteger(savedState?.nextMatchNumber) && savedState.nextMatchNumber > 0 ? savedState.nextMatchNumber : 1,
    savedMatches.reduce((max, match) => Number.isInteger(match?.number) ? Math.max(max, match.number + 1) : max, 1)
  ),
  recordScores: savedState?.recordScores !== false,
  sessionStarted: savedState?.sessionStarted === true,
  sessionEnded: savedState?.sessionEnded === true,
  setupInProgress: savedState?.setupInProgress === true,
  upNextMatches: (Array.isArray(savedState?.upNextMatches)
    ? savedState.upNextMatches
    : Array.isArray(savedState?.upNextIds) ? [savedState.upNextIds] : [])
    .filter(Array.isArray)
    .map((ids) => ids.filter((id) => typeof id === "string")),
  savedRoster: (Array.isArray(savedState?.savedRoster) ? savedState.savedRoster : savedState?.players ?? [])
    .filter((player) => player && typeof player.id === "string" && typeof player.name === "string")
    .map((player) => ({ id: player.id, name: player.name }))
};

if (state.courts.length === 0) {
  state.courts = [createCourt(), createCourt()];
}

function createCourt() {
  return { id: makeId(), round: 0, playerIds: [], startedAt: null };
}

function saveState() {
  try {
    if (state.sessionStarted) {
      state.savedRoster = state.players.map(({ id, name }) => ({ id, name }));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save Rally data.", error);
    showNotice("Your changes could not be saved in this browser.");
  }
}

function showNotice(message) {
  window.clearTimeout(noticeTimeout);
  notice.textContent = message;
  const setupError = document.querySelector("#setup-error");
  if (document.querySelector("#workspace").dataset.stage === "setup") {
    setupError.textContent = message;
  } else if (!message) {
    setupError.textContent = "";
  }
  if (message) {
    noticeTimeout = window.setTimeout(() => {
      notice.textContent = "";
      if (setupError.textContent === message) setupError.textContent = "";
    }, 5000);
  }
}

function setStage(stage) {
  const resumableStage = state.sessionStarted ? "game" : state.setupInProgress ? "setup" : state.sessionEnded ? "summary" : null;
  const resumeButton = document.querySelector("#resume-session");
  const newSessionButton = document.querySelector("#new-session");
  resumeButton.hidden = !resumableStage;
  resumeButton.textContent = resumableStage === "setup" ? "Continue Setup"
    : resumableStage === "summary" ? "View Last Results" : "Resume Session";
  newSessionButton.classList.toggle("primary-button", !resumableStage);
  newSessionButton.classList.toggle("secondary-button", Boolean(resumableStage));
  document.querySelector("#existing-session").hidden = resumableStage === "game" || resumableStage === "setup" || state.savedRoster.length === 0;
  document.querySelector(".session-home-actions").classList.toggle("is-new-only", !resumableStage && state.savedRoster.length === 0);
  document.querySelector("#session-home-description").textContent = resumableStage === "game"
    ? "Your session is saved. Resume where you left off or start a new one."
    : resumableStage === "setup"
      ? "Your player list is saved. Continue setup or start a new session."
      : state.savedRoster.length === 0
        ? "Start with a fresh player list."
        : "Start with a fresh player list or bring back your saved players.";
  document.querySelector(".app-shell").dataset.stage = stage;
  document.querySelector("#session-home").hidden = stage !== "home";
  document.querySelector("#session-summary").hidden = stage !== "summary";
  document.querySelector("#workspace").hidden = stage === "home" || stage === "summary";
  document.querySelector("#workspace").dataset.stage = stage;
  document.querySelector("#session-menu").hidden = stage !== "game";
  document.querySelector("#show-results").hidden = stage !== "game";
  document.querySelector("#setup-error").textContent = "";
  window.scrollTo(0, 0);
}

function prepareSession(useExistingPlayers) {
  state.players = useExistingPlayers
    ? state.savedRoster.map(({ id, name }) => ({ id, name, wins: 0, losses: 0, gamesPlayed: 0 }))
    : [];
  state.matches = [];
  state.nextMatchNumber = 1;
  state.upNextMatches = [];
  state.courts = state.courts.map(() => createCourt());
  state.sessionStarted = false;
  state.sessionEnded = false;
  state.setupInProgress = true;
  showNotice("");
  saveState();
  render();
  setStage("setup");
  document.querySelector("#player-name").focus();
}

function startGame() {
  const required = state.format === "singles" ? 2 : 4;
  if (state.players.length < required) {
    document.querySelector("#setup-error").textContent = `Add at least ${required} players for ${state.format}.`;
    document.querySelector("#player-name").focus();
    return;
  }
  state.sessionStarted = true;
  state.setupInProgress = false;
  state.courts = state.courts.map(() => createCourt());
  state.upNextMatches = [];
  setStage("game");
  saveState();
  render();
}

function endSession() {
  state.savedRoster = state.players.map(({ id, name }) => ({ id, name }));
  if (state.sessionStarted && !state.recordScores) {
    const amount = state.format === "singles" ? 2 : 4;
    state.courts.forEach((court) => {
      if (court.playerIds.length !== amount || court.matchId) return;
      court.playerIds.forEach((id) => {
        const player = playerById(id);
        if (player) player.gamesPlayed += 1;
      });
    });
  }
  state.sessionStarted = false;
  state.sessionEnded = true;
  state.setupInProgress = false;
  state.upNextMatches = [];
  state.courts = state.courts.map(() => createCourt());
  saveState();
  render();
  setStage("summary");
}

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  const isDark = theme === "dark";
  button.setAttribute("aria-pressed", String(isDark));
  button.querySelector("span[aria-hidden='true']").textContent = isDark ? "☀" : "☾";
  button.querySelector(".theme-toggle-text").textContent = isDark ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function playerInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0])
    : Array.from(words[0] ?? "").slice(0, 2);
  return letters.length ? `${letters[0]}${letters[1] ?? letters[0]}`.toLocaleUpperCase() : "";
}

function playerById(id) {
  return state.players.find((player) => player.id === id);
}

function pointDifferentialFor(player) {
  return state.matches.reduce((total, match) => {
    const playerIndex = match.playerIds.indexOf(player.id);
    if (playerIndex < 0 || match.gameTo === null) return total;
    const playerWon = (playerIndex < match.teamSize) === (match.winner === "team-a");
    const teamScore = playerWon ? match.gameTo : match.losingScore;
    const opponentScore = playerWon ? match.losingScore : match.gameTo;
    return total + teamScore - opponentScore;
  }, 0);
}

function compareStanding(a, b) {
  const aGames = Math.max(1, a.gamesPlayed);
  const bGames = Math.max(1, b.gamesPlayed);
  return b.wins * aGames - a.wins * bGames
    || Number(a.gamesPlayed === 0) - Number(b.gamesPlayed === 0)
    || b.pointDifferential - a.pointDifferential;
}

function rankPlayers(players) {
  const rankedPlayers = players.map((player) => ({
    ...player,
    gamesPlayed: player.gamesPlayed,
    pointDifferential: pointDifferentialFor(player)
  })).sort((a, b) => compareStanding(a, b) || a.name.localeCompare(b.name));

  let currentRank = 0;
  return rankedPlayers.map((player, index) => {
    const previous = rankedPlayers[index - 1];
    const tied = previous && compareStanding(player, previous) === 0;
    if (!tied) currentRank = index + 1;
    return { ...player, rank: currentRank };
  });
}

function renderPlayers() {
  playerList.replaceChildren();
  const activeIds = new Set(state.courts.flatMap((court) => court.playerIds));
  const queuedPlayers = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => !activeIds.has(player.id));
  queuedPlayers.forEach(({ player, index }) => {
    const item = document.createElement("li");
    item.className = "player-row";

    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    avatar.textContent = playerInitials(player.name);
    avatar.style.backgroundColor = COLORS[index % COLORS.length];

    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;

    const games = document.createElement("span");
    games.className = "player-games";
    const gamesPlayed = player.gamesPlayed;
    games.textContent = `${gamesPlayed} ${gamesPlayed === 1 ? "game" : "games"}`;

    const actions = document.createElement("span");
    actions.className = "row-actions";

    const edit = document.createElement("button");
    edit.className = "icon-button";
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${player.name}`);
    edit.title = "Edit player";
    edit.textContent = "✎";
    edit.addEventListener("click", () => openEditDialog(player));

    const remove = document.createElement("button");
    remove.className = "icon-button delete-player";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${player.name}`);
    remove.title = "Remove player";
    remove.textContent = "×";
    remove.addEventListener("click", () => removePlayer(player.id));

    actions.append(edit, remove);
    item.append(avatar, name, games, actions);
    playerList.append(item);
  });

  document.querySelector("#player-count").textContent = queuedPlayers.length;
  const emptyRoster = document.querySelector("#empty-roster");
  emptyRoster.hidden = queuedPlayers.length > 0;
  emptyRoster.querySelector("p").textContent = state.players.length === 0
    ? "Your crew will show up here."
    : "Everyone is on court.";
  emptyRoster.querySelector("span:last-child").textContent = state.players.length === 0
    ? "Add at least 2 players to get started."
    : "Add a player to join the queue.";
}

function formatCourtElapsed(startedAt, now = Date.now()) {
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const seconds = String(elapsed % 60).padStart(2, "0");
  const minutes = Math.floor(elapsed / 60);
  return minutes < 60
    ? `${minutes}:${seconds}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

function refreshCourtTimers() {
  const now = Date.now();
  document.querySelectorAll(".court-timer-value").forEach((value) => {
    value.textContent = formatCourtElapsed(Number(value.dataset.startedAt), now);
  });
}

function renderCourts() {
  courtGrid.replaceChildren();
  const teamSize = state.format === "singles" ? 1 : 2;
  const playersPerCourt = teamSize * 2;

  state.courts.forEach((court, index) => {
    const assignedPlayers = court.playerIds.map(playerById).filter(Boolean);
    const hasMatch = assignedPlayers.length === playersPerCourt;
    const card = document.createElement("article");
    card.className = `court-card${hasMatch ? " has-match" : " is-empty"}`;

    const head = document.createElement("div");
    head.className = "court-card-head";
    const title = document.createElement("span");
    title.className = "court-title";
    const number = document.createElement("span");
    number.className = "court-number";
    number.textContent = index + 1;
    title.append(number, document.createTextNode(`Court ${index + 1}`));
    if (court.playerIds.length === 0) {
      const available = document.createElement("span");
      available.className = "court-available";
      available.textContent = "Available";
      title.append(available);
    }
    const clear = document.createElement("button");
    clear.className = "court-clear";
    clear.type = "button";
    clear.textContent = "×";
    clear.disabled = court.playerIds.length === 0;
    clear.setAttribute("aria-label", `Empty Court ${index + 1}`);
    clear.title = `Empty Court ${index + 1}`;
    clear.addEventListener("click", () => clearCourt(court.id));
    let courtTimer = null;
    if (hasMatch && court.startedAt) {
      const timer = document.createElement("span");
      timer.className = "court-timer";
      timer.setAttribute("role", "timer");
      timer.setAttribute("aria-label", `Court ${index + 1} elapsed time`);
      const timerIcon = document.createElement("span");
      timerIcon.setAttribute("aria-hidden", "true");
      timerIcon.textContent = "◷";
      const timerValue = document.createElement("span");
      timerValue.className = "court-timer-value";
      timerValue.dataset.startedAt = court.startedAt;
      timerValue.textContent = formatCourtElapsed(court.startedAt);
      timer.append(timerIcon, timerValue);
      courtTimer = timer;
    }
    head.append(title, clear);

    const body = document.createElement("div");
    body.className = "court-card-body";
    if (hasMatch) {
      const match = document.createElement("div");
      match.className = "match-row";
      match.append(makeTeam(assignedPlayers.slice(0, teamSize), "team-a", court.id, index + 1), makeVs(), makeTeam(assignedPlayers.slice(teamSize), "team-b", court.id, index + 1));
      body.append(match);

      const winnerControl = document.createElement("div");
      winnerControl.className = "winner-control";
      const winnerLabel = document.createElement("span");
      winnerLabel.className = "winner-label";
      winnerLabel.textContent = court.winner ? "CHANGE WINNER" : "TAG WINNER";
      const winnerActions = document.createElement("div");
      winnerActions.className = "winner-actions";
      ["team-a", "team-b"].forEach((team) => {
        const winnerButton = document.createElement("button");
        winnerButton.className = `winner-button${court.winner === team ? " is-selected" : ""}`;
        winnerButton.type = "button";
        winnerButton.textContent = `${team === "team-a" ? "Team A" : "Team B"} won`;
        winnerButton.setAttribute("aria-pressed", String(court.winner === team));
        winnerButton.addEventListener("click", () => recordWinner(court.id, team));
        winnerActions.append(winnerButton);
      });
      winnerControl.append(winnerLabel, winnerActions);
      body.append(winnerControl);
    } else {
      const empty = document.createElement("div");
      empty.className = "court-empty";
      const nextIds = state.upNextMatches[0] ?? [];
      const nextReady = state.sessionStarted && court.playerIds.length === 0 && nextIds.length === playersPerCourt;
      if (nextReady) {
        empty.append(makeCourtNextPreview(nextIds, teamSize));
      } else {
        const message = document.createElement("p");
        message.className = "court-empty-message";
        message.textContent = `Add ${Math.max(0, playersPerCourt - availableReplacementPlayers().length)} more players to the queue to prepare Up Next.`;
        empty.append(message);
      }
      const actions = document.createElement("div");
      actions.className = "court-empty-actions";
      const startNext = document.createElement("button");
      startNext.className = "primary-button court-start-next";
      startNext.type = "button";
      startNext.textContent = "Start Up Next 1";
      startNext.disabled = !nextReady;
      startNext.addEventListener("click", () => sendUpNextToCourt(court.id));
      const choose = document.createElement("button");
      choose.className = "secondary-button court-choose-players";
      choose.type = "button";
      choose.textContent = "Choose Players";
      choose.disabled = court.playerIds.length > 0 || availableReplacementPlayers().length < playersPerCourt;
      choose.addEventListener("click", () => openChoosePlayersDialog(court.id));
      actions.append(startNext, choose);
      empty.append(actions);
      body.append(empty);
    }

    card.append(head, body);
    if (hasMatch) {
      const foot = document.createElement("div");
      foot.className = "court-card-foot";
      const status = document.createElement("span");
      status.className = "court-status";
      const dot = document.createElement("span");
      dot.className = "status-dot";
      const statusText = court.winner
        ? `${court.winner === "team-a" ? "Team A" : "Team B"} won`
        : "In play";
      status.append(dot, document.createTextNode(statusText));
      foot.append(status);
      if (courtTimer) foot.append(courtTimer);
      card.append(foot);
    }
    courtGrid.append(card);
  });

  document.querySelector("#court-count").textContent = state.courts.length;
  document.querySelector("#remove-court").disabled = state.courts.length <= 1;
  const amount = state.format === "singles" ? 2 : 4;
  document.querySelector("#setup-hint-text").textContent = `Add at least ${amount} players to fill a ${state.format === "singles" ? "singles" : "doubles"} court.`;
  document.querySelectorAll(".format-option").forEach((button) => {
    const selected = button.dataset.format === state.format;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function makeCourtNextPreview(playerIds, teamSize) {
  const preview = document.createElement("div");
  preview.className = "court-next-preview";
  [playerIds.slice(0, teamSize), playerIds.slice(teamSize)].forEach((teamIds, index) => {
    const team = document.createElement("div");
    team.className = "court-next-team";
    teamIds.forEach((id) => {
      const name = document.createElement("span");
      name.textContent = playerById(id)?.name ?? "";
      team.append(name);
    });
    if (index > 0) preview.append(makeVs());
    preview.append(team);
  });
  return preview;
}

function makeMatchActionIcon(pathData) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function matchRowValues(match) {
  const winnerTeam = match.winner === "team-a" ? 0 : 1;
  const winnerNames = match.playerNames.slice(winnerTeam * match.teamSize, (winnerTeam + 1) * match.teamSize);
  const loserNames = match.playerNames.slice((1 - winnerTeam) * match.teamSize, (2 - winnerTeam) * match.teamSize);
  const values = [
    { className: "match-number", text: String(match.number) },
    { className: "match-winner", text: winnerNames.join(" & ") },
    { className: "match-loser", text: loserNames.join(" & ") }
  ];
  if (state.recordScores) {
    values.push({ className: "match-score", text: match.gameTo === null ? "—" : `${match.gameTo}–${match.losingScore}` });
  }
  return values;
}

function renderMatchLog() {
  const list = document.querySelector("#match-log-list");
  const empty = document.querySelector("#match-log-empty");
  const query = document.querySelector("#match-search").value.trim().toLocaleLowerCase();
  list.replaceChildren();
  const matches = [...state.matches].reverse().filter((match) => {
    if (!query) return true;
    const searchText = [
      match.number,
      ...match.playerNames,
      ...(match.gameTo === null ? [] : [
        match.gameTo,
        match.losingScore,
        `${match.gameTo}-${match.losingScore}`,
        `${match.gameTo}–${match.losingScore}`
      ])
    ].join(" ").toLocaleLowerCase();
    return searchText.includes(query);
  });
  empty.hidden = matches.length > 0;
  empty.textContent = query ? "No matches found." : "Completed games will appear here.";
  matches.forEach((match) => {
    const row = document.createElement("tr");
    matchRowValues(match).forEach(({ className, text }) => {
      const cell = document.createElement("td");
      cell.className = className;
      cell.textContent = text;
      row.append(cell);
    });

    const actions = document.createElement("td");
    actions.className = "match-actions";
    const swap = document.createElement("button");
    swap.className = "match-action";
    swap.type = "button";
    swap.title = "Swap winner";
    swap.setAttribute("aria-label", `Swap winner for Match ${match.number}`);
    swap.append(makeMatchActionIcon("M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"));
    swap.addEventListener("click", () => swapMatchWinner(match.id));
    const remove = document.createElement("button");
    remove.className = "match-action match-delete";
    remove.type = "button";
    remove.title = "Delete Match";
    remove.setAttribute("aria-label", `Delete Match ${match.number}`);
    remove.append(makeMatchActionIcon("M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"));
    remove.addEventListener("click", () => confirmAction(
      `Delete Match ${match.number}?`,
      "This will remove the match from the log and update player records.",
      () => deleteMatch(match.id),
      "Delete Match"
    ));
    actions.append(swap, remove);
    row.append(actions);
    list.append(row);
  });
}

function renderSummaryMatchLog() {
  const list = document.querySelector("#summary-match-list");
  const empty = document.querySelector("#summary-match-empty");
  list.replaceChildren();
  empty.hidden = state.matches.length > 0;
  empty.textContent = "No matches were recorded.";
  [...state.matches].reverse().forEach((match) => {
    const row = document.createElement("tr");
    matchRowValues(match).forEach(({ className, text }) => {
      const cell = document.createElement("td");
      cell.className = className;
      cell.textContent = text;
      row.append(cell);
    });
    list.append(row);
  });
}

function makeTeam(players, className, courtId, courtNumber) {
  const team = document.createElement("div");
  team.className = `team ${className}`;
  players.forEach((player) => {
    const entry = document.createElement("button");
    entry.className = "team-player";
    entry.type = "button";
    entry.setAttribute("aria-label", `Change ${player.name} on Court ${courtNumber}`);
    entry.title = `Change ${player.name}`;
    entry.addEventListener("click", () => openReplaceDialog(courtId, player.id));
    const avatar = document.createElement("span");
    avatar.className = "mini-avatar";
    avatar.textContent = playerInitials(player.name);
    const name = document.createElement("span");
    name.className = "team-player-name";
    name.textContent = player.name;
    const change = document.createElement("span");
    change.className = "team-player-change";
    change.setAttribute("aria-hidden", "true");
    change.textContent = "↻";
    entry.append(avatar, name, change);
    team.append(entry);
  });
  return team;
}

function makeVs() {
  const label = document.createElement("span");
  label.className = "vs";
  label.textContent = "VS";
  return label;
}

function recordWinner(courtId, winner) {
  const court = state.courts.find((item) => item.id === courtId);
  const playersPerCourt = state.format === "singles" ? 2 : 4;
  if (!court || (winner !== "team-a" && winner !== "team-b") || court.playerIds.length !== playersPerCourt) return;
  if (!state.recordScores) {
    const existing = state.matches.find((match) => match.id === court.matchId);
    if (existing?.winner === winner) {
      clearCourt(court.id);
      return;
    }
    if (existing) {
      applyMatchRecord(existing, -1);
      existing.winner = winner;
      applyMatchRecord(existing, 1);
    } else {
      const players = court.playerIds.map(playerById).filter(Boolean);
      if (players.length !== playersPerCourt) return;
      const match = {
        id: makeId(),
        number: state.nextMatchNumber,
        courtId: court.id,
        playerIds: players.map((player) => player.id),
        playerNames: players.map((player) => player.name),
        teamSize: playersPerCourt / 2,
        winner,
        gameTo: null,
        losingScore: null
      };
      state.matches.push(match);
      state.nextMatchNumber += 1;
      court.matchId = match.id;
      applyMatchRecord(match, 1);
    }
    clearCourt(court.id);
    return;
  }
  activeRecord = {
    courtId,
    winner,
    gameTo: 11,
    losingScore: null,
    legacyWinner: !state.matches.some((match) => match.id === court.matchId) ? court.winner : null
  };
  const previous = state.matches.find((match) => match.id === court.matchId);
  if (previous) {
    activeRecord.gameTo = previous.gameTo;
    activeRecord.losingScore = previous.losingScore;
  }
  renderRecordDialog();
  recordDialog.showModal();
}

function renderRecordDialog() {
  const court = state.courts.find((item) => item.id === activeRecord?.courtId);
  if (!court || !activeRecord) return;
  const teamSize = state.format === "singles" ? 1 : 2;
  const teams = [
    court.playerIds.slice(0, teamSize).map(playerById).filter(Boolean),
    court.playerIds.slice(teamSize).map(playerById).filter(Boolean)
  ];
  const container = document.querySelector("#record-teams");
  container.replaceChildren();
  teams.forEach((teamPlayers, index) => {
    const team = index === 0 ? "team-a" : "team-b";
    const winning = activeRecord.winner === team;
    const row = document.createElement("div");
    row.className = `record-team${winning ? " is-winning" : ""}`;
    const badge = document.createElement("span");
    badge.className = `record-badge${winning ? " is-win" : ""}`;
    badge.textContent = winning ? "WIN" : "LOSE";
    const names = document.createElement("span");
    names.className = "record-team-names";
    names.textContent = teamPlayers.map((player) => player.name).join(" & ");
    const score = document.createElement("strong");
    score.className = "record-team-score";
    score.textContent = winning ? String(activeRecord.gameTo) : activeRecord.losingScore === null ? "—" : String(activeRecord.losingScore);
    row.append(badge, names, score);
    container.append(row);
  });
  const targets = document.querySelector("#game-targets");
  targets.replaceChildren();
  GAME_TARGETS.forEach((target) => {
    const button = document.createElement("button");
    button.className = `record-choice${activeRecord.gameTo === target ? " is-selected" : ""}`;
    button.type = "button";
    button.textContent = `${activeRecord.gameTo === target ? "✓ " : ""}${target}`;
    button.setAttribute("aria-pressed", String(activeRecord.gameTo === target));
    button.addEventListener("click", () => {
      activeRecord.gameTo = target;
      if (!isValidLosingScore(activeRecord.losingScore, target)) {
        activeRecord.losingScore = null;
      }
      renderRecordDialog();
    });
    targets.append(button);
  });
  const losingScores = document.querySelector("#losing-scores");
  losingScores.replaceChildren();
  for (let score = 0; score < activeRecord.gameTo; score += 1) {
    const button = document.createElement("button");
    button.className = `record-choice${activeRecord.losingScore === score ? " is-selected" : ""}`;
    button.type = "button";
    button.textContent = String(score);
    button.setAttribute("aria-pressed", String(activeRecord.losingScore === score));
    button.addEventListener("click", () => {
      activeRecord.losingScore = score;
      renderRecordDialog();
    });
    losingScores.append(button);
  }
  document.querySelector("#record-match-form button[type='submit']").disabled = !isValidLosingScore(activeRecord.losingScore, activeRecord.gameTo);
}

function applyMatchRecord(match, amount) {
  match.playerIds.forEach((playerId, index) => {
    const player = playerById(playerId);
    if (!player) return;
    const playerWon = (index < match.teamSize) === (match.winner === "team-a");
    const result = playerWon ? "wins" : "losses";
    player[result] = Math.max(0, player[result] + amount);
    player.gamesPlayed = Math.max(0, player.gamesPlayed + amount);
  });
}

function saveMatchResult() {
  if (!activeRecord || !GAME_TARGETS.includes(activeRecord.gameTo)
    || !isValidLosingScore(activeRecord.losingScore, activeRecord.gameTo)) return;
  const court = state.courts.find((item) => item.id === activeRecord.courtId);
  if (!court) return;
  const existing = state.matches.find((match) => match.id === court.matchId);
  if (existing) {
    applyMatchRecord(existing, -1);
    existing.winner = activeRecord.winner;
    existing.gameTo = activeRecord.gameTo;
    existing.losingScore = activeRecord.losingScore;
    applyMatchRecord(existing, 1);
  } else {
    const teamSize = state.format === "singles" ? 1 : 2;
    const players = court.playerIds.map(playerById).filter(Boolean);
    if (players.length !== teamSize * 2) return;
    const match = {
      id: makeId(),
      number: state.nextMatchNumber,
      courtId: court.id,
      playerIds: players.map((player) => player.id),
      playerNames: players.map((player) => player.name),
      teamSize,
      winner: activeRecord.winner,
      gameTo: activeRecord.gameTo,
      losingScore: activeRecord.losingScore
    };
    state.matches.push(match);
    state.nextMatchNumber += 1;
    court.matchId = match.id;
    if (activeRecord.legacyWinner) {
      match.winner = activeRecord.legacyWinner;
      applyMatchRecord(match, -1);
      match.winner = activeRecord.winner;
    }
    applyMatchRecord(match, 1);
  }
  activeRecord = null;
  recordDialog.close();
  clearCourt(court.id);
}

function swapMatchWinner(matchId) {
  const match = state.matches.find((entry) => entry.id === matchId);
  if (!match) return;
  applyMatchRecord(match, -1);
  match.winner = match.winner === "team-a" ? "team-b" : "team-a";
  applyMatchRecord(match, 1);
  const court = state.courts.find((entry) => entry.matchId === match.id);
  if (court) court.winner = match.winner;
  saveState();
  render();
}

function deleteMatch(matchId) {
  const index = state.matches.findIndex((entry) => entry.id === matchId);
  if (index < 0) return;
  const [match] = state.matches.splice(index, 1);
  applyMatchRecord(match, -1);
  const court = state.courts.find((entry) => entry.matchId === match.id);
  if (court) {
    court.matchId = null;
    court.winner = null;
  }
  saveState();
  render();
}

function confirmAction(title, message, action, confirmLabel) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#accept-confirm").textContent = confirmLabel;
  pendingConfirmation = action;
  confirmDialog.showModal();
}

function renderResults(list = document.querySelector("#results-list")) {
  list.replaceChildren();
  if (state.players.length === 0) {
    const empty = document.createElement("li");
    empty.className = "results-empty";
    empty.textContent = "Add players to see the session standings.";
    list.append(empty);
    return;
  }

  const rankedPlayers = rankPlayers(state.players);
  const recordCounts = new Map();
  rankedPlayers.forEach((player) => {
    const record = `${player.wins}:${player.gamesPlayed}`;
    recordCounts.set(record, (recordCounts.get(record) || 0) + 1);
  });

  rankedPlayers.forEach((player, index) => {
    const item = document.createElement("li");
    item.className = `result-row${index < 3 ? ` result-place-${index + 1}` : ""}`;

    const rank = document.createElement("span");
    rank.className = "result-rank";
    const medals = ["🥇", "🥈", "🥉"];
    rank.textContent = index < medals.length ? medals[index] : String(index + 1);
    rank.classList.toggle("result-rank-medal", index < medals.length);
    rank.setAttribute("aria-label", `Place ${index + 1}`);

    const playerInfo = document.createElement("div");
    playerInfo.className = "result-player-info";
    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = player.name;

    const gamesPlayed = player.gamesPlayed;
    const winRate = gamesPlayed ? Math.round((player.wins / gamesPlayed) * 100) : 0;
    const metrics = document.createElement("span");
    metrics.className = "result-metrics";
    metrics.textContent = `${winRate}% win rate · ${gamesPlayed} ${gamesPlayed === 1 ? "game" : "games"}`;
    if (recordCounts.get(`${player.wins}:${player.gamesPlayed}`) > 1) {
      metrics.textContent += ` · Point differential: ${player.pointDifferential > 0 ? "+" : ""}${player.pointDifferential}`;
    }
    playerInfo.append(name, metrics);

    const wins = document.createElement("span");
    wins.className = "result-wins";
    wins.textContent = `${player.wins} ${player.wins === 1 ? "Win" : "Wins"}`;

    item.append(rank, playerInfo, wins);
    list.append(item);
  });
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function selectFairPlayers(eligiblePlayers, amount, previousPlayers = new Set()) {
  return shuffle(eligiblePlayers)
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed
      || Number(previousPlayers.has(a.id)) - Number(previousPlayers.has(b.id)))
    .slice(0, amount);
}

function sameTeamSet(first, second) {
  return first.length === second.length && first.every((id) => second.includes(id));
}

function teamSetKey(ids) {
  return [...ids].sort().join("|");
}

function teamPairings(ids) {
  if (ids.length === 2) return [[ids, []]];
  if (ids.length === 4) {
    return [
      [[ids[0], ids[1]], [ids[2], ids[3]]],
      [[ids[0], ids[2]], [ids[1], ids[3]]],
      [[ids[0], ids[3]], [ids[1], ids[2]]]
    ];
  }
  return [];
}

function candidateMatchScore(ids, teamSize, generatedMatches) {
  let score = 0;
  const teams = [ids.slice(0, teamSize), ids.slice(teamSize)];
  const historical = [
    ...state.matches,
    ...generatedMatches.map((playerIds) => ({ teamSize, playerIds }))
  ];
  historical.forEach((match) => {
    if (match.teamSize !== teamSize) return;
    const previousTeams = [
      match.playerIds.slice(0, teamSize),
      match.playerIds.slice(teamSize)
    ];
    teams.forEach((team) => {
      if (teamSize > 1 && previousTeams.some((previous) => sameTeamSet(team, previous))) score += 10;
    });
    if ((sameTeamSet(teams[0], previousTeams[0]) && sameTeamSet(teams[1], previousTeams[1]))
      || (sameTeamSet(teams[0], previousTeams[1]) && sameTeamSet(teams[1], previousTeams[0]))) {
      score += 100;
    }
  });
  return score * 1000 + ids.reduce((total, id) => total + (playerById(id)?.gamesPlayed ?? 0), 0);
}

function candidateTeamOrientations(ids, teamSize) {
  if (teamSize === 1) return [ids, [...ids].reverse()];
  const pairings = teamPairings(ids);
  const orientations = [];
  pairings.forEach(([teamA, teamB]) => {
    orientations.push([...teamA, ...teamB]);
    orientations.push([...teamB, ...teamA]);
  });
  return orientations;
}

function candidatePlayerSets(pool, amount) {
  const candidates = [];
  const fair = selectFairPlayers(pool, amount);
  candidates.push(fair);

  if (pool.length <= 12) {
    const addCombinations = (start, chosen) => {
      if (chosen.length === amount) {
        candidates.push([...chosen]);
        return;
      }
      for (let index = start; index <= pool.length - (amount - chosen.length); index += 1) {
        chosen.push(pool[index]);
        addCombinations(index + 1, chosen);
        chosen.pop();
      }
    };
    addCombinations(0, []);
  } else {
    for (let attempt = 0; attempt < 96; attempt += 1) {
      candidates.push(shuffle(pool).slice(0, amount));
    }
  }
  return candidates.filter((candidate, index, all) =>
    all.findIndex((other) => teamSetKey(candidate.map((player) => player.id).sort()) === teamSetKey(other.map((player) => player.id).sort())) === index
  );
}

function buildUpNext(fillAll = false) {
  const previous = JSON.stringify(state.upNextMatches);
  const amount = state.format === "singles" ? 2 : 4;
  let pool = availableReplacementPlayers();
  const count = state.sessionStarted
    ? (fillAll ? Math.floor(pool.length / amount) : Math.min(1, Math.floor(pool.length / amount)))
    : 0;
  const matches = [];
  for (let index = 0; index < count; index += 1) {
    const teamSize = amount / 2;
    let bestIds = null;
    let bestScore = Infinity;
    candidatePlayerSets(pool, amount).forEach((selected) => {
      candidateTeamOrientations(selected.map((player) => player.id), teamSize).forEach((ids) => {
        const score = candidateMatchScore(ids, teamSize, matches);
        if (score < bestScore) {
          bestScore = score;
          bestIds = ids;
        }
      });
    });
    if (!bestIds) break;
    matches.push(bestIds);
    const selectedIds = new Set(bestIds);
    pool = pool.filter((player) => !selectedIds.has(player.id));
  }
  state.upNextMatches = matches;
}

function availableForNewUpNext() {
  const scheduledIds = new Set(state.upNextMatches.flat());
  return availableReplacementPlayers().filter((player) => !scheduledIds.has(player.id));
}

function addUpNextMatch() {
  const amount = state.format === "singles" ? 2 : 4;
  const pool = availableForNewUpNext();
  if (!state.sessionStarted || pool.length < amount) return;
  const players = shuffle(selectFairPlayers(pool, amount));
  state.upNextMatches.push(players.map((player) => player.id));
  saveState();
  render();
}

function rebuildUpNextMatch(matchIndex) {
  const ids = state.upNextMatches[matchIndex];
  if (!ids || ids.length < 2) return;
  const teamSize = state.format === "singles" ? 1 : 2;
  const currentTeam = new Set(ids.slice(0, teamSize));
  let shuffled = shuffle(ids);
  for (let attempt = 0; attempt < 8 && shuffled.slice(0, teamSize).every((id) => currentTeam.has(id)); attempt += 1) {
    shuffled = shuffle(ids);
  }
  if (shuffled.slice(0, teamSize).every((id) => currentTeam.has(id))) {
    shuffled = [...ids.slice(1), ids[0]];
  }
  state.upNextMatches[matchIndex] = shuffled;
  saveState();
  render();
}

function removeUpNextMatch(matchIndex) {
  if (matchIndex < 1 || matchIndex >= state.upNextMatches.length) return;
  state.upNextMatches.splice(matchIndex, 1);
  saveState();
  render();
}

function ensureUpNext() {
  const previous = JSON.stringify(state.upNextMatches);
  if (!state.sessionStarted) {
    state.upNextMatches = [];
    return previous !== "[]";
  }
  const amount = state.format === "singles" ? 2 : 4;
  const availableIds = new Set(availableReplacementPlayers().map((player) => player.id));
  const usedIds = new Set();
  state.upNextMatches = state.upNextMatches.filter((ids) => {
    if (ids.length !== amount || new Set(ids).size !== amount
      || !ids.every((id) => availableIds.has(id) && !usedIds.has(id))) return false;
    ids.forEach((id) => usedIds.add(id));
    return true;
  });
  if (state.upNextMatches.length === 0 && availableIds.size >= amount) buildUpNext();
  return JSON.stringify(state.upNextMatches) !== previous;
}

function getUpNextCourt(matchIndex = 0) {
  const available = state.courts.filter((court) => court.playerIds.length === 0);
  return available.length ? available[matchIndex % available.length] : null;
}

function upNextHistory(ids, teamSize) {
  const teams = [ids.slice(0, teamSize), ids.slice(teamSize)];
  const sameTeam = (first, second) => first.length === second.length
    && first.every((id) => second.includes(id));
  const together = [0, 0];
  let rematches = 0;
  state.matches.forEach((match) => {
    if (match.teamSize !== teamSize) return;
    const previousTeams = [
      match.playerIds.slice(0, teamSize),
      match.playerIds.slice(teamSize)
    ];
    if (teamSize > 1) {
      teams.forEach((team, index) => {
        if (previousTeams.some((previous) => sameTeam(team, previous))) together[index] += 1;
      });
    }
    if ((sameTeam(teams[0], previousTeams[0]) && sameTeam(teams[1], previousTeams[1]))
      || (sameTeam(teams[0], previousTeams[1]) && sameTeam(teams[1], previousTeams[0]))) {
      rematches += 1;
    }
  });
  return { together, rematches };
}

function renderUpNext() {
  const list = document.querySelector("#up-next-list");
  list.replaceChildren();
  const amount = state.format === "singles" ? 2 : 4;
  const matches = state.upNextMatches;
  document.querySelector("#rebuild-all-up-next").disabled = !state.sessionStarted
    || availableReplacementPlayers().length < amount;
  document.querySelector("#add-up-next-match").disabled = !state.sessionStarted
    || availableForNewUpNext().length < amount;
  if (matches.length === 0) {
    const card = document.createElement("section");
    card.className = "up-next-panel panel";
    const heading = document.createElement("div");
    heading.className = "up-next-heading";
    const title = document.createElement("h2");
    title.textContent = "Up Next ";
    const count = document.createElement("span");
    count.className = "count-pill";
    count.textContent = "0";
    title.append(count);
    heading.append(title);
    const empty = document.createElement("p");
    empty.className = "up-next-empty";
    const missing = Math.max(0, amount - availableReplacementPlayers().length);
    empty.textContent = `Add ${missing} more ${missing === 1 ? "player" : "players"} to the queue to build the next match.`;
    card.append(heading, empty);
    list.append(card);
    return;
  }

  matches.forEach((ids, matchIndex) => {
    const teamSize = amount / 2;
    const history = upNextHistory(ids, teamSize);
    const card = document.createElement("section");
    card.className = "up-next-panel panel";
    const heading = document.createElement("div");
    heading.className = "up-next-heading";
    const title = document.createElement("h2");
    title.textContent = "Up Next ";
    const count = document.createElement("span");
    count.className = "count-pill";
    count.textContent = matchIndex + 1;
    title.append(count);
    if (history.rematches > 0) {
      const rematch = document.createElement("span");
      rematch.className = "up-next-rematch";
      rematch.textContent = `Rematch${history.rematches > 1 ? ` ×${history.rematches}` : ""}`;
      rematch.title = `These teams have faced each other ${history.rematches} ${history.rematches === 1 ? "time" : "times"} this session.`;
      title.append(rematch);
    }
    const rebuild = document.createElement("button");
    rebuild.className = "up-next-rebuild";
    rebuild.type = "button";
    rebuild.textContent = "↻ Rebuild";
    rebuild.addEventListener("click", () => rebuildUpNextMatch(matchIndex));
    const headingActions = document.createElement("div");
    headingActions.className = "up-next-heading-actions";
    headingActions.append(rebuild);
    if (matchIndex > 0) {
      const remove = document.createElement("button");
      remove.className = "up-next-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `Remove Up Next ${matchIndex + 1}`;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => removeUpNextMatch(matchIndex));
      headingActions.append(remove);
    }
    heading.append(title, headingActions);

    const match = document.createElement("div");
    match.className = "up-next-match";
    const teamA = document.createElement("div");
    const teamB = document.createElement("div");
    teamA.className = "up-next-team team-a";
    teamB.className = "up-next-team team-b";
    [teamA, teamB].forEach((team, index) => {
      const labelRow = document.createElement("div");
      labelRow.className = "up-next-team-label-row";
      const label = document.createElement("span");
      label.className = "up-next-team-label";
      label.textContent = index === 0 ? "TEAM A" : "TEAM B";
      labelRow.append(label);
      if (history.together[index] > 0) {
        const paired = document.createElement("span");
        paired.className = "up-next-history-badge";
        paired.textContent = `Played together${history.together[index] > 1 ? ` ×${history.together[index]}` : ""}`;
        paired.title = `These players teamed up ${history.together[index]} ${history.together[index] === 1 ? "time" : "times"} this session.`;
        labelRow.append(paired);
      }
      team.append(labelRow);
    });
    ids.forEach((id, index) => {
      const player = playerById(id);
      const row = document.createElement("button");
      row.className = "up-next-player";
      row.type = "button";
      row.setAttribute("aria-label", `Change ${player.name} in Up Next ${matchIndex + 1}`);
      row.title = `Change ${player.name}`;
      row.addEventListener("click", () => openChangeUpNextDialog(matchIndex, id));
      const avatar = document.createElement("span");
      avatar.className = "up-next-avatar";
      avatar.textContent = playerInitials(player.name);
      avatar.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = player.name;
      const changeIcon = document.createElement("span");
      changeIcon.className = "up-next-player-change";
      changeIcon.textContent = "↻";
      changeIcon.setAttribute("aria-hidden", "true");
      row.append(avatar, name, changeIcon);
      (index < amount / 2 ? teamA : teamB).append(row);
    });
    match.append(teamA, teamB);

    const targetCourt = getUpNextCourt(matchIndex);
    card.append(heading, match);
    if (targetCourt) {
      const actions = document.createElement("div");
      actions.className = "up-next-actions";
      const send = document.createElement("button");
      send.className = "primary-button";
      send.type = "button";
      send.textContent = `Send to Court ${state.courts.indexOf(targetCourt) + 1}`;
      send.addEventListener("click", () => sendUpNext(matchIndex));
      actions.append(send);
      card.append(actions);
    }
    list.append(card);
  });
}

function openChangeUpNextDialog(matchIndex, currentId) {
  const ids = state.upNextMatches[matchIndex];
  const currentPlayer = playerById(currentId);
  if (!ids?.includes(currentId) || !currentPlayer) return;
  const replacements = availableReplacementPlayers().filter((player) => player.id !== currentId);
  if (replacements.length === 0) return;

  changingUpNext = { matchIndex, currentId };
  document.querySelector("#change-up-next-title").textContent = `Change ${currentPlayer.name} in Up Next ${matchIndex + 1}`;
  const replacement = document.querySelector("#change-up-next-replacement");
  replacement.replaceChildren();
  replacements.forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    const otherIndex = state.upNextMatches.findIndex((match) => match.includes(player.id));
    option.textContent = otherIndex < 0 ? player.name : `${player.name} (Up Next ${otherIndex + 1})`;
    replacement.append(option);
  });
  changeUpNextDialog.showModal();
  replacement.focus();
}

function changeUpNextPlayer(matchIndex, currentId, replacementId) {
  const ids = state.upNextMatches[matchIndex];
  const slot = ids?.indexOf(currentId) ?? -1;
  const availableIds = new Set(availableReplacementPlayers().map((player) => player.id));
  if (slot < 0 || currentId === replacementId || !availableIds.has(replacementId)) return false;

  const sameMatchSlot = ids.indexOf(replacementId);
  if (sameMatchSlot >= 0) {
    ids[sameMatchSlot] = currentId;
  } else {
    const otherIndex = state.upNextMatches.findIndex((match, index) => index !== matchIndex && match.includes(replacementId));
    if (otherIndex >= 0) {
      const other = state.upNextMatches[otherIndex];
      other[other.indexOf(replacementId)] = currentId;
    }
  }
  ids[slot] = replacementId;
  saveState();
  render();
  return true;
}

function availableReplacementPlayers() {
  const assigned = new Set(state.courts.flatMap((court) => court.playerIds));
  return state.players.filter((player) => !assigned.has(player.id));
}

function openReplaceDialog(courtId, playerId) {
  const court = state.courts.find((item) => item.id === courtId);
  const player = playerById(playerId);
  if (!court?.playerIds.includes(playerId) || !player) return;

  activeReplacement = { courtId, playerId };
  const courtNumber = state.courts.indexOf(court) + 1;
  document.querySelector("#replace-description").textContent = `Replace ${player.name} on Court ${courtNumber}. The other players will stay in place.`;

  const select = document.querySelector("#replacement-player");
  select.replaceChildren();
  const available = availableReplacementPlayers().sort((a, b) => a.name.localeCompare(b.name));
  available.forEach((candidate) => {
    const option = document.createElement("option");
    option.value = candidate.id;
    option.textContent = candidate.name;
    select.append(option);
  });
  const empty = available.length === 0;
  select.disabled = empty;
  document.querySelector("#replace-empty").hidden = !empty;
  document.querySelector("#random-replacement").disabled = empty;
  document.querySelector("#save-replacement").disabled = empty;
  replaceDialog.showModal();
  if (!empty) select.focus();
}

function replaceCourtPlayer(courtId, playerId, replacementId) {
  const court = state.courts.find((item) => item.id === courtId);
  const slot = court?.playerIds.indexOf(playerId) ?? -1;
  if (slot < 0 || !availableReplacementPlayers().some((player) => player.id === replacementId)) return false;

  const completed = Boolean(court.winner || state.matches.some((match) => match.id === court.matchId));
  court.playerIds[slot] = replacementId;
  court.winner = null;
  court.matchId = null;
  if (completed) court.round += 1;
  showNotice("");
  saveState();
  render();
  return true;
}

function randomizeAll() {
  const amount = state.format === "singles" ? 2 : 4;
  let pool = [...state.players];
  let filled = 0;
  state.courts.forEach((court) => {
    const completed = Boolean(court.winner || state.matches.some((match) => match.id === court.matchId));
    if (!state.recordScores && !court.matchId && court.playerIds.length === amount) {
      court.playerIds.forEach((playerId) => {
        const player = playerById(playerId);
        if (player) player.gamesPlayed += 1;
      });
    }
    court.winner = null;
    court.matchId = null;
    if (pool.length >= amount) {
      const selectedPlayers = selectFairPlayers(pool, amount);
      const selectedIds = new Set(selectedPlayers.map((player) => player.id));
      pool = pool.filter((player) => !selectedIds.has(player.id));
      court.playerIds = shuffle(selectedPlayers).map((player) => player.id);
      court.startedAt = Date.now();
      if (court.round === 0 || completed) court.round += 1;
      filled += 1;
    } else {
      court.playerIds = [];
      court.startedAt = null;
    }
  });
  const shortfall = state.courts.length - filled;
  if (shortfall > 0) {
    const additionalPlayers = state.courts.length * amount - state.players.length;
    showNotice(`Not enough players to fill every court. ${filled} ${filled === 1 ? "court was" : "courts were"} randomized; add ${additionalPlayers} more player${additionalPlayers === 1 ? "" : "s"} to fill the rest.`);
  } else {
    showNotice("");
  }
  saveState();
  render();
}

function clearCourt(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court || court.playerIds.length === 0) return;
  court.playerIds = [];
  court.winner = null;
  court.matchId = null;
  court.startedAt = null;
  saveState();
  render();
}

function openChoosePlayersDialog(courtId) {
  const court = state.courts.find((item) => item.id === courtId);
  const amount = state.format === "singles" ? 2 : 4;
  const available = availableReplacementPlayers();
  if (!court || court.playerIds.length > 0 || available.length < amount) return;

  choosingCourtId = courtId;
  document.querySelector("#choose-players-title").textContent = `Choose players for Court ${state.courts.indexOf(court) + 1}`;
  const list = document.querySelector("#choose-players-list");
  list.replaceChildren();
  available.forEach((player) => {
    const option = document.createElement("label");
    option.className = "choose-player-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = player.id;
    const avatar = document.createElement("span");
    avatar.className = "choose-player-avatar";
    avatar.textContent = playerInitials(player.name);
    avatar.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = player.name;
    option.append(input, avatar, name);
    list.append(option);
  });
  updateChoosePlayersSelection();
  choosePlayersDialog.showModal();
}

function updateChoosePlayersSelection() {
  const amount = state.format === "singles" ? 2 : 4;
  const inputs = [...document.querySelectorAll("#choose-players-list input")];
  const selected = inputs.filter((input) => input.checked).length;
  document.querySelector("#choose-players-count").textContent = `${selected} of ${amount} players selected`;
  document.querySelector("#assign-choose-players").disabled = selected !== amount;
  inputs.forEach((input) => { input.disabled = selected >= amount && !input.checked; });
}

function assignPlayersToCourt(court, playerIds) {
  const amount = state.format === "singles" ? 2 : 4;
  if (!state.recordScores && !court.matchId && court.playerIds.length === amount) {
    court.playerIds.forEach((playerId) => {
      const player = playerById(playerId);
      if (player) player.gamesPlayed += 1;
    });
  }
  court.playerIds = [...playerIds];
  court.winner = null;
  court.matchId = null;
  court.startedAt = Date.now();
  court.round += 1;
  saveState();
  render();
}

function sendUpNextToCourt(courtId, matchIndex = 0) {
  const court = state.courts.find((item) => item.id === courtId);
  if (!court || court.playerIds.length !== 0) {
    render();
    showNotice("That court is no longer available. Empty a court first.");
    return;
  }
  const nextIds = state.upNextMatches[matchIndex];
  const amount = state.format === "singles" ? 2 : 4;
  const availableIds = new Set(availableReplacementPlayers().map((player) => player.id));
  if (!nextIds || nextIds.length !== amount || !nextIds.every((id) => availableIds.has(id))) {
    if (ensureUpNext()) saveState();
    render();
    showNotice("The queue changed. Review the new Up Next lineup before sending it.");
    return;
  }

  state.upNextMatches.splice(matchIndex, 1);
  assignPlayersToCourt(court, nextIds);
  showNotice(`Up Next was sent to Court ${state.courts.indexOf(court) + 1}.`);
}

function sendUpNext(matchIndex = 0) {
  const amount = state.format === "singles" ? 2 : 4;
  if (state.upNextMatches[matchIndex]?.length !== amount) return;
  const court = getUpNextCourt(matchIndex);
  if (!court) return;
  sendUpNextToCourt(court.id, matchIndex);
}

function openEditDialog(player) {
  document.querySelector("#edit-player-id").value = player.id;
  document.querySelector("#edit-player-name").value = player.name;
  editDialog.showModal();
  document.querySelector("#edit-player-name").focus();
}

function removePlayer(playerId) {
  state.players = state.players.filter((player) => player.id !== playerId);
  state.courts.forEach((court) => {
    if (court.playerIds.includes(playerId)) {
      court.playerIds = [];
      court.winner = null;
      court.matchId = null;
    }
  });
  saveState();
  render();
}

function ensureCourtTimers() {
  const amount = state.format === "singles" ? 2 : 4;
  const now = Date.now();
  let changed = false;
  state.courts.forEach((court) => {
    const occupied = state.sessionStarted && court.playerIds.length === amount;
    if (occupied && !court.startedAt) {
      court.startedAt = now;
      changed = true;
    } else if (!occupied && court.startedAt !== null) {
      court.startedAt = null;
      changed = true;
    }
  });
  return changed;
}

function render() {
  const timersChanged = ensureCourtTimers();
  const upNextChanged = ensureUpNext();
  if (timersChanged || upNextChanged) saveState();
  renderPlayers();
  renderUpNext();
  renderCourts();
  renderMatchLog();
  renderResults(document.querySelector("#summary-results-list"));
  renderSummaryMatchLog();
  document.querySelector("#match-log-score-heading").hidden = !state.recordScores;
  document.querySelector("#summary-score-heading").hidden = !state.recordScores;
  document.querySelector("#record-score").checked = state.recordScores;
  document.querySelector("#workspace").dataset.recordScores = String(state.recordScores);
  document.querySelector("#existing-session").disabled = state.savedRoster.length === 0;
  document.querySelector("#summary-same-players").disabled = state.savedRoster.length === 0;
}

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
});

document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
applyTheme(getPreferredTheme());
document.querySelector("#session-menu").addEventListener("click", () => {
  confirmAction(
    "End session?",
    state.sessionStarted
      ? "View your results and match log. Your player roster will be saved for a future session."
      : "This setup will close and its session summary will be shown.",
    endSession,
    "End session"
  );
});
document.querySelector("#rebuild-all-up-next").addEventListener("click", () => {
  buildUpNext(true);
  saveState();
  render();
});
document.querySelector("#add-up-next-match").addEventListener("click", addUpNextMatch);
document.querySelector("#show-results").addEventListener("click", () => {
  renderResults();
  resultsDialog.showModal();
});
document.querySelector("#close-results").addEventListener("click", () => resultsDialog.close());
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  setStage("home");
});
document.querySelector("#new-session").addEventListener("click", () => prepareSession(false));
document.querySelector("#resume-session").addEventListener("click", () => {
  setStage(state.sessionStarted ? "game" : state.setupInProgress ? "setup" : "summary");
});
document.querySelector("#existing-session").addEventListener("click", () => prepareSession(true));
document.querySelector("#summary-new-session").addEventListener("click", () => prepareSession(false));
document.querySelector("#summary-same-players").addEventListener("click", () => prepareSession(true));
document.querySelector("#start-game").addEventListener("click", startGame);
document.querySelector("#record-score").addEventListener("change", (event) => {
  state.recordScores = event.target.checked;
  saveState();
  render();
});

document.querySelector("#add-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#player-name");
  const name = input.value.trim();
  if (!name) return;
  if (state.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showNotice(`${name} is already on the player list.`);
    input.focus();
    return;
  }
  state.players.push({ id: makeId(), name, wins: 0, losses: 0, gamesPlayed: 0 });
  input.value = "";
  document.querySelector("#setup-error").textContent = "";
  showNotice("");
  saveState();
  render();
  input.focus();
});

document.querySelector("#edit-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = document.querySelector("#edit-player-id").value;
  const name = document.querySelector("#edit-player-name").value.trim();
  const player = playerById(id);
  if (!player || !name) return;
  if (state.players.some((other) => other.id !== id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showNotice(`${name} is already on the player list.`);
    return;
  }
  player.name = name;
  editDialog.close();
  saveState();
  render();
});

document.querySelector("#cancel-edit").addEventListener("click", () => editDialog.close());
document.querySelector("#replace-player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeReplacement) return;
  const replacementId = document.querySelector("#replacement-player").value;
  if (replaceCourtPlayer(activeReplacement.courtId, activeReplacement.playerId, replacementId)) replaceDialog.close();
});
document.querySelector("#random-replacement").addEventListener("click", () => {
  if (!activeReplacement) return;
  const available = availableReplacementPlayers();
  if (available.length === 0) return;
  const player = available[Math.floor(Math.random() * available.length)];
  if (replaceCourtPlayer(activeReplacement.courtId, activeReplacement.playerId, player.id)) replaceDialog.close();
});
document.querySelector("#close-replace").addEventListener("click", () => replaceDialog.close());
replaceDialog.addEventListener("close", () => { activeReplacement = null; });
document.querySelector("#choose-players-list").addEventListener("change", updateChoosePlayersSelection);
document.querySelector("#choose-players-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const court = state.courts.find((item) => item.id === choosingCourtId);
  const amount = state.format === "singles" ? 2 : 4;
  const selectedIds = [...document.querySelectorAll("#choose-players-list input:checked")].map((input) => input.value);
  const availableIds = new Set(availableReplacementPlayers().map((player) => player.id));
  if (!court || court.playerIds.length > 0 || selectedIds.length !== amount
    || new Set(selectedIds).size !== amount || !selectedIds.every((id) => availableIds.has(id))) return;
  choosePlayersDialog.close();
  assignPlayersToCourt(court, shuffle(selectedIds));
  showNotice(`Players were assigned to Court ${state.courts.indexOf(court) + 1}.`);
});
document.querySelector("#cancel-choose-players").addEventListener("click", () => choosePlayersDialog.close());
choosePlayersDialog.addEventListener("close", () => { choosingCourtId = null; });
document.querySelector("#change-up-next-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!changingUpNext) return;
  const replacementId = document.querySelector("#change-up-next-replacement").value;
  if (changeUpNextPlayer(changingUpNext.matchIndex, changingUpNext.currentId, replacementId)) changeUpNextDialog.close();
});
document.querySelector("#cancel-change-up-next").addEventListener("click", () => changeUpNextDialog.close());
changeUpNextDialog.addEventListener("close", () => { changingUpNext = null; });
document.querySelectorAll(".format-option").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.format === state.format) return;
    state.format = button.dataset.format;
    state.courts.forEach((court) => {
      court.playerIds = [];
      court.winner = null;
      court.matchId = null;
    });
    showNotice("Format changed. Randomize to create new matchups.");
    saveState();
    render();
  });
});
document.querySelector("#add-court").addEventListener("click", () => {
  state.courts.push(createCourt());
  saveState();
  render();
});
document.querySelector("#remove-court").addEventListener("click", () => {
  if (state.courts.length <= 1) return;
  state.courts.pop();
  saveState();
  render();
});
document.querySelector("#match-search").addEventListener("input", renderMatchLog);
document.querySelector("#accept-confirm").addEventListener("click", () => {
  const action = pendingConfirmation;
  pendingConfirmation = null;
  confirmDialog.close();
  action?.();
});
document.querySelector("#cancel-confirm").addEventListener("click", () => confirmDialog.close());
confirmDialog.addEventListener("close", () => { pendingConfirmation = null; });
document.querySelector("#record-match-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveMatchResult();
});
document.querySelector("#record-swap").addEventListener("click", () => {
  if (!activeRecord) return;
  activeRecord.winner = activeRecord.winner === "team-a" ? "team-b" : "team-a";
  renderRecordDialog();
});
document.querySelector("#close-record").addEventListener("click", () => recordDialog.close());
document.querySelector("#cancel-record").addEventListener("click", () => recordDialog.close());
recordDialog.addEventListener("close", () => { activeRecord = null; });

document.querySelector("#session-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", year: "numeric"
}).format(new Date());

render();
setStage(state.sessionStarted ? "game" : state.setupInProgress ? "setup" : state.sessionEnded ? "summary" : "home");
window.setInterval(refreshCourtTimers, 1000);
