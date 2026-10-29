import { state } from "./state.js";
import { sound } from "./audio.js";
import { renderCurrentScreen, updateTimerUI, showToast, triggerConfetti } from "./ui-render.js";
import { appendChatMessage } from "./chat.js";

export function initSocket() {
  if (typeof io === "undefined") {
    console.warn("Aguardando carregamento da biblioteca Socket.io...");
    setTimeout(initSocket, 500);
    return;
  }

  // URL do backend: usa a mesma origem ou URL configurada
  const urlParams = new URLSearchParams(window.location.search);
  const customBackend = urlParams.get("backend") || localStorage.getItem("qse_backend_url");
  const backendUrl = customBackend || window.location.origin;

  const socket = io(backendUrl, {
    transports: ["websocket", "polling"],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000
  });

  state.socket = socket;

  socket.on("connect", () => {
    state.myId = socket.id;
    console.log("✓ Conectado ao servidor WebSocket via:", backendUrl);
  });

  socket.on("connect_error", (err) => {
    console.warn("Aviso de conexão com o backend WebSocket:", err.message);
  });

  // Atualização geral de estado da sala
  socket.on("room_state_update", (roomData) => {
    const previousState = state.room?.state;
    const previousActiveId = state.room?.activePlayerId;
    state.room = roomData;
    state.roomCode = roomData.code;

    // Detecta mudança de tela com base no estado da sala
    if (roomData.state === "lobby") {
      state.currentScreen = "lobby";
    } else if (roomData.state === "word_suggestion") {
      state.currentScreen = "word_suggestion";
      if (previousState !== "word_suggestion") {
        sound.playTurnChange();
      }
    } else if (roomData.state === "playing" || roomData.state === "turn_celebration") {
      state.currentScreen = "game";
      // Som de troca de turno suave apenas quando o jogador ativo muda
      if (
        previousState === "lobby" ||
        previousState === "word_suggestion" ||
        (previousActiveId && previousActiveId !== roomData.activePlayerId && roomData.state === "playing")
      ) {
        sound.playTurnChange();
      }
    } else if (roomData.state === "game_over") {
      state.currentScreen = "podium";
      sound.playGameOver();
      triggerConfetti();
    }

    renderCurrentScreen();
  });

  // Tick do temporizador em tempo real
  socket.on("timer_tick", (data) => {
    updateTimerUI(data.secondsRemaining, data.totalSeconds);
    if (data.secondsRemaining <= 5 && data.secondsRemaining > 0) {
      sound.playWarning();
    }
  });

  // Novas mensagens no chat
  socket.on("new_chat_message", (msg) => {
    appendChatMessage(msg);
  });

  // Feedback exclusivo para alertas e validações de turno
  socket.on("guess_feedback", (feedback) => {
    showToast(feedback.message, feedback.type === "close" ? "warning" : "error");
  });

  // Evento de resultado do palpite (acerto ou erro que encerra o turno)
  socket.on("guess_result", (result) => {
    if (result.correct) {
      sound.playSuccess();
      triggerConfetti();
      showToast(`🎉 ${result.guesserName} acertou "${result.word}"! (+${result.earnedPoints} pts)`, "success");
    } else {
      showToast(`❌ ${result.guesserName} errou o palpite! A palavra era "${result.word}".`, "error");
    }
  });

  socket.on("disconnect", () => {
    console.warn("Desconectado do servidor WebSocket.");
  });
}
