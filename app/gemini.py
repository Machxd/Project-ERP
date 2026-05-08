import json
import os
import urllib.request


def extrair_json_gemini(texto):
    limpo = (texto or "").strip()
    if limpo.startswith("```"):
        limpo = limpo.strip("`").replace("json\n", "", 1).strip()

    inicio = limpo.find("[")
    fim = limpo.rfind("]")
    if inicio >= 0 and fim > inicio:
        limpo = limpo[inicio:fim + 1]
    return json.loads(limpo)


def sugerir_precos_gemini(itens):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("Configure a variavel de ambiente GEMINI_API_KEY antes de usar o Gemini.")

    modelo = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    itens_limpos = []
    for item in (itens or [])[:25]:
        itens_limpos.append({
            "id": int(item.get("id")),
            "nome": str(item.get("nome", ""))[:120],
            "categoria": str(item.get("categoria", ""))[:80],
            "lote": str(item.get("lote", ""))[:80],
            "quantidade": float(item.get("quantidade", 0) or 0),
            "validade": str(item.get("validade", ""))[:20],
            "preco_atual": float(item.get("preco", 0) or 0)
        })

    prompt = (
        "Voce e um assistente de precificacao para uma pequena loja/mercado no Brasil. "
        "Estime o preco medio real atual de varejo brasileiro para cada produto com base no seu conhecimento. "
        "Considere principalmente nome, unidade/peso e categoria. Nao aplique desconto por validade, estoque ou promocao. "
        "Retorne apenas JSON valido, sem markdown, sem texto adicional. "
        "Formato obrigatorio: [{\"id\": 1, \"preco\": 9.90, \"motivo\": \"preco medio de varejo\"}]. "
        "Use somente os ids recebidos. O motivo deve ser curto, sem URLs e com no maximo 8 palavras. "
        "Produtos: "
        + json.dumps(itens_limpos, ensure_ascii=False)
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        dados = json.loads(resp.read().decode("utf-8"))

    partes = dados.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    texto = "".join(p.get("text", "") for p in partes)
    sugestoes = extrair_json_gemini(texto)
    ids_validos = {item["id"] for item in itens_limpos}
    resultado = []
    for s in sugestoes:
        produto_id = int(s.get("id"))
        preco = round(float(s.get("preco", 0) or 0), 2)
        if produto_id not in ids_validos or preco <= 0:
            continue
        resultado.append({
            "id": produto_id,
            "preco": preco,
            "motivo": str(s.get("motivo", "Preco medio de varejo"))[:90]
        })
    return resultado
