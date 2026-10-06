# Duelo da Zoeira · o card game mais careca do Brasil

Jogo de cartas de zoeira entre amigos, com regras inspiradas no Yu-Gi-Oh! clássico. Tem catálogo das cartas, o deck de 40 cartas, regras, **salão online com login, chat e desafios** e **duelos em tempo real** entre dois jogadores. Também dá para treinar contra o **Bot Careca**.

O diferencial: **ninguém precisa ficar clicando para ativar armadilha**. Você baixa a carta e o jogo ativa sozinho quando a condição dela acontece. O oponente atacou e você tem a Força Careca virada? Já era.

O site é 100% estático (HTML, CSS e JavaScript puro), então roda no **GitHub Pages** sem servidor próprio.

| | |
|---|---|
| **Repositório** | [github.com/carloseduardosnp01-art/RPG-zoeiro](https://github.com/carloseduardosnp01-art/RPG-zoeiro) |
| **Site (GitHub Pages)** | [carloseduardosnp01-art.github.io/RPG-zoeiro](https://carloseduardosnp01-art.github.io/RPG-zoeiro/) |

> **Aviso:** projeto **feito por fãs, sem fins comerciais**, sem anúncios e sem nenhuma ligação com a Konami (dona de *Yu-Gi-Oh!*). As Careca Coins são moeda de brincadeira: não se compram com dinheiro e não valem dinheiro. As cartas e notícias usam nomes, apelidos e fotos da turma: **quem cria uma conta e joga está ciente de que seu nick, seu nome e sua imagem podem ser usados para fazer parte da zoeira**. Quem quiser sair é só falar com um ADM. Veja o [aviso completo](#aviso-do-jogo).

---

## Sumário
1. [Funcionalidades](#funcionalidades)
2. [Publicar no GitHub Pages](#publicar-no-github-pages)
3. [Rodar no computador](#rodar-no-computador)
4. [Como o online funciona](#como-o-online-funciona)
5. [As cartas e o deck](#as-cartas-e-o-deck)
6. [Regras e automações](#regras-e-automações)
7. [Estrutura do código](#estrutura-do-código) · [Banco de dados](#banco-de-dados-supabase)
8. [Como publicar uma notícia](#como-publicar-uma-notícia)
9. [Como criar cartas novas](#como-criar-cartas-novas) · [Como criar um cosmético](#como-criar-um-cosmético)
10. [Aviso do jogo](#aviso-do-jogo)
11. [Créditos](#créditos)

---

## Funcionalidades

- **Início** com leque de cartas em destaque e, no topo, a faixa da última notícia.
- **Notícias** (`#noticias`): anúncios de torneios e novidades, com cartaz, data do evento e contagem ("Faltam 3 dias", "É amanhã!", "É hoje!").
- **Catálogo**: busca (sem diferenciar acentos), filtros por categoria, atributo e raridade, ordenação, paginação e modal com a carta completa, ficha, "como funciona no jogo" e frase da carta (com navegação Anterior/Próxima).
- **Template próprio das cartas**, feito em HTML/CSS e usado em todo o site: moldura por tipo (Normal, Efeito, Magia, Armadilha), atributo com kanji, estrelas, selo de raridade (nome prateado, dourado, prisma (Secreta) ou arco-íris e brilho holográfico na arte; a Lendária tem o nome numa placa escura com borda dourada), moldura Divina azul, vermelha ou dourada para os deuses, número de série e selo careca. Nomes com mais de 26 letras quebram em duas linhas em vez de encolher. A mesma carta escala de 50 px (campo no celular) até a carta grande do modal.
- **Deck**:
  - **Meu deck**: editor para montar e salvar o seu deck. Clique na coleção para colocar uma cópia e no deck para tirar. Regras: de **40 a 60 cartas** e até **3 cópias** de cada (dá para tirar à vontade enquanto monta, mas só salva com 40 a 60; com 60 não dá para colocar mais). O deck salvo fica no navegador e na sua conta, e é o que você usa nos duelos online e no treino.
  - **Deck padrão** (Deck Careca Supremo): mesa com as pilhas de cópias e o resumo (40 cartas: 22 monstros, 12 magias, 6 armadilhas). É o deck de quem ainda não montou o seu e o deck do Bot Careca.
- **Regras** em acordeão.
- **Salão online** (igual ao chat do site de referência):
  - criar conta (nick, senha, clã e avatar) e entrar; **🔒 Trocar senha** no próprio perfil;
  - chat global com histórico, emojis e mensagens do sistema ("🏆 Fulano zerou os LP de Ciclano na Arena!");
  - lista de duelistas online com nível, clã e busca;
  - **botão direito** (ou toque) no duelista → *Desafiar para duelo* / *Mensagem privada*;
  - o desafio aparece numa aba privada com **Aceitar** e **Recusar**; ao aceitar, os dois vão direto para a arena;
  - perfil com nível, XP, vitórias/derrotas e botão para trocar a foto de perfil (as artes das cartas);
  - clique no nome de um duelista (ranking, chat, lista de online, histórico ou no seu próprio perfil) para abrir o **perfil** dele: nível, XP, vitórias/derrotas, se está online e os **últimos 10 duelos** com resultado, oponente e XP (o histórico fica salvo no perfil público e sincroniza entre aparelhos);
  - ranking com duas abas: **XP geral** (online + treino) e **Vitórias online**, com medalhas no top 3 e a sua posição se você estiver fora do top 10;
  - **ID do jogador**: cada conta ganha um ID sorteado (ex.: `#K7QX-9M2P`) que aparece no perfil e nunca muda (contas antigas ganham no próximo login);
  - **ADMs** (MenonICE e MenonFIRE, em `js/admin.js`): nome em vermelho com o selo **ADM** no chat, na lista de online, no ranking, no perfil e no duelo; painel com **📢 aviso no chat** e **🎁 dar Careca Coins** (pelo perfil do jogador). Como o site não tem servidor, quem prova que é ADM é uma **assinatura digital** (ECDSA P-256): a chave secreta fica só no aparelho do ADM (ativada colando o código `ZOEIRA-ADM:...` no painel do perfil) e o site só tem a chave pública. Mensagem, presença ou presente sem assinatura válida não valem (aparecem como "⚠ não verificado"). Para trocar uma chave, gere um par novo e troque a pública em `js/admin.js`;
  - **🏆 Torneio** (botão no salão): só um ADM cria. Os jogadores se inscrevem, o ADM fecha as inscrições e a **chave é sorteada** (quem sobra passa direto). Partidas **melhor de 3**, com **disputa de 3º lugar**. O ADM aperta **"Iniciar jogo"** e os dois jogadores entram sozinhos no duelo; o jogo do ADM lê o resultado e avança a chave (ele precisa ficar com a página aberta durante o torneio). Também dá para anular um jogo travado ou dar W.O. Tudo vai **assinado pelo ADM** (`torneio/atual`), então ninguém inventa resultado. Quando um torneio termina, uma cópia assinada vai para o **📚 Histórico de torneios** (`torneio/historico/<id>`), na mesma janela: pódio de cada torneio e a chave completa ("Ver a chave"); um ADM pode tirar um torneio do histórico. Regras em `js/torneio.js` (testável sem tela) e tela em `js/torneio-ui.js`;
  - **Troféus e relíquias** (`js/premios.js`): troféus de **ouro, prata e bronze** e a relíquia **Careca do Milênio**, entregues só por ADM (pelo pódio do torneio ou pelo perfil do jogador) e conferidos pela assinatura. Aparecem no perfil e, ao clicar em um troféu ou na relíquia, abre a imagem grande com os detalhes (dono, torneio, data e ADM que entregou; `js/visor-premio.js`); para tirar um prêmio entregue por engano (ou de teste), coloque o id dele em `REMOVIDOS` (`js/premios.js`): o jogo de todo mundo passa a ignorá-lo e o perfil do dono se limpa sozinho; a relíquia se equipa no perfil e vai junto para os duelos (1vs1, Tag e treino). **Compra do Destino:** 1 vez por duelo, na sua Fase Principal, com **4000 PV ou menos**, escolha qualquer carta do deck e coloque-a no topo (no Tag, cada membro usa a sua);
  - **Careca Coins** (moeda do jogo, `img/careca-coin.webp`): **+5** por vitória contra jogador de verdade (1vs1 ou Tag 2vs2) e **+1** por vitória contra o Bot; derrota não dá moeda. O saldo aparece no seu perfil, no perfil dos outros, no histórico e na tela de vitória. No perfil público ficam `coinsGanhas`, `coinsGastas` e os `presentes` de ADM (cada um com a assinatura do ADM); saldo = ganhas + presentes − gastas − compras da Loja. **Proteção:** como o servidor de mensagens é público, o jogo do dono nunca aceita de lá nada que diminua o saldo (gastos, presentes sem assinatura válida, presentes "já contados", perfil zerado ou apagado) e republica o perfil certo por cima. Isso impede alguém de zerar as moedas dos outros, mas não impede a pessoa de mexer no próprio saldo (para isso só com servidor próprio). Com o banco de dados, o perfil de cada um fica guardado no servidor. As moedas se gastam na **🛒 Loja da Zoeira**;
  - **🛒 Loja da Zoeira** (`js/loja.js`, botão no Salão, na página Deck e na carta do catálogo): cartas especiais compradas com Careca Coins. Cada uma é comprada **uma vez** e fica na coleção para sempre (fica em `compras` no perfil e vai para o banco). No editor do deck, as cartas da Loja que você ainda não tem aparecem com 🔒 e o preço; clicar nelas abre a Loja. Se um deck tiver uma carta da Loja que o jogador não comprou, ela vira **Careca Feijão** nos duelos (uma Fusão não comprada só sai do Deck Adicional). Compras vindas do servidor público (modo antigo) que o próprio jogo não fez são ignoradas, para ninguém gastar as moedas dos outros;
  - **🎨 Cosméticos** (`js/cosmeticos.js`, aba **Cosméticos** da Loja): **50 Careca Coins** cada, ou na Roleta Diária. Só mudam o visual, e o oponente vê os seus nos duelos:
    - **Molduras de avatar** (Fúria Viking, Coroa Cósmica, Trovão dos Dragões): em volta da sua foto no perfil e no placar do duelo, com uma faixa de luz e faíscas;
    - **Skin de campo** (Templo Arcano): o seu lado do campo ganha a arte, uma peça por zona (as de monstro roxas, as de magia azuis, deck e Deck Adicional em círculos vermelhos), e um fundo com pulso de luz. O lado do oponente usa a skin dele, virada;
    - **Costas das cartas** (Selo Arcano, o portal do templo): o seu deck, o seu Deck Adicional, as suas cartas baixadas e a sua mão vista pelo oponente, com um reflexo que passa de vez em quando.
    Comprado na Loja já sai usando; em **Usar / Em uso (tirar)** dá para trocar. Fica no perfil: o que você tem em `compras` (`{ cosmetico, preco }`) ou no resumo da roleta, e o que está usando em `visual` (`{ moldura, campo, verso }`), que vai no cartão do jogador para o duelo.
  - **🎡 Roleta Diária** (`js/roleta.js`, botão no Salão e no seu perfil): **1 giro grátis por dia**, que volta à meia-noite (horário de Brasília). Não dá para comprar giros, pagar para girar de novo nem aumentar as chances, e os prêmios só valem dentro do jogo. As chances aparecem na própria roleta, e o tamanho de cada fatia é a chance dela: **10 Careca Coins 50%**, **nada 30%**, **30 Careca Coins 10%**, **cosmético** que você ainda não tem **5%**, **carta da Loja** que você ainda não tem **3%** e **relíquia Careca do Milênio 2%**. Repetido vira Careca Coins: carta (já tem todas as da Loja) 100, relíquia 50, cosmético (já tem todos) 50. **Quem sorteia é o servidor** (`girar_roleta` em `supabase/banco.sql`): a roda só gira até a fatia que ele mandou, o limite de um giro por dia é conferido lá, e o perfil recebe só um resumo (`roleta`: giros, moedas, cartas e relíquias) que o navegador não consegue alterar. O prêmio vai para o chat; carta e relíquia aparecem com destaque depois que o banco confirma. A relíquia da roleta não tem assinatura de ADM: quem confirma que ela é de verdade (no perfil, no placar do duelo e ao aceitar um desafio) é o resumo no banco;
  - XP: online vitória +100 e derrota +40; contra o Bot, 30% disso (+30 / +12) sem contar vitória/derrota. Desistir do treino antes do 3º turno não dá XP.
- **👑 Reino dos Carecas (ranked)**, na aba **⚔️ Duelos** (`js/ranked.js`): **⚔️ Procurar partida** coloca você na fila (aparece no Salão como "na fila"). O jogo procura outro jogador que também está procurando; **sem ninguém em 60 segundos, você enfrenta o Bot Careca**, que vale igual. **Vitória: +1 ponto e +5 Careca Coins. Derrota: 0 ponto e +1 Careca Coin** (no ranked não tem as moedas normais de duelo; as do modo vêm do servidor). Por **temporada** (a Temporada 1 vai até 01/11/2026; as próximas, de 3 semanas): **top 3 ganha 100 / 60 / 30 Careca Coins e o Troféu do Reino dos Carecas** (ouro, prata e bronze), que aparece no perfil confirmado pelo servidor. **Ban list**: as cartas banidas aparecem na aba, e quem tem alguma no deck não entra na fila (o anfitrião também recusa um deck com carta banida).
  - **Os ADMs encerram a temporada na mão**: na aba Duelos, em "🛡️ ADM: ban list e temporada", **🏁 Encerrar** entrega os prêmios do top 3 (desempate: mais vitórias, depois menos derrotas, depois quem chegou antes), zera a classificação, abre a próxima temporada (com a data prevista escolhida, por padrão daqui a 21 dias, e a mesma ban list) e avisa no chat. Ali também dá para **mudar a ban list** e a data prevista da temporada aberta.
  - **Contra trapaça**: os pontos, as moedas do modo e os prêmios ficam no banco (`ranked_*` no `supabase/banco.sql`). Contra gente, os dois confirmam a partida no começo e a vitória só conta quando o perdedor confirma a derrota (ou depois de 5 minutos sem resposta, quando ele some no meio do duelo); se os dois disserem que venceram, ninguém ganha. Contra o Bot, largar o duelo no meio vira derrota quando você começa outro, e vitória com menos de 1 minuto de duelo não vale. Como não existe servidor juiz, um espertinho com o console aberto ainda consegue inventar vitórias contra o Bot: o placar é para a zoeira.
  - **Fila sem briga**: o mais novo na fila manda o pedido para o mais antigo, e o mais antigo aceita o primeiro e cria o duelo; assim dois jogadores nunca criam dois duelos um para o outro.
- **Arena**:
  - no PC, a arena ocupa a tela toda: os jogadores e o relógio ficam numa coluna à esquerda, as fases na vertical ao lado do campo, e o menu do site some durante o duelo (botões **⛶ Tela cheia** e **🏠 Ir ao site** na coluna dos jogadores);
  - placar com nível, cartas na mão, barra de LP e relógio da ação (60 s);
  - campo com zonas de monstro, magia/armadilha, **Zona de Campo** (1 por jogador, os dois podem ter campo ativo ao mesmo tempo; ativar outro campo manda o antigo para o Cemitério), deck e cemitério;
  - barra de fases (DRAW, STBY, MP1, BP, MP2, END);
  - clique numa carta → menu só com as ações válidas naquele momento (a carta brilha em verde quando tem ação);
  - janelas para escolher tributos, alvos, alvo do ataque e descarte;
  - animações: carta grande com frase de zoeira ao invocar/ativar ("VAPO!", "FORÇA CARECA!", "CAIU NA ARMADILHA DO BIG!"), ataque indo até o alvo, cartas explodindo, dano subindo, tela tremendo;
  - sons sintetizados (sem arquivos de áudio) com botão de mudo;
  - registro do duelo, chat do duelo com provocações rápidas e balão sobre o jogador;
  - resultado com XP ganho e **Revanche**;
  - se a página recarregar no meio do duelo, ela volta para a partida.
- **Tag da Zoeira 2vs2** (duelo em dupla):
  - no Salão, o botão **👥 Tag 2vs2** abre uma **mesa** no chat global, no estilo Clash Royale: duas vagas para o Time 1 (azul, P1 e P3) e duas para o Time 2 (vermelho, P2 e P4). Cada um toca numa vaga livre e o nick aparece lá; tocar na própria vaga sai dela. Quando as 4 vagas enchem, o duelo começa sozinho;
  - quem abriu a mesa é o "juiz": os cliques viram pedidos para ele, que decide na ordem de chegada (duas pessoas nunca ficam na mesma vaga). A mesa expira se o juiz sumir por 1 minuto ou se não lotar em 10 minutos;
  - regras do Tag Duel: cada **time** tem um campo, um cemitério e **8000 PV compartilhados**; cada jogador tem **o próprio deck e a própria mão**. Ordem dos turnos **P1 → P2 → P3 → P4**; o "controlador inimigo atual" (alvo de efeitos como o Midasmon e quem recebe o dano) é o membro do outro time que jogou por último. A arena mostra a **ordem dos confrontos** dos próximos 4 turnos;
  - só o membro da vez joga; o parceiro vê a própria mão esperando. Cartas que voltam para a mão vão para a mão do **dono**. Se o membro da vez sumir, o parceiro pode passar a vez por ele, e o outro time pode pedir W.O. depois de 1 minuto;
  - vitória/derrota contam como online (+100 / +40 XP) e aparecem no histórico como "Tag 2vs2";
- **📜 Aviso do jogo** (`js/aviso.js`, link no rodapé de todas as páginas): sem fins comerciais, feito por fãs, uso de nome e imagem na zoeira. Para criar conta é preciso marcar que leu e está ciente; quem já tinha conta vê o aviso ao entrar e escolhe entre **✔ Li e estou ciente** e **Não concordo (sair da conta)** (essa janela não fecha clicando fora; só lendo pelo rodapé é que tem o botão Fechar). A confirmação fica no perfil (`ciente: { versao, t }`, guardada no banco); para pedir uma confirmação nova depois de mudar o texto, suba `VERSAO_DO_AVISO` em `js/conta.js`.
- **Treino contra o Bot Careca**, sem precisar de conta. O bot joga limpo (não olha cartas viradas nem a sua mão) e ainda zoa no chat.
- Responsivo (celular, tablet e computador) e com foco visível, rótulos e `aria-live`.

---

## Publicar no GitHub Pages

O código já está em `github.com/carloseduardosnp01-art/RPG-zoeiro`. Para o site ir ao ar:

1. No plano gratuito do GitHub, o Pages só funciona em repositório **público**: em **Settings → General → Danger Zone → Change visibility**, deixe o repositório público.
2. Abra **Settings → Pages**, em *Build and deployment* escolha **Deploy from a branch**, branch **main**, pasta **/ (root)** e salve.
3. Em um ou dois minutos o jogo fica em `https://carloseduardosnp01-art.github.io/RPG-zoeiro/`.

Para mandar atualizações depois:

```bash
python ferramentas/nova-versao.py
git add -A
git commit -m "mensagem"
git push
```

O `nova-versao.py` coloca um número de versão (`?v=...`) no endereço dos arquivos CSS, JS e das cartas. Como o endereço muda a cada versão, o navegador baixa os arquivos novos sozinho, sem precisar de Ctrl+F5.

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
| `?banco=local` | usa um banco de testes no computador (porta 8012) em vez do Supabase. Fora do site publicado o banco fica **desligado** e o jogo usa só o modo antigo |
| `?banco=real` | força o Supabase de verdade (por exemplo, testando o site por outro endereço) |

> Dica: com "continuar conectado" marcado, a segunda aba entra na mesma conta. Clique em **Sair da conta** nela e crie a outra.

---

## Banco de dados (Supabase)

Desde 03/10/2026 o que **não pode sumir** fica num banco de dados de verdade, no [Supabase](https://supabase.com) (plano gratuito, servidor em São Paulo): **contas, perfis, Careca Coins, troféus, relíquias e o histórico de torneios**. O que é ao vivo (duelos, chat, quem está online) continua no broker MQTT, porque pode se perder sem problema. O site continua no GitHub Pages.

- `supabase/banco.sql`: tabelas e funções do banco. As tabelas ficam no esquema `zoeira`, que o site **não enxerga**; o site só chama as funções do esquema `public`, e cada uma confere a sessão de quem chamou. Ninguém consegue mexer na conta, no perfil ou nas moedas dos outros.
- `js/banco.js`: chama essas funções. Usa a chave **publishable** (feita para ficar no site). A chave **secret** e a senha do banco nunca entram no projeto.
- A senha nunca vai para o banco: o navegador manda um código derivado dela (HMAC-SHA256 com o nick), guardado lá com bcrypt. 10 senhas erradas em 15 minutos bloqueiam a conta por 15 minutos.
- O perfil grava com **versão**: se dois aparelhos gravarem ao mesmo tempo, o segundo recebe o perfil do primeiro, junta os dois e grava de novo (nada se perde).

**Instalar ou atualizar o banco:** no Supabase, **SQL Editor → New query**, cole o `supabase/banco.sql` inteiro e clique em **Run** (pode rodar de novo quando o arquivo mudar; nada é apagado). As contas dos ADMs (MenonICE e MenonFIRE) já nascem reservadas e precisam de senha, também pelo SQL Editor:

```sql
select zoeira.definir_senha('menonice', 'a senha que você usa no jogo');
select zoeira.definir_senha('menonfire', 'a senha que você usa no jogo');
```

**A mudança para o banco é automática:**
- Quem **entra** com nick e senha de uma conta antiga é levado para o banco na hora, com a mesma senha e todo o progresso.
- Quem **já estava conectado** é levado sem digitar nada; o jogo pede para ele escolher uma senha ("🔒 Escolher minha senha", pode ser a de sempre).
- Se o banco não responder (sem internet, projeto pausado), o jogo segue no modo antigo, pelo broker.

**Backup:** no Painel do ADM, **💾 Baixar backup do jogo** baixa um `.json` com todos os perfis (sem senhas), o histórico de torneios e o torneio em andamento. Faça um por semana e guarde o arquivo.

**Roleta Diária no banco:** a tabela `zoeira.roleta` guarda um giro por jogador por dia (o dia de Brasília). Para mudar as chances, mude `zoeira.faixa_da_roleta` no `banco.sql` (e a tabela `FAIXAS` em `js/roleta.js`, que só desenha a roda) e rode o arquivo de novo no SQL Editor. Enquanto o `banco.sql` novo não roda no Supabase, a roleta mostra "ainda não está ligada" e o resto do jogo funciona normal.

**Reino dos Carecas no banco:** `zoeira.ranked_temporadas` (temporadas, data prevista e ban list), `ranked_partidas` (quem jogou e o resultado que cada um mandou), `ranked_pontos` (pontos, vitórias, derrotas e moedas de cada um por temporada) e `ranked_premios` (top 3 de cada temporada encerrada). O perfil recebe um resumo (`ranked`: moedas e troféus) que o navegador não consegue alterar, como o da roleta. A Temporada 1 nasce com a ban list Controle Carecal, Espanta Trouxas e Vai um cigarrin? (mude na aba Duelos, como ADM).

**ADM no banco:** redefinir senha (mesmo de quem ainda não veio para o banco), dar troféus e moedas (ficam guardados no perfil do jogador, mesmo offline), guardar torneios e **apagar uma conta** (para quem registrou o nick de outro jogador). Senha de ADM só pelo SQL Editor.

**Plano gratuito:** o projeto "dorme" se ninguém usar por 7 dias. Os dados não se perdem; é só abrir o painel do Supabase e clicar em **Restore**.

---

## Como o online funciona

O ao vivo (chat, quem está online, desafios, duelos, mesas de Tag e torneio) passa pelo **Realtime do Supabase**, no mesmo projeto do banco (`js/rede.js`, biblioteca [supabase-js](https://github.com/supabase/supabase-js) fixada na versão 2.117.2, com hash de integridade no `index.html`). Desde 04/10/2026; antes era um broker MQTT público, que caiu (o EMQX parou de responder e o HiveMQ passou a recusar conexões por excesso). Ninguém precisa de servidor próprio: o Realtime só repassa mensagens, e toda a regra do jogo roda no navegador de cada jogador.

- **Canais separados**, para gastar pouco (o plano grátis tem 2 milhões de mensagens por mês, e uma mensagem para N pessoas conta N+1): `geral` (chat, mesas, torneio, ranking ao vivo), um por duelo (`duelo-<id>`: só quem joga recebe as jogadas) e um por jogador (`jogador-<nick>`: mensagens privadas, desafios, presentes e prêmios). Mensagem para um canal em que a aba não está vai pela API (`httpSend`).
- **Quem está online:** pela Presença do Realtime, que só manda mensagem quando alguém entra, sai ou muda (nick, status, nível); quem fecha a aba ou cai sai sozinho da lista. O salão continua mandando a presença a cada 25 s, mas a `rede.js` só repassa quando ela muda.
- **Mensagens guardadas** ("retidas", a última mensagem de cada tópico para quem chega depois: histórico do chat, torneio, mesas, estado dos duelos, prêmios): ficam na tabela `zoeira.retidas` do banco, gravadas e lidas pelas funções `gravar_retida` e `ler_retidas` (`supabase/banco.sql`). Contas, presença e perfis não vão para lá; duelos e mesas esquecidos há mais de 3 dias somem sozinhos.
- **Reserva:** se o Supabase não responder (ou o `banco.sql` novo ainda não tiver rodado), o jogo volta para o broker MQTT público (`wss://broker.emqx.io`, com `broker.hivemq.com` de reserva). Todo mundo precisa estar no mesmo para se ver. `?rede=mqtt` força o MQTT e `?rede=local` usa as abas do mesmo navegador (testes sem internet). Com `?banco=local` o Realtime é o de verdade, mas os canais ganham `teste-` no nome.

Tópicos (todos começam com `rpgdazoeira/v1/`; são os mesmos no Supabase e no MQTT):

| Tópico | Para quê |
|---|---|
| `presenca/<sessão>` | quem está online (no Supabase, pela Presença; no MQTT, mensagem retida que o broker apaga quando a aba cai) |
| `chat/global` e `chat/historico` | chat global e as últimas 40 mensagens |
| `dm/<nick>` | mensagens privadas e desafios |
| `perfis/<nick>` | aviso de que um perfil mudou (o perfil de verdade vem do banco) |
| `duelo/<id>/estado` e `duelo/<id>/sinal` | o duelo em si e os "estou aqui"/chat do duelo |
| `mesas/<id>`, `torneio/...`, `presentes/...`, `premios/...` | mesas de Tag 2vs2, torneio, presentes e prêmios de ADM |

**O duelo:** quem desafiou cria a partida com o próprio deck e o deck que o oponente mandou junto com o "aceito" (o motor confere se os dois valem; se não, usa o padrão), embaralha com uma semente e sorteia quem começa. Só age quem está na vez (as armadilhas são automáticas, então o oponente nunca precisa decidir nada no turno do outro). Quem joga aplica a jogada no próprio navegador e publica o **estado inteiro** no tópico do duelo; o outro só substitui o dele. Como o estado fica guardado (no banco, ou retido no broker), quem recarregar a página volta para a partida.

**Ressincronização:** se uma mensagem se perder (celular que saiu do app, internet que caiu uns segundos), quem está esperando pede o estado guardado de novo sozinho: a cada 5 s sem novidades, quando a aba volta a ficar visível e quando a conexão volta. Só estados com `seq` maior são aplicados, então isso nunca desfaz jogada. (No Supabase, `pedirRetido` lê do banco. No MQTT, o MQTT.js ignora um "subscribe" repetido de um tópico já assinado, por isso `pedirRetido` sai e entra de novo no tópico para o broker reenviar o valor retido.)

**Ausência:** cada navegador manda um sinal a cada 8 s no Supabase (5 s no MQTT). Se o oponente sumir por 20 s aparece um aviso; depois de 60 s dá para **reivindicar vitória por W.O.** Se o tempo da ação (60 s) acabar, o turno passa sozinho.

### Deck e versões do site

- O deck salvo tem data própria. Quando o perfil chega de outra aba ou aparelho, o jogo junta as duas cópias: vale o **deck salvo mais recente** e as estatísticas nunca diminuem (antes, uma cópia antiga do perfil, publicada ao ganhar XP, podia apagar o deck).
- Cada desafio leva a "versão" das cartas. Se os dois jogadores estiverem com versões diferentes do site (um deles com a página antiga em cache), o desafio é recusado com o aviso para recarregar, em vez de o jogo trocar o deck pelo padrão sem avisar.
- A cada 3 minutos o site confere se saiu uma versão nova das cartas e avisa para recarregar.

### Limitações (é zoeira, mas é bom saber)

- O broker é **público**: qualquer pessoa que conheça os tópicos consegue ler as mensagens. Não mande nada sério pelo chat.
- A senha nunca sai do navegador: vai só um hash **PBKDF2 (150 mil iterações, com sal)**. Mesmo assim, **use uma senha só para o jogo**.
- **Esqueceu a senha?** Ninguém consegue ver a senha (nem os ADMs), só trocar. No **Painel do ADM** (ou no perfil do jogador), o ADM digita o nick e define uma **senha provisória**, que passa para o dono em particular. No login com ela, o jogo avisa e já abre o "🔒 Trocar senha". As estatísticas, moedas e prêmios da conta não mudam. Se a conta nem estiver no servidor (ver abaixo), o jogo pergunta se o ADM quer recriá-la com a senha provisória.
- **O servidor público pode esquecer tudo** (broker.emqx.io é gratuito e sem garantia: já apagou perfis, contas, chat e torneios). O jogo se recupera sozinho: quem está logado, ao abrir o jogo, devolve o próprio perfil e a conta a partir da cópia do aparelho; o ADM que organiza devolve o torneio em andamento e qualquer jogador devolve os torneios do histórico (são assinados). Quem só joga em outro aparelho precisa entrar de novo no aparelho de sempre.
- **🧹 Limpar o chat global** (Painel do ADM): apaga as mensagens para todo mundo (vale só com a assinatura do ADM).
- Não há um servidor juiz, então um espertinho com o console aberto consegue trapacear. Jogue com amigos.
- Brokers públicos podem limpar mensagens retidas. Por isso cada navegador guarda uma cópia da conta e do perfil e republica ao entrar.
- Contas, perfis, moedas e troféus agora ficam no banco (veja **Banco de dados**); o broker público só guarda o que é ao vivo.

---

## As cartas e o deck

As artes vieram das cartas que você mandou, recortadas só na ilustração (`img/cartas/*.webp`, 640×640). O resto da carta é desenhado pelo site.

| Código | Carta | Tipo | Cópias | Resumo |
|---|---|---|---|---|
| ZOE-PT001 | Careca Feijão | Monstro Normal · Nv 3 · 1750/0 | 3 | Bate forte e é o tributo perfeito |
| ZOE-PT002 | Grande Mestre | Monstro Normal · Nv 7 · 2500/2100 | 3 | O chefão (2 tributos, ou via Invocador) |
| ZOE-PT003 | Careca Cast Surpresa | Efeito/Virar · Nv 2 · 450/600 | 2 | VIRE: pode destruir 1 monstro |
| ZOE-PT004 | Miro Animal | Efeito · VENTO · Besta Alada · Nv 4 · 2000/1500 | 3 | Saideira: destruiu monstro em batalha → +500 de dano **(efeito inventado: a carta original está sem texto)** |
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
| ZOE-PT019 | Midasmon **(limitada a 1)** | Efeito/Virar · Nv 2 · 1000/400 | – | VIRE: o oponente descarta 1 carta (você escolhe no seu turno; sorteada no turno dele) |
| ZOE-PT020 | Karecoh Alado | Efeito · Nv 1 · 300/200 | – | Destruído no campo → sem dano de batalha pelo resto do turno |
| ZOE-PT021 | Wellington, O Guerreiro Mágico | Efeito · Nv 4 · 1600/1600 | – | Entra com 1 Marcador (+300 ATK); botão Efeito gasta o marcador e destrói 1 Magia/Armadilha |
| ZOE-PT022 | O Alquimista das Farmácias **(limitada a 1)** | Efeito/Virar · Nv 3 · 1500/1300 | – | VIRE: busca 1 Magia do deck (você escolhe no seu turno; sorteada no turno do oponente) |
| ZOE-PT023 | Miqueas, o Mestre das Lâminas e Punhos **(limitada a 1)** | Efeito · Nv 6 · 2400/2200 | – | Ao ser Invocado pode destruir 1 Magia/Armadilha; botão Efeito (só na Fase Principal 1): descarta 1 carta e ataca 2 vezes |
| ZOE-PT024 | Manoel do Gelo | Efeito · ÁGUA · Nv 3 · 1500/1200 | – | Destruído: chama outro "Manoel do Gelo" sorteado do deck (1 vez por turno) |
| ZOE-PT025 | Manoel do Gelo Careca | Efeito · ÁGUA · Nv 7 · 2400/1900 | – | Invocação-Especial descartando 2 de ÁGUA; botão Efeito (só na Fase Principal 1): tributa 1 de ÁGUA em ataque e ataca 2 vezes |
| ZOE-PT026 | Pote do Gelo | Magia | – | Devolve 2 cartas "gelo" da mão ao deck e compra 3 |
| ZOE-PT027 | Lamento Prematuro **(limitada a 1)** | Magia de Equipamento | – | Paga 800 PV e traz 1 monstro do seu Cemitério em ataque; se ela for destruída, o monstro vai junto |
| ZOE-PT028 | Sai Daqui Obeso | Armadilha | – | Oponente atacou → o atacante volta para a mão dele |
| ZOE-PT029 | O Último Gole **(limitada a 1)** | Magia de Equipamento | – | Dobra o ATK de 1 monstro; no fim do turno ele é destruído |
| ZOE-PT030 | O Herói do Lamento | Monstro Normal · LUZ · Nv 7 · 2500/2000 | – | Guerreiro das estrelas |
| ZOE-PT031 | ADM Ditador **(limitada a 2)** | Armadilha | – | Oponente Invocou (qualquer tipo, inclusive Especial) um monstro com 1500+ de ATK → esse monstro é banido (sai do jogo) |
| ZOE-PT032 | David Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1300/1400 | – | Todos os monstros de VENTO ganham 300 de ATK |
| ZOE-PT033 | Davi Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1700/600 | – | Invocação-Normal: devolve 1 Besta Alada sua + 1 monstro do oponente para a mão. No Cemitério: busca 1 Besta Alada Nv 4 de até 1500 ATK |
| ZOE-PT034 | Thales Animal **(limitada a 2)** | Efeito · VENTO · Besta Alada · Nv 4 · 1400/1300 | – | Ao ser Invocado: busca Egoísmo Puro / Zoológico Animal (2 com um "Animal" Nv 5+) |
| ZOE-PT035 | George Animal | Efeito · VENTO · Dragão · Nv 7 · 2000/2500 | – | "Animal" de Nv 6 ou menos não podem ser atacados; Invocação-Especial em defesa com VENTO Nv ≤ 6; ao ir pro Cemitério manda 1 VENTO Besta Alada do deck pro Cemitério |
| ZOE-PT036 | John Animal **(limitada a 2)** | Efeito · VENTO · Besta Alada · Nv 4 · 1400/1300 | – | Botão Efeito: descarta 1 "Animal" e chama 1 "Animal" do deck em Defesa |
| ZOE-PT037 | Wellington Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1000/900 | – | +500 ATK por VENTO seu com a face para cima; não pode ser atacado se você tiver outro VENTO |
| ZOE-PT038 | Miqueas Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1900/1200 | – | Descarta da mão para buscar o "Zoológico Animal" |
| ZOE-PT039 | Midas Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1200/1000 | – | Botão Efeito: devolve 1 VENTO seu para a mão e faz uma Invocação-Normal extra de VENTO |
| ZOE-PT040 | Big Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1300/1400 | – | Invocação-Especial com "Animal" Nv 5+; ao ser Invocado, na Fase Principal 2 recupera do Cemitério Egoísmo Puro ou Zoológico Animal |
| ZOE-PT041 | Emanoel Animal | Efeito · VENTO · Besta Alada · Nv 4 · 1600/1600 | – | Destruído em batalha: busca 1 "Animal" sorteado do deck |
| ZOE-PT042 | Irmãos Animal | Efeito · VENTO · Besta Alada · Nv 6 · 1950/2100 | – | Só entra pela carta "Egoísmo Puro" |
| ZOE-PT043 | Egoísmo Puro | Magia | – | Com um "Animal" no campo: Invocação-Especial de 1 "Animal" ou Irmãos Animal da mão ou do deck |
| ZOE-PT044 | Zoológico Animal | Magia de Campo | – | Vai para a Zona de Campo. Bestas Aladas +200 ATK/DEF; quem Invocar um "Animal" pode destruir 1 Magia/Armadilha |
| ZOE-PT045 | Irmãollow **(limitada a 1)** | Efeito · LUZ · Fada · Nv 3 · 300/500 | – | Não é destruído em batalha; atacado virado para baixo → quem atacou leva 1000 |
| ZOE-PT046 | Controle Carecal **(limitada a 1)** | Magia | – | Paga 800 PV e toma o controle de 1 monstro com a face para cima do oponente até a Fase Final |
| ZOE-PT047 | Menino Mentiroso | Magia | – | Sem monstros no seu campo: Invocação-Especial de 1 Monstro Normal Nv 4 ou menos do deck |
| ZOE-PT048 | Grande Mestre do Caos | Efeito · TREVAS · Mago · Nv 8 · 2800/2600 | – | Invocado neste turno: na Fase Principal 2, botão Efeito pega 1 Magia do Cemitério; bane quem ele destrói em batalha; com a face para cima, é banido ao sair do campo |
| ZOE-PT049 | Upstart Gordo | Magia | – | Compra 1 carta e o oponente ganha 1000 PV |
| ZOE-PT050 | Jinreca | Efeito · TREVAS · Máquina · Nv 6 · 2400/1500 | – | Com a face para cima no campo, nenhuma Armadilha ativa (dos dois lados) |
| ZOE-PT051 | As Mil Facas do Mestre | Magia | – | Com Grande Mestre ou Grande Mestre do Caos seu no campo: destrói todos os monstros do oponente |
| ZOE-PT052 | Berinjela do Imenso **(limitada a 1)** | Magia de Equipamento | – | +900 ATK por carta com o mesmo nome do monstro nos dois Cemitérios (todo "Animal" se chama "Animal") |
| ZOE-PT053 | Revolução Animal **(limitada a 2)** | Armadilha Contínua | – | A única que você ativa (no seu turno, a partir do seguinte ao que baixou): descarta 1 carta e Invoca os "Animal" do Cemitério; se ela sair do campo, eles são destruídos |
| ZOE-PT054 | Rafaza the Careca **(limitada a 2)** | Efeito · TREVAS · Guerreiro · Nv 3 · 1300/800 | – | Ataca 2 vezes em toda Batalha; o Controle Carecal não pega ele |
| ZOE-PT055 | Os Negão Pegaram Ele | Efeito · TERRA · Guerreiro · Nv 4 · 1000/1000 | – | Botão Efeito: vai como Tributo e destrói 1 monstro do campo |
| ZOE-PT056 | Mirasita | Efeito/Virar · TERRA · Inseto · Nv 2 · 500/300 | – | VIRE: vai para o deck do oponente; quando ele comprar, entra em Defesa do lado dele, ele leva 1000 e os monstros dele viram Insetos |
| ZOE-PT057 | 1 Litro de Porra pela Manhã | Magia | – | +2000 PV (1 por turno) |
| ZOE-PT058 | Daiki, Chaos Calvo **(limitada a 1)** | Efeito · TREVAS · Mago · Nv 6 · 2300/2000 | – | Só entra pela mão banindo 1 LUZ e 1 TREVAS do Cemitério; botão Efeito bane 1 monstro com a face para cima (nesse turno não ataca) |
| ZOE-PT059 | Sugadão **(limitada a 1)** | Magia | – | Destrói todas as Magias e Armadilhas do campo (Zonas de Campo também) |
| ZOE-PT060 | Hoje Não | Armadilha | – | Ativa sozinha num ataque que machucaria: no resto do turno você não sofre dano de batalha e seus monstros não são destruídos em batalha |
| ZOE-PT061 | Bora Bill **(limitada a 1)** | Magia | – | Se um monstro seu foi do campo para o Cemitério neste turno: Invocação-Especial de 1 monstro com até 1500 de ATK do deck |
| ZOE-PT062 | Thangan **(limitada a 1)** | Efeito · TREVAS · Demônio · Nv 3 · 1000/600 | – | Saiu do campo para o Cemitério: 1 monstro sorteado com até 1500 de ATK do deck para a mão (os efeitos dele ficam bloqueados no turno) |
| ZOE-PT063 | W — Hackeando Sistema **(limitada a 1)** | Armadilha | – | Ativa sozinha quando o oponente ativa Magia/Armadilha: descarta 1 carta sorteada, nega e destrói |
| ZOE-PT064 | W — Guerreiro das Lâminas Gêmeas | Efeito · TERRA · Internet · Nv 4 · 1700/1000 | – | Contra monstro em Defesa: dano perfurante e um 2º ataque (1 vez por Batalha); só 1 dele no seu campo |
| ZOE-PT065 | Armadura de Gelo | Armadilha | – | Ativa sozinha quando um monstro do oponente ataca: bane o atacante |
| ZOE-PT066 | Obelisco, o Imenso **(limitada a 1)** | Efeito · DIVINO · Besta Divina · Nv 10 · 4000/4000 | – | 3 tributos, não pode ser baixado, ninguém responde à Invocação-Normal e nenhum efeito escolhe ele como alvo; botão Efeito: tributa 2 e destrói todos os monstros do oponente |
| ZOE-PT067 | Dragão Sulista Safado Olhos Nada Azuis | Monstro Normal · LUZ · Dragão · Nv 8 · 3000/2500 | – | Material do Miro, o Adestrador de Dragões |
| ZOE-PT068 | Suruba | Magia | – | Invocação-Fusão: 1 Monstro de Fusão do Deck Adicional com materiais da mão ou do campo |
| ZOE-PT069 | Miro, o Adestrador de Dragões **(limitada a 1)** | Fusão · LUZ · Dragão · Nv 8 · 3000/2500 | – | "Grande Mestre" + "Dragão Sulista"; no campo se chama "Grande Mestre"; o oponente não mira nem destrói com efeitos as suas Magias/Armadilhas |
| ZOE-PT070 | Careca Lamentador | Fusão · TREVAS · Guerreiro · Nv 8 · 3000/3000 | – | 1 monstro "Careca" + 1 monstro "Lamento/Lamentador/Lamentável" ou "Thales"; dano perfurante |
| ZOE-PT071 | Chaos Kelvor - Prodígio **(Loja: 200 🪙, limitada a 1)** | Efeito · TREVAS · Dragão · Nv 8 · 3000/2500 | – | Só entra pela mão banindo 1 LUZ e 1 TREVAS do Cemitério; botão Efeito (1 vez por turno): paga 1000 PV, manda as duas mãos e os dois campos para o Cemitério (o Kelvor vai junto) e dá 300 de dano por carta do oponente que foi; depois você não ativa mais nada no turno |
| ZOE-PT072 | Black Luster Daiki - Enviado do Hospício **(Loja: 200 🪙, limitada a 1)** | Efeito · LUZ · Guerreiro · Nv 8 · 3000/2500 | – | Entra como o Daiki; botão Efeito (1 vez por turno): bane 1 monstro do campo (nesse turno não ataca); destruiu monstro em batalha → 2º ataque |
| ZOE-PT073 | Mago Dragão Sonho do BIG **(Loja: 500 🪙, limitada a 1)** | Fusão · LUZ · Mago · Nv 10 · 3750/2900 | – | "Grande Mestre" + 1 ou mais "Dragão Sulista"; **só entra pela Suruba** (nem o Lamento Prematuro traz de volta); usos por turno = Dragões usados: nega e bane efeitos da mão/Cemitério do oponente e nega ataques (ganhando PV); protegido de efeitos de monstro e Armadilhas do oponente; saiu do campo → Miro, o Adestrador entra do Deck Adicional |
| ZOE-PT074 | Miro, o Sulista Calvo **(Loja: 100 🪙, limitada a 1)** | Efeito · LUZ · Besta Alada · Nv 8 · 3000/2600 | – | Só entra pela mão com 4+ monstros de LUZ de nomes diferentes no Cemitério; botão Efeito: paga 1000 PV e destrói todas as outras cartas do campo; Fase Final: manda 4 cartas do topo do deck para o Cemitério |
| ZOE-PT075 | Calvo-In | Magia | – | Descarta 1 monstro de Nível 8 da mão e compra 2 cartas |
| ZOE-PT076 | Miro Metálico Calvo Dragon | Efeito · TREVAS · Dragão · Nv 10 · 2800/2400 | – | Invocação-Especial da mão banindo 1 Dragão seu com a face para cima (1 por turno; também entra com 2 tributos); botão Efeito (1 por turno): Invoca 1 Dragão da mão ou do Cemitério (menos outro Miro Metálico) |
| ZOE-PT077 | AlexanMiro | Monstro Normal · LUZ · Dragão · Nv 4 · 2000/100 | – | Dragão de alexandrita sem tributo |
| ZOE-PT078 | Wellyborgue | Monstro Normal · TERRA · Máquina · Nv 4 · 1900/1500 | – | Guerreiro cibernético de escudo e lâmina de plasma |
| ZOE-PT079 | WI-FI Grátis | Magia de Campo | – | Todos os monstros do Tipo Internet (os "W", com a face para cima, dos dois lados) +500 ATK e −400 DEF |
| ZOE-PT080 | Espanta Trouxas **(limitada a 1)** | Magia | – | Destrói todos os monstros do oponente |
| ZOE-PT081 | Geada da Peste | Magia de Campo | – | (Também se chama "Gelada".) Monstros de ÁGUA no campo +200 ATK/DEF; os de ÁGUA nas mãos e no campo ficam com 1 Nível a menos (o Manoel do Gelo Careca passa a pedir 1 tributo) |
| ZOE-PT082 | Guerreiro Manoel | Monstro Normal · ÁGUA · Guerreiro · Nv 4 · 2000/1500 | – | Guerreiro das correntes congelantes do norte |
| ZOE-PT083 | Daiki Místico | Monstro Normal · LUZ · Mago · Nv 4 · 800/2000 | – | Elfo de pouco ataque e muita defesa |
| ZOE-PT084 | Defense Careca | Efeito · TREVAS · Guerreiro · Nv 6 · 1550/2500 | – | Invocado por Invocação-Normal ou Flip vai para Defesa; ataca mesmo em Defesa, usando o ATK |
| ZOE-PT085 | Doutor Daiki **(limitada a 1)** | Efeito · TREVAS · Mago · Nv 1 · 300/300 | – | Botão Efeito (Ataque ou Defesa): paga 1000 PV e Invoca 1 Fusão de Nível 6 ou menos do Deck Adicional; ela não ataca direto e volta no fim do turno |
| ZOE-PT086 | Slif o Dragão Careca do Céu **(limitada a 1)** | Efeito · DIVINO · Besta Divina · Nv 10 · ?/? | – | 3 tributos, não pode ser baixado, ninguém responde à Invocação-Normal; 1000 de ATK/DEF por carta na sua mão; monstro do oponente Invocado (Normal ou Especial) em Ataque perde 2000 de ATK e, se zerar, é destruído; se entrou por Invocação-Especial, vai para o Cemitério na Fase Final |
| ZOE-PT087 | O Emanuel Careca de ICE **(limitada a 1)** | Efeito · DIVINO · Besta Divina · Nv 10 · ?/? | – | 3 tributos, não pode ser baixado nem Invocado por Invocação-Especial, ninguém responde à Invocação-Normal; ao entrar pode pagar PV até ficar com 100 e ganha isso de ATK/DEF; botão Efeito: paga 1000 PV e destrói 1 monstro do campo |
| ZOE-PT088 | W — O Hacker | Efeito · TERRA · Internet · Nv 3 · 1200/800 | – | Com um monstro "W" seu com a face para cima, entra da mão por Invocação-Especial (Ataque ou Defesa); tributado numa Invocação-Tributo: compra 1 e descarta 1 |
| ZOE-PT089 | Chamado dos Vagabundos **(limitada a 1)** | Armadilha Contínua | – | Ativada pelo jogador (a partir do turno seguinte, na Fase Principal): traz 1 monstro do seu Cemitério em Ataque; se ela sair do campo o monstro é destruído, e se o monstro for destruído ela vai junto |
| ZOE-PT090 | W — Miqueas, o Quebrador de Runas **(limitada a 1)** | Efeito · TERRA · Internet · Nv 6 · 2300/1900 | – | Ao entrar (Tributo, Flip ou Especial) destrói 1 Magia/Armadilha; na mão, entra por Invocação-Especial quando alguém ativa uma Armadilha; no campo, a 1ª Armadilha do seu turno dá 2 ataques (sem ataque direto) |
| ZOE-PT091 | W — Midas, o Ladrão de Dados **(limitada a 1)** | Efeito · TERRA · Internet · Nv 3 · 1400/1000 | – | Ao entrar, vê as Magias/Armadilhas da mão do oponente e pode fazer ele descartar 1 (o Midas perde 200 de ATK); destruído em batalha: compra 1 |
| ZOE-PT092 | W — A Rede Central **(limitada a 2)** | Magia de Campo | – | Monstros "W" +200 de ATK; botão Efeito (1 vez por turno): Invoca 1 "W" da mão; "W" seu destruído: pega 1 carta "W" do Cemitério |
| ZOE-PT093 | Os Irmãos **(limitada a 1)** | Efeito · TREVAS · Guerreiro · Nv 4 · 1800/2000 | – | Botão Efeito (1 vez por turno): bane até 2 monstros do seu Cemitério, +300 de ATK cada; o oponente só pode atacar eles; com uma carta "Alquimista" no campo, seus monstros não são destruídos em batalha |
| ZOE-PT094 | Soul Chapado | Efeito · TREVAS · Mago · Nv 1 · 0/0 | – | Na mão (1 vez por turno): manda 1 Mago Nv 6+ do deck ao Cemitério e entra em Defesa, ou vai junto e traz o Grande Mestre / a Feiticeira Careca do Cemitério; no campo (1 vez por turno): manda até 2 Magias/Armadilhas (mão ou campo) ao Cemitério e compra a mesma quantidade |
| ZOE-PT095 | Cigarrin Gostoso | Magia Normal | – | Manda 1 Monstro Normal seu com a face para cima ao Cemitério e compra 2 |
| ZOE-PT096 | Vai um cigarrin? **(limitada a 1)** | Magia Contínua | – | Quem tem menos PV não sofre dano; 1 vez por turno o duelista da vez (de qualquer lado) paga 1000 PV e compra 1, destrói a carta ou dá 1000 PV ao oponente |
| ZOE-PT097 | Mystic Daikizinho | Efeito · TREVAS · Planta · Nv 4 · 1400/1100 | – | Destruído em batalha (e no Cemitério): chama 1 TREVAS sorteado com até 1500 de ATK do deck, em Ataque |
| ZOE-PT098 | Shining Zoom | Efeito · LUZ · Fada · Nv 4 · 1400/800 | – | Destruído em batalha (e no Cemitério): chama 1 LUZ sorteado com até 1500 de ATK do deck, em Ataque |

**Atributos:** TERRA, TREVAS, LUZ, ÁGUA (水), VENTO e DIVINO. Desde 04/10/2026 não existem mais GELO (os Manoel do Gelo viraram ÁGUA; o "gelo" do Pote do Gelo é ÁGUA ou "Gelo" no nome) nem INTERNET como atributo: os monstros "W" são TERRA e do **Tipo Internet** (o antigo Ciberso), e é esse Tipo que ganha o bônus do WI-FI Grátis. O Nível "na hora" (`nivelAtual` em `js/motor.js`, por causa da Geada da Peste) é o que vale para os tributos e para os efeitos que olham o Nível na mão e no campo.

**Cartas da Loja:** as quatro cartas "Lendária da Zoeira" (ZOE-PT071 a 074) não estão no deck padrão: são compradas com Careca Coins na 🛒 Loja (veja em [Funcionalidades](#funcionalidades)). **Lendária da Zoeira é só para essas exclusivas**, que ninguém tem no começo; as outras cartas fortes vão até Ultra Rara, e os três deuses (Obelisco, Slif o Dragão Careca do Céu e O Emanuel Careca de ICE) são **Secreta**, liberados para todo mundo no editor. Detalhes que valem no jogo:
- **Entrada lendária:** quando uma delas entra em campo, a arena faz uma entrada especial: a carta desce do céu com raios arco-íris, faíscas, clarão, tremor e fanfarra, com o selo "★ LENDÁRIA DA ZOEIRA ★" e uma frase só dela (`ENTRADAS_LENDARIAS` em `js/arena.js`). Em campo, ela fica com uma aura arco-íris pulsando.
- O **Chaos Kelvor** e o **Miro, o Sulista Calvo** pedem confirmação antes de ativar o efeito (os dois limpam a mesa, inclusive as suas cartas).
- O **Mago Dragão Sonho do BIG** só pode ser Invocado por Invocação-Fusão (`"somenteFusao": true` em `data/cartas.json`): nenhum outro efeito o coloca no campo, nem depois de ele ter entrado pela Suruba.
- As proteções do **Mago Dragão Sonho do BIG** são automáticas, como as armadilhas. "Efeito da mão" vale para Magias ativadas da mão e para efeitos ativados da mão (Miqueas Animal, Manoel do Gelo Careca); "do Cemitério", para George, Thangan e Davi Animal. Os usos do turno são um só, para as duas proteções.
- **Os deuses (Obelisco, Slif o Dragão Careca do Céu e O Emanuel Careca de ICE):** `"tributos": 3`, `"naoBaixa": true` (não pode ser baixado) e `"semResposta": true` (nenhuma Armadilha responde à Invocação-Normal). `"cemiterioSeEspecial": true` manda para o Cemitério na Fase Final quem entrou por Invocação-Especial; `"naoEspecial": true` impede Lamento Prematuro e Bora Bill de trazer a carta. Com `"statsVariaveis": true` a carta mostra ATK/DEF **"?"** fora do campo; no campo aparecem os valores de verdade (`atkAtual`/`defAtual`, que somam `bonusDosDeuses` em `js/motor.js`).
- **Cartas "W":** são as que têm o nome começando com "W —" (`ehW` em `js/motor.js`). Valem para o W — O Hacker, a W — A Rede Central e os "W" que entram por ela. Os gatilhos dos "W" (Hacker tributado, Miqueas, Midas, Rede Central) entram na fila de gatilhos: no seu turno você escolhe; no turno do oponente são automáticos (sorteados), como os outros gatilhos do jogo.
- **Visual dos deuses:** o campo `"tema"` escolhe a cor da moldura Divina: `"azul"` (Obelisco), `"vermelho"` (Slif o Dragão Careca do Céu) ou `"dourado"` (O Emanuel Careca de ICE) (`css/carta.css`). A raridade **Secreta** deixa o nome prateado com um reflexo de arco-íris e a arte com uma trama brilhante em losango. Na arena, um deus entra com clarão, raios e halo na cor dele, selo "✦ DEUS DA ZOEIRA ✦" e uma frase só dele (`ENTRADAS_DIVINAS` em `js/arena.js`), e fica com uma aura dessa cor no campo.
- O **Black Luster Daiki** e o **Chaos Kelvor** entram do mesmo jeito que o Daiki, Chaos Calvo: da mão, banindo 1 monstro de LUZ e 1 de TREVAS do seu Cemitério.

**Cartas "Animal":** todo monstro com "Animal" no nome conta como "Animal" para esses efeitos. Para criar uma Magia/Armadilha que o Thales Animal consiga buscar, coloque `"mencionaIrmaos": true` nela em `data/cartas.json`.

**Fusão e Deck Adicional:** os Monstros de Fusão (moldura roxa) não contam nas 40 a 60 cartas: ficam no **Deck Adicional** (até 15), que aparece no canto do tabuleiro (a antiga "Zona Careca"; tocando no seu, dá para ver as cartas). Eles só entram pela Magia "Suruba", que manda os 2 materiais (da mão ou do campo) para o Cemitério. No `data/cartas.json`, uma Fusão tem `"subtipo": "fusao"` e `"materiais"`: `{"nome": "..."}` (nome exato) ou `{"contem": "..."}` (pedaço do nome; pode ser uma lista, como `["lament", "thales"]`). Se uma Fusão fosse voltar para a mão, volta para o Deck Adicional.

**Cemitério e banidas:** toque no Cemitério (de qualquer jogador, mesmo vazio) para ver as cartas dele; a janela tem uma aba **Banidas** com as cartas que saíram do jogo. Quando alguém tem cartas banidas, aparece um selo 🚫 com o número ao lado do Cemitério.

**Dono e controle:** o Controle Carecal pode deixar um monstro no campo do outro jogador até a Fase Final. Tudo o que sai do campo vai sempre para o **dono** da carta (Cemitério, mão ou banidas), nunca para quem estava controlando.

**Cartas limitadas:** algumas cartas fortes só podem ter 1 (ou 2) cópias por deck (o campo `"limite"` em `data/cartas.json`; `0` = banida). O editor não deixa passar do limite e não salva um deck acima dele. Se um jogador entrar num duelo com cópias acima do limite (um deck salvo antes da carta ser limitada, por exemplo), as sobras viram **Careca Feijão** na hora, mesmo passando de 3 Feijões, e o registro do duelo avisa.

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
├── index.html            # Todas as telas (início, notícias, catálogo, deck, regras, salão, arena)
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
│   ├── conta.js          # Cadastro, login, sessão no banco e estatísticas
│   ├── banco.js          # Chamadas ao banco de dados (Supabase)
│   ├── rede.js           # Tempo real: Realtime do Supabase (ou MQTT público de reserva, ou abas locais)
│   ├── catalogo.js       # Catálogo, modal, leque e mesa do deck padrão
│   ├── noticias.js       # Página de notícias e faixa da última notícia no início
│   ├── loja.js           # Loja da Zoeira (cartas compradas com Careca Coins)
│   ├── aviso.js          # Aviso do jogo (sem fins comerciais, nome e imagem) e confirmação de ciência
│   ├── roleta.js         # Roleta Diária (1 giro grátis por dia; o sorteio é do servidor)
│   ├── cosmeticos.js     # Cosméticos: molduras de avatar, skin de campo e costas das cartas
│   ├── deck.js           # Deck do jogador: guardar, validar, usar nos duelos
│   ├── editor-deck.js    # Tela "Meu deck"
│   ├── cartas-ui.js      # HTML das cartas (frente e verso)
│   ├── som.js            # Efeitos sonoros (Web Audio)
│   └── util.js           # Funções pequenas
├── supabase/banco.sql    # Banco de dados: tabelas, funções e permissões (cole no SQL Editor do Supabase)
├── data/cartas.json      # As 98 cartas (texto, stats, cópias no deck padrão, efeito, preço na Loja)
├── data/noticias.json    # As notícias (a mais nova aparece primeiro)
├── img/noticias/         # Cartazes das notícias
├── img/cartas/           # Artes recortadas (WebP 640×640)
├── img/cosmeticos/       # Molduras, peças da skin de campo (uma por zona), fundo, prévia e costas
└── fontes/               # Cinzel e Crimson Pro (SIL Open Font License)
```

O **motor** é independente da tela: dá para rodar partidas inteiras no Node (foi assim que ele foi testado, com milhares de partidas bot × bot e jogadas aleatórias, conferindo que nenhuma carta some ou duplica e que toda partida termina).

---

## Como publicar uma notícia

1. Coloque o cartaz em `img/noticias/` (WebP, uns 900 px de largura).
2. Acrescente um objeto no começo de `data/noticias.json`:
   - `id` (único, sem espaços), `publicada` e, se for um evento, `evento` (as duas no formato `AAAA-MM-DD`);
   - `categoria` (ex.: `"🏆 Torneio"`), `titulo`, `texto` (use `
` para pular linha), `imagem`, `largura`, `altura` e `alt` (descrição do cartaz);
   - `botao` (opcional): `{ "texto": "...", "href": "#salao" }`.
   - `encerrado` (opcional): `true` quando o evento já terminou (o selo vira "Encerrado").
3. Rode `python ferramentas/nova-versao.py` e publique. A mais nova (pela data `publicada`) vira a faixa da página inicial.

---

## Como criar um cosmético

1. **Moldura de avatar:** PNG/WebP quadrado com o centro transparente (o buraco onde entra a foto), uns 512×512, em `img/cosmeticos/`. Em `js/cosmeticos.js`, uma linha em `COSMETICOS` com `tipo: "moldura"`, `nome`, `imagem`, `descricao` e `abertura` (quanto da largura da imagem é o buraco, de 0 a 1).
2. **Skin de campo:** uma peça em pé (proporção de carta, 59×86) para cada zona (`campo`, `monstro`, `cemiterio`, `magia`, `deck`, `extra`), um fundo e uma prévia para a Loja, com o nome `campo-<skin>-<zona>.webp`. Em `COSMETICOS`: `tipo: "campo"`, `skin: "<skin>"`, `previa`; e no fim de `css/arena.css`, as linhas `.zona[data-skin="<skin>"][data-zona="..."]` e `.campo__fundo[data-skin="<skin>"]` (copie as do Templo Arcano).
3. **Costas das cartas:** uma arte em pé (59×86, uns 452×660) em `img/cosmeticos/`. Em `COSMETICOS`: `tipo: "verso"`, `skin`, `imagem`.
4. Para a **Roleta Diária** também poder dar o cosmético, acrescente o id em `v_cosmeticos` (função `zoeira.girar` no `supabase/banco.sql`) e rode o arquivo de novo no SQL Editor.

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
5. Para vender a carta na **Loja**, coloque `"loja": preço` (em Careca Coins) e `"copias": 0`. Ela aparece sozinha na Loja e fica trancada no editor para quem não comprou. Para a **Roleta Diária** também poder dar essa carta, acrescente o id dela em `v_loja` (função `zoeira.girar` no `supabase/banco.sql`) e rode o arquivo de novo no SQL Editor.

---

## Aviso do jogo

O mesmo texto da janela **📜 Aviso** do site:

- **Sem fins comerciais.** O jogo é gratuito e feito por fãs: não tem anúncios, não vende nada e ninguém ganha dinheiro com ele. As Careca Coins são moeda de brincadeira: não se compram com dinheiro de verdade, não valem dinheiro e não se trocam por nada fora do jogo.
- **Paródia feita por fãs.** As regras são inspiradas em *Yu-Gi-Oh!*, marca da Konami. O jogo não tem ligação com a Konami nem com nenhuma outra empresa. As cartas, artes, nomes e textos são paródias feitas pela turma.
- **Nome e imagem na zoeira.** O jogo usa apelidos, nomes e fotos dos participantes em cartas, artes, notícias, troféus e brincadeiras. Quem cria uma conta e joga está ciente e de acordo que seu nick, seu nome, sua imagem e seus resultados (ranking, troféus, histórico de duelos e mensagens no chat) podem aparecer no jogo e ser usados para fazer parte da zoeira, sempre sem fins comerciais.
- **Zoeira com respeito.** É brincadeira entre amigos: nada de ofensa de verdade, preconceito ou humilhação. Os ADMs podem limpar o chat, mudar cartas e apagar contas que passem do limite.
- **Quer sair da zoeira?** Quem não quiser mais o nome ou a imagem no jogo fala com um ADM do jogo: a conta pode ser apagada e as cartas com a pessoa podem ser mudadas ou retiradas.
- **Dados.** O jogo guarda só o que precisa para funcionar: nick, clã, avatar, progresso (XP, vitórias, moedas, troféus e deck) e a senha protegida (ninguém vê a senha, nem os ADMs). O chat e os duelos passam por um servidor público de mensagens, então ninguém deve escrever dados pessoais no chat.

---

## Créditos

| Recurso | Origem | Licença |
|---|---|---|
| Artes das cartas, logo e telas de vitória/derrota | Enviadas pelo dono do projeto, recortadas e comprimidas para o site | — |
| Código, textos, template das cartas, emblema careca e sons | Feitos para este projeto | — |
| [Bootstrap 5.3.3](https://getbootstrap.com/) | CDN jsDelivr | MIT |
| [MQTT.js 5](https://github.com/mqttjs/MQTT.js) | CDN jsDelivr | MIT |
| Fontes Cinzel e Crimson Pro | Google Fonts (arquivos em `fontes/`) | SIL Open Font License |
| Estrutura das regras | Inspirada em *Yu-Gi-Oh!* (Konami). Projeto de zoeira entre amigos, sem fins comerciais | — |
