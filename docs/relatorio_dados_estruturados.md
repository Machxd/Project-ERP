# Relatório Técnico — Dados Estruturados no Projeto ERP de Inventário de Perecíveis

---

## 1. Definição de Dados Estruturados

Dados estruturados são informações organizadas em um formato fixo e previsível, onde cada elemento possui um tipo definido, um nome identificador e uma posição clara dentro de uma hierarquia. Diferente de dados não estruturados (como um texto livre ou uma imagem), os dados estruturados seguem um esquema rígido que permite ao computador localizar, comparar e manipular qualquer valor de forma direta, sem necessidade de interpretação.

As principais características dos dados estruturados são:

- **Organização tabular:** os dados são dispostos em linhas e colunas, como em uma planilha ou tabela de banco de dados, onde cada coluna representa um atributo e cada linha representa um registro.
- **Tipagem definida:** cada campo possui um tipo de dado explícito (inteiro, texto, real, data), o que permite validações automáticas e operações consistentes.
- **Relacionamento entre entidades:** tabelas diferentes podem se conectar por meio de chaves estrangeiras, criando vínculos lógicos entre conjuntos de dados distintos.
- **Consulta eficiente:** por estarem organizados, é possível buscar, filtrar e ordenar registros usando linguagens como SQL sem percorrer manualmente todo o conjunto.

Em sistemas computacionais, a estruturação dos dados é fundamental porque garante integridade (o dado armazenado é válido), consistência (diferentes partes do sistema enxergam a mesma informação) e escalabilidade (o volume de dados pode crescer sem que a lógica de acesso precise mudar).

---

## 2. Aplicação no Projeto

O projeto desenvolvido é um ERP (Enterprise Resource Planning) voltado para a gestão de inventário de produtos perecíveis. Seu objetivo central é controlar a validade dos produtos, registrar todas as movimentações de estoque (entradas, saídas e desperdícios) e oferecer um painel analítico para apoiar decisões que reduzam prejuízos por vencimento.

### 2.1 Quais dados são utilizados

O sistema trabalha com dois conjuntos principais de dados:

- **Produtos:** representam os itens físicos em estoque, com informações de identificação (nome, categoria, lote), quantidade disponível e datas relevantes (validade e entrada).
- **Movimentações:** representam o histórico de tudo o que aconteceu com cada produto — cadastros iniciais, reposições, vendas, ajustes manuais e registros de desperdício.

### 2.2 Como estão organizados

Os dados seguem o modelo relacional. Existem duas tabelas no banco de dados, e a ligação entre elas é feita pelo campo `produto_id` na tabela de movimentações, que referencia o `id` da tabela de produtos. Essa relação é do tipo um-para-muitos: um produto pode ter diversas movimentações associadas, mas cada movimentação pertence a um único produto.

No lado do front-end (JavaScript), os mesmos dados são armazenados temporariamente em arrays de objetos (`produtosGlobais` e `historicoGlobal`) para permitir filtros, ordenações e renderização dos gráficos sem precisar consultar o servidor a cada interação.

### 2.3 Onde são armazenados

- **Banco de dados SQLite3 (`inventario.db`):** armazenamento persistente no disco. É o repositório definitivo de todos os registros.
- **Variáveis Python (tuplas retornadas pelo cursor):** armazenamento temporário durante o processamento de cada requisição HTTP no back-end.
- **Variáveis JavaScript (arrays e objetos):** armazenamento temporário no navegador, alimentado pelas respostas da API, usado para renderização da interface e dos gráficos.

---

## 3. Exemplo de Variáveis Estruturadas

A tabela abaixo apresenta 14 variáveis utilizadas no projeto, abrangendo back-end e front-end:

| # | Nome da Variável | Tipo de Dado | Descrição | Exemplo de Valor |
|---|---|---|---|---|
| 1 | `id` (produtos) | INTEGER | Identificador único do produto, gerado automaticamente pelo banco | `7` |
| 2 | `nome` | TEXT | Nome comercial do produto | `"Leite Meio Gordo"` |
| 3 | `categoria` | TEXT | Classificação do produto | `"Laticínios"` |
| 4 | `lote` | TEXT | Código ou descrição do lote de fabricação | `"Lote 05/2024"` |
| 5 | `quantidade` | REAL | Quantidade atual em estoque (unidades ou kg) | `40.0` |
| 6 | `data_validade` | TEXT | Data de vencimento do produto no formato ISO | `"2024-05-15"` |
| 7 | `data_entrada` | TEXT | Data em que o produto foi registrado no estoque | `"2024-05-01"` |
| 8 | `produto_id` (movimentações) | INTEGER | Chave estrangeira que referencia o produto movimentado | `7` |
| 9 | `tipo_movimento` | TEXT | Categoria da movimentação realizada | `"saida"` |
| 10 | `quantidade` (movimentações) | REAL | Volume movimentado naquela operação | `10.0` |
| 11 | `data_hora` | TEXT | Momento exato do registro da movimentação | `"2024-05-10 14:32:00"` |
| 12 | `motivo` | TEXT | Justificativa ou observação sobre a movimentação | `"Venda balcão"` |
| 13 | `produtosGlobais` (JS) | Array de objetos | Lista completa de produtos carregada no navegador | `[{id:7, nome:"Leite", ...}]` |
| 14 | `contagemGlobal` (JS) | Objeto | Contadores de status de validade para os gráficos | `{normal:5, alerta:2, vencido:1}` |

---

## 4. Análise da Utilização

### 4.1 O que os dados representam

Os dados do sistema representam o estado físico e financeiro de um estoque de produtos perecíveis. A tabela de **produtos** reflete a fotografia atual do inventário — o que existe, em que quantidade e quando vence. A tabela de **movimentações** reflete o histórico completo — tudo que entrou, saiu ou foi descartado, quando e por qual motivo. Juntas, essas duas entidades permitem reconstruir toda a trajetória de cada item desde o cadastro até o consumo ou descarte.

### 4.2 Como são utilizados no sistema

O fluxo de utilização dos dados segue um ciclo contínuo:

1. **Cadastro:** o usuário preenche o formulário no front-end. Os dados são enviados via requisição POST para a API Python, que insere um novo registro na tabela `produtos` e automaticamente cria uma movimentação do tipo "entrada" na tabela `movimentacoes`.
2. **Consulta e exibição:** o front-end solicita via GET a lista de produtos e movimentações. O back-end consulta o SQLite e retorna os dados em formato JSON. O JavaScript armazena esses dados em variáveis globais e renderiza a tabela, os badges de status e os gráficos do Chart.js.
3. **Movimentação:** ao registrar uma saída ou desperdício, o sistema insere um novo registro na tabela de movimentações e simultaneamente atualiza o campo `quantidade` na tabela de produtos, garantindo que o estoque reflita a operação.
4. **Análise:** os gráficos (doughnut de saúde, barras de categorias e linha de tendência) são construídos a partir dos dados já carregados no navegador, permitindo filtragem por mês sem novas requisições ao servidor.

### 4.3 Por que são importantes para o funcionamento do projeto

Sem a estruturação adequada dos dados, o sistema não conseguiria:

- **Rastrear validade:** o campo `data_validade` com formato padronizado permite calcular automaticamente quantos dias faltam para o vencimento e classificar o produto como "Válido", "Alerta" ou "Vencido".
- **Garantir consistência do estoque:** a relação entre `movimentacoes` e `produtos` via chave estrangeira impede que uma movimentação referencie um produto inexistente e permite que cada entrada ou saída ajuste corretamente a quantidade.
- **Gerar análises confiáveis:** os gráficos do dashboard dependem de dados tipados e previsíveis. A contagem de produtos por status e a soma de quantidades por categoria só funcionam porque cada registro segue exatamente o mesmo esquema.
- **Manter o histórico auditável:** toda operação fica registrada com data, hora e motivo, o que permite reconstruir decisões passadas e identificar padrões de desperdício.

