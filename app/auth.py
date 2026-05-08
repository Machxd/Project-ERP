import base64
import hashlib
import hmac
import secrets
import sqlite3
import time
from collections import deque
from datetime import datetime
from threading import Lock


SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

SESSAO_TTL_SEGUNDOS = 8 * 60 * 60

LOGIN_MAX_TENTATIVAS = 5
LOGIN_JANELA_SEGUNDOS = 15 * 60

PERFIS_VALIDOS = ("admin", "operador")
SENHA_MIN = 6
NOME_MIN = 3
NOME_MAX = 32

USUARIOS_PADRAO = (
    ("admin", "admin123", "admin"),
    ("operador", "op2024", "operador"),
)


def _conectar():
    return sqlite3.connect("data/inventario.db")


def _hash_senha(senha, salt_b64):
    salt = base64.b64decode(salt_b64)
    derivado = hashlib.scrypt(
        senha.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN
    )
    return base64.b64encode(derivado).decode("ascii")


def gerar_credencial(senha):
    salt_b64 = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
    return salt_b64, _hash_senha(senha, salt_b64)


def _validar_nome(nome):
    if not nome or len(nome) < NOME_MIN or len(nome) > NOME_MAX:
        raise ValueError(f"Nome deve ter entre {NOME_MIN} e {NOME_MAX} caracteres.")
    if not all(c.isalnum() or c in "._-" for c in nome):
        raise ValueError("Nome aceita letras, números, ponto, hífen e underline.")


def _validar_senha(senha):
    if not senha or len(senha) < SENHA_MIN:
        raise ValueError(f"Senha deve ter ao menos {SENHA_MIN} caracteres.")


def _validar_perfil(perfil):
    if perfil not in PERFIS_VALIDOS:
        raise ValueError("Perfil invalido.")


def garantir_seed_usuarios():
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM usuarios")
    if cur.fetchone()[0] == 0:
        agora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for nome, senha, perfil in USUARIOS_PADRAO:
            salt, hash_senha = gerar_credencial(senha)
            cur.execute(
                "INSERT INTO usuarios (nome, salt, hash_senha, perfil, criado_em, ativo) VALUES (?,?,?,?,?,1)",
                (nome, salt, hash_senha, perfil, agora)
            )
        conn.commit()
    conn.close()


_sessoes_ativas = {}
_sessoes_lock = Lock()
_tentativas_login = {}
_tentativas_lock = Lock()


def listar_usuarios():
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("SELECT nome, perfil, criado_em, ativo FROM usuarios ORDER BY nome COLLATE NOCASE")
    linhas = cur.fetchall()
    conn.close()
    return [
        {"nome": l[0], "perfil": l[1], "criado_em": l[2], "ativo": bool(l[3])}
        for l in linhas
    ]


def autenticar_usuario(usuario, senha):
    if not usuario or not senha:
        return None
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("SELECT salt, hash_senha, perfil, ativo FROM usuarios WHERE nome = ? COLLATE NOCASE", (usuario,))
    linha = cur.fetchone()
    conn.close()
    if not linha:
        return None
    salt, hash_senha, perfil, ativo = linha
    if not ativo:
        return None
    candidato = _hash_senha(senha, salt)
    if not hmac.compare_digest(candidato, hash_senha):
        return None
    return {"nome": usuario, "perfil": perfil}


def _buscar_perfil(nome):
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("SELECT perfil, ativo FROM usuarios WHERE nome = ? COLLATE NOCASE", (nome,))
    linha = cur.fetchone()
    conn.close()
    return linha


def criar_usuario(nome, senha, perfil):
    nome = (nome or "").strip()
    _validar_nome(nome)
    _validar_senha(senha)
    _validar_perfil(perfil)
    salt, hash_senha = gerar_credencial(senha)
    agora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = _conectar()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO usuarios (nome, salt, hash_senha, perfil, criado_em, ativo) VALUES (?,?,?,?,?,1)",
            (nome, salt, hash_senha, perfil, agora)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise ValueError("Ja existe um usuario com esse nome.")
    finally:
        conn.close()


