import { makeCode, evaluateGuess, containsSpoiler, parseQuickResponseText } from "./server-utils.js";
import { pickRandomWord, getAvailableCategories } from "./words.js";

export const AVATARS = ["🦁", "🦊", "🐼", "🐸", "🦄", "🚀", "🎭", "🎩", "👑", "🍕", "🥑", "🎸", "🐱", "🐶", "🐵", "🐯"];

export class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRoomMap = new Map(); // socketId -> roomCode
  }

  // Cria uma nova sala com o Host
  createRoom(socketId, hostName, settings = {}, requestedAvatar = null) {
    let code = makeCode();
    while (this.rooms.has(code)) {
      code = makeCode();
    }

    const hostAvatar = requestedAvatar && AVATARS.includes(requestedAvatar)
      ? requestedAvatar
      : AVATARS[Math.floor(Math.random() * AVATARS.length)];

    const safeSettings = settings && typeof settings === "object" ? settings : {};
    const safeHostName = typeof hostName === "string" && hostName.trim() ? hostName.trim() : "Host";

    const room = {
      code,
      hostId: socketId,
      state: "lobby", // "lobby" | "word_suggestion" | "playing" | "turn_celebration" | "game_over"
      settings: {
        categories: Array.isArray(safeSettings.categories) && safeSettings.categories.length > 0
          ? safeSettings.categories
          : ["celebridades", "desenhos", "animais", "objetos", "profissoes"],
        turnTime: Number(safeSettings.turnTime) || 60,
        totalRounds: Number(safeSettings.totalRounds) || 3
      },
      currentRound: 1,
      unresolvedQueue: [], // Fila de IDs de jogadores com palavras ainda não acertadas na rodada
      attemptNumber: 1, // Contador global de tentativas da rodada (inicia em 1)
      activePlayerId: null,
      turnPhase: "awaiting_question", // "awaiting_question" | "awaiting_responses" | "awaiting_guess_or_pass"
      currentQuestion: null,
      turnResponses: [],
      turnEnded: false,
      turnResult: null,
      turnSecondsRemaining: 60,
      timerInterval: null,
      transitionTimer: null,
      transitionToken: 0,
      turnSeq: 0, // Identificador sequencial da tentativa (turno) atual; incrementa a cada startTurn
      pendingTransition: null, // Transição que encerra a tentativa atual: { turnSeq, reason }. Consumida uma única vez por advanceTurn
      players: [
        {
          id: socketId,
          name: safeHostName,
          avatar: hostAvatar,
          score: 0,
          currentWord: null,
          submittedWord: null,
          hasGuessed: false,
          isHost: true,
          spectatingUntilNextRound: false
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
  joinRoom(code, socketId, playerName, requestedAvatar = null) {
    const cleanCode = String(code || "").trim().toUpperCase();
    const room = this.rooms.get(cleanCode);

    if (!room) {
      return { success: false, error: "Sala não encontrada. Verifique o código informado." };
    }

    const safePlayerName = typeof playerName === "string" ? playerName.trim() : "";

    // Se já estiver no jogo e o jogador estiver reconectando
    const existingPlayer = room.players.find((p) => p.id === socketId);
    if (existingPlayer) {
      existingPlayer.name = safePlayerName || existingPlayer.name;
      if (requestedAvatar && AVATARS.includes(requestedAvatar)) {
        existingPlayer.avatar = requestedAvatar;
      }
      this.playerRoomMap.set(socketId, cleanCode);
      return { success: true, room };
    }

    // Valida e atribui o avatar escolhido ou fallback
    let avatar = null;
    if (requestedAvatar && AVATARS.includes(requestedAvatar)) {
      avatar = requestedAvatar;
    } else {
      const usedAvatars = room.players.map((p) => p.avatar);
      const availableAvatars = AVATARS.filter((a) => !usedAvatars.includes(a));
      avatar = availableAvatars.length > 0
        ? availableAvatars[Math.floor(Math.random() * availableAvatars.length)]
        : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    }

    // Se entrou com a partida em andamento, entra como espectador até a próxima rodada
    const isMidRound = room.state === "playing" || room.state === "turn_celebration";

    const newPlayer = {
      id: socketId,
      name: safePlayerName || `Jogador ${room.players.length + 1}`,
      avatar,
      score: 0,
      currentWord: null,
      submittedWord: null,
      hasGuessed: false,
      isHost: room.players.length === 0,
      spectatingUntilNextRound: isMidRound
    };

    room.players.push(newPlayer);
    this.playerRoomMap.set(socketId, cleanCode);

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

    // Remove o jogador da fila de palavras não resolvidas
    if (room.unresolvedQueue) {
      room.unresolvedQueue = room.unresolvedQueue.filter((id) => id !== socketId);
    }

    // Se a sala ficou vazia, encerra timers e exclui a sala
    if (room.players.length === 0) {
      this.clearRoomTimers(room);
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
    const wasActivePlayer = room.activePlayerId === socketId;
    if (wasActivePlayer && (room.state === "playing" || room.state === "turn_celebration")) {
      this.addSystemMessage(room, `⚠️ O jogador da vez (${disconnectedPlayer.name}) saiu da sala.`);
      this.clearRoomTimers(room);
      if (room.state === "playing" && !room.turnEnded) {
        room.turnEnded = true;
        room.attemptNumber = (room.attemptNumber || 1) + 1;
      }
      // A desconexão assume a transição da tentativa atual (se o callback agendado ainda não rodou).
      // O callback agendado foi invalidado por clearRoomTimers; apenas um dos dois avança a partida.
      const transition = this.openTransition(room, "player_left");
      this.advanceTurn(room, "player_left", transition.turnSeq);
    } else {
      this.addSystemMessage(room, `👋 ${disconnectedPlayer.name} saiu da sala.`);

      // Se a fila esvaziou após a saída do jogador, finaliza a rodada
      if (room.state === "playing" && room.unresolvedQueue.length === 0) {
        this.clearRoomTimers(room);
        room.turnEnded = true;
        const transition = this.openTransition(room, "queue_empty");
        this.advanceTurn(room, "queue_empty", transition.turnSeq);
      } else {
        // Se estava aguardando respostas e só sobrou o jogador ativo
        if (room.state === "playing" && room.turnPhase === "awaiting_responses") {
          const others = room.players.filter((p) => p.id !== room.activePlayerId);
          if (others.length === 0) {
            room.turnPhase = "awaiting_guess_or_pass";
          }
        }
        this.broadcastRoomState(room);
      }
    }

    return { code, room };
  }

  // Atualiza configurações da sala (somente Host)
  updateSettings(code, socketId, newSettings) {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== socketId || !newSettings || typeof newSettings !== "object") return false;

    if (newSettings.categories && Array.isArray(newSettings.categories) && newSettings.categories.length > 0) {
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

    this.clearRoomTimers(room);

    room.currentRound = 1;
    room.unresolvedQueue = [];
    room.attemptNumber = 1;
    room.usedWords.clear();
    room.chatMessages = [];

    // Zera pontuações e limpa palavras submetidas
    for (const player of room.players) {
      player.score = 0;
      player.currentWord = null;
      player.submittedWord = null;
      player.hasGuessed = false;
      player.spectatingUntilNextRound = false;
    }

    // Transiciona para a Fase de Sugestão de Palavras
    room.state = "word_suggestion";

    this.broadcastRoomState(room);
    return { success: true, state: "word_suggestion" };
  }

  // Inicia nova fase de sugestão ao iniciar uma nova rodada
  startWordSuggestionPhase(room) {
    this.clearRoomTimers(room);

    room.state = "word_suggestion";
    room.unresolvedQueue = [];
    room.attemptNumber = 1;

    for (const player of room.players) {
      player.currentWord = null;
      player.submittedWord = null;
      player.hasGuessed = false;
      player.spectatingUntilNextRound = false;
    }

    this.broadcastRoomState(room);
  }

  // 2. ENVIAR PALAVRA SUGERIDA PELO JOGADOR
  async submitWord(code, socketId, payload = {}) {
    const { word, category, hint } = payload && typeof payload === "object" ? payload : {};
    const room = this.rooms.get(code);
    if (!room) return { success: false, error: "Sala não encontrada." };

    if (room.state !== "word_suggestion") {
      return { success: false, error: "Não estamos na fase de sugestão de palavras." };
    }

    const player = room.players.find((p) => p.id === socketId);
    if (!player) return { success: false, error: "Jogador não encontrado." };

    const cleanWord = typeof word === "string" ? word.trim() : "";
    if (!cleanWord || cleanWord.length < 2) {
      return { success: false, error: "Digite uma palavra secreta válida (mínimo 2 letras)." };
    }

    const cleanCategory = typeof category === "string" && category.trim() ? category.trim() : "Geral";
    const cleanHint = typeof hint === "string" ? hint.trim() : "";

    // Armazena a palavra sugerida pelo jogador
    player.submittedWord = {
      palavra: cleanWord,
      categoriaNome: cleanCategory,
      dica: cleanHint,
      authorId: player.id,
      authorName: player.name
    };

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

    const eligiblePlayers = room.players.filter((p) => !p.spectatingUntilNextRound);

    // Preenche com palavras do JSON caso algum jogador não tenha enviado a tempo (se o Host forçar)
    for (const player of eligiblePlayers) {
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

    const n = eligiblePlayers.length;

    if (n >= 2) {
      // ALGORITMO DE DESARRANJO MATEMÁTICO GARANTIDO (Fisher-Yates Shuffle + Permutação Cíclica)
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Ciclo: Jogador em indices[k] recebe a palavra do jogador em indices[(k - 1 + n) % n]
      for (let k = 0; k < n; k++) {
        const receiverIndex = indices[k];
        const giverIndex = indices[(k - 1 + n) % n];

        const receiver = eligiblePlayers[receiverIndex];
        const giver = eligiblePlayers[giverIndex];

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
      const soloPlayer = eligiblePlayers[0];
      const fallback = await pickRandomWord(room.settings.categories, room.usedWords);
      soloPlayer.currentWord = fallback;
      soloPlayer.hasGuessed = false;
    }

    // Início da Partida / Rodada com as palavras distribuídas
    room.state = "playing";

    // Inicializa a fila de palavras não resolvidas com a ordem original dos participantes
    room.unresolvedQueue = eligiblePlayers.map((p) => p.id);
    room.attemptNumber = 1;

    // Inicia o primeiro turno da fila
    this.startTurn(room);
    return { success: true };
  }

  // Cancela timers de intervalo e de transição da sala.
  // Também invalida a transição pendente: quem precisar avançar depois de limpar os timers
  // deve registrar a transição novamente com openTransition (ver handleDisconnect).
  clearRoomTimers(room) {
    if (!room) return;
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    if (room.transitionTimer) {
      clearTimeout(room.transitionTimer);
      room.transitionTimer = null;
    }
    room.transitionToken = (room.transitionToken || 0) + 1;
    room.pendingTransition = null;
  }

  // Registra (de forma idempotente) a transição que encerra a tentativa atual.
  // Existe no máximo uma transição por tentativa, identificada por room.turnSeq.
  openTransition(room, reason) {
    if (!room) return null;
    if (!room.pendingTransition || room.pendingTransition.turnSeq !== room.turnSeq) {
      room.pendingTransition = { turnSeq: room.turnSeq, reason };
    }
    return room.pendingTransition;
  }

  // Agenda a transição de turno de forma segura e protegida contra race conditions
  scheduleTurnTransition(room, delayMs, reason) {
    if (!room) return;
    if (room.transitionTimer) {
      clearTimeout(room.transitionTimer);
      room.transitionTimer = null;
    }

    const transition = this.openTransition(room, reason);
    const transitionTurnSeq = transition.turnSeq;
    const token = (room.transitionToken || 0) + 1;
    room.transitionToken = token;
    const expectedRound = room.currentRound;
    const expectedActiveId = room.activePlayerId;

    const transitionCallback = () => {
      room.transitionTimer = null;
      room._executePendingTransition = null;
      const currentRoom = this.rooms.get(room.code);
      if (!currentRoom || currentRoom !== room) return false;
      if (room.transitionToken !== token) return false;
      if (room.currentRound !== expectedRound) return false;
      if (room.state !== "turn_celebration") return false;
      if (room.activePlayerId !== expectedActiveId) return false;

      // advanceTurn só avança se esta transição (turnSeq) ainda estiver pendente
      return this.advanceTurn(room, reason, transitionTurnSeq);
    };

    room._executePendingTransition = transitionCallback;
    room.transitionTimer = setTimeout(transitionCallback, delayMs);
  }


  // Inicia o turno do jogador que está na frente da fila de não resolvidos
  startTurn(room) {
    this.clearRoomTimers(room);

    // Remove eventuais IDs de jogadores desconectados
    room.unresolvedQueue = (room.unresolvedQueue || []).filter((id) =>
      room.players.some((p) => p.id === id)
    );

    // Se não há mais jogadores na fila, todos acertaram nesta rodada!
    if (room.unresolvedQueue.length === 0) {
      this.endRound(room);
      return;
    }

    const activePlayerId = room.unresolvedQueue[0];
    const activePlayer = room.players.find((p) => p.id === activePlayerId);

    if (!activePlayer) {
      room.unresolvedQueue.shift();
      return this.startTurn(room);
    }

    room.state = "playing";
    room.turnSeq = (room.turnSeq || 0) + 1; // Nova tentativa: nenhuma transição anterior é válida para ela
    room.pendingTransition = null;
    room.activePlayerId = activePlayer.id;
    room.turnPhase = "awaiting_question";
    room.currentQuestion = null;
    room.turnResponses = [];
    room.turnEnded = false;
    room.turnResult = null;
    room.turnSecondsRemaining = room.settings.turnTime;

    this.addSystemMessage(
      room,
      `🎯 É a vez de ${activePlayer.name}! (Tentativa ${room.attemptNumber})`
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
  // REQUISITO: O jogador volta para o final da fila com a MESMA palavra (a palavra NÃO é revelada)
  handleTimeExpired(room) {
    if (room.turnEnded) return;
    room.turnEnded = true;
    this.clearRoomTimers(room);

    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);

    // Move o jogador ativo do início para o final da fila de palavras não resolvidas
    if (room.unresolvedQueue.length > 0 && room.unresolvedQueue[0] === room.activePlayerId) {
      const timedOutId = room.unresolvedQueue.shift();
      room.unresolvedQueue.push(timedOutId);
    }

    // Incrementa o número global da tentativa da rodada
    room.attemptNumber += 1;

    this.addSystemMessage(
      room,
      `⏰ O tempo acabou para ${activePlayer?.name || "O jogador"}! Volta para o final da fila.`,
      "timeout"
    );

    room.state = "turn_celebration";
    room.turnResult = {
      outcome: "timeout",
      player: activePlayer?.name || "Jogador",
      avatar: activePlayer?.avatar || "👤"
    };

    this.broadcastRoomState(room, { turnResult: room.turnResult });

    this.scheduleTurnTransition(room, 3500, "time_expired");
  }

  // Passa a vez manualmente
  // REQUISITO: Apenas o jogador ativo pode passar a vez. O host NÃO pode passar por ele nem ignorar a pergunta.
  skipTurn(code, socketId) {
    const room = this.rooms.get(code);
    if (!room || room.state !== "playing") return false;

    // Apenas o jogador ativo da vez pode passar a vez
    if (socketId !== room.activePlayerId) {
      this.io.to(socketId).emit("guess_feedback", {
        message: "Apenas o jogador da vez pode passar a vez.",
        type: "warning"
      });
      return false;
    }

    if (room.turnEnded) {
      return false;
    }

    // Pergunta e resposta prévia são estritamente obrigatórias antes de passar a vez
    if (room.turnPhase !== "awaiting_guess_or_pass") {
      this.io.to(socketId).emit("guess_feedback", {
        message: "Você deve formular sua pergunta e aguardar resposta antes de passar a vez.",
        type: "warning"
      });
      return false;
    }

    room.turnEnded = true;
    this.clearRoomTimers(room);

    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);

    // Move o jogador do início para o final da fila de não resolvidos
    if (room.unresolvedQueue.length > 0 && room.unresolvedQueue[0] === room.activePlayerId) {
      const passedId = room.unresolvedQueue.shift();
      room.unresolvedQueue.push(passedId);
    }

    // Incrementa a tentativa global
    room.attemptNumber += 1;

    this.addSystemMessage(
      room,
      `⏭️ ${activePlayer?.name || "Jogador"} passou a vez e volta para o final da fila.`,
      "skip"
    );

    room.state = "turn_celebration";
    room.turnResult = {
      outcome: "skipped",
      player: activePlayer?.name || "Jogador",
      avatar: activePlayer?.avatar || "👤"
    };

    this.broadcastRoomState(room, { turnResult: room.turnResult });

    this.scheduleTurnTransition(room, 3500, "skipped");

    return true;
  }

  // Processa a tentativa única de palpite do jogador ativo
  handlePlayerGuess(code, socketId, guessText) {
    const room = this.rooms.get(code);
    if (!room || room.state !== "playing") {
      return { success: false, error: "Jogo não está em andamento." };
    }

    if (socketId !== room.activePlayerId) {
      return { success: false, error: "Apenas o jogador da vez pode palpitar." };
    }

    if (room.turnEnded) {
      return { success: false, error: "O turno já terminou." };
    }

    if (room.turnPhase !== "awaiting_guess_or_pass") {
      return { success: false, error: "Você precisa fazer uma pergunta e aguardar resposta antes de palpitar." };
    }

    const sender = room.players.find((p) => p.id === socketId);
    if (!sender) return { success: false, error: "Jogador não encontrado." };

    const text = typeof guessText === "string" ? guessText.trim() : "";
    if (!text) return { success: false, error: "Digite um palpite válido." };

    // Consome a tentativa única de palpite imediatamente
    room.turnEnded = true;
    this.clearRoomTimers(room);

    const activePlayer = sender;
    const secretWord = activePlayer.currentWord?.palavra || "";
    const evaluation = evaluateGuess(text, secretWord);

    // Registra a mensagem de palpite no chat para todos verem
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
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    this.io.to(room.code).emit("new_chat_message", chatEntry);

    // 1. PALPITE CORRETO!
    if (evaluation.isCorrect) {
      // Remove o jogador definitivamente da fila de palavras não resolvidas da rodada
      if (room.unresolvedQueue.length > 0 && room.unresolvedQueue[0] === room.activePlayerId) {
        room.unresolvedQueue.shift();
      }
      sender.hasGuessed = true;

      // FÓRMULA DE PONTUAÇÃO CONFORME ESPECIFICAÇÃO:
      // Base: Math.max(0, 110 - (turnoAtual * 10))
      const base = Math.max(0, 110 - (room.attemptNumber * 10));

      // Bônus: Math.round(100 * (tempoParaBonus / 60)), com divisor fixo de 60s
      const tempoParaBonus = Math.min(60, Math.max(0, room.turnSecondsRemaining));
      const bonus = Math.round(100 * (tempoParaBonus / 60));

      const earnedPoints = base + bonus;
      sender.score += earnedPoints;

      // Incrementa a tentativa global da rodada
      room.attemptNumber += 1;

      this.addSystemMessage(
        room,
        `🎉 BINGO! ${sender.name} ACERTOU a palavra secreta: "${secretWord}"! (${base} base + ${bonus} bônus = +${earnedPoints} pts)`,
        "correct_guess"
      );

      room.state = "turn_celebration";
      room.turnResult = {
        outcome: "correct",
        player: sender.name,
        avatar: sender.avatar,
        word: secretWord,
        points: earnedPoints,
        base,
        bonus
      };

      this.io.to(room.code).emit("guess_result", {
        correct: true,
        guesserId: sender.id,
        guesserName: sender.name,
        word: secretWord,
        earnedPoints,
        base,
        bonus,
        totalScore: sender.score
      });

      this.broadcastRoomState(room, { wordRevealed: secretWord, turnResult: room.turnResult });

      this.scheduleTurnTransition(room, 4000, "correct_guess");

      return { success: true, correct: true, earnedPoints, base, bonus };
    }

    // 2. PALPITE ERRADO!
    // REQUISITO: O jogador errou -> volta para o final da fila de não resolvidos com a mesma palavra (NÃO revela a palavra)
    if (room.unresolvedQueue.length > 0 && room.unresolvedQueue[0] === room.activePlayerId) {
      const failedId = room.unresolvedQueue.shift();
      room.unresolvedQueue.push(failedId);
    }

    // Incrementa a tentativa global da rodada
    room.attemptNumber += 1;

    this.addSystemMessage(
      room,
      `❌ ${sender.name} palpitou "${text}", mas errou! Volta para o final da fila.`,
      "wrong_guess"
    );

    room.state = "turn_celebration";
    room.turnResult = {
      outcome: "wrong",
      player: sender.name,
      avatar: sender.avatar,
      guess: text
    };

    this.io.to(room.code).emit("guess_result", {
      correct: false,
      guesserId: sender.id,
      guesserName: sender.name,
      guess: text
    });

    this.broadcastRoomState(room, { turnResult: room.turnResult });

    this.scheduleTurnTransition(room, 3500, "wrong_guess");

    return { success: true, correct: false };
  }

  // Avança para o próximo jogador da fila de não resolvidos ou finaliza a rodada.
  // Cada tentativa encerrada gera UMA transição pendente (room.pendingTransition, identificada por turnSeq).
  // advanceTurn consome essa transição de forma síncrona ANTES de iniciar o próximo turno, então:
  //  - uma segunda chamada para a mesma transição retorna false sem iniciar nada (mesmo em Promise.all);
  //  - uma chamada com turnSeq de um turno já encerrado (callback atrasado) é ignorada;
  //  - a transição válida do turno seguinte não é bloqueada, pois é uma nova transição (novo turnSeq).
  // Retorna true somente quando esta chamada efetivamente avançou a partida.
  advanceTurn(room, reason = "normal", expectedTurnSeq = room ? room.turnSeq : undefined) {
    if (!room) return false;

    const pending = room.pendingTransition;
    if (!pending || pending.turnSeq !== expectedTurnSeq || pending.turnSeq !== room.turnSeq) {
      return false;
    }
    room.pendingTransition = null; // consome a transição antes de qualquer efeito colateral

    this.clearRoomTimers(room);

    if (!room.players || room.players.length === 0) {
      return false;
    }

    // Limpa eventuais jogadores que desconectaram da fila
    room.unresolvedQueue = (room.unresolvedQueue || []).filter((id) =>
      room.players.some((p) => p.id === id)
    );

    // Se todos os jogadores resolveram suas palavras nesta rodada:
    if (room.unresolvedQueue.length === 0) {
      this.endRound(room);
      return true;
    }

    // Inicia o turno do jogador que está no início da fila
    this.startTurn(room);
    return true;
  }


  // Encerra a rodada atual e avança para a próxima ou para o pódio final
  endRound(room) {
    this.clearRoomTimers(room);

    room.currentRound += 1;

    // Se todas as rodadas foram concluídas -> FIM DE JOGO
    if (room.currentRound > room.settings.totalRounds) {
      this.endGame(room);
      return;
    }

    // Nova rodada: nova fase de sugestão de palavras para renovar o desafio!
    this.startWordSuggestionPhase(room);
  }

  // Finaliza a partida e exibe o pódio
  endGame(room) {
    this.clearRoomTimers(room);
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

  // Reinicia a partida (somente quando a partida terminou: game_over)
  async restartGame(code, socketId) {
    const room = this.rooms.get(code);
    if (!room || room.hostId !== socketId) {
      if (room && socketId) {
        this.io.to(socketId).emit("guess_feedback", {
          message: "Apenas o Host pode reiniciar a partida.",
          type: "warning"
        });
      }
      return false;
    }

    if (room.state !== "game_over") {
      this.io.to(socketId).emit("guess_feedback", {
        message: "A partida só pode ser reiniciada após o término.",
        type: "warning"
      });
      return false;
    }

    this.clearRoomTimers(room);
    return await this.startGame(code, socketId);
  }

  // Processa mensagens no chat respeitando a máquina de estados do turno
  handleChatMessage(code, socketId, messageText) {
    const room = this.rooms.get(code);
    if (!room) return null;

    const sender = room.players.find((p) => p.id === socketId);
    if (!sender) return null;

    const text = typeof messageText === "string" ? messageText.trim() : "";
    if (!text) return null;

    const isActivePlayer = room.state === "playing" && room.activePlayerId === socketId;
    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);

    // ========================================================
    // 1. SE FOR O JOGADOR DA VEZ:
    // ========================================================
    if (isActivePlayer) {
      if (room.turnEnded || room.state !== "playing") {
        this.io.to(sender.id).emit("guess_feedback", {
          message: "Aguarde a transição para o próximo turno.",
          type: "warning"
        });
        return { success: false, error: "Turno finalizado." };
      }

      // Etapa 1: O jogador ativo pode enviar EXATAMENTE UMA pergunta
      if (room.turnPhase === "awaiting_question") {
        room.currentQuestion = text;

        const otherPlayers = room.players.filter((p) => p.id !== socketId);
        if (otherPlayers.length > 0) {
          room.turnPhase = "awaiting_responses";
        } else {
          // Caso solo (1 jogador na sala para teste): avança direto para palpite/passagem
          room.turnPhase = "awaiting_guess_or_pass";
        }

        const questionEntry = {
          id: Math.random().toString(36).substring(2, 9),
          senderId: sender.id,
          senderName: sender.name,
          avatar: sender.avatar,
          text,
          type: "question",
          timestamp: Date.now()
        };
        room.chatMessages.push(questionEntry);
        if (room.chatMessages.length > 100) room.chatMessages.shift();
        this.io.to(room.code).emit("new_chat_message", questionEntry);

        // Não duplica com mensagem repetitiva do sistema
        this.broadcastRoomState(room);
        return { success: true, phase: room.turnPhase, type: "question" };
      }

      // Etapa 2: Aguardando respostas dos outros participantes
      if (room.turnPhase === "awaiting_responses") {
        this.io.to(sender.id).emit("guess_feedback", {
          message: "Você já fez sua pergunta neste turno! Aguarde as respostas dos amigos para poder palpitar.",
          type: "warning"
        });
        return { success: false, error: "Aguardando respostas." };
      }

      // Etapa 3: Palpite ou passagem
      if (room.turnPhase === "awaiting_guess_or_pass") {
        return this.handlePlayerGuess(code, socketId, text);
      }
    }

    // ========================================================
    // 2. SE FOR OUTRO JOGADOR (ESPECTADOR OU QUEM JÁ ACERTOU):
    // ========================================================

    // Proteção Anti-Spoiler: Impede espectadores de dizerem a palavra secreta diretamente
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

    // Se o espectador estiver enviando uma resposta SIM/NÃO/TALVEZ pelo chat:
    const recognizedReaction = parseQuickResponseText(text);
    if (recognizedReaction) {
      // Rejeita se o turno já encerrou ou a partida não está em andamento normal
      if (room.turnEnded || room.state !== "playing") {
        this.io.to(sender.id).emit("guess_feedback", {
          message: "O turno atual já terminou.",
          type: "warning"
        });
        return { success: false, error: "O turno atual já terminou." };
      }

      // Rejeita resposta rápida antes da pergunta ser feita
      if (room.turnPhase === "awaiting_question") {
        this.io.to(sender.id).emit("guess_feedback", {
          message: "Aguarde o jogador da vez fazer a pergunta antes de responder.",
          type: "warning"
        });
        return { success: false, error: "Aguarde a pergunta do jogador da vez." };
      }
    }

    // Mensagem de bate-papo normal enviada pelo espectador
    const chatEntry = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: sender.id,
      senderName: sender.name,
      avatar: sender.avatar,
      text,
      type: "chat",
      timestamp: Date.now()
    };

    room.chatMessages.push(chatEntry);
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    this.io.to(room.code).emit("new_chat_message", chatEntry);

    // Se for uma resposta válida reconhecida e o turno estiver aberto para respostas:
    if (room.state === "playing" && !room.turnEnded && recognizedReaction) {
      room.turnResponses.push({ senderId: sender.id, text, reaction: recognizedReaction });
      if (room.turnPhase === "awaiting_responses") {
        room.turnPhase = "awaiting_guess_or_pass";
        this.broadcastRoomState(room);
      }
    }

    return { type: "chat", chatEntry };
  }

  // Resposta rápida com 1 toque (SIM, NÃO, TALVEZ)
  handleQuickReaction(code, socketId, reaction) {
    const room = this.rooms.get(code);
    if (!room) return false;

    // Se o turno já encerrou ou o jogo não está em andamento normal (ex: turn_celebration), rejeita
    if (room.turnEnded || room.state !== "playing") {
      this.io.to(socketId).emit("guess_feedback", {
        message: "O turno atual já terminou.",
        type: "warning"
      });
      return false;
    }

    const sender = room.players.find((p) => p.id === socketId);
    if (!sender || socketId === room.activePlayerId) return false; // O jogador ativo não pode responder a si próprio

    // Só aceita respostas rápidas depois que o jogador ativo fez a pergunta
    if (room.turnPhase === "awaiting_question") {
      this.io.to(socketId).emit("guess_feedback", {
        message: "Aguarde o jogador da vez fazer a pergunta antes de responder.",
        type: "warning"
      });
      return false;
    }

    // Apenas aceita respostas enquanto o turno estiver aberto para respostas
    if (room.turnPhase !== "awaiting_responses" && room.turnPhase !== "awaiting_guess_or_pass") {
      return false;
    }

    const validReactions = {
      yes: { text: "👍 SIM!", label: "SIM", color: "green" },
      no: { text: "👎 NÃO!", label: "NÃO", color: "red" },
      maybe: { text: "🤔 TALVEZ / ÀS VEZES", label: "TALVEZ", color: "yellow" }
    };

    const reactionData = validReactions[reaction];
    if (!reactionData) return false;

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
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    this.io.to(room.code).emit("new_chat_message", chatEntry);

    // Registra a resposta na lista de respostas do turno
    room.turnResponses.push({ senderId: sender.id, reaction });

    // Se foi a primeira resposta válida recebida, libera a decisão do jogador ativo
    if (room.turnPhase === "awaiting_responses") {
      room.turnPhase = "awaiting_guess_or_pass";
      this.broadcastRoomState(room);
    }

    return true;
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
  getRoomStateForPlayer(room, socketId, extraData = {}) {
    const myPlayer = room.players.find((p) => p.id === socketId);

    const safePlayers = room.players.map((p) => {
      const isMe = p.id === socketId;
      const isInQueue = room.unresolvedQueue ? room.unresolvedQueue.includes(p.id) : false;

      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        isHost: p.isHost,
        hasGuessed: p.hasGuessed,
        isInQueue,
        spectatingUntilNextRound: !!p.spectatingUntilNextRound,
        hasSubmittedWord: !!p.submittedWord,
        // Palavra na testa: oculta para o próprio jogador da vez a menos que revelada na celebração de acerto
        currentWord: isMe
          ? p.currentWord
            ? {
                palavra: (extraData.wordRevealed && room.state === "turn_celebration") || p.hasGuessed
                  ? p.currentWord.palavra
                  : "???",
                categoriaNome: p.currentWord.categoriaNome || "Geral",
                dica: "Faça perguntas aos outros jogadores no chat!"
              }
            : null
          : p.currentWord
      };
    });

    const activePlayer = room.players.find((p) => p.id === room.activePlayerId);
    const submittedCount = room.players.filter((p) => !!p.submittedWord).length;
    const totalPlayers = room.players.length;
    const unresolvedQueueCount = room.unresolvedQueue ? room.unresolvedQueue.length : 0;

    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      currentRound: room.currentRound,
      unresolvedQueueCount,
      attemptNumber: room.attemptNumber || 1,
      activePlayerId: room.activePlayerId,
      activePlayerName: activePlayer ? activePlayer.name : "",
      activePlayerAvatar: activePlayer ? activePlayer.avatar : "",
      turnPhase: room.turnPhase || "awaiting_question",
      currentQuestion: room.currentQuestion || null,
      turnResponsesCount: room.turnResponses ? room.turnResponses.length : 0,
      canGuessOrPass: room.turnPhase === "awaiting_guess_or_pass",
      turnEnded: !!room.turnEnded,
      turnResult: extraData.turnResult || room.turnResult || null,
      wordRevealed: extraData.wordRevealed || null,
      turnSecondsRemaining: room.turnSecondsRemaining,
      players: safePlayers,
      isMyTurn: room.activePlayerId === socketId,
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
      const socket = this.io.sockets?.sockets?.get(player.id);
      if (socket) {
        socket.emit("room_state_update", this.getRoomStateForPlayer(room, player.id, extraData));
      }
    }
  }
}
