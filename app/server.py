import json
import logging
import mimetypes
import os
import sys
import time
import urllib.error
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse, parse_qs, unquote
from app.auth import (
    autenticar_usuario, criar_sessao, encerrar_sessao, usuario_por_token,
    registrar_falha_login, limpar_tentativas_login, login_bloqueado,
    listar_usuarios, criar_usuario, excluir_usuario, alterar_senha,
    alterar_perfil, garantir_seed_usuarios
)
from app.config import carregar_env_local
from app.database import criar_tabelas
from app.exportacao import gerar_csv_inventario, gerar_csv_historico, gerar_pdf_simples
from app.gemini import sugerir_precos_gemini
from app.operacoes import (
    inserir_produto, inserir_produtos_lote, editar_produto_completo,
    listar_produtos, excluir_produto, registrar_movimento, listar_movimentacoes,
    listar_categorias_loja, listar_produtos_loja, criar_pedido,
    listar_pedidos, atualizar_status_pedido, atualizar_precos_lote, resetar_sistema,
    descartar_produtos_vencendo
)

LIMITE_BODY_BYTES = 2 * 1024 * 1024

PEDIDO_MAX = 10
PEDIDO_JANELA_SEGUNDOS = 5 * 60
_pedidos_por_ip = {}
_pedidos_lock = Lock()

LIMITES_CAMPO = {
    "nome_cliente": 120,
    "telefone": 32,
    "endereco": 240,
    "complemento": 120,
    "observacao": 500,
    "pagamento": 16,
}
PEDIDO_MAX_ITENS = 200

CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "object-src 'none'"
)


def pedido_bloqueado(ip):
    agora = time.monotonic()
    with _pedidos_lock:
        fila = _pedidos_por_ip.get(ip)
        if not fila:
            return 0
        while fila and agora - fila[0] > PEDIDO_JANELA_SEGUNDOS:
            fila.popleft()
        if len(fila) >= PEDIDO_MAX:
            return int(PEDIDO_JANELA_SEGUNDOS - (agora - fila[0]))
        return 0


def registrar_pedido_ip(ip):
    agora = time.monotonic()
    with _pedidos_lock:
        fila = _pedidos_por_ip.setdefault(ip, deque())
        while fila and agora - fila[0] > PEDIDO_JANELA_SEGUNDOS:
            fila.popleft()
        fila.append(agora)


logger = logging.getLogger("erp")


carregar_env_local()


