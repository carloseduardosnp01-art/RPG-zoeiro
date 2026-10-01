"""
Duelo da Zoeira · ferramentas/nova-versao.py

Rode antes de cada envio para o GitHub:  python ferramentas/nova-versao.py

Coloca um número de versão (?v=N) no endereço de todos os arquivos do jogo
(CSS, JS e data/cartas.json). Como o endereço muda a cada versão, o navegador
é obrigado a baixar os arquivos novos, sem precisar de Ctrl+F5.
"""
import re
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
versao = time.strftime("%Y%m%d%H%M")


def trocar(caminho, padrao, novo):
    texto = caminho.read_text(encoding="utf-8")
    texto2 = re.sub(padrao, novo, texto)
    if texto2 != texto:
        caminho.write_text(texto2, encoding="utf-8")


# index.html: só os arquivos do próprio site (não mexe nos da CDN)
trocar(RAIZ / "index.html", r'((?:href|src)="(?:css|js)/[\w-]+\.(?:css|js))(?:\?v=\w+)?"', rf'\1?v={versao}"')

# imports entre os módulos JS (todos com o mesmo número, senão o módulo carrega duas vezes)
for js in (RAIZ / "js").glob("*.js"):
    trocar(js, r'(from "\./[\w-]+\.js)(?:\?v=\w+)?"', rf'\1?v={versao}"')

# versão usada no fetch das cartas
trocar(RAIZ / "js" / "app.js", r'const VERSAO = "\w*";', f'const VERSAO = "{versao}";')

# versao.json: o site compara com a própria versão e se atualiza sozinho
(RAIZ / "versao.json").write_text(f'{{ "versao": "{versao}" }}\n', encoding="utf-8")

print("Versao", versao)
