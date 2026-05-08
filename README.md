# MeriU Gestao + Loja Online

Sistema local de gestao comercial para estoque, validade, pedidos e loja online. O projeto roda com Python puro, SQLite e front-end HTML/CSS/JS.

## Como rodar

```powershell
python servidor.py
```

Depois acesse:

- Login: http://localhost:8080
- Painel admin: http://localhost:8080/admin-erp
- Loja: http://localhost:8080/loja

Usuarios criados na primeira execucao (seed inicial):

- admin / admin123
- operador / op2024

A senha dessas contas pode ser trocada na aba **Usuarios** do painel. Veja [Usuarios](#usuarios).

## Estrutura

```text
app/
  auth.py          Usuarios, sessoes (TTL 8h) e rate-limit de login
  config.py        Carregamento local do .env
  database.py      Estrutura SQLite (produtos, movimentacoes, pedidos, usuarios)
  exportacao.py    Geracao de CSV e PDF
  gemini.py        Consulta de sugestao de precos
  operacoes.py     Regras de negocio, estoque, pedidos e precos
  server.py        Servidor HTTP e rotas

templates/
  admin.html       Painel administrativo
  login.html       Login
  loja.html        Loja online

data/
  inventario.db    Banco SQLite
  samples/         CSVs de exemplo para importacao

static/
  css/             Estilos das telas
  js/              Scripts das telas
  img/             Imagens da loja e produtos

docs/              Documentacao e relatorios
servidor.py        Entrada principal
main.py            Entrada alternativa
```

## Observacoes

SQLite ja vem com o Python, entao nao precisa instalar um servidor SQL separado. A interface usa CDNs para icones, fontes e graficos; com internet a experiencia visual fica completa.

## CSV de importacao

O importador aceita CSV separado por virgula ou ponto e virgula.

Colunas aceitas:

```text
Nome,Categoria,Lote,Quantidade,Validade,Entrada,Preco
```

`Preco` e opcional. Se ficar vazio ou se a coluna nao existir, o produto entra com preco `0`.

Tambem e possivel reimportar o CSV exportado pelo sistema, que inclui `ID` e `Imagem URL`; essas colunas extras sao ignoradas na importacao.

## Sugestao de precos com Gemini

A aba de precos consulta a Gemini API para estimar o preco medio real de mercado.

Para usar Gemini, crie um arquivo `.env` na raiz do projeto usando `.env.example` como base:

```env
GEMINI_API_KEY=sua_chave_aqui
GEMINI_MODEL=gemini-2.5-flash
```

O arquivo `.env` fica fora do versionamento pelo `.gitignore`. Tambem e possivel usar variavel de ambiente do Windows:

```powershell
$env:GEMINI_API_KEY="sua_chave_aqui"
python servidor.py
```

As sugestoes do Gemini entram como alteracoes pendentes para revisao do admin. Promocoes por validade sao calculadas automaticamente por regras locais, sem internet.

## Descarte automatico

Produtos com estoque positivo e validade em ate 3 dias sao baixados automaticamente como `desperdicio`. O produto permanece cadastrado com quantidade `0`, e a baixa fica registrada no historico de movimentacoes.

## Usuarios

A aba **Usuarios** (visivel apenas para admin) permite cadastrar, excluir, trocar perfil e redefinir senha.

- Nome: 3 a 32 caracteres, aceita letras, numeros, ponto, hifen e underline.
- Senha: minimo 6 caracteres.
- Perfil: `admin` ou `operador`.
- O sistema sempre mantem ao menos um admin ativo. Trocar a senha ou rebaixar um usuario encerra suas sessoes ativas.
- Voce nao pode excluir nem rebaixar o proprio usuario (evita ficar sem acesso).

## Seguranca

- Senhas armazenadas com **scrypt** (salt unico por usuario, persistido em SQLite). O texto puro nunca e gravado.
- Sessoes com **TTL de 8 horas** e tokens de 64 hex chars. Logout e revalidacao de perfil acontecem por requisicao.
- Login com **rate-limit por IP**: 5 tentativas a cada 15 min. Checkout da loja: 10 pedidos a cada 5 min.
- **Headers de seguranca** em todas as respostas: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Body limitado a 2 MB por requisicao. Campos do checkout tem teto de tamanho e o pedido e limitado a 200 itens.
- Sanitizacao de HTML no painel (campos vindos de cliente anonimo da loja sao escapados antes de renderizar).

## Tema

A preferencia de tema (claro / escuro / sistema) fica salva em `localStorage.erp_theme_preference` no navegador. O login le esse valor e adota o mesmo tema automaticamente, sem botao proprio. O admin e a loja tem botao para alternar.
