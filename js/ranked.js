/* ==========================================================================
   Duelo da Zoeira · js/ranked.js
   Reino dos Carecas: o modo ranked, na aba Duelos. Fila para achar outro
   jogador (60 segundos sem ninguém = duelo contra o Bot Careca, que vale
   igual), temporada encerrada pelos ADMs, ban list e classificação.
   Os pontos, as Careca Coins do modo e os prêmios ficam no banco
   (supabase/banco.sql, funções ranked_*): o navegador só pede.
   ========================================================================== */

import * as conta from "./conta.js?v=202610061350";
import * as adm from "./admin.js?v=202610061350";
import { entrarNaFila, sairDaFila, estadoDaFila, contarRanked, avisarChat } from "./salao.js?v=202610061350";
import { criarSessaoBot } from "./sessao.js?v=202610061350";
import { abrirArena, arenaAtiva, fecharArena } from "./arena.js?v=202610061350";
import { deckAtual } from "./deck.js?v=202610061350";
import { cartaPorId, problemaDoDeck } from "./motor.js?v=202610061350";
import { el, aviso } from "./util.js?v=202610061350";
import { tocar } from "./som.js?v=202610061350";

export const ESPERA_BOT = 60; // segundos na fila antes do duelo contra o Bot Careca
export const PREMIOS_TOP3 = [100, 60, 30];
const MEDALHAS = ["🥇", "🥈", "🥉"];

const r = { tabela: null, erro: null, carregando: null, ticker: null, verTodos: false, cartas: [], sincronizado: null };
const $ = (sel) => document.querySelector(sel);
const nomeDaCarta = (id) => cartaPorId(id)?.nome || id;
const data = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "");

export function iniciarRanked(cartas) {
  r.cartas = cartas;
  document.addEventListener("ranked-mudou", () => carregar());
  document.addEventListener("ranked-de-novo", () => {
    location.hash = "#arena";
    buscar();
  });
  conta.aoMudarUsuario(() => desenhar());
  addEventListener("hashchange", () => {
    if (location.hash === "#arena") carregar();
  });
  setInterval(() => {
    if (location.hash === "#arena" && !arenaAtiva() && !document.hidden) carregar();
  }, 60 * 1000);
  if (location.hash === "#arena") carregar();
  else desenhar();
}

// Busca a temporada, a ban list e a classificação no banco. Na primeira vez com a conta, também
// traz o perfil do banco (moedas e troféus do ranked que o servidor deu enquanto a aba estava fechada).
function carregar() {
  const u = conta.usuarioAtual();
  if (u && r.sincronizado !== u.chave) {
    r.sincronizado = u.chave;
    conta.sincronizarComBanco().catch(() => {});
  }
  if (r.carregando) return r.carregando;
  r.carregando = conta.rankedTabela()
    .then((t) => {
      r.tabela = t;
      r.erro = null;
    })
    .catch((e) => {
      r.erro = e.message || "Não foi possível falar com o servidor do jogo.";
    })
    .finally(() => {
      r.carregando = null;
      desenhar();
    });
  return r.carregando;
}


/* ---------- Fila ---------- */

async function buscar() {
  const u = conta.usuarioAtual();
  if (!u) {
    aviso("Entre na sua conta (Salão Online) para jogar o Reino dos Carecas.", "erro");
    location.hash = "#salao";
    return;
  }
  if (estadoDaFila().buscando) return;
  if (!r.tabela) await carregar();
  const t = r.tabela?.temporada;
  if (!t) {
    aviso(r.erro || "Nenhuma temporada do Reino dos Carecas está aberta agora.", "erro");
    return;
  }
  const deck = deckAtual();
  const problema = problemaDoDeck(deck);
  if (problema) {
    aviso(`Seu deck não vale no Reino dos Carecas: ${problema} Arrume na aba Deck.`, "erro", 9000);
    return;
  }
  const banidas = [...new Set(deck.filter((id) => t.banidas.includes(id)))];
  if (banidas.length) {
    aviso(`Seu deck tem carta${banidas.length > 1 ? "s" : ""} banida${banidas.length > 1 ? "s" : ""} no Reino dos Carecas: ${banidas.map(nomeDaCarta).join(", ")}. Tire na aba Deck.`, "erro", 10000);
    return;
  }
  try {
    await entrarNaFila({ temporada: t.numero, banidas: t.banidas, aoMudar: desenhar });
  } catch (e) {
    aviso(e.message, "erro");
    return;
  }
  tocar("desafio");
  clearInterval(r.ticker);
  r.ticker = setInterval(tique, 1000);
  desenhar();
}