def alterar_senha(nome, nova_senha):
    _validar_senha(nova_senha)
    salt, hash_senha = gerar_credencial(nova_senha)
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("UPDATE usuarios SET salt = ?, hash_senha = ? WHERE nome = ? COLLATE NOCASE",
                (salt, hash_senha, nome))
    afetados = cur.rowcount
    conn.commit()
    conn.close()
    if not afetados:
        raise ValueError("Usuario nao encontrado.")
    _invalidar_sessoes_de(nome)


def alterar_perfil(nome, novo_perfil):
    _validar_perfil(novo_perfil)
    linha = _buscar_perfil(nome)
    if not linha:
        raise ValueError("Usuario nao encontrado.")
    perfil_atual = linha[0]
    if perfil_atual == "admin" and novo_perfil != "admin":
        if _contar_admins_ativos() <= 1:
            raise ValueError("Mantenha pelo menos um admin ativo.")
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("UPDATE usuarios SET perfil = ? WHERE nome = ? COLLATE NOCASE", (novo_perfil, nome))
    conn.commit()
    conn.close()
    _invalidar_sessoes_de(nome)


def excluir_usuario(nome):
    linha = _buscar_perfil(nome)
    if not linha:
        raise ValueError("Usuario nao encontrado.")
    perfil_atual, ativo = linha
    if perfil_atual == "admin" and ativo and _contar_admins_ativos() <= 1:
        raise ValueError("Mantenha pelo menos um admin ativo.")
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("DELETE FROM usuarios WHERE nome = ? COLLATE NOCASE", (nome,))
    conn.commit()
    conn.close()
    _invalidar_sessoes_de(nome)


def _contar_admins_ativos():
    conn = _conectar()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM usuarios WHERE perfil = 'admin' AND ativo = 1")
    n = cur.fetchone()[0]
    conn.close()
    return n


def _invalidar_sessoes_de(nome):
    nome_lower = nome.lower()
    with _sessoes_lock:
        tokens_remover = [t for t, s in _sessoes_ativas.items() if s["usuario"].lower() == nome_lower]
        for t in tokens_remover:
            _sessoes_ativas.pop(t, None)


def criar_sessao(usuario):
    token = secrets.token_hex(32)
    with _sessoes_lock:
        _sessoes_ativas[token] = {"usuario": usuario, "expira_em": time.monotonic() + SESSAO_TTL_SEGUNDOS}
    return token


def encerrar_sessao(token):
    with _sessoes_lock:
        sessao = _sessoes_ativas.pop(token, None)
    return sessao["usuario"] if sessao else None


def usuario_por_token(token):
    if not token:
        return None
    agora = time.monotonic()
    with _sessoes_lock:
        sessao = _sessoes_ativas.get(token)
        if not sessao:
            return None
        if sessao["expira_em"] <= agora:
            _sessoes_ativas.pop(token, None)
            return None
        usuario = sessao["usuario"]
    linha = _buscar_perfil(usuario)
    if not linha or not linha[1]:
        with _sessoes_lock:
            _sessoes_ativas.pop(token, None)
        return None
    return {"nome": usuario, "perfil": linha[0]}


def registrar_falha_login(ip):
    agora = time.monotonic()
    with _tentativas_lock:
        fila = _tentativas_login.setdefault(ip, deque())
        while fila and agora - fila[0] > LOGIN_JANELA_SEGUNDOS:
            fila.popleft()
        fila.append(agora)


def limpar_tentativas_login(ip):
    with _tentativas_lock:
        _tentativas_login.pop(ip, None)


def login_bloqueado(ip):
    agora = time.monotonic()
    with _tentativas_lock:
        fila = _tentativas_login.get(ip)
        if not fila:
            return 0
        while fila and agora - fila[0] > LOGIN_JANELA_SEGUNDOS:
            fila.popleft()
        if len(fila) >= LOGIN_MAX_TENTATIVAS:
            return int(LOGIN_JANELA_SEGUNDOS - (agora - fila[0]))
        return 0
