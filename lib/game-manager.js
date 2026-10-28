import { makeCode, evaluateGuess, containsSpoiler } from "./server-utils.js";
import { pickRandomWord, getAvailableCategories } from "./words.js";

const AVATARS = ["🦁", "🦊", "🐼", "🐸", "🦄", "🚀", "🎭", "🎩", "👑", "🍕", "🥑", "🎸", "🐱", "🐶", "🐵", "🐯"];

export class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRoomMap = new Map(); // socketId -> roomCode
  }

  // Cria uma nova sala com o Host
  createRoom(socketId, hostName, settings = {}) {
    let code = makeCode();
    while (this.rooms.has(code)) {
      code = makeCode();
    }

    const hostAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const room = {
      code,
      hostId: socketId,
      state: "lobby", // "lobby" | "word_suggestion" | "playing" | "turn_celebration" | "game_over"
      settings: {
        categories: settings.categories || ["celebridades", "desenhos", "animais", "objetos", "profissoes"],
        turnTime: Number(settings.turnTime) || 60,
        totalRounds: Number(settings.totalRounds) || 3
      },
      currentRound: 1,
      turnIndex: 0,
      activePlayerId: null,
      turnSecondsRemaining: 60,
      timerInterval: null,
      players: [
        {
          id: socketId,
          name: hostName || "Host",
          avatar: hostAvatar,
          score: 0,
          currentWord: null,
          submittedWord: null, // Palavra sugerida por este jogador para colocar na testa de outro
          hasGuessed: false,
          isHost: true
        }
      ],
      usedWords: new Set(),
      chatMessages: [],
      createdAt: Date.now()
    };

    this.rooms.set(code, room);
    this.playerRoomMap.set(socketId, code);
    return room;
  }

  // Adiciona um jogador a uma sala existente
  joinRoom(code, socketId, playerName) {
    const cleanCode = (code || "").trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return { success: false, error: "Sala não encontrada. Verifique o código informado." };
    }

    // Se já estiver no jogo e o jogador estiver reconectando
    const existingPlayer = room.players.find((p) => p.id === socketId);
    if (existingPlayer) {
      existingPlayer.name = playerName || existingPlayer.name;
      this.playerRoomMap.set(socketId, cleanCode);
      return { success: true, room };
    }

    // Escolhe avatar ainda não usado ou aleatório
    const usedAvatars = room.players.map((p) => p.avatar);
    const availableAvatars = AVATARS.filter((a) => !usedAvatars.includes(a));
    const avatar = availableAvatars.length > 0
      ? availableAvatars[Math.floor(Math.random() * availableAvatars.length)]
      : AVATARS[Math.floor(Math.random() * AVATARS.length)];

    const newPlayer = {
      id: socketId,
      name: (playerName || `Jogador ${room.players.length + 1}`).trim(),
      avatar,
      score: 0,
      currentWord: null,
      submittedWord: null,
      hasGuessed: false,
      isHost: room.players.length === 0
    };

    room.players.push(newPlayer);
    this.playerRoomMap.set(socketId, cleanCode);

    // Se entrou durante a fase de jogo, sorteia uma palavra para ele
    if (room.state === "playing") {
      pickRandomWord(room.settings.categories, room.usedWords).then((word) => {
        newPlayer.currentWord = word;
        this.broadcastRoomState(room);
      });
    }

    return { success: true, room };
  }

  // Remove um jogador quando ele sai ou desconecta
  handleDisconnect(socketId) {
    const code = this.playerRoomMap.get(socketId);
    if (!code) return null;

    this.playerRoomMap.delete(socketId);
    const room = this.rooms.get(code);
    if (!room) return null;

    const playerIndex = room.players.findIndex((p) => p.id === socketId);
    if (playerIndex === -1) return null;

    const disconnectedPlayer = room.players[playerIndex];
    room.players.splice(playerIndex, 1);

    // Se a sala ficou vazia, encerra o timer e exclui a sala
    if (room.players.length === 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      this.rooms.delete(code);
      return { code, deleted: true };
    }

    // Se o host saiu, transfere para o primeiro jogador restante
    if (room.hostId === socketId) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    // Se estávamos na fase de sugestão, verifica se agora todos os restantes já enviaram
    if (room.state === "word_suggestion") {
      const allSubmitted = room.players.every((p) => !!p.submittedWord);
      if (allSubmitted && room.players.length > 0) {
        this.distributeWords(room);
        return { code, room };
      }
    }

    // Se o jogador desconectado era o jogador da vez
    if (room.state === "playing" && room.activePlayerId === socketId) {
      this.addSystemMessage(room, `⚠️ O jogador da vez (${disconnectedPlayer.name}) saiu da sala. Passando o turno...`);
      if (room.timerInterval) clearInterval(room.timerInterval);
      this.advanceTurn(room, "player_left");
    } else {
      this.addSystemMessage(room, `👋 ${disconnectedPlayer.name} saiu da sala.`);
      this.broadcastRoomState(room);
    }

    return { code, room };
  }

  // Atualiza configurações da sala (somente Host)
  updateSettings(code, socketId, newSettings) {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== socketId) return false;

    if (newSettings.categories && Array.isArray(newSettings.categories)) {
      room.settings.categories = newSettings.categories;
    }
    if (newSettings.turnTime) {
      room.settings.turnTime = Math.max(30, Math.min(180, Number(newSettings.turnTime)));
    }
    if (newSettings.totalRounds) {
      room.settings.totalRounds = Math.max(1, Math.min(10, Number(newSettings.totalRounds)));
    }

    this.broadcastRoomState(room);
    return true;
  }

  // 1. FASE DE PREPARAÇÃO: O Host clica em Iniciar e o jogo entra em 'word_suggestion'
  async startGame(code, socketId) {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== socketId) {
      return { success: false, error: "Apenas o Host pode iniciar a partida." };
    }

    if (room.players.length < 1) {
      return { success: false, error: "São necessários jogadores na sala." };
    }

    room.currentRound = 1;
    room.turnIndex = 0;
    room.usedWords.clear();
    room.chatMessages = [];

    // Zera pontuações e limpa palavras submetidas
    for (const player of room.players) {
      player.score = 0;
      player.currentWord = null;
      player.submittedWord = null;
      player.hasGuessed = false;
    }

    // Transiciona para a Fase de Sugestão de Palavras
    room.state = "word_suggestion";

    this.addSystemMessage(
      room,
      `💡 Fase de Sugestão de Palavras iniciada! Cada jogador deve escrever uma palavra secreta para a testa de um amigo.`
    );

    this.broadcastRoomState(room);
    return { success: true, state: "word_suggestion" };
  }

  // Inicia nova fase de sugestão ao iniciar uma nova rodada
  startWordSuggestionPhase(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);

    room.state = "word_suggestion";
    for (const player of room.players) {
      player.currentWord = null;
      player.submittedWord = null;
      player.hasGuessed = false;
    }

    this.addSystemMessage(
      room,
      `💡 Rodada ${room.currentRound}: Escreva uma nova palavra secreta para colocar na testa de um amigo!`
    );

    this.broadcastRoomState(room);
  }

  // 2. ENVIAR PALAVRA SUGERIDA PELO JOGADOR
  async submitWord(code, socketId, { word, category, hint }) {
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: "Sala não encontrada." };

    if (room.state !== "word_suggestion") {
      return { success: false, error: "Não estamos na fase de sugestão de palavras." };
    }

    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { success: false, error: "Jogador não encontrado." };

    const cleanWord = (word || "").trim();
    if (!cleanWord || cleanWord.length < 2) {
      return { success: false, error: "Digite uma palavra secreta válida (mínimo 2 letras)." };
    }

    // Armazena a palavra sugerida pelo jogador
    player.submittedWord = {
      palavra: cleanWord,
      categoriaNome: (category || "Geral").trim(),
      dica: (hint || "").trim(),
      authorId: player.id,
      authorName: player.name
    };

    this.addSystemMessage(room, `✍️ ${player.name} enviou sua palavra secreta.`);

    // Verifica se todos os jogadores na sala já enviaram suas palavras
    const allSubmitted = room.players.every((p) => !!p.submittedWord);

    if (allSubmitted && room.players.length > 0) {
      // Sorteia e distribui garantindo a Regra de Ouro (Derangement)
      await this.distributeWords(room);
      return { success: true, allSubmitted: true, state: "playing" };
    }

    this.broadcastRoomState(room);
    return { success: true, allSubmitted: false };
  }

  // 3. LÓGICA DE SORTEIO E DISTRIBUIÇÃO (DESARRANJO / DERANGEMENT PROGRAMÁTICO)
  // Regra de Ouro: NENHUM jogador recebe a própria palavra que ele mesmo escreveu!
  async distributeWords(room, requesterId = null) {
    if (requesterId && requesterId !== room.hostId) {
      return { success: false, error: "Apenas o Host pode forçar a distribuição." };
    }

    // Preenche com palavras do JSON caso algum jogador não tenha enviado a tempo (se o Host forçar)
    for (const player of room.players) {
      if (!player.submittedWord) {
        const fallback = await pickRandomWord(room.settings.categories, room.usedWords);
        player.submittedWord = {
          palavra: fallback.palavra,
          categoriaNome: fallback.categoriaNome || "Geral",
          dica: fallback.dica || "Palavra surpresa!",
          authorId: "system",
          authorName: "Sistema"
        };
      }
    }

    const n = room.players.length;

    if (n >= 2) {
      // ALGORITMO DE DESARRANJO MATEMÁTICO GARANTIDO (Fisher-Yates Shuffle + Permutação Cíclica)
      // Cria uma permutação aleatória dos índices dos jogadores
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Ciclo: Jogador em indices[k] recebe a palavra do jogador em indices[(k - 1 + n) % n]
      // Como (k - 1 + n) % n !== k para qualquer n >= 2,
      // É 100% GARANTIDO que nenhum jogador receberá a palavra de sua própria autoria!
      for (let k = 0; k < n; k++) {
        const receiverIndex = indices[k];
        const giverIndex = indices[(k - 1 + n) % n];

        const receiver = room.players[receiverIndex];
        const giver = room.players[giverIndex];

        receiver.currentWord = {
          palavra: giver.submittedWord.palavra,
          categoriaNome: giver.submittedWord.categoriaNome || "Geral",
          dica: giver.submittedWord.dica || `Sugerido por ${giver.name}`,
          authorId: giver.id,
          authorName: giver.name
        };
        receiver.hasGuessed = false;
      }
    } else if (n === 1) {
      // Caso de teste individual (1 jogador na sala)
      const soloPlayer = room.players[0];
      const fallback = await pickRandomWord(room.settings.categories, room.usedWords);
      soloPlayer.currentWord = fallback;
      soloPlayer.hasGuessed = false;
    }

    // Início da Partida / Rodada com as palavras distribuídas
    room.state = "playing";
    room.turnIndex = 0;

    this.addSystemMessage(
      room,
      `🎭 Todas as palavras secretas foram distribuídas! Cada jogador recebeu a palavra de outro participante. A rodada começou!`
    );

    // Inicia o primeiro turno
    this.startTurn(room);
    return { success: true };
  }

  // Inicia o turno do jogador atual
  startTurn(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);

    if (room.turnIndex >= room.players.length) {
      room.turnIndex = 0;
    }

    const activePlayer = room.players[room.turnIndex];
    if (!activePlayer) return;

    room.state = "playing";
    room.activePlayerId = activePlayer.id;
    room.turnSecondsRemaining = room.settings.turnTime;

    this.addSystemMessage(
      room,
      `🎯 É a vez de ${activePlayer.name}! Faça perguntas no chat ou tente adivinhar quem você é!`
    );

    this.broadcastRoomState(room);

    // Timer do turno sincronizado pelo servidor
    room.timerInterval = setInterval(() => {
      room.turnSecondsRemaining -= 1;

      this.io.to(room.code).emit("timer_tick", {
        secondsRemaining: room.turnSecondsRemaining,
        totalSeconds: room.settings.turnTime
      });

      if (room.turnSecondsRemaining <= 0) {
        clearInterval(room.timerInterval);
        this.handleTimeExpired(room);
      }
    }, 1000);
  }

  // Tratamento de tempo esgotado no turno
  handleTimeExpired(room) {
    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
    const wordRevealed = activePlayer?.currentWord?.palavra || "Desconhecido";

    this.addSystemMessage(
      room,
      `⏰ O tempo acabou! ${activePlayer?.name || "O jogador"} não adivinhou a tempo. A palavra secreta era: "${wordRevealed}".`,
      "timeout"
    );

    room.state = "turn_celebration";
    this.broadcastRoomState(room, { wordRevealed });

    setTimeout(() => {
      this.advanceTurn(room, "time_expired");
    }, 4000);
  }

  // Avança para o próximo jogador ou para a próxima rodada
  async advanceTurn(room, reason = "normal") {
    if (room.timerInterval) clearInterval(room.timerInterval);

    room.turnIndex += 1;

    // Se todos os jogadores da rodada já jogaram
    if (room.turnIndex >= room.players.length) {
      room.turnIndex = 0;
      room.currentRound += 1;

      // Se todas as rodadas foram concluídas -> FIM DE JOGO
      if (room.currentRound > room.settings.totalRounds) {
        this.endGame(room);
        return;
      }

      this.addSystemMessage(
        room,
        `🔔 Fim da Rodada ${room.currentRound - 1}! Preparando a Rodada ${room.currentRound} de ${room.settings.totalRounds}...`,
        "round_end"
      );

      // Nova rodada: nova fase de sugestão de palavras para renovar o desafio!
      this.startWordSuggestionPhase(room);
      return;
    }

    // Inicia o próximo turno
    this.startTurn(room);
  }

  // Finaliza a partida e exibe o pódio
  endGame(room) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.state = "game_over";

    const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
    const winner = sortedPlayers[0];

    this.addSystemMessage(
      room,
      `🏆 FIM DE JOGO! O grande vencedor foi ${winner?.name || "Jogador"} com ${winner?.score || 0} pontos! Parabéns a todos!`,
      "game_over"
    );

    this.broadcastRoomState(room, {
      podium: sortedPlayers.map((p, index) => ({
        rank: index + 1,
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score
      }))
    });
  }

  // Reinicia a partida
  async restartGame(code, socketId) {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== socketId) return false;
    return await this.startGame(code, socketId);
  }

  // Passa a vez manualmente
  skipTurn(code, socketId) {
    const room = this.rooms.get(code);
    if (!room || room.state !== "playing") return false;

    if (socketId !== room.hostId && socketId !== room.activePlayerId) {
      return false;
    }

    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
    const wordRevealed = activePlayer?.currentWord?.palavra || "";

    this.addSystemMessage(
      room,
      `⏭️ ${activePlayer?.name || "Jogador"} passou a vez. A palavra era: "${wordRevealed}".`,
      "skip"
    );

    if (room.timerInterval) clearInterval(room.timerInterval);
    room.state = "turn_celebration";
    this.broadcastRoomState(room, { wordRevealed });

    setTimeout(() => {
      this.advanceTurn(room, "skipped");
    }, 3500);

    return true;
  }

  // Processa mensagens no chat e valida palpites
  handleChatMessage(code, socketId, messageText) {
    const room = this.rooms.get(code);
    if (!room) return null;

    const sender = room.players.find((p) => p.id === socketId);
    if (!sender) return null;

    const text = (messageText || "").trim();
    if (!text) return null;

    const isActivePlayer = room.state === "playing" && room.activePlayerId === socketId;
    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);

    // 1. SE FOR O JOGADOR DA VEZ: Avalia se é um palpite da sua palavra secreta
    if (isActivePlayer && activePlayer?.currentWord?.palavra) {
      const evaluation = evaluateGuess(text, activePlayer.currentWord.palavra);

      // ACERTOU!
      if (evaluation.isCorrect) {
        if (room.timerInterval) clearInterval(room.timerInterval);

        const timeRatio = Math.max(0, room.turnSecondsRemaining / room.settings.turnTime);
        const earnedPoints = 100 + Math.round(timeRatio * 100);
        sender.score += earnedPoints;
        sender.hasGuessed = true;

        const guessedWord = activePlayer.currentWord.palavra;

        this.addSystemMessage(
          room,
          `🎉 BINGO! ${sender.name} ACERTOU a palavra secreta: "${guessedWord}"! (+${earnedPoints} pontos)`,
          "correct_guess"
        );

        room.state = "turn_celebration";

        this.io.to(room.code).emit("guess_result", {
          correct: true,
          guesserId: sender.id,
          guesserName: sender.name,
          word: guessedWord,
          earnedPoints,
          totalScore: sender.score
        });

        this.broadcastRoomState(room, { wordRevealed: guessedWord });

        setTimeout(() => {
          this.advanceTurn(room, "guessed_correctly");
        }, 4000);

        return { type: "correct", earnedPoints };
      }

      // QUASE LÁ!
      if (evaluation.isClose) {
        const chatEntry = {
          id: Math.random().toString(36).substring(2, 9),
          senderId: sender.id,
          senderName: sender.name,
          avatar: sender.avatar,
          text,
          type: "guess",
          timestamp: Date.now()
        };
        room.chatMessages.push(chatEntry);
        this.io.to(room.code).emit("new_chat_message", chatEntry);

        this.io.to(sender.id).emit("guess_feedback", {
          message: "🔥 Você está muito perto!",
          type: "close"
        });

        return { type: "close" };
      }
    }

    // 2. SE FOR OUTRO JOGADOR: Proteção Anti-Spoiler
    if (room.state === "playing" && !isActivePlayer && activePlayer?.currentWord?.palavra) {
      if (containsSpoiler(text, activePlayer.currentWord.palavra)) {
        this.io.to(sender.id).emit("guess_feedback", {
          message: "⚠️ Cuidado! Não diga a palavra secreta diretamente no chat!",
          type: "warning"
        });

        const safeText = "[Mensagem oculta para não dar spoiler!]";
        const baseMsg = {
          id: Math.random().toString(36).substring(2, 9),
          senderId: sender.id,
          senderName: sender.name,
          avatar: sender.avatar,
          timestamp: Date.now()
        };

        for (const player of room.players) {
          if (player.id === room.activePlayerId) {
            this.io.to(player.id).emit("new_chat_message", {
              ...baseMsg,
              text: safeText,
              type: "censored"
            });
          } else {
            this.io.to(player.id).emit("new_chat_message", {
              ...baseMsg,
              text,
              type: "chat"
            });
          }
        }
        return { type: "spoiler_blocked" };
      }
    }

    // 3. MENSAGEM NORMAL OU PERGUNTA
    const chatEntry = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: sender.id,
      senderName: sender.name,
      avatar: sender.avatar,
      text,
      type: isActivePlayer ? "guess" : "chat",
      timestamp: Date.now()
    };

    room.chatMessages.push(chatEntry);
    if (room.chatMessages.length > 100) room.chatMessages.shift();

    this.io.to(room.code).emit("new_chat_message", chatEntry);
    return { type: "chat", chatEntry };
  }

  // Resposta rápida com 1 toque (SIM, NÃO, TALVEZ)
  handleQuickReaction(code, socketId, reaction) {
    const room = this.rooms.get(code);
    if (!room || room.state !== "playing") return;

    const sender = room.players.find((p) => p.id === socketId);
    if (!sender || socketId === room.activePlayerId) return;

    const validReactions = {
      yes: { text: "👍 SIM!", label: "SIM", color: "green" },
      no: { text: "👎 NÃO!", label: "NÃO", color: "red" },
      maybe: { text: "🤔 TALVEZ / ÀS VEZES", label: "TALVEZ", color: "yellow" }
    };

    const reactionData = validReactions[reaction];
    if (!reactionData) return;

    const chatEntry = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: sender.id,
      senderName: sender.name,
      avatar: sender.avatar,
      text: reactionData.text,
      type: "quick_reaction",
      reactionType: reaction,
      timestamp: Date.now()
    };

    room.chatMessages.push(chatEntry);
    this.io.to(room.code).emit("new_chat_message", chatEntry);
  }

  // Adiciona mensagem do sistema ao chat
  addSystemMessage(room, text, subtype = "info") {
    const msg = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: "system",
      senderName: "Sistema",
      avatar: "🤖",
      text,
      type: "system",
      subtype,
      timestamp: Date.now()
    };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    this.io.to(room.code).emit("new_chat_message", msg);
  }

  // GERAÇÃO DO SNAPSHOT DE ESTADO PERSONALIZADO PARA CADA JOGADOR
  // REGRA DE OURO:
  // 1. Na fase de jogo, o jogador da vez NUNCA recebe sua própria palavra no payload!
  // 2. Na fase de sugestão, ninguém recebe a palavra escrita pelos outros!
  getRoomStateForPlayer(room, socketId, extraData = {}) {
    const myPlayer = room.players.find((p) => p.id === socketId);

    const safePlayers = room.players.map((p) => {
      const isMe = p.id === socketId;

      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        isHost: p.isHost,
        hasGuessed: p.hasGuessed,
        // Informa se este jogador já enviou sua sugestão de palavra
        hasSubmittedWord: !!p.submittedWord,
        // Palavra na testa:
        currentWord: isMe
          ? p.currentWord
            ? {
                palavra: extraData.wordRevealed && room.state === "turn_celebration" ? p.currentWord.palavra : "???",
                categoriaNome: p.currentWord.categoriaNome || "Geral",
                dica: "Faça perguntas aos outros jogadores no chat!"
              }
            : null
          : p.currentWord
      };
    });

    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);

    // Contagem de submissões na fase de sugestão
    const submittedCount = room.players.filter((p) => !!p.submittedWord).length;
    const totalPlayers = room.players.length;

    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      currentRound: room.currentRound,
      turnIndex: room.turnIndex,
      activePlayerId: room.activePlayerId,
      activePlayerName: activePlayer ? activePlayer.name : "",
      activePlayerAvatar: activePlayer ? activePlayer.avatar : "",
      turnSecondsRemaining: room.turnSecondsRemaining,
      players: safePlayers,
      isMyTurn: room.activePlayerId === socketId,
      // Dados específicos da fase de sugestão
      mySubmittedWord: myPlayer?.submittedWord ? myPlayer.submittedWord.palavra : null,
      hasSubmittedMyWord: !!myPlayer?.submittedWord,
      submittedCount,
      totalPlayers,
      ...extraData
    };
  }

  // Transmite o estado da sala para cada jogador conectado individualmente de forma segura
  broadcastRoomState(room, extraData = {}) {
    for (const player of room.players) {
      const socket = this.io.sockets.sockets.get(player.id);
      if (socket) {
        socket.emit("room_state_update", this.getRoomStateForPlayer(room, player.id, extraData));
      }
    }
  }
}