class ServidorNativo(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        logger.info("%s - %s", self.client_address[0], format % args)

    def _aplicar_headers_seguranca(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')

    def _enviar_json(self, dados, status=200):
        self.send_response(status)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self._aplicar_headers_seguranca()
        self.end_headers()
        self.wfile.write(json.dumps(dados, ensure_ascii=False).encode('utf-8'))

    def _enviar_html(self, caminho):
        arquivo = Path(caminho)
        if not arquivo.is_absolute():
            arquivo = Path("templates") / arquivo

        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self._aplicar_headers_seguranca()
        self.end_headers()
        try:
            with open(arquivo, 'rb') as f:
                self.wfile.write(f.read())
        except FileNotFoundError:
            self.wfile.write(f"Erro: {caminho} nao encontrado.".encode('utf-8'))

    def _enviar_estatico(self, path):
        raiz = Path("static").resolve()
        relativo = unquote(path.replace("/static/", "", 1))
        arquivo = (raiz / relativo).resolve()
        if not str(arquivo).startswith(str(raiz)) or not arquivo.is_file():
            self.send_response(404)
            self.end_headers()
            return
        content_type = mimetypes.guess_type(str(arquivo))[0] or "application/octet-stream"
        if arquivo.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif arquivo.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-type", content_type)
        self.send_header("Cache-Control", "no-store")
        self._aplicar_headers_seguranca()
        self.end_headers()
        with open(arquivo, "rb") as f:
            self.wfile.write(f.read())

    def _enviar_arquivo(self, conteudo, content_type, nome_arquivo):
        self.send_response(200)
        self.send_header('Content-type', content_type)
        self.send_header('Content-Disposition', f'attachment; filename="{nome_arquivo}"')
        self._aplicar_headers_seguranca()
        self.end_headers()
        if isinstance(conteudo, str):
            conteudo = conteudo.encode('utf-8-sig')
        self.wfile.write(conteudo)

    def _token_requisicao(self, dados=None, params=None):
        if isinstance(dados, dict) and dados.get('token'):
            return dados.get('token')
        if params and params.get('token'):
            return params.get('token', [''])[0]
        return self.headers.get('X-Auth-Token', '')

    def _usuario_sessao(self, dados=None, params=None):
        token = self._token_requisicao(dados, params)
        return usuario_por_token(token)

    def _exigir_login(self, dados=None, params=None):
        usuario = self._usuario_sessao(dados, params)
        if not usuario:
            self._enviar_json({"status": "erro", "mensagem": "Sessao expirada. Faça login novamente."}, 401)
            return None
        return usuario

    def _exigir_admin(self, dados=None, params=None):
        usuario = self._exigir_login(dados, params)
        if not usuario:
            return None
        if usuario["perfil"] != "admin":
            self._enviar_json({"status": "erro", "mensagem": "Apenas administradores podem executar esta ação."}, 403)
            return None
        return usuario

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        params = parse_qs(parsed.query)

        if path.startswith('/static/'):
            self._enviar_estatico(path)

        elif path == '/':
            self._enviar_html('login.html')

        elif path in ('/admin-erp', '/admin-erp/'):
            self._enviar_html('admin.html')

        elif path == '/loja':
            self._enviar_html('loja.html')

        elif path == '/favicon.ico':
            favicon = Path("static/img/meriu-logo.png")
            if favicon.is_file():
                self.send_response(200)
                self.send_header("Content-type", "image/png")
                self.end_headers()
                with open(favicon, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(204)
                self.end_headers()

        elif path == '/api/produtos':
            if not self._exigir_login(params=params):
                return
            produtos = listar_produtos()
            resultado = []
            for p in produtos:
                resultado.append({
                    "id": p[0], "nome": p[1], "categoria": p[2], "lote": p[3],
                    "quantidade": p[4], "validade": p[5], "entrada": p[6],
                    "preco": p[7] if len(p) > 7 else 0.0,
                    "imagem_url": p[8] if len(p) > 8 else ""
                })
            self._enviar_json(resultado)

        elif path == '/api/movimentacoes':
            if not self._exigir_login(params=params):
                return
            movimentos = listar_movimentacoes()
            resultado = []
            for m in movimentos:
                resultado.append({
                    "id": m[0], "produto_nome": m[1], "tipo": m[2],
                    "quantidade": m[3], "data_hora": m[4], "motivo": m[5]
                })
            self._enviar_json(resultado)

        elif path == '/api/exportar/inventario.csv':
            if not self._exigir_login(params=params):
                return
            csv_exportado = gerar_csv_inventario(listar_produtos())
            self._enviar_arquivo(csv_exportado, 'text/csv; charset=utf-8', 'inventario.csv')

        elif path == '/api/exportar/historico.csv':
            if not self._exigir_login(params=params):
                return
            csv_exportado = gerar_csv_historico(listar_movimentacoes())
            self._enviar_arquivo(csv_exportado, 'text/csv; charset=utf-8', 'historico_movimentacoes.csv')

        elif path == '/api/exportar/inventario.pdf':
            if not self._exigir_login(params=params):
                return
            linhas = [[p[0], p[1], p[2], p[3], p[4], p[5]] for p in listar_produtos()]
            pdf = gerar_pdf_simples("Inventario atual", ["ID", "Nome", "Categoria", "Lote", "Qtd", "Validade"], linhas)
            self._enviar_arquivo(pdf, 'application/pdf', 'inventario.pdf')

        elif path == '/api/exportar/historico.pdf':
            if not self._exigir_login(params=params):
                return
            linhas = [[m[4], m[1], m[2], m[3], m[5] or ""] for m in listar_movimentacoes()]
            pdf = gerar_pdf_simples("Historico de movimentacoes", ["Data/Hora", "Produto", "Tipo", "Qtd", "Motivo"], linhas)
            self._enviar_arquivo(pdf, 'application/pdf', 'historico_movimentacoes.pdf')

        elif path == '/api/loja/categorias':
            cats = listar_categorias_loja()
            self._enviar_json(cats)

        elif path == '/api/loja/produtos':
            categoria = params.get('categoria', ['todos'])[0]
            if categoria == 'todos':
                categoria = None
            produtos = listar_produtos_loja(categoria)
            resultado = []

            hoje = datetime.now().date()
            imagem_por_produto = {}
            for p in produtos:
                chave = (str(p[1]).strip().lower(), str(p[2]).strip().lower())
                imagem = p[7] if len(p) > 7 else ""
                if imagem and chave not in imagem_por_produto:
                    imagem_por_produto[chave] = imagem

            grupos_normais = {}
            for p in produtos:
                produto_id, nome, categoria_p, lote, quantidade, validade, preco = p[:7]
                imagem = p[7] if len(p) > 7 else ""
                chave = (str(nome).strip().lower(), str(categoria_p).strip().lower())
                imagem_compartilhada = imagem_por_produto.get(chave, imagem)
                try:
                    dias = (datetime.strptime(validade, "%Y-%m-%d").date() - hoje).days
                except Exception:
                    dias = 9999

                item = {
                    "id": produto_id,
                    "produto_ids": [produto_id],
                    "nome": nome,
                    "categoria": categoria_p,
                    "lote": lote,
                    "quantidade": quantidade,
                    "validade": validade,
                    "preco": preco,
                    "imagem_url": imagem_compartilhada,
                    "catalogo_tipo": "lote"
                }

                if 0 <= dias <= 30:
                    resultado.append(item)
                    continue

                grupo = grupos_normais.setdefault(chave, {
                    "id": produto_id,
                    "produto_ids": [],
                    "nome": nome,
                    "categoria": categoria_p,
                    "lote": "",
                    "quantidade": 0,
                    "validade": validade,
                    "preco": preco,
                    "imagem_url": imagem_compartilhada,
                    "catalogo_tipo": "produto"
                })
                grupo["produto_ids"].append(produto_id)
                grupo["quantidade"] += float(quantidade or 0)
                if validade < grupo["validade"]:
                    grupo["validade"] = validade
                if float(preco or 0) > 0 and (float(grupo["preco"] or 0) <= 0 or float(preco) < float(grupo["preco"])):
                    grupo["preco"] = preco
                if imagem_compartilhada and not grupo["imagem_url"]:
                    grupo["imagem_url"] = imagem_compartilhada

            for grupo in grupos_normais.values():
                if len(grupo["produto_ids"]) > 1:
                    grupo["id"] = -min(grupo["produto_ids"])
                    grupo["lote"] = f"{len(grupo['produto_ids'])} lotes"
                else:
                    grupo["lote"] = "1 lote"
                resultado.append(grupo)

            resultado.sort(key=lambda item: (item["nome"].lower(), item["catalogo_tipo"], item["validade"]))
            self._enviar_json(resultado)

        elif path == '/api/pedidos':
            if not self._exigir_admin(params=params):
                return
            pedidos = listar_pedidos()
            self._enviar_json(pedidos)

        elif path == '/api/usuarios':
            if not self._exigir_admin(params=params):
                return
            self._enviar_json(listar_usuarios())

        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'Rota nao encontrada.')

    def do_POST(self):
        try:
            tamanho = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            self._enviar_json({"status": "erro", "mensagem": "Content-Length invalido."}, 400)
            return
        if tamanho < 0 or tamanho > LIMITE_BODY_BYTES:
            self._enviar_json({"status": "erro", "mensagem": "Requisicao excede o tamanho permitido."}, 413)
            return
        if tamanho:
            try:
                dados = json.loads(self.rfile.read(tamanho).decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._enviar_json({"status": "erro", "mensagem": "JSON invalido."}, 400)
                return
        else:
            dados = {}

        if self.path == '/api/login':
            ip = self.client_address[0]
            espera = login_bloqueado(ip)
            if espera > 0:
                logger.warning("login bloqueado por rate-limit ip=%s espera=%ss", ip, espera)
                minutos = max(1, espera // 60)
                self._enviar_json(
                    {"status": "erro", "mensagem": f"Muitas tentativas. Tente novamente em {minutos} min."},
                    429
                )
                return

            usuario = dados.get('usuario', '')
            senha   = dados.get('senha', '')
            autenticado = autenticar_usuario(usuario, senha)
            if autenticado:
                limpar_tentativas_login(ip)
                token = criar_sessao(usuario)
                logger.info("login sucesso usuario=%s ip=%s", usuario, ip)
                self._enviar_json({"status": "sucesso", "token": token, "usuario": usuario, "perfil": autenticado["perfil"]})
            else:
                registrar_falha_login(ip)
                logger.warning("login falha usuario=%r ip=%s", usuario, ip)
                self._enviar_json({"status": "erro", "mensagem": "Usuário ou senha incorretos."}, 401)
            return

        elif self.path == '/api/logout':
            token = dados.get('token', '')
            usuario = encerrar_sessao(token)
            if usuario:
                logger.info("logout usuario=%s ip=%s", usuario, self.client_address[0])
            self._enviar_json({"status": "sucesso"})
            return

        elif self.path == '/api/adicionar':
            if not self._exigir_admin(dados=dados):
                return
            inserir_produto(
                dados['nome'], dados['categoria'], dados['lote'],
                float(dados['quantidade']), dados['validade'], dados['entrada'],
                float(dados.get('preco', 0.0)),
                dados.get('imagem_url', '')
            )
            self._enviar_json({"status": "sucesso"})

        elif self.path == '/api/editar':
            if not self._exigir_admin(dados=dados):
                return
            editar_produto_completo(
                int(dados['id']), dados['nome'], dados['categoria'], dados['lote'],
                float(dados['quantidade']), dados['validade'], dados['entrada'],
                float(dados.get('preco', 0.0)),
                dados.get('imagem_url', '')
            )
            self._enviar_json({"status": "sucesso"})

        elif self.path == '/api/importar_lote':
            if not self._exigir_admin(dados=dados):
                return
            lote = []
            itens_importacao = dados.get('itens', []) if isinstance(dados, dict) else dados
            for item in itens_importacao:
                lote.append((
                    item['nome'], item['categoria'], item.get('lote', 'Lote Padrão'),
                    float(item['quantidade']), item['validade'], item['entrada'],
                    float(item.get('preco', 0.0))
                ))
            if lote:
                inserir_produtos_lote(lote)
            self._enviar_json({"status": "sucesso", "importados": len(lote)})

        elif self.path == '/api/excluir':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            excluir_produto(int(dados['id']))
            logger.info("produto excluido id=%s usuario=%s", dados.get('id'), usuario["nome"])
            self._enviar_json({"status": "sucesso"})

        elif self.path == '/api/movimentar':
            if not self._exigir_login(dados=dados):
                return
            try:
                registrar_movimento(
                    int(dados['id']), dados['tipo'],
                    float(dados['quantidade']), dados.get('motivo', '')
                )
                self._enviar_json({"status": "sucesso"})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)

        elif self.path == '/api/loja/pedido':
            ip = self.client_address[0]
            espera = pedido_bloqueado(ip)
            if espera > 0:
                logger.warning("pedido bloqueado por rate-limit ip=%s espera=%ss", ip, espera)
                minutos = max(1, espera // 60)
                self._enviar_json(
                    {"status": "erro", "mensagem": f"Muitos pedidos seguidos. Tente novamente em {minutos} min."},
                    429
                )
                return

            campos = {}
            for nome_campo, limite in LIMITES_CAMPO.items():
                valor = str(dados.get(nome_campo, '')).strip()
                if len(valor) > limite:
                    self._enviar_json({"status": "erro", "mensagem": f"Campo '{nome_campo}' excede {limite} caracteres."}, 400)
                    return
                campos[nome_campo] = valor

            nome_cliente = campos["nome_cliente"]
            endereco = campos["endereco"]
            pagamento = campos["pagamento"]
            itens = dados.get('itens')
            if not nome_cliente or not endereco or not pagamento:
                self._enviar_json({"status": "erro", "mensagem": "Nome, endereco e pagamento sao obrigatorios."}, 400)
                return
            if pagamento not in ('pix', 'cartao', 'dinheiro'):
                self._enviar_json({"status": "erro", "mensagem": "Forma de pagamento invalida."}, 400)
                return
            if not isinstance(itens, list) or not itens:
                self._enviar_json({"status": "erro", "mensagem": "Pedido sem itens."}, 400)
                return
            if len(itens) > PEDIDO_MAX_ITENS:
                self._enviar_json({"status": "erro", "mensagem": f"Pedido excede {PEDIDO_MAX_ITENS} itens."}, 400)
                return
            try:
                pedido_id = criar_pedido(
                    nome_cliente, campos["telefone"],
                    endereco, campos["complemento"],
                    pagamento, campos["observacao"],
                    itens
                )
                registrar_pedido_ip(ip)
                self._enviar_json({"status": "sucesso", "pedido_id": pedido_id})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)
            except Exception:
                self._enviar_json({"status": "erro", "mensagem": "Falha ao registrar pedido."}, 500)

        elif self.path == '/api/pedidos/status':
            if not self._exigir_admin(dados=dados):
                return
            atualizar_status_pedido(int(dados['id']), dados['status'])
            self._enviar_json({"status": "sucesso"})

        elif self.path == '/api/precos/gemini':
            if not self._exigir_admin(dados=dados):
                return
            try:
                sugestoes = sugerir_precos_gemini(dados.get('itens', []))
                self._enviar_json({"status": "sucesso", "sugestoes": sugestoes})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)
            except urllib.error.HTTPError as e:
                e.read()
                if e.code == 503:
                    self._enviar_json(
                        {"status": "erro", "mensagem": "Gemini esta ocupado no momento. Tente novamente em alguns minutos."},
                        503
                    )
                    return
                if e.code in (401, 403):
                    mensagem = "A chave do Gemini foi recusada. Verifique a GEMINI_API_KEY no arquivo .env."
                elif e.code == 429:
                    mensagem = "Limite de uso do Gemini atingido. Tente novamente mais tarde."
                else:
                    mensagem = f"Gemini retornou erro {e.code}. Tente novamente mais tarde."
                self._enviar_json({"status": "erro", "mensagem": mensagem}, 502)
            except Exception as e:
                self._enviar_json({"status": "erro", "mensagem": "Falha ao consultar Gemini. Verifique internet e configuracao da API."}, 500)

        elif self.path == '/api/precos/atualizar':
            if not self._exigir_admin(dados=dados):
                return
            itens = dados.get('itens', [])
            atualizados = atualizar_precos_lote(itens)
            self._enviar_json({"status": "sucesso", "atualizados": atualizados})

        elif self.path == '/api/usuarios/criar':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            try:
                criar_usuario(
                    str(dados.get('nome', '')).strip(),
                    str(dados.get('senha', '')),
                    str(dados.get('perfil', '')).strip()
                )
                logger.info("usuario criado nome=%s por=%s", dados.get('nome'), usuario["nome"])
                self._enviar_json({"status": "sucesso"})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)

        elif self.path == '/api/usuarios/excluir':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            alvo = str(dados.get('nome', '')).strip()
            if alvo.lower() == usuario["nome"].lower():
                self._enviar_json({"status": "erro", "mensagem": "Voce nao pode excluir o proprio usuario."}, 400)
                return
            try:
                excluir_usuario(alvo)
                logger.info("usuario excluido nome=%s por=%s", alvo, usuario["nome"])
                self._enviar_json({"status": "sucesso"})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)

        elif self.path == '/api/usuarios/senha':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            try:
                alterar_senha(
                    str(dados.get('nome', '')).strip(),
                    str(dados.get('senha', ''))
                )
                logger.info("senha alterada nome=%s por=%s", dados.get('nome'), usuario["nome"])
                self._enviar_json({"status": "sucesso"})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)

        elif self.path == '/api/usuarios/perfil':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            alvo = str(dados.get('nome', '')).strip()
            novo = str(dados.get('perfil', '')).strip()
            if alvo.lower() == usuario["nome"].lower() and novo != "admin":
                self._enviar_json({"status": "erro", "mensagem": "Voce nao pode rebaixar o proprio usuario."}, 400)
                return
            try:
                alterar_perfil(alvo, novo)
                logger.info("perfil alterado nome=%s para=%s por=%s", alvo, novo, usuario["nome"])
                self._enviar_json({"status": "sucesso"})
            except ValueError as e:
                self._enviar_json({"status": "erro", "mensagem": str(e)}, 400)

        elif self.path == '/api/resetar_sistema':
            usuario = self._exigir_admin(dados=dados)
            if not usuario:
                return
            resetar_sistema()
            logger.warning("sistema resetado usuario=%s ip=%s", usuario["nome"], self.client_address[0])
            self._enviar_json({"status": "sucesso"})


def configurar_logs():
    if logger.handlers:
        return
    nivel = os.environ.get("ERP_LOG_LEVEL", "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger.addHandler(handler)
    logger.setLevel(getattr(logging, nivel, logging.INFO))
    logger.propagate = False


def iniciar_servidor():
    configurar_logs()
    criar_tabelas()
    garantir_seed_usuarios()
    descartados = descartar_produtos_vencendo()
    if descartados:
        logger.info("descarte automatico aplicado em %s produto(s)", descartados)
    porta = 8080
    servidor = ThreadingHTTPServer(('127.0.0.1', porta), ServidorNativo)
    logger.info("servidor iniciado em http://localhost:%s", porta)
    logger.info("loja:  http://localhost:%s/loja", porta)
    logger.info("admin: http://localhost:%s/admin-erp", porta)
    logger.info("usuarios disponiveis: %s", ", ".join(u["nome"] for u in listar_usuarios()))
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        logger.info("servidor encerrado pelo usuario")
    servidor.server_close()


if __name__ == '__main__':
    iniciar_servidor()