---

## 5. Controle de Fluxo

O controle de fluxo do projeto está distribuído entre o back-end Python e o front-end JavaScript, utilizando estruturas condicionais e de repetição para direcionar a lógica do sistema de acordo com os dados recebidos.

### 5.1 Estruturas Condicionais (if / else)

No **back-end**, a principal estrutura condicional está na função `registrar_movimento` do arquivo `operacoes.py`. Essa função recebe o tipo de movimentação e decide se o estoque deve ser incrementado ou decrementado:

```python
if tipo == 'entrada':
    cur.execute("UPDATE produtos SET quantidade = quantidade + ? WHERE id = ?", (quantidade, produto_id))
elif tipo in ['saida', 'desperdicio']:
    cur.execute("UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?", (quantidade, produto_id))
```

Essa decisão é crítica porque garante que o estoque nunca seja atualizado de forma incorreta — uma entrada sempre soma, enquanto uma saída ou desperdício sempre subtrai.

No **servidor** (`servidor.py`), toda a lógica de roteamento é baseada em condicionais que verificam o caminho (path) da requisição HTTP:

```python
if self.path == '/api/adicionar':
    # insere produto
elif self.path == '/api/editar':
    # edita produto
elif self.path == '/api/excluir':
    # exclui produto
```

No **front-end**, a função `calcularStatus` usa condicionais para classificar cada produto conforme sua proximidade do vencimento:

```javascript
if (diffDias < 0) return { tipo: 'vencido' };
if (diffDias <= 7) return { tipo: 'alerta' };
return { tipo: 'normal' };
```

Outra condicional importante ocorre na função `salvarMovimento`, que impede que o usuário retire mais do que existe em estoque:

```javascript
if ((tipo === 'saida' || tipo === 'desperdicio') && qtd > produtoSelecionadoMovimento.qtd)
    return alert("Erro: Quantidade excede o estoque atual!");
```

### 5.2 Estruturas de Repetição (for / forEach)

No **back-end**, a função `inserir_produtos_lote` usa um laço `for` para percorrer a lista de produtos importados via CSV e inserir cada um individualmente no banco:

```python
for p in lista_produtos:
    cur.execute("INSERT INTO produtos (...) VALUES (?, ?, ?, ?, ?, ?)", (...))
```

No **front-end**, o laço `forEach` é utilizado em diversos momentos:

- Na função `processarERenderizar`, para percorrer a lista de produtos, calcular o status de cada um, acumular as contagens por categoria e construir as linhas da tabela HTML.
- Na função `renderizarHistoricoFiltrado`, para percorrer as movimentações e montar a tabela de histórico com os badges de tipo correspondentes.
- Na função `popularFiltroMeses`, para gerar dinamicamente as opções do seletor de meses a partir das datas presentes nos dados.

### 5.3 Lógica de Decisão Baseada nos Dados

O sistema toma decisões automatizadas com base nos dados estruturados em vários pontos:

- **Classificação de validade:** a diferença entre a data atual e a `data_validade` determina a cor e o texto do badge exibido na interface, orientando visualmente o operador sobre quais produtos precisam de atenção.
- **Roteamento de requisições:** o caminho da URL (path) recebido pelo servidor Python determina qual função de negócio será executada, funcionando como um controlador que direciona o fluxo para a operação correta.
- **Atualização de estoque:** o campo `tipo_movimento` define se a quantidade do produto será somada ou subtraída, e a validação no front-end impede operações que resultariam em estoque negativo.
- **Filtragem por período:** o valor selecionado no filtro de meses determina quais registros são exibidos na tabela e quais alimentam os gráficos, sem necessidade de nova consulta ao servidor.

Esse conjunto de estruturas condicionais e de repetição, operando sobre dados bem estruturados e tipados, é o que permite ao sistema funcionar de forma coerente, segura e responsiva.

---

*Relatório elaborado como parte da disciplina de Engenharia de Software / Programação, com base no projeto ERP de Inventário de Produtos Perecíveis.*
