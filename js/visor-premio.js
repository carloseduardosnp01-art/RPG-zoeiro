/* ==========================================================================
   Duelo da Zoeira · js/visor-premio.js
   Janela com o troféu (ou a relíquia) em tamanho grande e os detalhes:
   de quem é, de qual torneio, quando e por qual ADM foi entregue.
   ========================================================================== */

import { el } from "./util.js?v=202610032015";
import { PREMIOS, ehReliquia } from "./premios.js?v=202610032015";
import { nomeDoAdmin } from "./admin.js?v=202610032015";

let encerrarAberto = null;

function linha(lista, rotulo, valor) {
  if (valor === undefined || valor === null || valor === "") return;
  lista.append(el("dt", "", rotulo), el("dd", "", valor));
}

// premio: { id, item, torneio, para, de, t } (já com a assinatura conferida)
// dono: perfil de quem ganhou ({ nick, tag, reliquia })
export function abrirPremio(premio, dono, origem) {
  const info = PREMIOS[premio.item];
  if (!info) return;
  encerrarAberto?.();

  const reliquia = ehReliquia(premio.item);
  const dialogo = el("dialog", `visor-premio visor-premio--${premio.item}`);
  dialogo.setAttribute("aria-label", `${info.nome} de ${dono.nick}`);

  const fechar = el("button", "visor-premio__fechar", "✕");
  fechar.type = "button";
  fechar.setAttribute("aria-label", "Fechar");

  const palco = el("div", "visor-premio__palco");
  const img = el("img", "visor-premio__img");
  img.src = info.grande || info.imagem;
  img.alt = info.nome;
  palco.append(el("span", "visor-premio__brilho"), img);

  const texto = el("div", "visor-premio__texto");
  texto.append(el("p", "visor-premio__tipo", reliquia ? "🔺 Relíquia do Milênio" : `${info.emoji} Troféu de torneio`));
  texto.append(el("h3", "visor-premio__nome", info.nome));
  if (!reliquia) texto.append(el("p", "visor-premio__posicao", info.posicao));
  if (reliquia && info.habilidade) texto.append(el("p", "visor-premio__habilidade", `✨ ${info.habilidade}`));
  if (info.texto) texto.append(el("p", "visor-premio__descricao", info.texto));

  const ficha = el("dl", "visor-premio__ficha");
  linha(ficha, "Dono", `${dono.tag ? `[${dono.tag}] ` : ""}${dono.nick}`);
  linha(ficha, "Torneio", premio.torneio);
  if (premio.t) linha(ficha, "Entregue em", new Date(premio.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }));
  linha(ficha, "Entregue por", `${nomeDoAdmin(premio.de)} (ADM)`);
  if (reliquia) linha(ficha, "Situação", dono.reliquia === premio.id ? "Equipada: vai junto para os duelos" : "Guardada");
  texto.append(ficha);
  texto.append(el("p", "visor-premio__selo", "✔ Prêmio autêntico: assinatura do ADM conferida"));

  const caixa = el("div", "visor-premio__caixa");
  caixa.append(fechar, palco, texto);
  dialogo.append(caixa);

  // Dentro de um modal do Bootstrap, o diálogo precisa ficar dentro dele: senão o
  // modal "puxa" o foco de volta e o Esc fecharia o perfil junto
  (origem?.closest(".modal") || document.body).append(dialogo);
  // Fecha e tira da página. Não depende só do evento "close", que alguns
  // navegadores embutidos não disparam
  const encerrar = () => {
    if (!dialogo.isConnected) return;
    if (dialogo.open) dialogo.close();
    dialogo.remove();
    if (encerrarAberto === encerrar) encerrarAberto = null;
    origem?.focus?.();
  };
  fechar.addEventListener("click", encerrar);
  dialogo.addEventListener("keydown", (e) => {
    if (e.key === "Escape") e.stopPropagation();
  });
  dialogo.addEventListener("cancel", (e) => {
    e.preventDefault();
    encerrar();
  });
  dialogo.addEventListener("close", encerrar);
  // clicar fora da caixa (no fundo escuro) fecha: lá o alvo é o próprio <dialog>
  dialogo.addEventListener("click", (e) => {
    if (e.target === dialogo) encerrar();
  });
  encerrarAberto = encerrar;
  dialogo.showModal();
  fechar.focus();
}
