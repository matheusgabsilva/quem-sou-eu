import { state } from "./state.js";
import { sound } from "./audio.js";
import { renderCurrentScreen, updateTimerUI, showToast, triggerConfetti } from "./ui-render.js";
import { appendChatMessage } from "./chat.js";

export function initSocket() {
  const socket = io();
  state.socket = socket;

  socket.on("connect", () => {
    state.myId = socket.id;
  });

  // Atualização geral de estado da sala
  socket.on("room_state_update", (roomData) => {
    const previousState = state.room?.state;
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
      // Se acabou de virar o turno ou começar
      if (previousState === "lobby" || previousState === "word_suggestion" || previousState === "turn_celebration") {
        sound.playTurnChange();
      }
    } else if (roomData.state === "game_over") {
      state.currentScreen = "podium";
      sound.playGameOver();
      triggerConfetti();
    }

    renderCurrentScreen();
  });

  // Tick do temporizador em tempo real (60 FPS / 1s suave)
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

  // Feedback exclusivo para palpites próximos ou alertas
  socket.on("guess_feedback", (feedback) => {
    showToast(feedback.message, feedback.type === "close" ? "warning" : "error");
  });

  // Evento especial de comemoração de acerto
  socket.on("guess_result", (result) => {
    if (result.correct) {
      sound.playSuccess();
      triggerConfetti();
      showToast(`🎉 ${result.guesserName} acertou "${result.word}"! (+${result.earnedPoints} pts)`, "success");
    }
  });

  socket.on("disconnect", () => {
    showToast("Desconectado do servidor. Tentando reconectar...", "error");
  });
}