function tique() {
  const f = estadoDaFila();
  if (!f.buscando) {
    clearInterval(r.ticker);
    r.ticker = null;
    desenhar();
    return;
  }
  const passou = Math.floor((Date.now() - f.desde) / 1000);
  if (passou >= ESPERA_BOT && !f.pedindo) {
    // ninguém apareceu: duelo contra o Bot Careca (vale igual)
    sairDaFila();
    clearInterval(r.ticker);
    r.ticker = null;
    jogarContraBot();
    return;
  }
  const contador = $("#reino-contador");
  if (contador) contador.textContent = `${Math.floor(passou / 60)}:${String(passou % 60).padStart(2, "0")}`;
  const barra = $("#reino-barra");
  if (barra) barra.style.width = `${Math.min(100, (passou / ESPERA_BOT) * 100)}%`;
}

function cancelar() {
  sairDaFila();
  clearInterval(r.ticker);
  r.ticker = null;
  desenhar();
}

async function jogarContraBot() {
  const u = conta.usuarioAtual();
  const t = r.tabela?.temporada;
  if (!u || !t || arenaAtiva()) {
    desenhar();
    return;
  }
  const sessao = criarSessaoBot({ ...conta.cartaoPublico(u), reliquia: conta.reliquiaEquipada(u) }, deckAtual());
  sessao.estado.ranked = t.numero;
  let ok = null;
  try {
    ok = await conta.rankedEntrar(sessao.estado.id, null);
  } catch {
    ok = null;
  }
  if (!ok?.ok) {
    aviso("O servidor do jogo não abriu a partida do Reino dos Carecas. Tente de novo.", "erro", 8000);
    desenhar();
    return;
  }
  aviso("🤖 Ninguém apareceu na fila: você vai encarar o Bot Careca (vale pontos igual)!", "info", 6000);
  abrirArena(sessao, {
    aoTerminar: (estado, eu) => {
      const venceu = estado.vencedor === eu;
      const { xp } = conta.registrarResultado({ dueloId: estado.id, venceu, contraBot: true, oponente: estado.jogadores[1 - eu], motivo: estado.motivo, ranked: true });
      contarRanked(estado.id, venceu);
      return { xp, ranked: { venceu } };
    },
    aoSair: () => {
      location.hash = "#arena";
      carregar();
    },
    rotuloRevanche: "👑 Buscar outra partida",
    revanche: () => {
      fecharArena();
      location.hash = "#arena";
      buscar();
    },
  });
  location.hash = "#arena";
}


/* ---------- Tela ---------- */

