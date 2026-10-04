/* ==========================================================================
   Duelo da Zoeira · js/aviso.js
   Aviso do jogo: feito por fãs, sem fins comerciais, e quem joga está ciente
   de que nick, nome e imagem podem entrar na zoeira. Abre pelo rodapé e pelos
   links [data-abrir-aviso]. Quem tem conta e ainda não confirmou (contas de
   antes do aviso) vê a janela e escolhe: "✔ Li e estou ciente" (a confirmação
   fica no perfil) ou "Não concordo" (sai da conta).
   ========================================================================== */

import * as conta from "./conta.js?v=202610041200";
import { sairDaConta } from "./salao.js?v=202610041200";
import { aviso } from "./util.js?v=202610041200";

let modal = null;

const $ = (sel) => document.querySelector(sel);
const data = (t) => new Date(t).toLocaleDateString("pt-BR");

export function iniciarAviso() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-abrir-aviso]");
    if (!link) return;
    e.preventDefault();
    abrirAviso();
  });
  $("#aviso-ciente").addEventListener("click", () => {
    conta.marcarCiente();
    modal?.hide();
    aviso("Valeu! Agora é só zoeira. 🧑‍🦲", "ok");
  });
  $("#aviso-sair").addEventListener("click", () => {
    if (!sairDaConta()) return;
    modal?.hide();
    aviso("Você saiu da conta. Se quiser que ela seja apagada, fale com um ADM do jogo.", "info", 10000);
  });
  // espera um pouco: o perfil do banco (que pode já ter a confirmação) chega logo depois de entrar
  conta.aoMudarUsuario(() => setTimeout(pedirCiencia, 4000));
  addEventListener("hashchange", () => setTimeout(pedirCiencia, 800));
  setTimeout(pedirCiencia, 4000); // sessão que já voltou sozinha ao abrir o site
}

export function abrirAviso() {
  const u = conta.usuarioAtual();
  const ciente = Boolean(u) && conta.estaCiente(u);
  const pedir = Boolean(u) && !ciente; // conta sem confirmação: só sai confirmando ou saindo da conta
  const situacao = $("#aviso-situacao");
  situacao.hidden = !u;
  situacao.classList.toggle("aviso-situacao--pendente", pedir);
  if (ciente) situacao.textContent = `✔ ${u.nick}, você confirmou que está ciente deste aviso${u.ciente.t ? ` em ${data(u.ciente.t)}` : ""}.`;
  else if (u) situacao.textContent = `${u.nick}, para continuar jogando, confirme que leu e está ciente. Se não concordar, é só sair da conta.`;
  for (const b of document.querySelectorAll("#modal-aviso [data-so-ler]")) b.hidden = pedir;
  $("#aviso-sair").hidden = !pedir;
  $("#aviso-ciente").hidden = !pedir;

  const janela = $("#modal-aviso");
  if (!janela.classList.contains("show")) {
    // pedindo a confirmação, clicar fora ou apertar Esc não fecha
    bootstrap.Modal.getInstance(janela)?.dispose();
    modal = new bootstrap.Modal(janela, pedir ? { backdrop: "static", keyboard: false } : {});
  }
  modal.show();
}

// Conta sem a confirmação: mostra o aviso, sem atrapalhar duelo nem outra janela aberta
function pedirCiencia() {
  const u = conta.usuarioAtual();
  if (!u || conta.estaCiente(u)) return;
  if (document.body.classList.contains("em-duelo") || document.querySelector(".modal.show")) return;
  abrirAviso();
}
