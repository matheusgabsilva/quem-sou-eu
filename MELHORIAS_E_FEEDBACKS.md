# Melhorias e feedbacks do jogo

Documento de requisitos para as próximas alterações pelo Antigravity. Consolida os feedbacks dos jogadores, as decisões do proprietário e o comportamento atual identificado no código. Este arquivo descreve requisitos; não altera o código.

## 1. Comportamento atual relevante

- O servidor controla um jogador ativo por vez. Os outros jogadores veem a palavra dele e podem responder pelo chat ou por SIM, NÃO e TALVEZ.
- A implementação atual limita o jogador ativo a uma pergunta e um palpite por turno. A primeira resposta de outro jogador libera a decisão de palpitar ou passar; os demais ainda conseguem responder depois disso.
- Hoje um palpite errado encerra a vez. Quando todos os participantes tiveram uma primeira vez, a rodada avança, mesmo que haja palavras que ninguém acertou. Esse comportamento precisa mudar conforme a fila definida abaixo.
- Hoje o acerto vale `100 + round(100 * tempoRestante / tempoConfigurado)`. Errar, passar ou deixar o tempo acabar não reduz pontos.
- O jogo permite configurar 45, 60, 90 ou 120 segundos por turno e a quantidade de rodadas. A nova regra de bônus definida abaixo usa como referência fixa 60 segundos; consulte a regra de limite para partidas com tempos diferentes.
- Há mensagens de sistema no chat sobre envio de palavra, início de fase/rodada, distribuição de palavras e troca de vez. O feedback mais recente pede remover mensagens repetitivas de preparação e deixar o chat mais limpo.
- O layout do jogo usa três colunas. Na versão atual, o placar ocupa 3/12, o palco 5/12 e o chat 4/12; em telas estreitas, as áreas são empilhadas e a página pode rolar.

## 2. Regra de turnos e fila de palavras não resolvidas

Cada palavra é distribuída uma vez no começo da rodada e permanece com o mesmo jogador até ser acertada. Não redistribuir palavras após erro, passagem ou timeout.

### Fluxo de uma tentativa

1. O jogador elegível no início da fila faz exatamente uma pergunta.
2. A primeira resposta de outro participante — por mensagem no chat ou por SIM/NÃO/TALVEZ — libera a decisão do jogador ativo. Os demais participantes ainda podem responder normalmente enquanto essa pessoa decide e até o turno terminar.
3. O jogador ativo pode enviar um único palpite ou passar sem palpitar. Não mostrar modal de confirmação.
4. Um palpite errado termina a tentativa atual. Passar também termina a tentativa. Timeout termina a tentativa automaticamente.
5. Erro, passagem ou timeout colocam o jogador no final da fila de palavras não resolvidas, preservando a ordem original entre os jogadores que ainda precisam adivinhar. A pessoa poderá tentar novamente mais tarde com a mesma palavra.
6. Acerto remove o jogador da fila de adivinhação. Ele continua na sala e pode responder SIM/NÃO/TALVEZ às perguntas dos demais, mas não recebe outro turno de palpite nessa rodada.
7. A rodada só termina quando todos os jogadores da fila acertaram suas palavras. Não encerrar a rodada apenas porque cada pessoa teve uma primeira tentativa ou porque o último da fila errou/passou.
8. Quando a fila ficar vazia, seguir para a fase de preparação da próxima rodada, se houver; depois da última rodada, mostrar o pódio.

### Ordem da fila

- Inicializar a fila pela ordem original dos participantes da rodada.
- Em cada tentativa, processar a pessoa no início da fila.
- Se ela errar, passar ou esgotar o tempo, removê-la temporariamente do início e colocá-la no final, sem alterar sua palavra.
- Se acertar, removê-la definitivamente da fila daquela rodada.
- Participantes que já acertaram continuam habilitados como respondentes.
- Mudanças na lista de participantes por entrada, saída ou desconexão não podem duplicar, pular ou reatribuir palavras. Definir tratamento seguro para desconexão do jogador ativo e registrar a decisão na entrega.

## 3. Pontuação — regra acordada

A pontuação de cada acerto soma dois componentes independentes: uma base que cai conforme o número global da tentativa na rodada e um bônus de tempo que depende do relógio.

### Pontuação base por tentativa na rodada

Fórmula:

```js
base = Math.max(0, 110 - (turnoAtual * 10))
```

`turnoAtual` começa em 1 para a primeira tentativa da fila da rodada e aumenta em uma unidade a cada tentativa concluída, independentemente de quem a realizou. A base é 100 no turno 1, 90 no turno 2, 80 no turno 3 e segue caindo 10 pontos por turno até zero no turno 11 e seguintes. Ao iniciar uma nova rodada, o contador reinicia em 1.

### Bônus por tempo

Fórmula alinhada:

```js
bonus = Math.round(100 * (tempoRestante / 60))
```

- O bônus máximo de referência é 100 pontos e depende apenas do tempo restante, não do número do turno.
- O tempo usado no cálculo não pode ser menor que zero nem maior que 60 segundos. Isso mantém o bônus dentro de 0–100 mesmo quando o lobby estiver configurado para 90 ou 120 segundos.
- Com tempo configurado em 45 segundos, o bônus máximo no início do turno é 75 pontos pela referência fixa de 60 segundos definida acima.
- Não substituir o divisor fixo `60` pelo tempo configurado sem autorização. Deixar explícito no código/entrega que o divisor é fixo.

### Total concedido

```js
total = base + bonus
```

Somar os pontos ao total acumulado do jogador somente quando ele acertar. Erro, passagem e timeout não concedem pontos. O placar ao vivo e o pódio continuam ordenados pelo total acumulado.

Exemplos:

| Tentativa na rodada | Base | Tempo restante | Bônus | Total no acerto |
|---:|---:|---:|---:|---:|
| 1 | 100 | 60 s | 100 | 200 |
| 2 | 90 | 45 s | 75 | 165 |
| 3 | 80 | 30 s | 50 | 130 |
| 4 | 70 | 15 s | 25 | 95 |
| 10 | 10 | 60 s | 100 | 110 |
| 11 ou posterior | 0 | 60 s | 100 | 100 |

## 4. Respostas e fase de palpite

- A pergunta é obrigatória para entrar na etapa de palpite/passagem, exceto quando o turno terminar por timeout ou saída/desconexão tratada pelo servidor.
- A primeira resposta válida libera a tentativa do jogador ativo. Não exigir resposta de todos.
- Depois da primeira resposta, manter os controles de resposta dos demais participantes ativos até o encerramento real do turno. Respostas adicionais não iniciam uma segunda tentativa nem alteram a fila.
- Só o jogador ativo pode palpitar ou passar. Rejeitar no servidor ações fora de ordem, tentativas extras e eventos duplicados.
- Jogadores que já acertaram a palavra da rodada continuam podendo responder, mas não podem voltar à fila de palpites nessa rodada.

## 5. Limpeza do chat e mensagens de sistema

- Remover avisos redundantes como “Fulano enviou sua palavra secreta”, contagens repetidas de submissão, “todas as palavras foram distribuídas” e narrativas de início de rodada/preparação. A tela e os controles já explicam essas fases.
- Manter o aviso claro de **quem está na vez** e a indicação visual da fase atual.
- Manter no histórico as perguntas reais e respostas dos jogadores, os palpites e mensagens essenciais de resultado (acerto/erro/palavra revelada) necessárias para acompanhar a partida.
- Evitar repetir em uma mensagem de sistema uma pergunta que já aparece como mensagem do jogador.
- Manter o feed contido dentro do painel: mensagens não podem aumentar a página inteira. O campo de envio e os botões SIM/NÃO/TALVEZ devem continuar acessíveis.
- A rolagem automática deve acompanhar novas mensagens quando o usuário já está no fim do histórico, sem puxá-lo para baixo se estiver lendo mensagens anteriores.

## 6. Redimensionamento do tabuleiro

- Usar mais largura horizontal em desktop, reduzindo margens laterais excessivas sem comprometer telas pequenas.
- Redistribuir as três áreas para dar mais largura ao chat e melhorar a leitura das mensagens. Como ponto inicial, avaliar placar 3/12, palco 4/12 e chat 5/12, ajustando com inspeção visual em resoluções comuns.
- Preservar a hierarquia do cartão central e a leitura do placar; evitar que o chat ocupe espaço à custa de esconder as ações do turno.
- Em telas menores, manter adaptação responsiva, rolagem interna do histórico e acesso evidente aos controles. Conferir o comportamento real em celular, não apenas em desktop.

## 7. Melhorias anteriores já implementadas no commit atual

O commit atual já inclui implementações para preservar o rascunho de palavra e dica durante atualizações de progresso, transmitir e validar o avatar escolhido, conter o histórico do chat e remover sons das respostas rápidas. Não desfazer essas melhorias ao alterar o fluxo.

## 8. Feedbacks originais e critérios de aceite

- O chat não cresce junto com as mensagens nem desloca a página; a leitura e o envio continuam acessíveis.
- O tabuleiro usa melhor a largura de desktop e o painel do chat é mais largo.
- O chat deixa de repetir mensagens de preparação/envio de palavra; o jogador consegue identificar quem está na vez.
- Cada tentativa aceita uma pergunta e no máximo um palpite ou passagem.
- Qualquer participante pode responder; a primeira resposta libera a decisão do ativo, e os demais ainda podem responder até o turno terminar.
- Erro, passagem ou timeout mantêm a palavra com o mesmo jogador e o colocam no final da fila; a ordem dos demais elegíveis permanece estável.
- Acerto remove a pessoa da fila de palpites, mas ela continua apta a responder às perguntas dos demais.
- A rodada só avança quando todos acertaram suas palavras; o último jogador não provoca fim prematuro por errar.
- A base e o bônus seguem as fórmulas deste documento, aplicadas no servidor. O placar e o pódio mostram os totais acumulados.
- A seleção de avatar e os rascunhos na preparação continuam preservados; respostas rápidas não reproduzem os sons incômodos.
- Cobrir timeout em cada fase, saída/desconexão, mudança de membros, último elegível da fila, repetição/concorrência de eventos, reinício e início da próxima rodada.

## 9. Arquivos provavelmente envolvidos

- `lib/game-manager.js`: fila de palavras não resolvidas, transições, contador de tentativa por rodada, timer e pontuação.
- `lib/socket-handler.js`: validação e encaminhamento de eventos Socket.IO.
- `public/js/ui-render.js`: estados do turno, respostas, layout das três colunas e mensagens visuais.
- `public/js/socket.js`: sincronização e renderização dos estados.
- `public/js/chat.js`: apresentação e rolagem do histórico.
- `public/css/style.css`: dimensões, contenção e responsividade.

## 10. Requisitos de implementação

- Aplicar regras de fila e pontuação no servidor; não confiar apenas na interface.
- Manter invariantes de sigilo da palavra, proteção anti-spoiler, autorização do host e pontuação por acerto.
- Evitar avanços duplicados quando palpite, passagem, timeout ou desconexão ocorrerem quase ao mesmo tempo.
- Garantir que quem acertou não volte à fila da rodada, mas siga presente para responder.
- Não alterar a identidade visual sem necessidade; validar legibilidade e layout em desktop e mobile.
- Ao entregar, resumir decisões de fluxo, arquivos alterados, validações executadas e limitações restantes.