function desenhar() {
  const area = $("#reino");
  const lado = $("#reino-ranking");
  if (!area || !lado) return;
  const u = conta.usuarioAtual();
  const t = r.tabela?.temporada;
  const f = estadoDaFila();

  const topo = el("div", "reino__topo");
  topo.append(el("span", "reino__coroa", "👑"));
  const titulos = el("div");
  titulos.append(el("h3", "reino__titulo", "Reino dos Carecas"), el("p", "reino__sub",
    t ? `Ranked · ${t.nome}${t.fim ? ` · até ${data(t.fim)}` : ""}` : r.erro ? "Sem conexão com o servidor do jogo" : r.tabela ? "Nenhuma temporada aberta" : "Carregando..."));
  topo.append(titulos);

  const regras = el("ul", "reino__regras");
  regras.append(
    el("li", "", "Vitória: +1 ponto e +5 Careca Coins · Derrota: 0 ponto e +1 Careca Coin"),
    el("li", "", `A fila procura outro jogador; sem ninguém em ${ESPERA_BOT} segundos, você enfrenta o Bot Careca (vale igual)`),
    el("li", "", `Top 3 da temporada: ${PREMIOS_TOP3.join(" / ")} Careca Coins e o Troféu do Reino dos Carecas (ouro, prata e bronze)`),
  );

  const acao = el("div", "reino__acao");
  if (!u) {
    acao.append(el("p", "reino__aviso", "Entre na sua conta para jogar o ranked."));
    const b = el("a", "btn btn-ouro", "💬 Entrar no Salão Online");
    b.href = "#salao";
    acao.append(b);
  } else if (f.buscando) {
    const busca = el("div", "reino__busca");
    busca.append(el("span", "reino__radar"), el("strong", "", "Procurando oponente..."), el("span", "reino__contador", "0:00"));
    busca.lastChild.id = "reino-contador";
    const trilho = el("div", "reino__trilho");
    const barra = el("div", "reino__barra");
    barra.id = "reino-barra";
    trilho.append(barra);
    const sair = el("button", "btn btn-sm btn-outline-light", "Cancelar");
    sair.type = "button";
    sair.addEventListener("click", cancelar);
    acao.append(busca, trilho, el("p", "reino__dica", `Se ninguém aparecer em ${ESPERA_BOT} segundos, o Bot Careca entra no lugar.`), sair);
  } else {
    const b = el("button", "btn btn-ouro btn-lg reino__jogar", "⚔️ Procurar partida");
    b.type = "button";
    b.disabled = !t;
    b.addEventListener("click", buscar);
    acao.append(b, el("p", "reino__dica", "Largar um duelo contra o Bot no meio conta como derrota."));
  }

  const meu = u && r.tabela ? r.tabela.ranking.findIndex((x) => x.chave === u.chave) : -1;
  const eu = meu >= 0 ? r.tabela.ranking[meu] : null;
  const placar = el("div", "reino__meu");
  if (u && t) {
    placar.append(
      caixinha(eu ? `${meu + 1}º` : "–", "Posição"),
      caixinha(eu ? eu.pontos : 0, "Pontos"),
      caixinha(eu ? `${eu.vitorias}/${eu.derrotas}` : "0/0", "V/D"),
    );
  }

  const ban = el("div", "reino__ban");
  if (t) {
    ban.append(el("h4", "", `🚫 Ban list (${t.banidas.length})`));
    if (t.banidas.length) {
      const lista = el("div", "reino__banidas");
      t.banidas.forEach((id) => lista.append(el("span", "reino__banida", nomeDaCarta(id))));
      ban.append(lista, el("p", "reino__dica", "Essas cartas não podem estar no deck para entrar na fila."));
    } else {
      ban.append(el("p", "reino__dica", "Nenhuma carta banida nesta temporada."));
    }
  }

  area.replaceChildren(topo, placar, acao, regras, ban);
  if (u && adm.ehAdmin(u.chave) && t) area.append(painelAdm(t));
  if (f.buscando) tique();

  desenharRanking(lado, u);
}

function caixinha(valor, rotulo) {
  const c = el("div", "reino__caixinha");
  c.append(el("strong", "", String(valor)), el("span", "", rotulo));
  return c;
}

function desenharRanking(lado, u) {
  const t = r.tabela?.temporada;
  const lista = r.tabela?.ranking || [];
  lado.replaceChildren(el("h4", "reino__ranking-titulo", `🏆 Classificação${t ? ` · ${t.nome}` : ""}`));
  if (!lista.length) {
    lado.append(el("p", "reino__dica", r.tabela ? "Ninguém pontuou ainda. O trono está vazio!" : "Carregando..."));
  } else {
    const tabela = el("ol", "reino__tabela");
    const mostrar = r.verTodos ? lista : lista.slice(0, 10);
    mostrar.forEach((x, i) => {
      const li = el("li", "reino__linha");
      if (u && x.chave === u.chave) li.dataset.eu = "true";
      if (i < 3) li.dataset.podio = String(i + 1);
      li.append(el("span", "reino__pos", i < 3 ? MEDALHAS[i] : `${i + 1}º`), el("span", "reino__nick", x.nick),
        el("span", "reino__vd", `${x.vitorias}V ${x.derrotas}D`), el("strong", "reino__pontos", `${x.pontos} pt${x.pontos === 1 ? "" : "s"}`));
      tabela.append(li);
    });
    lado.append(tabela);
    if (lista.length > 10) {
      const mais = el("button", "btn btn-sm btn-outline-light mt-2", r.verTodos ? "Ver só o top 10" : `Ver todos (${lista.length})`);
      mais.type = "button";
      mais.addEventListener("click", () => {
        r.verTodos = !r.verTodos;
        desenhar();
      });
      lado.append(mais);
    }
  }
  const ultima = r.tabela?.ultima;
  if (ultima && ultima.podio.length) {
    const podio = el("div", "reino__ultima");
    podio.append(el("h5", "", `👑 Pódio da ${ultima.nome}`));
    ultima.podio.forEach((x) => podio.append(el("div", "", `${MEDALHAS[x.posicao - 1]} ${x.nick} · +${x.coins} Careca Coins`)));
    lado.append(podio);
  }
}


/* ---------- ADM: ban list e fim da temporada ---------- */

