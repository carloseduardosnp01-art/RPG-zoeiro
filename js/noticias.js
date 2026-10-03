/* ==========================================================================
   Duelo da Zoeira · js/noticias.js
   Página de notícias e o destaque da última notícia na página inicial.
   As notícias ficam em data/noticias.json (a mais nova aparece primeiro).
   ========================================================================== */

import { el } from "./util.js?v=202610031522";

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// "2026-10-03" -> Date local (sem fuso, para não virar o dia anterior)
function lerData(texto) {
  const [a, m, d] = String(texto).split("-").map(Number);
  return new Date(a, m - 1, d);
}

function dataCurta(texto) {
  return lerData(texto).toLocaleDateString("pt-BR");
}

function dataComDia(texto) {
  const data = lerData(texto);
  return `${DIAS[data.getDay()]}, ${data.toLocaleDateString("pt-BR")}`;
}

// "Faltam 3 dias", "É amanhã!", "É hoje!" ou "Já aconteceu"
function contagem(texto) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((lerData(texto) - hoje) / 86400000);
  if (dias > 1) return { texto: `Faltam ${dias} dias`, classe: "breve" };
  if (dias === 1) return { texto: "É amanhã!", classe: "amanha" };
  if (dias === 0) return { texto: "É hoje!", classe: "hoje" };
  return { texto: "Já aconteceu", classe: "passou" };
}

function seloEvento(noticia) {
  const selo = el("p", "noticia__evento");
  selo.append(el("span", "noticia__data", `📅 ${dataComDia(noticia.evento)}`));
  const falta = contagem(noticia.evento);
  selo.append(el("span", `noticia__contagem noticia__contagem--${falta.classe}`, falta.texto));
  return selo;
}

// só as notícias mais antigas esperam a rolagem para carregar a imagem
function imagemDa(noticia, classe, preguicosa = false) {
  const img = el("img", classe);
  img.src = noticia.imagem;
  img.alt = noticia.alt || noticia.titulo;
  if (preguicosa) img.loading = "lazy";
  img.decoding = "async";
  if (noticia.largura) img.width = noticia.largura;
  if (noticia.altura) img.height = noticia.altura;
  return img;
}

function cartaoNoticia(noticia, i) {
  const artigo = el("article", "noticia painel");
  artigo.id = `noticia-${noticia.id}`;

  if (noticia.imagem) {
    const link = el("a", "noticia__imagem");
    link.href = noticia.imagem;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = "Abrir a imagem em tamanho cheio";
    link.append(imagemDa(noticia, "", i > 0));
    artigo.append(link);
  }

  const corpo = el("div", "noticia__corpo");
  const topo = el("p", "noticia__topo");
  if (noticia.categoria) topo.append(el("span", "noticia__categoria", noticia.categoria));
  topo.append(el("span", "noticia__publicada", `Publicada em ${dataCurta(noticia.publicada)}`));
  corpo.append(topo, el("h3", "noticia__titulo", noticia.titulo));
  if (noticia.evento) corpo.append(seloEvento(noticia));
  corpo.append(el("p", "noticia__texto", noticia.texto));
  if (noticia.botao) {
    const botao = el("a", "btn btn-ouro", noticia.botao.texto);
    botao.href = noticia.botao.href;
    corpo.append(botao);
  }
  artigo.append(corpo);
  return artigo;
}

// Faixa da página inicial com a notícia mais nova
function destaqueNoticia(noticia) {
  const link = el("a", "noticia-faixa");
  link.href = `#noticias`;
  if (noticia.imagem) link.append(imagemDa(noticia, "noticia-faixa__imagem"));
  const corpo = el("span", "noticia-faixa__corpo");
  corpo.append(el("span", "noticia-faixa__rotulo", "📰 Última notícia"));
  corpo.append(el("strong", "noticia-faixa__titulo", noticia.titulo));
  if (noticia.evento) {
    const falta = contagem(noticia.evento);
    corpo.append(el("span", "noticia-faixa__data", `📅 ${dataComDia(noticia.evento)} · ${falta.texto}`));
  }
  corpo.append(el("span", "noticia-faixa__mais", "Ler a notícia →"));
  link.append(corpo);
  return link;
}

export async function iniciarNoticias(versao) {
  const lista = document.querySelector("#lista-noticias");
  const faixa = document.querySelector("#noticia-destaque");
  let noticias;
  try {
    const resposta = await fetch(`data/noticias.json?v=${versao}`, { cache: "no-cache" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    noticias = await resposta.json();
  } catch (erro) {
    lista.replaceChildren(el("div", "estado", `Não foi possível carregar as notícias (${erro.message}).`));
    return;
  }

  noticias.sort((a, b) => String(b.publicada).localeCompare(String(a.publicada)));
  if (!noticias.length) {
    lista.replaceChildren(el("div", "estado", "Nenhuma notícia por enquanto."));
    return;
  }
  lista.replaceChildren(...noticias.map((n, i) => cartaoNoticia(n, i)));
  faixa.replaceChildren(destaqueNoticia(noticias[0]));
  faixa.hidden = false;
}
