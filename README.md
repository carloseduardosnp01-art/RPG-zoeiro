# Duelo da Zoeira · o card game mais careca do Brasil

Jogo de cartas de zoeira entre amigos, com regras inspiradas no Yu-Gi-Oh! clássico. Tem catálogo das cartas, o deck de 40 cartas, regras, **salão online com login, chat e desafios** e **duelos em tempo real** entre dois jogadores. Também dá para treinar contra o **Bot Careca**.

O diferencial: **ninguém precisa ficar clicando para ativar armadilha**. Você baixa a carta e o jogo ativa sozinho quando a condição dela acontece. O oponente atacou e você tem a Força Careca virada? Já era.

O site é 100% estático (HTML, CSS e JavaScript puro), então roda no **GitHub Pages** sem servidor próprio.

| | |
|---|---|
| **Repositório** | [github.com/carloseduardosnp01-art/RPG-zoeiro](https://github.com/carloseduardosnp01-art/RPG-zoeiro) |
| **Site (GitHub Pages)** | [carloseduardosnp01-art.github.io/RPG-zoeiro](https://carloseduardosnp01-art.github.io/RPG-zoeiro/) |

---

## Sumário
1. [Funcionalidades](#funcionalidades)
2. [Publicar no GitHub Pages](#publicar-no-github-pages)
3. [Rodar no computador](#rodar-no-computador)
4. [Como o online funciona](#como-o-online-funciona)
5. [As cartas e o deck](#as-cartas-e-o-deck)
6. [Regras e automações](#regras-e-automações)
7. [Estrutura do código](#estrutura-do-código)
8. [Como criar cartas novas](#como-criar-cartas-novas)
9. [Créditos](#créditos)

---

## Funcionalidades

- **Início** com leque de cartas em destaque.
- **Catálogo**: busca (sem diferenciar acentos), filtros por categoria, atributo e raridade, ordenação, paginação e modal com a carta completa, ficha, "como funciona no jogo" e frase da carta (com navegação Anterior/Próxima).
- **Template próprio das cartas**, feito em HTML/CSS e usado em todo o site: moldura por tipo (Normal, Efeito, Magia, Armadilha), atributo com kanji, estrelas, selo de raridade (nome prateado, dourado ou arco-íris e brilho holográfico na arte), número de série e selo careca. A mesma carta escala de 50 px (campo no celular) até a carta grande do modal.
- **Deck**:
  - **Meu deck**: editor para montar e salvar o seu deck. Clique na coleção para colocar uma cópia e no deck para tirar. Regras: de **40 a 60 cartas** e até **3 cópias** de cada (dá para tirar à vontade enquanto monta, mas só salva com 40 a 60; com 60 não dá para colocar mais). O deck salvo fica no navegador e na sua conta, e é o que você usa nos duelos online e no treino.
  - **Deck padrão** (Deck Careca Supremo): mesa com as pilhas de cópias e o resumo (40 cartas: 22 monstros, 12 magias, 6 armadilhas). É o deck de quem ainda não montou o seu e o deck do Bot Careca.
- **Regras** em acordeão.
- **Salão online** (igual ao chat do site de referência):
  - criar conta (nick, senha, clã e avatar) e entrar;
  - chat global com histórico, emojis e mensagens do sistema ("🏆 Fulano zerou os LP de Ciclano na Arena!");
  - lista de duelistas online com nível, clã e busca;
  - **botão direito** (ou toque) no duelista → *Desafiar para duelo* / *Mensagem privada*;
  - o desafio aparece numa aba privada com **Aceitar** e **Recusar**; ao aceitar, os dois vão direto para a arena;
  - perfil com nível, XP, vitórias/derrotas e ranking dos carecas.
- **Arena**:
  - no PC, a arena ocupa a tela toda: os jogadores e o relógio ficam numa coluna à esquerda, as fases na vertical ao lado do campo, e o menu do site some durante o duelo (botões **⛶ Tela cheia** e **🏠 Ir ao site** na coluna dos jogadores);
  - placar com nível, cartas na mão, barra de LP e relógio da ação (60 s);
  - campo com zonas de monstro, magia/armadilha, deck e cemitério;
  - barra de fases (DRAW, STBY, MP1, BP, MP2, END);
  - clique numa carta → menu só com as ações válidas naquele momento (a carta brilha em verde quando tem ação);
  - janelas para escolher tributos, alvos, alvo do ataque e descarte;
  - animações: carta grande com frase de zoeira ao invocar/ativar ("VAPO!", "FORÇA CARECA!", "CAIU NA ARMADILHA DO BIG!"), ataque indo até o alvo, cartas explodindo, dano subindo, tela tremendo;
  - sons sintetizados (sem arquivos de áudio) com botão de mudo;
  - registro do duelo, chat do duelo com provocações rápidas e balão sobre o jogador;
  - resultado com XP ganho e **Revanche**;
  - se a página recarregar no meio do duelo, ela volta para a partida.
- **Treino contra o Bot Careca**, sem precisar de conta. O bot joga limpo (não olha cartas viradas nem a sua mão) e ainda zoa no chat.
- Responsivo (celular, tablet e computador) e com foco visível, rótulos e `aria-live`.

---

## Publicar no GitHub Pages

O código já está em `github.com/carloseduardosnp01-art/RPG-zoeiro`. Para o site ir ao ar:

1. No plano gratuito do GitHub, o Pages só funciona em repositório **público**: em **Settings → General → Danger Zone → Change visibility**, deixe o repositório público.
2. Abra **Settings → Pages**, em *Build and deployment* escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e salve.
3. Em um ou dois minutos o jogo fica em `https://carloseduardosnp01-art.github.io/RPG-zoeiro/`.

Para mandar atualizações depois: `git add -A`, `git commit -m "mensagem"` e `git push`.

Pronto: é só mandar o link para os amigos, cada um cria a conta e todos se encontram no salão.

---

## Rodar no computador

O navegador bloqueia `fetch` em arquivos abertos com dois cliques (`file://`), então use um servidor local dentro da pasta:

```bash
python -m http.server 8000
```

Depois abra **http://localhost:8000**.

### Endereços úteis para testes

| Endereço | O que faz |
|---|---|
| `?treino` | abre direto um duelo contra o bot |
| `?rede=local` | troca o servidor online por uma rede **local entre abas** do mesmo navegador. Abra duas abas com `?rede=local#salao`, crie uma conta em cada uma e desafie você mesmo, sem internet |
| `?debug` | deixa a sessão do duelo acessível no console (`zoeiraDebug.sessao()`) |

> Dica: com "continuar conectado" marcado, a segunda aba entra na mesma conta. Clique em **Sair da conta** nela e crie a outra.

---

## Como o online funciona

Como não há servidor próprio, o site usa um **broker MQTT público** por WebSocket seguro (`wss://broker.emqx.io`, com `broker.hivemq.com` de reserva), através da biblioteca [MQTT.js](https://github.com/mqttjs/MQTT.js). O broker só repassa mensagens entre os navegadores; toda a regra do jogo roda no navegador de cada jogador.

Tópicos (todos começam com `rpgdazoeira/v1/`):

| Tópico | Para quê |
|---|---|
| `presenca/<sessão>` | quem está online (mensagem retida; o broker apaga sozinho quando a aba cai) |
| `chat/global` e `chat/historico` | chat global e as últimas 40 mensagens |
| `dm/<nick>` | mensagens privadas e desafios |
| `contas/<nick>` e `perfis/<nick>` | conta (só o hash da senha) e perfil público |
| `duelo/<id>/estado` e `duelo/<id>/sinal` | o duelo em si e os "estou aqui"/chat do duelo |

**O duelo:** quem desafiou cria a partida com o próprio deck e o deck que o oponente mandou junto com o "aceito" (o motor confere se os dois valem; se não, usa o padrão), embaralha com uma semente e sorteia quem começa. Só age quem está na vez (as armadilhas são automáticas, então o oponente nunca precisa decidir nada no turno do outro). Quem joga aplica a jogada no próprio navegador e publica o **estado inteiro** no tópico do duelo; o outro só substitui o dele. Como o estado fica retido no broker, quem recarregar a página volta para a partida.

**Ausência:** cada navegador manda um sinal a cada 5 s. Se o oponente sumir por 20 s aparece um aviso; depois de 60 s dá para **reivindicar vitória por W.O.** Se o tempo da ação (60 s) acabar, o turno passa sozinho.

### Limitações (é zoeira, mas é bom saber)

- O broker é **público**: qualquer pessoa que conheça os tópicos consegue ler as mensagens. Não mande nada sério pelo chat.
- A senha nunca sai do navegador: vai só um hash **PBKDF2 (150 mil iterações, com sal)**. Mesmo assim, **use uma senha só para o jogo**.
- Não há um servidor juiz, então um espertinho com o console aberto consegue trapacear. Jogue com amigos.
- Brokers públicos podem limpar mensagens retidas. Por isso cada navegador guarda uma cópia da conta e do perfil e republica ao entrar.
- Se um dia quiser contas "de verdade", dá para trocar `js/rede.js` e `js/conta.js` por um serviço como Firebase ou Supabase: o resto do jogo só conversa com essas duas partes.

---

## As cartas e o deck

As artes vieram das cartas que você mandou, recortadas só na ilustração (`img/cartas/*.webp`, 640×640). O resto da carta é desenhado pelo site.

| Código | Carta | Tipo | Cópias | Resumo |
|---|---|---|---|---|
| ZOE-PT001 | Careca Feijão | Monstro Normal · Nv 3 · 1750/0 | 3 | Bate forte e é o tributo perfeito |
| ZOE-PT002 | Grande Mestre | Monstro Normal · Nv 7 · 2500/2100 | 3 | O chefão (2 tributos, ou via Invocador) |
| ZOE-PT003 | Careca Cast Surpresa | Efeito/Virar · Nv 2 · 450/600 | 2 | VIRE: pode destruir 1 monstro |
| ZOE-PT004 | Miro Animal | Efeito · Nv 4 · 2000/1500 | 3 | Saideira: destruiu monstro em batalha → +500 de dano **(efeito inventado: a carta original está sem texto)** |
| ZOE-PT005 | Careca do PT | Efeito · Nv 5 · 2400/1000 | 3 | Tributo: pode destruir 1 monstro |
| ZOE-PT006 | Adm do PT | Efeito · Nv 6 · 2400/1000 | 2 | Tributo: destrói até 2 Magias/Armadilhas |
| ZOE-PT007 | Feiticeira Careca | Efeito · Nv 6 · 2000/1700 | 3 | +300 ATK por Grande Mestre nos cemitérios |
| ZOE-PT008 | Carecas da Luz Reveladora | Magia | 2 | Revela os monstros virados do oponente (sem efeito VIRE) e ele não ataca por 3 turnos dele |
| ZOE-PT009 | Vapo! | Magia | 2 | Destrói todos os monstros |
| ZOE-PT010 | Soco do Big | Magia Rápida | 3 | Destrói 1 Magia/Armadilha |
| ZOE-PT011 | Bust do Big | Magia de Equipamento | 2 | +700 ATK |
| ZOE-PT012 | Invocador | Magia | 3 | Invoca um Monstro Normal Nv 5+ da mão |
| ZOE-PT013 | Força Careca | Armadilha | 3 | Oponente atacou → destrói os monstros dele em ataque |
| ZOE-PT014 | Armadilha do Big | Armadilha | 3 | Oponente invocou monstro com 1000+ ATK → destrói |
| ZOE-PT015 | Carecalla | Efeito · Nv 6 · 2100/1600 | 3 | Entra de penetra se só o oponente tiver monstro |
| ZOE-PT016 | Gigante de Pedra Careca | Monstro Normal · Nv 3 · 1300/2000 | – | Muralha de defesa sem tributo |
| ZOE-PT017 | Carecelta | Monstro Normal · Nv 4 · 1400/1200 | – | Elfo careca espadachim |
| ZOE-PT018 | Midasgel | Efeito/Virar · Nv 2 · 1000/400 | – | VIRE: compra 1 carta |
| ZOE-PT019 | Midasmon | Efeito/Virar · Nv 2 · 1000/400 | – | VIRE: o oponente descarta 1 carta (você escolhe no seu turno; sorteada no turno dele) |
| ZOE-PT020 | Karecoh Alado | Efeito · Nv 1 · 300/200 | – | Destruído no campo → sem dano de batalha pelo resto do turno |

A coluna "Cópias" é do **deck padrão**. As cartas com "–" (Gigante de Pedra Careca, Carecelta, Midasgel, Midasmon e Karecoh Alado) ficam fora dele e entram nos decks personalizados. Deck padrão: **40 cartas** (22 monstros, 12 magias, 6 armadilhas). Com 15 cartas diferentes e no máximo 3 cópias, 10 cartas ficaram com 3 cópias e 5 com 2 (Careca Cast Surpresa, Adm do PT, Bust do Big, Vapo! e Carecas da Luz). A Feiticeira Careca original falava de "Mago Negro"; aqui ela conta o **Grande Mestre**, que é o "Mago Negro" do deck.

---

## Regras e automações

- 8000 LP e 5 cartas na mão. Todo turno começa comprando 1 carta, **inclusive o primeiro** (quem começa fica com 6). Ninguém ataca no 1º turno do duelo.
- Deck de 40 a 60 cartas, até 3 cópias de cada.
- 1 Invocação-Normal (ou baixar 1 monstro) por turno. Nível 5–6 pede 1 tributo; Nível 7+ pede 2.
- Mão com mais de 6 cartas na Fase Final: descarta o excesso.
- **Automático:**
  - Compra e Fase de Espera passam sozinhas.
  - **Armadilhas** só podem ser baixadas; a partir do turno seguinte ativam sozinhas no primeiro momento em que a condição acontece (uma por gatilho, da esquerda para a direita).
  - **Careca Cast Surpresa** virado por um ataque ativa sozinho e destrói o monstro mais forte do oponente.
  - **Carecas da Luz** conta os turnos sozinha (o número aparece na carta).
  - **Miro Animal** cobra a saideira (+500 de dano) sozinho quando destrói um monstro em batalha.
  - **Midasgel** compra 1 carta sozinho quando é virado. **Midasmon** virado por um ataque faz o oponente descartar 1 carta sorteada.
  - **Karecoh Alado** destruído no campo deixa o dono sem dano de batalha até o fim do turno (aparece uma 🪽 ao lado do nome).
  - **Careca do PT** e **Careca Cast Surpresa** só perguntam o alvo se o oponente tiver monstro, e dá para não escolher nada: você nunca é obrigado a destruir um monstro seu.
  - **Bust do Big** vai para o cemitério junto com o monstro equipado.
  - Tempo da ação esgotado: o jogo resolve a escolha pendente e passa o turno.
- **Você escolhe:** tributos, alvos das magias, alvo do Careca do PT/Adm do PT/Cast Surpresa (quando você mesmo vira), a carta que o Midasmon descarta (quando você mesmo vira), alvo dos ataques e descarte.

---

## Estrutura do código

```
.
├── index.html            # Todas as telas (início, catálogo, deck, regras, salão, arena)
├── css/
│   ├── estilo.css        # Tema do site, catálogo, deck, login e salão
│   ├── carta.css         # Template das cartas (tudo em cqw: escala com o tamanho)
│   └── arena.css         # Tabuleiro, placar, fases, animações
├── js/
│   ├── app.js            # Entrada: carrega as cartas e troca as telas pelo #endereço
│   ├── motor.js          # Regras do duelo (sem tela): estado + ação → novo estado + eventos
│   ├── bot.js            # Bot Careca
│   ├── arena.js          # Tela do duelo: desenha o estado, anima os eventos, menus e escolhas
│   ├── sessao.js         # Liga a arena ao duelo (contra o bot ou online)
│   ├── salao.js          # Salão: presença, chat, desafios, perfil e ranking
│   ├── conta.js          # Cadastro, login e estatísticas
│   ├── rede.js           # Conexão MQTT (ou rede local entre abas)
│   ├── catalogo.js       # Catálogo, modal, leque e mesa do deck padrão
│   ├── deck.js           # Deck do jogador: guardar, validar, usar nos duelos
│   ├── editor-deck.js    # Tela "Meu deck"
│   ├── cartas-ui.js      # HTML das cartas (frente e verso)
│   ├── som.js            # Efeitos sonoros (Web Audio)
│   └── util.js           # Funções pequenas
├── data/cartas.json      # As 20 cartas (texto, stats, cópias no deck padrão, efeito)
├── img/cartas/           # Artes recortadas (WebP 640×640)
└── fontes/               # Cinzel e Crimson Pro (SIL Open Font License)
```

O **motor** é independente da tela: dá para rodar partidas inteiras no Node (foi assim que ele foi testado, com milhares de partidas bot × bot e jogadas aleatórias, conferindo que nenhuma carta some ou duplica e que toda partida termina).

---

## Como criar cartas novas

1. Coloque a arte quadrada em `img/cartas/` (640×640, WebP ou JPG).
2. Acrescente a carta em `data/cartas.json`. Para um monstro normal ou um efeito que já existe, é só isso.
3. Para um **efeito novo**, dê um nome em `"efeito"` e programe em `js/motor.js`:
   - magias: `requisitosMagia()` (alvos) e o `switch` de `ativarMagia()`;
   - armadilhas: `verificarArmadilhas()` (o gatilho e o que acontece);
   - efeitos ao invocar: `aposInvocar()`.
   Depois dê uma frase de zoeira para ela em `FRASES` (`js/arena.js`) e ensine o bot em `js/bot.js`, se quiser.
4. Em `"copias"`, coloque quantas cópias entram no deck padrão (0 = só nos decks personalizados).

---

## Créditos

| Recurso | Origem | Licença |
|---|---|---|
| Artes das cartas | Montagens enviadas pelo dono do projeto, recortadas para o site | — |
| Código, textos, template das cartas, emblema careca e sons | Feitos para este projeto | — |
| [Bootstrap 5.3.3](https://getbootstrap.com/) | CDN jsDelivr | MIT |
| [MQTT.js 5](https://github.com/mqttjs/MQTT.js) | CDN jsDelivr | MIT |
| Fontes Cinzel e Crimson Pro | Google Fonts (arquivos em `fontes/`) | SIL Open Font License |
| Estrutura das regras | Inspirada em *Yu-Gi-Oh!* (Konami). Projeto de zoeira entre amigos, sem fins comerciais | — |