function painelAdm(t) {
  const caixa = el("details", "reino__adm");
  caixa.append(el("summary", "", "🛡️ ADM: ban list e temporada"));
  let banidas = [...t.banidas];

  const chips = el("div", "reino__banidas");
  const desenharChips = () => {
    chips.replaceChildren();
    banidas.forEach((id) => {
      const b = el("button", "reino__banida reino__banida--tirar", `${nomeDaCarta(id)} ✕`);
      b.type = "button";
      b.title = "Tirar da ban list";
      b.addEventListener("click", () => {
        banidas = banidas.filter((x) => x !== id);
        desenharChips();
      });
      chips.append(b);
    });
    if (!banidas.length) chips.append(el("span", "reino__dica", "Nenhuma carta banida."));
  };
  desenharChips();

  const linhaBanir = el("div", "d-flex gap-2 mt-2");
  const escolha = el("select", "form-select form-select-sm");
  escolha.setAttribute("aria-label", "Carta para banir");
  escolha.append(new Option("Escolha uma carta para banir...", ""));
  [...r.cartas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).forEach((c) => escolha.append(new Option(c.nome, c.id)));
  const banir = el("button", "btn btn-sm btn-outline-light", "Banir");
  banir.type = "button";
  banir.addEventListener("click", () => {
    if (escolha.value && !banidas.includes(escolha.value)) banidas.push(escolha.value);
    escolha.value = "";
    desenharChips();
  });
  linhaBanir.append(escolha, banir);

  const linhaFim = el("label", "d-flex gap-2 align-items-center mt-2 reino__dica");
  const fim = el("input", "form-control form-control-sm w-auto");
  fim.type = "date";
  fim.value = t.fim ? String(t.fim).slice(0, 10) : "";
  linhaFim.append("Fim previsto:", fim);

  const salvar = el("button", "btn btn-sm btn-ouro mt-2", "💾 Salvar ban list e data");
  salvar.type = "button";
  salvar.addEventListener("click", async () => {
    salvar.disabled = true;
    try {
      const res = await conta.rankedConfigurar(banidas, fim.value || null);
      if (!res?.ok) throw new Error(res?.erro === "adm" ? "Só ADM pode mudar a ban list." : "O servidor recusou a ban list.");
      aviso("Ban list do Reino dos Carecas salva!", "ok");
      carregar();
    } catch (e) {
      aviso(e.message, "erro");
    } finally {
      salvar.disabled = false;
    }
  });

  const fimProxima = el("input", "form-control form-control-sm w-auto");
  fimProxima.type = "date";
  const daqui21 = new Date(Date.now() + 21 * 86400000);
  fimProxima.value = daqui21.toISOString().slice(0, 10);
  const linhaProxima = el("label", "d-flex gap-2 align-items-center mt-3 reino__dica");
  linhaProxima.append("Fim previsto da próxima temporada:", fimProxima);
  const encerrar = el("button", "btn btn-sm btn-danger mt-2", `🏁 Encerrar a ${t.nome} e entregar os prêmios`);
  encerrar.type = "button";
  encerrar.addEventListener("click", async () => {
    if (!confirm(`Encerrar a ${t.nome} agora? O top 3 recebe ${PREMIOS_TOP3.join("/")} Careca Coins e o troféu, a classificação zera e começa a próxima temporada. Não dá para desfazer.`)) return;
    encerrar.disabled = true;
    try {
      const res = await conta.rankedEncerrar(fimProxima.value || null);
      if (!res?.ok) throw new Error(res?.erro === "adm" ? "Só ADM pode encerrar a temporada." : "O servidor não encerrou a temporada.");
      const podio = res.podio.map((x) => `${MEDALHAS[x.posicao - 1]} ${x.nick} (+${x.coins} Careca Coins)`).join(" · ");
      avisarChat(`👑 Fim da ${res.nome} do Reino dos Carecas! ${podio || "Ninguém pontuou."} A Temporada ${res.nova} já começou: bora pra fila!`);
      aviso(`${res.nome} encerrada! ${podio || "Ninguém pontuou."}`, "ok", 12000);
      tocar("vitoria");
      carregar();
    } catch (e) {
      aviso(e.message, "erro");
    } finally {
      encerrar.disabled = false;
    }
  });

  caixa.append(el("p", "reino__dica mb-1", "Ban list da temporada aberta (vale na hora para quem entrar na fila):"), chips, linhaBanir, linhaFim, salvar,
    linhaProxima, encerrar);
  return caixa;
}
