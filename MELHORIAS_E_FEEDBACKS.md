# Melhorias e feedbacks do jogo

Documento de referência para orientar as próximas alterações do projeto pelo Antigravity. Consolida os comentários dos jogadores, as observações do proprietário e o fluxo identificado no código atual. Este documento registra requisitos; não altera o comportamento do jogo.

## 1. Contexto atual confirmado no código

- O servidor escolhe um jogador ativo por vez (`activePlayerId`); os participantes não tentam adivinhar simultaneamente.
- Na vez de uma pessoa, ela vê `???` no próprio cartão. Os demais veem a palavra dela e podem responder pelo chat e pelos botões SIM, NÃO ou TALVEZ.
- Hoje o jogador ativo pode enviar várias mensagens/palpites durante o turno. Um acerto encerra o turno; passar a vez ou o cronômetro expirar também encerra o turno.
- Após acerto, passagem ou tempo esgotado, há uma tela/estado de celebração e uma espera aproximada de 3,5 a 4 segundos antes do próximo turno.
- A rodada só termina quando todos os jogadores da lista atual tiveram seu turno. Se houver rodadas configuradas, inicia uma nova fase de sugestão de palavras. O pódio aparece após a última rodada.
- O padrão é 60 segundos por turno e 3 rodadas. O host pode configurar categorias, tempo e número de rodadas.
- As atualizações da sala acionam a renderização da tela inteira no cliente. Na fase de sugestão, isso pode recriar o formulário e apagar o que os outros jogadores ainda estavam digitando.
- O backend atribui avatares por conta própria ao criar/entrar em uma sala. O avatar escolhido pelo usuário na tela inicial não é enviado nos eventos de criação/entrada, portanto a seleção não é preservada de forma confiável.
- O chat recebe novas mensagens e rola até o final. Seu feed usa rolagem interna, mas o layout precisa ser verificado para impedir que mensagens façam a página inteira crescer ou escondam controles em telas menores.
- As respostas rápidas são mensagens visíveis a todos; atualmente o servidor não registra que a pessoa da vez já fez sua pergunta nem limita a quantidade de palpites do jogador ativo.

## 2. Regra desejada para o turno — alinhamento principal

Cada participante deve ter sua vez em sequência. Durante o turno, o jogador ativo pode:

1. Fazer **exatamente uma pergunta** no chat.
2. Aguardar a resposta dos demais, que podem responder SIM, NÃO ou TALVEZ. A escolha da resposta continua livre para cada participante; não há votação obrigatória nem resposta de uma pessoa específica.
3. Depois de receber a resposta, escolher entre:
   - enviar **um único palpite**; ou
   - passar a vez sem palpitar.
4. Se o palpite estiver correto, o turno termina e a vez passa ao próximo jogador.
5. Se o palpite estiver errado, essa tentativa é consumida e o turno termina imediatamente; a vez passa ao próximo jogador.
6. Se decidir não palpitar, pode passar a vez diretamente.
7. O tempo configurado continua sendo o limite máximo do turno. Se expirar em qualquer etapa, o turno termina e passa ao próximo jogador.

Não adicionar uma tela/modal de confirmação para iniciar o palpite. A decisão deve ser apresentada como ações claras após a pergunta/respostas. A pergunta é obrigatória para avançar normalmente ao palpite ou à passagem; exceções por timeout permanecem automáticas.

A rodada continua até que todos os participantes tenham tido seu turno. O jogo continua respeitando o número de rodadas configurado; não termina simplesmente porque alguém acertou. Tornar visualmente evidente quem está jogando, quando aguarda respostas e para quem a vez passou.

## 3. Feedbacks recebidos de quem jogou

### 3.1 Chat e layout

- Com muitas mensagens, o chat cresce e desloca a página para baixo. Manter o histórico rolando dentro da caixa do chat, sem expandir a página inteira.
- Garantir que o campo de texto e os botões de resposta rápida permaneçam acessíveis enquanto o histórico rola, especialmente em telas menores.

### 3.2 Ritmo e clareza de turnos

