import { GameManager } from "./game-manager.js";

function readPayloadAndCallback(payload, callback) {
  const cb = typeof callback === "function"
    ? callback
    : typeof payload === "function"
      ? payload
      : null;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    if (cb) {
      cb({ success: false, error: "Dados inválidos para esta ação." });
    }
    return null;
  }

  return { data: payload, cb };
}

export function setupSocketHandlers(io) {
  const gameManager = new GameManager(io);

  io.on("connection", (socket) => {
    // 1. Criar uma nova sala (Host) com validação e suporte a avatar escolhido
    socket.on("create_room", (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const { name, avatar, settings } = data;
        const room = gameManager.createRoom(socket.id, name, settings, avatar);
        socket.join(room.code);
        const playerState = gameManager.getRoomStateForPlayer(room, socket.id);
        if (cb) {
          cb({ success: true, code: room.code, room: playerState });
        }
      } catch (err) {
        console.error("Erro em create_room:", err);
        if (cb) {
          cb({ success: false, error: "Falha ao criar sala." });
        }
      }
    });

    // 2. Entrar em uma sala existente com validação e suporte a avatar escolhido
    socket.on("join_room", (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const { code, name, avatar } = data;
        const result = gameManager.joinRoom(code, socket.id, name, avatar);
        if (!result.success) {
          if (cb) {
            cb({ success: false, error: result.error });
          }
          return;
        }

        const room = result.room;
        socket.join(room.code);

        // Notifica a sala que um novo jogador entrou
        const displayName = typeof name === "string" && name.trim() ? name.trim() : "Novo jogador";
        gameManager.addSystemMessage(room, `👋 ${displayName} entrou na sala!`);
        gameManager.broadcastRoomState(room);

        const playerState = gameManager.getRoomStateForPlayer(room, socket.id);
        if (cb) {
          cb({ success: true, code: room.code, room: playerState });
        }
      } catch (err) {
        console.error("Erro em join_room:", err);
        if (cb) {
          cb({ success: false, error: "Falha ao entrar na sala." });
        }
      }
    });

    // 3. Atualizar configurações da sala (Host)
    socket.on("update_settings", (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const { code, settings } = data;
        const success = gameManager.updateSettings(code, socket.id, settings);
        if (cb) {
          cb({ success });
        }
      } catch (err) {
        console.error("Erro em update_settings:", err);
        if (cb) cb({ success: false });
      }
    });

    // 4. Iniciar a partida / Fase de Sugestão de Palavras (Host)
    const handleStartGame = async (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const result = await gameManager.startGame(data.code, socket.id);
        if (cb) {
          cb(result);
        }
      } catch (err) {
        console.error("Erro em start_game:", err);
        if (cb) cb({ success: false, error: "Falha ao iniciar a partida." });
      }
    };
    socket.on("game:start", handleStartGame);
    socket.on("start_game", handleStartGame);

    // 5. Enviar palavra sugerida pelo jogador ('word:submit' e 'submit_word')
    const handleSubmitWord = async (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const { code, word, category, hint } = data;
        const result = await gameManager.submitWord(code, socket.id, { word, category, hint });
        if (cb) {
          cb(result);
        }
      } catch (err) {
        console.error("Erro em submit_word:", err);
        if (cb) cb({ success: false, error: "Falha ao enviar palavra." });
      }
    };
    socket.on("word:submit", handleSubmitWord);
    socket.on("submit_word", handleSubmitWord);

    // 6. Distribuir palavras e iniciar rodada ('game:distribute' e 'distribute_words')
    const handleDistribute = async (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const room = gameManager.rooms.get(data.code);
        if (!room) {
          if (cb) cb({ success: false, error: "Sala não encontrada" });
          return;
        }
        const result = await gameManager.distributeWords(room, socket.id);
        if (cb) {
          cb(result);
        }
      } catch (err) {
        console.error("Erro em distribute_words:", err);
        if (cb) cb({ success: false, error: "Falha ao distribuir palavras." });
      }
    };
    socket.on("game:distribute", handleDistribute);
    socket.on("distribute_words", handleDistribute);

    // 7. Enviar mensagem no chat (pergunta do jogador da vez ou conversa/resposta de espectador)
    const handleChatMessage = (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const result = gameManager.handleChatMessage(data.code, socket.id, data.text);
        if (cb) {
          cb({ success: !!result, result });
        }
      } catch (err) {
        console.error("Erro em chat_message:", err);
        if (cb) cb({ success: false, result: null });
      }
    };
    socket.on("chat:message", handleChatMessage);
    socket.on("chat_message", handleChatMessage);

    // 8. Enviar palpite único do jogador ativo ('turn:guess' e 'guess_word')
    const handlePlayerGuess = (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const guessText = data.guess || data.text;
        const result = gameManager.handlePlayerGuess(data.code, socket.id, guessText);
        if (cb) {
          cb(result);
        }
      } catch (err) {
        console.error("Erro em turn:guess:", err);
        if (cb) cb({ success: false, error: "Falha ao processar palpite." });
      }
    };
    socket.on("turn:guess", handlePlayerGuess);
    socket.on("guess_word", handlePlayerGuess);

    // 9. Resposta rápida (SIM / NÃO / TALVEZ)
    const handleQuickReaction = (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const success = gameManager.handleQuickReaction(data.code, socket.id, data.reaction);
        if (cb) {
          cb({ success });
        }
      } catch (err) {
        console.error("Erro em quick_reaction:", err);
        if (cb) cb({ success: false });
      }
    };
    socket.on("quick:reaction", handleQuickReaction);
    socket.on("quick_reaction", handleQuickReaction);

    // 10. Passar a vez (apenas jogador ativo)
    const handleSkipTurn = (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const success = gameManager.skipTurn(data.code, socket.id);
        if (cb) {
          cb({ success });
        }
      } catch (err) {
        console.error("Erro em skip_turn:", err);
        if (cb) cb({ success: false });
      }
    };
    socket.on("turn:skip", handleSkipTurn);
    socket.on("skip_turn", handleSkipTurn);

    // 11. Reiniciar jogo após término
    const handleRestartGame = async (payload, callback) => {
      const parsed = readPayloadAndCallback(payload, callback);
      if (!parsed) return;
      const { data, cb } = parsed;
      try {
        const success = await gameManager.restartGame(data.code, socket.id);
        if (cb) {
          cb({ success });
        }
      } catch (err) {
        console.error("Erro em restart_game:", err);
        if (cb) cb({ success: false });
      }
    };
    socket.on("game:restart", handleRestartGame);
    socket.on("restart_game", handleRestartGame);

    // 12. Sair da sala intencionalmente
    socket.on("leave_room", () => {
      try {
        gameManager.handleDisconnect(socket.id);
      } catch (err) {
        console.error("Erro em leave_room:", err);
      }
    });

    // 13. Desconexão
    socket.on("disconnect", () => {
      try {
        gameManager.handleDisconnect(socket.id);
      } catch (err) {
        console.error("Erro em disconnect:", err);
      }
    });
  });

  return gameManager;
}
