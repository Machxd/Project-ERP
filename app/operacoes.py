import sqlite3
from datetime import datetime, timedelta

def conectar():
    return sqlite3.connect("data/inventario.db")

def descartar_produtos_vencendo(dias_limite=3):
    conn = conectar()
    cur = conn.cursor()
    limite = (datetime.now().date() + timedelta(days=dias_limite)).strftime("%Y-%m-%d")
    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    motivo = f"Descarte automatico: validade em ate {dias_limite} dias"

    try:
        cur.execute("BEGIN")
        cur.execute("""
            SELECT id, quantidade FROM produtos
            WHERE quantidade > 0 AND date(data_validade) <= date(?)
        """, (limite,))
        itens = cur.fetchall()

        for produto_id, quantidade in itens:
            qtd = float(quantidade or 0)
            if qtd <= 0:
                continue
            cur.execute("""
                INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
                VALUES (?, 'desperdicio', ?, ?, ?)
            """, (produto_id, qtd, data_hora, motivo))
            cur.execute("UPDATE produtos SET quantidade = 0 WHERE id = ?", (produto_id,))

        conn.commit()
        return len(itens)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def inserir_produto(nome, categoria, lote, quantidade, data_validade, data_entrada, preco=0.0, imagem_url=''):
    conn = conectar()
    cur = conn.cursor()

    if not imagem_url:
        cur.execute("""
            SELECT imagem_url FROM produtos
            WHERE lower(nome) = lower(?) AND lower(categoria) = lower(?) AND imagem_url != ''
            ORDER BY id LIMIT 1
        """, (nome, categoria))
        existente = cur.fetchone()
        if existente:
            imagem_url = existente[0]

    cur.execute("""
    INSERT INTO produtos (nome, categoria, lote, quantidade, data_validade, data_entrada, preco, imagem_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (nome, categoria, lote, quantidade, data_validade, data_entrada, preco, imagem_url))

    if imagem_url:
        cur.execute("""
            UPDATE produtos SET imagem_url = ?
            WHERE lower(nome) = lower(?) AND lower(categoria) = lower(?)
        """, (imagem_url, nome, categoria))

    produto_id = cur.lastrowid
    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute("""
    INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
    VALUES (?, 'entrada', ?, ?, 'Cadastro Inicial')
    """, (produto_id, quantidade, data_hora))

    conn.commit()
    conn.close()
    descartar_produtos_vencendo()

def inserir_produtos_lote(lista_produtos):
    conn = conectar()
    cur = conn.cursor()
    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for p in lista_produtos:
        lote_val = p[2] if len(p) > 5 else "Lote Padrão"
        qtd_val  = p[3] if len(p) > 5 else p[2]
        val_val  = p[4] if len(p) > 5 else p[3]
        ent_val  = p[5] if len(p) > 5 else p[4]
        preco_val = p[6] if len(p) > 6 else 0.0
        cur.execute("""
            SELECT imagem_url FROM produtos
            WHERE lower(nome) = lower(?) AND lower(categoria) = lower(?) AND imagem_url != ''
            ORDER BY id LIMIT 1
        """, (p[0], p[1]))
        imagem_existente = cur.fetchone()
        imagem_val = imagem_existente[0] if imagem_existente else ''

        cur.execute("""
        INSERT INTO produtos (nome, categoria, lote, quantidade, data_validade, data_entrada, preco, imagem_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (p[0], p[1], lote_val, qtd_val, val_val, ent_val, preco_val, imagem_val))

        produto_id = cur.lastrowid
        cur.execute("""
        INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
        VALUES (?, 'entrada', ?, ?, 'Importação CSV')
        """, (produto_id, qtd_val, data_hora))

    conn.commit()
    conn.close()
    descartar_produtos_vencendo()

def editar_produto_completo(produto_id, nome, categoria, lote, quantidade, validade, entrada, preco=0.0, imagem_url=''):
    conn = conectar()
    cur = conn.cursor()

    cur.execute("""
    UPDATE produtos
    SET nome = ?, categoria = ?, lote = ?, quantidade = ?, data_validade = ?, data_entrada = ?, preco = ?, imagem_url = ?
    WHERE id = ?
    """, (nome, categoria, lote, quantidade, validade, entrada, preco, imagem_url, produto_id))

    if imagem_url:
        cur.execute("""
            UPDATE produtos SET imagem_url = ?
            WHERE lower(nome) = lower(?) AND lower(categoria) = lower(?)
        """, (imagem_url, nome, categoria))

    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute("""
    INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
    VALUES (?, 'ajuste', ?, ?, 'Edição de Cadastro')
    """, (produto_id, quantidade, data_hora))

    conn.commit()
    conn.close()
    descartar_produtos_vencendo()

def listar_produtos():
    descartar_produtos_vencendo()
    conn = conectar()
    cur = conn.cursor()
    cur.execute("SELECT id, nome, categoria, lote, quantidade, data_validade, data_entrada, preco, imagem_url FROM produtos")
    produtos = cur.fetchall()
    conn.close()
    return produtos

def excluir_produto(produto_id):
    conn = conectar()
    cur = conn.cursor()
    cur.execute("DELETE FROM movimentacoes WHERE produto_id = ?", (produto_id,))
    cur.execute("DELETE FROM produtos WHERE id = ?", (produto_id,))
    conn.commit()
    conn.close()

def registrar_movimento(produto_id, tipo, quantidade, motivo):
    if tipo not in ('entrada', 'saida', 'desperdicio'):
        raise ValueError("Tipo de movimento invalido.")
    quantidade = float(quantidade)
    if quantidade <= 0:
        raise ValueError("Quantidade deve ser maior que zero.")

    conn = conectar()
    cur = conn.cursor()
    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        cur.execute("BEGIN")
        cur.execute("""
        INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
        VALUES (?, ?, ?, ?, ?)
        """, (produto_id, tipo, quantidade, data_hora, motivo))

        if tipo == 'entrada':
            cur.execute("UPDATE produtos SET quantidade = quantidade + ? WHERE id = ?", (quantidade, produto_id))
        else:
            cur.execute("SELECT quantidade FROM produtos WHERE id = ?", (produto_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError("Produto nao encontrado.")
            if float(row[0]) < quantidade:
                raise ValueError("Estoque insuficiente para a movimentacao.")
            cur.execute("UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?", (quantidade, produto_id))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def listar_movimentacoes():
    conn = conectar()
    cur = conn.cursor()
    cur.execute("""
    SELECT m.id, p.nome, m.tipo_movimento, m.quantidade, m.data_hora, m.motivo
    FROM movimentacoes m
    JOIN produtos p ON m.produto_id = p.id
    ORDER BY m.data_hora DESC
    """)
    movimentos = cur.fetchall()
    conn.close()
    return movimentos

def listar_categorias_loja():
    descartar_produtos_vencendo()
    hoje = datetime.now().strftime("%Y-%m-%d")
    conn = conectar()
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT categoria FROM produtos
        WHERE quantidade > 0 AND data_validade >= ?
        ORDER BY categoria
    """, (hoje,))
    cats = [row[0] for row in cur.fetchall()]
    conn.close()
    return cats

def listar_produtos_loja(categoria=None):
    descartar_produtos_vencendo()
    hoje = datetime.now().strftime("%Y-%m-%d")
    conn = conectar()
    cur = conn.cursor()
    if categoria and categoria != 'todos':
        cur.execute("""
            SELECT id, nome, categoria, lote, quantidade, data_validade, preco, imagem_url
            FROM produtos
            WHERE quantidade > 0 AND data_validade >= ? AND categoria = ?
            ORDER BY nome, data_validade
        """, (hoje, categoria))
    else:
        cur.execute("""
            SELECT id, nome, categoria, lote, quantidade, data_validade, preco, imagem_url
            FROM produtos
            WHERE quantidade > 0 AND data_validade >= ?
            ORDER BY nome, categoria, data_validade
        """, (hoje,))
    produtos = cur.fetchall()
    conn.close()
    return produtos

def criar_pedido(nome_cliente, telefone, endereco, complemento, pagamento, observacao, itens):
    descartar_produtos_vencendo()
    conn = conectar()
    cur = conn.cursor()
    data_hora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    itens_validados = []
    for item in itens:
        try:
            quantidade_pedida = float(item.get('quantidade', 0))
        except (TypeError, ValueError):
            raise ValueError("Quantidade invalida no pedido.")
        if quantidade_pedida <= 0:
            raise ValueError("Quantidade do item deve ser maior que zero.")

        ids = item.get('produto_ids') or [item.get('produto_id')]
        ids = [int(produto_id) for produto_id in ids if produto_id is not None]
        if not ids:
            raise ValueError("Produto invalido no pedido.")

        itens_validados.append({
            "ids": ids,
            "quantidade": quantidade_pedida,
            "nome_produto": str(item.get('nome_produto', '')).strip()
        })

    try:
        cur.execute("BEGIN")
        cur.execute("""
            INSERT INTO pedidos (nome_cliente, telefone, endereco, complemento, pagamento, total, status, observacao, data_hora)
            VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
        """, (nome_cliente, telefone, endereco, complemento, pagamento, 0.0, observacao, data_hora))
        pedido_id = cur.lastrowid

        total = 0.0
        for validado in itens_validados:
            ids = validado["ids"]
            restante = validado["quantidade"]

            cur.execute(f"""
                SELECT id, quantidade, preco, nome FROM produtos
                WHERE id IN ({",".join("?" for _ in ids)}) AND quantidade > 0
                ORDER BY data_validade ASC, id ASC
            """, ids)
            lotes = cur.fetchall()

            if sum(float(lote[1]) for lote in lotes) + 0.0001 < restante:
                raise ValueError(f"Estoque insuficiente para {validado['nome_produto']}.")

            for produto_id, estoque, preco_db, nome_db in lotes:
                if restante <= 0:
                    break
                preco_unitario = float(preco_db or 0)
                if preco_unitario <= 0:
                    raise ValueError(f"Produto sem preco cadastrado: {nome_db}.")

                qtd_saida = min(restante, float(estoque))
                restante -= qtd_saida
                total += qtd_saida * preco_unitario

                cur.execute("""
                    INSERT INTO itens_pedido (pedido_id, produto_id, nome_produto, quantidade, preco_unitario)
                    VALUES (?, ?, ?, ?, ?)
                """, (pedido_id, produto_id, nome_db, qtd_saida, preco_unitario))

                cur.execute("""
                    INSERT INTO movimentacoes (produto_id, tipo_movimento, quantidade, data_hora, motivo)
                    VALUES (?, 'saida', ?, ?, 'Venda Online')
                """, (produto_id, qtd_saida, data_hora))

                cur.execute("""
                    UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?
                """, (qtd_saida, produto_id))

        cur.execute("UPDATE pedidos SET total = ? WHERE id = ?", (round(total, 2), pedido_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return pedido_id

def listar_pedidos():
    conn = conectar()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, nome_cliente, telefone, endereco, pagamento, total, status, data_hora
        FROM pedidos ORDER BY data_hora DESC
    """)
    pedidos = cur.fetchall()
    resultado = []
    for p in pedidos:
        cur.execute("""
            SELECT nome_produto, quantidade, preco_unitario
            FROM itens_pedido WHERE pedido_id = ?
        """, (p[0],))
        itens = cur.fetchall()
        resultado.append({
            'id': p[0], 'nome_cliente': p[1], 'telefone': p[2],
            'endereco': p[3], 'pagamento': p[4], 'total': p[5],
            'status': p[6], 'data_hora': p[7],
            'itens': [{'nome': i[0], 'quantidade': i[1], 'preco': i[2]} for i in itens]
        })
    conn.close()
    return resultado

def atualizar_status_pedido(pedido_id, novo_status):
    conn = conectar()
    cur = conn.cursor()
    cur.execute("UPDATE pedidos SET status = ? WHERE id = ?", (novo_status, pedido_id))
    conn.commit()
    conn.close()

def atualizar_precos_lote(precos):
    conn = conectar()
    cur = conn.cursor()
    atualizados = 0
    for item in precos:
        produto_id = int(item['id'])
        preco = float(item['preco'])
        cur.execute("UPDATE produtos SET preco = ? WHERE id = ?", (preco, produto_id))
        atualizados += cur.rowcount
    conn.commit()
    conn.close()
    return atualizados

def resetar_sistema():
    conn = conectar()
    cur = conn.cursor()
    cur.execute("DELETE FROM itens_pedido")
    cur.execute("DELETE FROM pedidos")
    cur.execute("DELETE FROM movimentacoes")
    cur.execute("DELETE FROM produtos")
    cur.execute("DELETE FROM sqlite_sequence WHERE name IN ('produtos', 'movimentacoes', 'pedidos', 'itens_pedido')")
    conn.commit()
    conn.close()
