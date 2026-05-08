import sqlite3

def conectar():
    return sqlite3.connect("data/inventario.db")

def criar_tabelas():
    conn = conectar()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        categoria TEXT NOT NULL,
        lote TEXT NOT NULL,
        quantidade REAL NOT NULL,
        data_validade TEXT NOT NULL,
        data_entrada TEXT NOT NULL,
        preco REAL DEFAULT 0.0
    );
    """)

    try:
        cur.execute("ALTER TABLE produtos ADD COLUMN preco REAL DEFAULT 0.0")
        conn.commit()
    except Exception:
        pass

    try:
        cur.execute("ALTER TABLE produtos ADD COLUMN imagem_url TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass

    cur.execute("""
    CREATE TABLE IF NOT EXISTS movimentacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id INTEGER NOT NULL,
        tipo_movimento TEXT NOT NULL,
        quantidade REAL NOT NULL,
        data_hora TEXT NOT NULL,
        motivo TEXT,
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_cliente TEXT NOT NULL,
        telefone TEXT,
        endereco TEXT NOT NULL,
        complemento TEXT,
        pagamento TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT DEFAULT 'pendente',
        observacao TEXT,
        data_hora TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS itens_pedido (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        nome_produto TEXT NOT NULL,
        quantidade REAL NOT NULL,
        preco_unitario REAL NOT NULL,
        FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
        salt TEXT NOT NULL,
        hash_senha TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK(perfil IN ('admin','operador')),
        criado_em TEXT NOT NULL,
        ativo INTEGER NOT NULL DEFAULT 1
    );
    """)

    conn.commit()
    conn.close()
