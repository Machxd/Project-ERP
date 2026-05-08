# MeriU Gestao + Loja Online

Sistema local de gestao comercial para produtos pereciveis, com controle de estoque, validade, movimentacoes, precos, promocoes automaticas e loja online.

## Como rodar

1. Execute `python servidor.py`
2. Acesse `http://localhost:8080`
3. Login: `admin / admin123` ou `operador / op2024`

## Links locais

- Login: `http://localhost:8080`
- Painel admin: `http://localhost:8080/admin-erp`
- Loja: `http://localhost:8080/loja`

## Estrutura

```text
app/
  auth.py          Usuarios, sessoes e limite de tentativas de login
  config.py        Carregamento local do .env
  database.py      Estrutura e conexao SQLite
  exportacao.py    Geracao de CSV e PDF
  gemini.py        Consulta de sugestao de precos
  operacoes.py     Regras de negocio, estoque, pedidos e precos
  server.py        Servidor HTTP e rotas

templates/
  admin.html       Painel administrativo
  login.html       Login
  loja.html        Loja online

static/
  css/             Estilos
  js/              Scripts
  img/             Imagens da loja e produtos

data/
  inventario.db    Banco SQLite
  samples/         CSVs de exemplo para importacao

docs/              Documentacao e relatorios
servidor.py        Entrada principal
main.py            Entrada alternativa
```

## Funcionalidades

- Cadastro, edicao e exclusao de produtos com permissao de admin
- Movimentacoes de entrada, saida e desperdicio
- Importacao e exportacao CSV/PDF
- Sugestao de precos com Gemini
- Promocoes automaticas por validade
- Descarte automatico de produtos com validade em ate 3 dias
- Loja online com carrinho e checkout local
- Tema automatico conforme o sistema operacional