- A troca entre participantes parece rápida e deixa dúvida se a partida ainda está valendo.
- Mostrar uma transição/indicador visual entre turnos, informando de forma clara que a vez mudou e quem joga agora. A experiência deve deixar explícito que o próximo jogador tem sua oportunidade.
- Considerar o tempo de celebração/transição atual (cerca de 3,5–4 s) ao ajustar a indicação visual; não reduzir o tempo sem necessidade.

### 3.3 Último jogador

- Foi relatado que, quando alguém acerta, o jogo acaba e a última pessoa às vezes não chega a jogar.
- A leitura do código indica que, em condições normais, o acerto encerra somente o turno atual e a rodada só avança após todos jogarem. Conferir a nova regra de uma pergunta/um palpite para garantir que o último participante também sempre receba sua vez e que a partida não finalize antes disso.

## 4. Observações do proprietário

### 4.1 Rascunho da sugestão de palavra

- Na tela “Escreva uma Palavra Secreta”, se outra pessoa enviar a própria palavra enquanto alguém ainda está preenchendo a sua, o formulário da pessoa que ainda digita é limpo.
- Preservar localmente os campos de palavra e dica/categoria durante atualizações de progresso da sala. O envio de um participante não pode apagar o rascunho dos demais.

### 4.2 Avatar

- A escolha de avatar na tela inicial não está sendo respeitada ao entrar/criar sala.
- Enviar e preservar o avatar escolhido pelo jogador no fluxo de criação e entrada, com validação no servidor e compatibilidade com avatares disponíveis.

### 4.3 Sons

- Os sons associados às respostas SIM e NÃO incomodam.
- Rever os efeitos sonoros acionados por respostas rápidas e reduzir/remover os sons incômodos, sem remover inadvertidamente os sons de acerto, aviso de tempo ou transição que não foram apontados.

## 5. Critérios de aceite sugeridos

- Em uma sala com vários jogadores, ninguém consegue enviar uma segunda pergunta durante o mesmo turno.
- A resposta SIM/NÃO/TALVEZ não consome o palpite; após a pergunta, o jogador pode fazer no máximo um palpite ou passar.
- Um palpite errado encerra o turno imediatamente; um correto mantém a pontuação/celebração existente e também encerra o turno.
- Passar sem palpitar encerra o turno; timeout também avança sem bloquear a partida.
- Todos os jogadores na rodada, inclusive o último, recebem um turno antes de começar outra rodada ou mostrar o pódio.
- Os controles e o indicador de estado tornam explícito se o jogador está formulando a pergunta, aguardando respostas, escolhendo palpite/passagem ou se é a vez de outra pessoa.
- Atualizações de progresso da sugestão não removem os rascunhos locais de palavra e dica.
- O avatar escolhido aparece corretamente na sala e no jogo.
- O histórico do chat rola dentro do painel e não empurra a página nem esconde o campo de entrada/respostas rápidas em desktop e celular.
- As respostas rápidas não reproduzem o efeito sonoro incômodo identificado.

## 6. Áreas do projeto relacionadas

- `lib/game-manager.js`: ordem e estado dos turnos, tempo, validação de mensagens/palpites, pontuação e avanço de rodada.
- `lib/socket-handler.js`: eventos Socket.IO e passagem de dados de criação/entrada.
- `public/js/ui-render.js`: telas de preparação, jogo, controles, formulário e layout do chat.
- `public/js/socket.js`: atualização/renderização do estado em tempo real.
- `public/js/chat.js`: envio e apresentação das mensagens.
- `public/js/audio.js`: efeitos sonoros sintetizados.
- `public/css/style.css`: regras visuais/responsivas e contenção/rolagem do layout.

## 7. Nota para implementação

Validar a nova regra no servidor, não apenas desabilitando controles na interface. O estado do turno deve impedir mensagens/perguntas extras e palpites repetidos mesmo se o cliente enviar eventos fora da ordem. Preservar as salvaguardas atuais de sigilo da palavra, proteção anti-spoiler, pontuação e autorização do host. Cobrir casos de timeout, saída/desconexão, um jogador restante e mudanças no número de jogadores durante a rodada para evitar travamentos ou encerramento prematuro.
