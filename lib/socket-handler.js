import { GameManager } from "./game-manager.js";

export function setupSocketHandlers(io) {
  const gameManager = new GameManager(io);

  io.on("connection", (socket) => {
    // 1. Criar uma nova sala (Host) com validação e suporte a avatar escolhido
    socket.on("create_room", ({ name, avatar, settings }, callback) => {
      try {
        const room = gameManager.createRoom(socket.id, name, settings, avatar);
        socket.join(room.code);
        const playerState = gameManager.getRoomStateForPlayer(room, socket.id);
        if (typeof callback === "function") {
          callback({ success: true, code: room.code, room: playerState });
        }
      } catch (err) {
        console.error("Erro em create_room:", err);
        if (typeof callback === "function") {
          callback({ success: false, error: "Falha ao criar sala." });
        }
      }
    });

    // 2. Entrar em uma sala existente com validação e suporte a avatar escolhido
    socket.on("join_room", ({ code, name, avatar }, callback) => {
      try {
        const result = gameManager.joinRoom(code, socket.id, name, avatar);
        if (!result.success) {
          if (typeof callback === "function") {
            callback({ success: false, error: result.error });
          }
          return;
        }

        const room = result.room;
        socket.join(room.code);

        // Notifica a sala que um novo jogador entrou
        gameManager.addSystemMessage(room, `👋 ${name || "Novo jogador"} entrou na sala!`);
        gameManager.broadcastRoomState(room);

        const playerState = gameManager.getRoomStateForPlayer(room, socket.id);
        if (typeof callback === "function") {
          callback({ success: true, code: room.code, room: playerState });
        }
      } catch (err) {
        console.error("Erro em join_room:", err);
        if (typeof callback === "function") {
          callback({ success: false, error: "Falha ao entrar na sala." });
        }
      }
    });

    // 3. Atualizar configurações da sala (Host)
    socket.on("update_settings", ({ code, settings }, callback) => {
      const success = gameManager.updateSettings(code, socket.id, settings);
      if (typeof callback === "function") {
        callback({ success });
      }
    });

    // 4. Iniciar a partida / Fase de Sugestão de Palavras (Host)
    const handleStartGame = async ({ code }, callback) => {
      const result = await gameManager.startGame(code, socket.id);
      if (typeof callback === "function") {
        callback(result);
      }
    };
    socket.on("game:start", handleStartGame);
    socket.on("start_game", handleStartGame);

    // 5. Enviar palavra sugerida pelo jogador ('word:submit' e 'submit_word')
    const handleSubmitWord = async ({ code, word, category, hint }, callback) => {
      const result = await gameManager.submitWord(code, socket.id, { word, category, hint });
      if (typeof callback === "function") {
        callback(result);
      }
    };
    socket.on("word:submit", handleSubmitWord);
    socket.on("submit_word", handleSubmitWord);

    // 6. Distribuir palavras e iniciar rodada ('game:distribute' e 'distribute_words')
    const handleDistribute = async ({ code }, callback) => {
      const room = gameManager.rooms.get(code);
      if (!room) {
        if (typeof callback === "function") callback({ success: false, error: "Sala não encontrada" });
        return;
      }
      const result = await gameManager.distributeWords(room, socket.id);
      if (typeof callback === "function") {
        callback(result);
      }
    };
    socket.on("game:distribute", handleDistribute);
    socket.on("distribute_words", handleDistribute);

    // 7. Enviar mensagem no chat (pergunta do jogador da vez ou conversa/resposta de espectador)
    const handleChatMessage = ({ code, text }, callback) => {
      const result = gameManager.handleChatMessage(code, socket.id, text);
      if (typeof callback === "function") {
        callback({ success: !!result, result });
      }
    };
    socket.on("chat:message", handleChatMessage);
    socket.on("chat_message", handleChatMessage);

    // 8. Enviar palpite único do jogador ativo ('turn:guess' e 'guess_word')
    const handlePlayerGuess = ({ code, guess, text }, callback) => {
      const guessText = guess || text;
      const result = gameManager.handlePlayerGuess(code, socket.id, guessText);
      if (typeof callback === "function") {
        callback(result);
      }
    };
    socket.on("turn:guess", handlePlayerGuess);
    socket.on("guess_word", handlePlayerGuess);

    // 9. Resposta rápida (SIM / NÃO / TALVEZ)
    const handleQuickReaction = ({ code, reaction }) => {
      gameManager.handleQuickReaction(code, socket.id, reaction);
    };
    socket.on("quick:reaction", handleQuickReaction);
    socket.on("quick_reaction", handleQuickReaction);

    // 10. Passar a vez (jogador ativo ou host)
    const handleSkipTurn = ({ code }, callback) => {
      const success = gameManager.skipTurn(code, socket.id);
      if (typeof callback === "function") {
        callback({ success });
      }
    };
    socket.on("turn:skip", handleSkipTurn);
    socket.on("skip_turn", handleSkipTurn);

    // 11. Reiniciar jogo após término
    const handleRestartGame = async ({ code }, callback) => {
      const success = await gameManager.restartGame(code, socket.id);
      if (typeof callback === "function") {
        callback({ success });
      }
    };
    socket.on("game:restart", handleRestartGame);
    socket.on("restart_game", handleRestartGame);

    // 12. Sair da sala intencionalmente
    socket.on("leave_room", () => {
      gameManager.handleDisconnect(socket.id);
    });

    // 13. Desconexão
    socket.on("disconnect", () => {
      gameManager.handleDisconnect(socket.id);
    });
  });

  return gameManager;
}
