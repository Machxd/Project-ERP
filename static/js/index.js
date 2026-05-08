lucide.createIcons();
    document.getElementById('entrada').valueAsDate = new Date();

    function esc(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    let graficoStatus, graficoCategoria;
    let produtosGlobais = [];
    let historicoGlobal = [];
    let contagemGlobal = { normal: 0, alerta: 0, vencido: 0 };
    let categoriasGlobal = {};
    let ordemAtual = { coluna: '', asc: true };
    let produtoSelecionadoMovimento = null;
    let editandoId = null;
    let usuarioAtual = '';
    let perfilAtual = 'operador';
    let precosAlterados = {};
    let precosSugeridos = {};
    let modoSelecaoPrecos = false;
    let precosSelecionadosGemini = new Set();
    const temaSistemaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function preferenciaTema() {
        return localStorage.getItem('erp_theme_preference') || 'system';
    }

    function aplicarTema(tema = preferenciaTema()) {
        const usarEscuro = tema === 'dark' || (tema === 'system' && temaSistemaQuery?.matches);
        document.body.classList.toggle('dark-theme', !!usarEscuro);
        const icone = document.getElementById('icone-tema');
        if (icone) icone.setAttribute('data-lucide', usarEscuro ? 'sun' : 'moon');
        lucide.createIcons();
        if (graficoStatus || graficoCategoria) atualizarGraficos();
    }

    function tokenSessao() {
        return sessionStorage.getItem('erp_token') || '';
    }

    function usuarioEhAdmin() {
        return perfilAtual === 'admin';
    }

    function fetchAutenticado(url, opcoes = {}) {
        return fetch(url, {
            ...opcoes,
            headers: {
                ...(opcoes.headers || {}),
                'X-Auth-Token': tokenSessao()
            }
        });
    }

    function toggleDropdown() { document.getElementById("importDropdown").classList.toggle("show"); }
    window.onclick = function(event) {
        if (!event.target.matches('.dropbtn') && !event.target.closest('.dropbtn')) {
            const dropdowns = document.getElementsByClassName("dropdown-content");
            for (let i = 0; i < dropdowns.length; i++) {
                if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
            }
        }
    }

    function switchView(view) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${view}`).classList.add('active');
        document.getElementById(`tab-${view}`).classList.add('active');
        if (view === 'precos') renderizarPrecos();
        if (view === 'historico') carregarHistorico();
        if (view === 'pedidos') carregarPedidos();
        if (view === 'usuarios') carregarUsuarios();
    }

    function toggleFullScreen() {
        const container = document.getElementById('fullscreen-container');
        const icone = document.getElementById('icone-fullscreen');
        container.classList.toggle('fullscreen');
        if (container.classList.contains('fullscreen')) {
            icone.setAttribute('data-lucide', 'minimize');
            document.body.style.overflow = 'hidden';
        } else {
            icone.setAttribute('data-lucide', 'maximize');
            document.body.style.overflow = 'auto';
        }
        lucide.createIcons();
    }

    function exportarDados(tipo, formato) {
        const token = tokenSessao();
        if (!token) { window.location.href = '/'; return; }
        window.location.href = `/api/exportar/${tipo}.${formato}?token=${encodeURIComponent(token)}`;
    }

    function toggleTema() {
        const proximoTema = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
        localStorage.setItem('erp_theme_preference', proximoTema);
        aplicarTema(proximoTema);
    }

    function calcularStatus(dataValidade) {
        const validade = new Date(dataValidade);
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const diffDias = Math.ceil((validade - hoje) / (1000 * 60 * 60 * 24));
        if (diffDias < 0) return { html: '<span class="badge vencido">Vencido</span>', tipo: 'vencido' };
        if (diffDias <= 7) return { html: `<span class="badge alerta">Vence em ${diffDias}d</span>`, tipo: 'alerta' };
        return { html: '<span class="badge normal">Válido</span>', tipo: 'normal' };
    }

    function popularFiltroMeses(dados, selectId, campoData) {
        const select = document.getElementById(selectId);
        const valorAtual = select.value;
        select.innerHTML = '<option value="todos">Todos</option>';
        const meses = new Set();
        dados.forEach(item => { if (item[campoData]) meses.add(item[campoData].substring(0, 7)); });
        Array.from(meses).sort().reverse().forEach(anoMes => {
            const [ano, mes] = anoMes.split('-');
            const option = document.createElement('option');
            option.value = anoMes; option.textContent = `${mes}/${ano}`;
            select.appendChild(option);
        });
        if (Array.from(meses).includes(valorAtual)) select.value = valorAtual;
    }

    function popularFiltroCategoriasPrecos() {
        const select = document.getElementById('filtroCategoriaPrecos');
        if (!select) return;
        const valorAtual = select.value;
        select.innerHTML = '<option value="todos">Todas categorias</option>';
        [...new Set(produtosGlobais.map(p => p.categoria).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b))
            .forEach(categoria => {
                const option = document.createElement('option');
                option.value = categoria;
                option.textContent = categoria;
                select.appendChild(option);
            });
        if ([...select.options].some(opt => opt.value === valorAtual)) select.value = valorAtual;
    }

    async function carregarDados() {
        const res = await fetchAutenticado('/api/produtos');
        produtosGlobais = await res.json();
        popularFiltroMeses(produtosGlobais, 'filtroMesInventario', 'entrada');
        popularFiltroCategoriasPrecos();
        const resHist = await fetchAutenticado('/api/movimentacoes');
        historicoGlobal = await resHist.json();
        processarERenderizar();
        if (document.getElementById('view-precos')?.classList.contains('active')) renderizarPrecos();
    }

    async function carregarHistorico() {
        const res = await fetchAutenticado('/api/movimentacoes');
        historicoGlobal = await res.json();
        popularFiltroMeses(historicoGlobal, 'filtroMesHistorico', 'data_hora');
        renderizarHistoricoFiltrado();
    }

    function renderizarHistoricoFiltrado() {
        const filtro = document.getElementById('filtroMesHistorico').value;
        const historicoFiltrado = historicoGlobal.filter(m => filtro === 'todos' || m.data_hora.startsWith(filtro));
        const tbody = document.querySelector('#tabela-historico tbody');
        tbody.innerHTML = '';
        historicoFiltrado.forEach(m => {
            let badgeClass = 'badge-entrada'; let tipoNome = 'Entrada';
            if (m.tipo === 'saida') { badgeClass = 'badge-saida'; tipoNome = 'Saída'; }
            if (m.tipo === 'desperdicio') { badgeClass = 'badge-desperdicio'; tipoNome = 'Desperdício'; }
            if (m.tipo === 'ajuste') { badgeClass = 'badge-alerta'; tipoNome = 'Ajuste'; }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="color:var(--text-tertiary);font-size:0.82rem;">${esc(m.data_hora)}</td>
                <td style="font-weight:500;">${esc(m.produto_nome)}</td>
                <td><span class="badge ${badgeClass}">${tipoNome}</span></td>
                <td style="font-weight:600;">${esc(m.quantidade)}</td>
                <td style="color:var(--text-secondary);">${esc(m.motivo) || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function ordenarTabela(coluna) {
        if (ordemAtual.coluna === coluna) ordemAtual.asc = !ordemAtual.asc;
        else { ordemAtual.coluna = coluna; ordemAtual.asc = true; }
        produtosGlobais.sort((a, b) => {
            let valA = a[coluna]; let valB = b[coluna];
            if (coluna === 'quantidade') { valA = parseFloat(valA); valB = parseFloat(valB); }
            else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
            if (valA < valB) return ordemAtual.asc ? -1 : 1;
            if (valA > valB) return ordemAtual.asc ? 1 : -1;
            return 0;
        });
        processarERenderizar();
    }

    function processarERenderizar() {
        const filtro = document.getElementById('filtroMesInventario').value;
        const pesquisa = (document.getElementById('campoPesquisa').value || '').toLowerCase().trim();
        const produtosFiltrados = produtosGlobais.filter(p => {
            const passaMes = filtro === 'todos' || p.entrada.startsWith(filtro);
            const passaPesquisa = !pesquisa ||
                p.nome.toLowerCase().includes(pesquisa) ||
                p.categoria.toLowerCase().includes(pesquisa) ||
                p.lote.toLowerCase().includes(pesquisa);
            return passaMes && passaPesquisa;
        });
        const tbody = document.querySelector('#tabela-produtos tbody');
        tbody.innerHTML = '';
        contagemGlobal = { normal: 0, alerta: 0, vencido: 0 };
        categoriasGlobal = {};

        produtosFiltrados.forEach(p => {
            const status = calcularStatus(p.validade);
            contagemGlobal[status.tipo]++;
            categoriasGlobal[p.categoria] = (categoriasGlobal[p.categoria] || 0) + p.quantidade;

            const tr = document.createElement('tr');
            tr.className = "clickable-row";
            tr.onclick = function () { if (usuarioEhAdmin()) carregarParaEdicao(p); };
            const botaoExcluir = usuarioEhAdmin() ? `
                    <button class="icon-btn delete" onclick="excluirProduto(${p.id})" title="Excluir">
                        <i data-lucide="trash-2" size="16"></i>
                    </button>` : '';
            tr.innerHTML = `
                <td style="font-weight:500;">${esc(p.nome)}</td>
                <td style="color:var(--text-secondary);">${esc(p.categoria)}</td>
                <td style="color:var(--text-tertiary);font-size:0.84rem;">${esc(p.lote)}</td>
                <td><strong>${esc(p.quantidade)}</strong></td>
                <td style="font-size:0.86rem;">${esc(p.validade)}</td>
                <td>${status.html}</td>
                <td class="action-btns" onclick="event.stopPropagation()">
                    <button class="icon-btn move" data-produto-id="${p.id}" data-produto-nome="${esc(p.nome)}" data-produto-qtd="${p.quantidade}" onclick="abrirModalMovimentoBtn(this)" title="Movimentar">
                        <i data-lucide="arrow-left-right" size="16"></i>
                    </button>
                    ${botaoExcluir}
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
        atualizarGraficos();
        renderizarResumoMovimentacoesDashboard();
    }

    function precoAtualProduto(produto) {
        return Number(produto.preco || 0);
    }

    function precoEditadoProduto(produto) {
        return Object.prototype.hasOwnProperty.call(precosAlterados, produto.id)
            ? Number(precosAlterados[produto.id])
            : precoAtualProduto(produto);
    }

    function diasAteValidadeProduto(produto) {
        const partes = String(produto.validade || '').split('-').map(Number);
        if (partes.length !== 3 || partes.some(n => !Number.isFinite(n))) return Infinity;
        const data = new Date(partes[0], partes[1] - 1, partes[2]);
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        return Math.ceil((data - hoje) / 86400000);
    }

    function arredondarPreco(valor) {
        if (!Number.isFinite(valor) || valor <= 0) return 0;
        if (valor < 1) return Number(valor.toFixed(2));
        return Number((Math.max(0, Math.floor(valor) - 0.10)).toFixed(2));
    }

    function sugerirPrecoProduto(produto) {
        const precoAtual = precoAtualProduto(produto);
        if (precoAtual <= 0) return { preco: 0, motivo: 'Sem preco base' };

        const dias = diasAteValidadeProduto(produto);
        const estoque = Number(produto.quantidade || 0);
        let fator = 1;
        const motivos = [];

        if (dias >= 0 && dias <= 7) {
            fator *= 0.25;
            motivos.push('75% off validade');
        } else if (dias >= 0 && dias <= 30) {
            fator *= 0.75;
            motivos.push('25% off validade');
        }

        if (estoque >= 100) {
            fator *= 0.92;
            motivos.push('estoque alto');
        } else if (estoque >= 50) {
            fator *= 0.95;
            motivos.push('estoque medio');
        } else if (estoque <= 5 && dias > 14) {
            fator *= 1.08;
            motivos.push('estoque baixo');
        }

        if (motivos.length === 0) return { preco: precoAtual, motivo: 'manter' };
        return { preco: arredondarPreco(precoAtual * fator), motivo: motivos.join(' + ') };
    }

    function promocaoValidadeProduto(produto) {
        const precoAtual = precoAtualProduto(produto);
        const dias = diasAteValidadeProduto(produto);
        if (dias < 0 || dias > 30) return null;

        const desconto = dias <= 7 ? 0.75 : 0.25;
        const preco = precoAtual > 0 ? arredondarPreco(precoAtual * (1 - desconto)) : 0;
        const prazo = dias === 0 ? 'vence hoje' : `vence em ${dias}d`;
        return {
            preco,
            desconto,
            dias,
            semPreco: precoAtual <= 0,
            motivo: `${Math.round(desconto * 100)}% off - ${prazo}`
        };
    }

    function formatarMoeda(valor) {
        return 'R$ ' + Number(valor || 0).toFixed(2).replace('.', ',');
    }

    function labelPrazoPromocao(dias) {
        return dias === 0 ? 'vence hoje' : `vence em ${dias}d`;
    }

    function produtoElegivelSugestaoGemini(produto) {
        const promo = promocaoValidadeProduto(produto);
        return !promo || promo.semPreco;
    }

    function atualizarModoSelecaoPrecos() {
        document.body.classList.toggle('price-selection-mode', modoSelecaoPrecos);
        const selecionados = document.getElementById('precosSelecionados');
        if (selecionados) selecionados.textContent = precosSelecionadosGemini.size;
        const btn = document.getElementById('btnSugerirPrecos');
        if (btn && !btn.classList.contains('loading')) {
            const label = btn.querySelector('.btn-label');
            if (label) label.textContent = modoSelecaoPrecos ? 'Consultar selecionados' : 'Sugerir precos';
        }
    }

    function limparSelecaoPrecosInvalida(produtosVisiveis) {
        const idsVisiveis = new Set(produtosVisiveis.map(p => Number(p.id)));
        [...precosSelecionadosGemini].forEach(id => {
            if (!idsVisiveis.has(Number(id))) precosSelecionadosGemini.delete(id);
        });
    }

    function renderizarPrecos() {
        if (!usuarioEhAdmin()) return;
        const pesquisa = (document.getElementById('campoPesquisaPrecos')?.value || '').toLowerCase().trim();
        const categoria = document.getElementById('filtroCategoriaPrecos')?.value || 'todos';
        const produtos = produtosGlobais.filter(p => {
            const passaCategoria = categoria === 'todos' || p.categoria === categoria;
            const passaPesquisa = !pesquisa ||
                p.nome.toLowerCase().includes(pesquisa) ||
                p.categoria.toLowerCase().includes(pesquisa) ||
                p.lote.toLowerCase().includes(pesquisa);
            return passaCategoria && passaPesquisa;
        });

        if (modoSelecaoPrecos) limparSelecaoPrecosInvalida(produtos);
        document.getElementById('precosTotalVisivel').textContent = produtos.length;
        document.getElementById('precosPendentes').textContent = Object.keys(precosAlterados).length;
        document.getElementById('precosSugestoes').textContent = Object.keys(precosSugeridos).length;
        atualizarModoSelecaoPrecos();
        renderizarPromocoesValidade(produtos);

        const tbody = document.querySelector('#tabela-precos tbody');
        tbody.innerHTML = '';
        if (produtos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-tertiary);padding:32px;">Nenhum produto encontrado.</td></tr>';
            return;
        }

        produtos.forEach(p => {
            const precoOriginal = precoAtualProduto(p);
            const precoEditado = precoEditadoProduto(p);
            const mudou = Object.prototype.hasOwnProperty.call(precosAlterados, p.id);
            const sugestao = precosSugeridos[p.id];
            const delta = precoEditado - precoOriginal;
            const deltaClass = delta > 0 ? 'up' : (delta < 0 ? 'down' : '');
            const deltaTexto = delta === 0 ? 'Sem alteração' : `${delta > 0 ? '+' : '-'} ${formatarMoeda(Math.abs(delta))}`;
            const elegivelSugestao = produtoElegivelSugestaoGemini(p);
            const selecionado = precosSelecionadosGemini.has(Number(p.id));
            const tr = document.createElement('tr');
            tr.className = `${modoSelecaoPrecos && elegivelSugestao ? 'price-selectable-row' : ''} ${selecionado ? 'selected' : ''}`;
            tr.innerHTML = `
                <td class="price-select-col">
                    ${elegivelSugestao
                        ? `<input class="price-select-check" type="checkbox" ${selecionado ? 'checked' : ''} onchange="alternarSelecaoPreco(${p.id}, this.checked)">`
                        : `<span class="price-select-blocked" title="Produto em promocao automatica nao entra no Gemini">--</span>`}
                </td>
                <td style="font-weight:600;">${esc(p.nome)}</td>
                <td style="color:var(--text-secondary);">${esc(p.categoria)}</td>
                <td style="color:var(--text-tertiary);font-size:0.84rem;">${esc(p.lote)}</td>
                <td><strong>${esc(p.quantidade)}</strong></td>
                <td style="font-weight:600;">${formatarMoeda(precoOriginal)}</td>
                <td>${sugestao ? `<span class="price-suggestion">${formatarMoeda(sugestao.preco)}<small>${esc(sugestao.motivo)}</small></span>` : '<span class="price-delta">--</span>'}</td>
                <td>
                    <input class="price-input ${mudou ? 'changed' : ''}" type="number" min="0" step="0.01"
                        value="${precoEditado.toFixed(2)}" onchange="alterarPrecoProduto(${p.id}, this.value)">
                </td>
                <td><span class="price-delta ${deltaClass}">${deltaTexto}</span></td>
            `;
            if (modoSelecaoPrecos && elegivelSugestao) {
                tr.onclick = ev => {
                    if (ev.target.closest('input, button, select')) return;
                    alternarSelecaoPreco(p.id, !precosSelecionadosGemini.has(Number(p.id)));
                };
            }
            tbody.appendChild(tr);
        });
    }

    function alternarSelecaoPreco(id, marcado) {
        id = Number(id);
        if (marcado) precosSelecionadosGemini.add(id);
        else precosSelecionadosGemini.delete(id);
        atualizarModoSelecaoPrecos();
        renderizarPrecos();
    }

    function selecionarTodosPrecosVisiveis() {
        if (!modoSelecaoPrecos) return;
        const elegiveis = produtosVisiveisPrecos().filter(produtoElegivelSugestaoGemini).slice(0, 25);
        precosSelecionadosGemini = new Set(elegiveis.map(p => Number(p.id)));
        renderizarPrecos();
    }

    function cancelarSelecaoPrecos() {
        modoSelecaoPrecos = false;
        precosSelecionadosGemini.clear();
        renderizarPrecos();
    }

    function alterarPrecoProduto(id, valor) {
        const produto = produtosGlobais.find(p => p.id === id);
        if (!produto) return;
        const novoPreco = Math.max(0, Number(valor || 0));
        const precoOriginal = precoAtualProduto(produto);
        if (Math.abs(novoPreco - precoOriginal) < 0.001) delete precosAlterados[id];
        else precosAlterados[id] = novoPreco;
        renderizarPrecos();
    }

    function produtosVisiveisPrecos() {
        const pesquisa = (document.getElementById('campoPesquisaPrecos')?.value || '').toLowerCase().trim();
        const categoria = document.getElementById('filtroCategoriaPrecos')?.value || 'todos';
        return produtosGlobais.filter(p => {
            const passaCategoria = categoria === 'todos' || p.categoria === categoria;
            const passaPesquisa = !pesquisa ||
                p.nome.toLowerCase().includes(pesquisa) ||
                p.categoria.toLowerCase().includes(pesquisa) ||
                p.lote.toLowerCase().includes(pesquisa);
            return passaCategoria && passaPesquisa;
        });
    }

    function renderizarPromocoesValidade(produtos = produtosVisiveisPrecos()) {
        const lista = document.getElementById('promoValidadeList');
        const resumo = document.getElementById('promoValidadeResumo');
        if (!lista || !resumo) return;

        const todosItens = produtos
            .map(p => ({ produto: p, promo: promocaoValidadeProduto(p) }))
            .filter(item => item.promo)
            .sort((a, b) => a.promo.dias - b.promo.dias);
        const itens = todosItens.slice(0, 10);

        resumo.textContent = `${todosItens.length} item${todosItens.length === 1 ? '' : 's'}`;
        if (itens.length === 0) {
            lista.innerHTML = '<div class="promo-empty">Nenhum produto visivel entra em promocao automatica agora.</div>';
            return;
        }

        lista.innerHTML = itens.map(({ produto, promo }) => `
            <div class="promo-validity-item">
                <span class="promo-product">
                    <strong>${esc(produto.nome)}</strong>
                    <small>${esc(produto.categoria)} - ${labelPrazoPromocao(promo.dias)}</small>
                </span>
                <span class="promo-price">
                    <small>${Math.round(promo.desconto * 100)}% off</small>
                    ${promo.semPreco ? 'Sem preco' : formatarMoeda(promo.preco)}
                </span>
                <span class="promo-base">${formatarMoeda(precoAtualProduto(produto))}</span>
            </div>
        `).join('');
    }

    function setSugerirPrecosLoading(ativo) {
        const btn = document.getElementById('btnSugerirPrecos');
        if (!btn) return;
        btn.disabled = ativo;
        btn.classList.toggle('loading', ativo);
        const label = btn.querySelector('.btn-label');
        if (label) label.textContent = ativo ? 'Consultando...' : (modoSelecaoPrecos ? 'Consultar selecionados' : 'Sugerir precos');
    }

    async function sugerirPrecos() {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem sugerir precos.");
        const produtosVisiveis = produtosVisiveisPrecos();
        const produtosPromocao = produtosVisiveis.filter(p => {
            const promo = promocaoValidadeProduto(p);
            return promo && !promo.semPreco;
        });
        const produtosElegiveis = produtosVisiveis.filter(produtoElegivelSugestaoGemini);

        if (!modoSelecaoPrecos) {
            if (produtosElegiveis.length === 0) return alert("Nenhum produto elegivel para consultar. Produtos em promocao automatica por validade nao entram nas sugestoes do Gemini.");
            modoSelecaoPrecos = true;
            precosSelecionadosGemini.clear();
            renderizarPrecos();
            alert("Selecione na tabela os produtos que devem receber sugestao de preco. O limite por consulta e de 25 itens.");
            return;
        }

        const produtos = produtosElegiveis.filter(p => precosSelecionadosGemini.has(Number(p.id)));
        if (produtos.length === 0) return alert("Nenhum produto elegivel para consultar. Produtos em promocao automatica por validade nao entram nas sugestoes do Gemini.");
        if (produtos.length > 25) return alert("Selecione no maximo 25 produtos por consulta.");

        const avisoPromos = produtosPromocao.length
            ? ` ${produtosPromocao.length} produto(s) em promocao automatica foram ignorados.`
            : '';
        const ok = confirm(`Consultar Gemini para buscar preco medio de mercado de ${produtos.length} produto(s) selecionado(s)?${avisoPromos} Isso pode usar cota/custo da API.`);
        if (!ok) return;

        const itens = produtos.map(p => ({
            id: p.id,
            nome: p.nome,
            categoria: p.categoria,
            lote: p.lote,
            quantidade: p.quantidade,
            validade: p.validade,
            preco: precoAtualProduto(p)
        }));

        setSugerirPrecosLoading(true);
        try {
            const resposta = await fetch('/api/precos/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: tokenSessao(), itens })
            });
            const dados = await resposta.json().catch(() => ({}));
            if (!resposta.ok) {
                const mensagem = String(dados.mensagem || "Erro ao consultar Gemini. Tente novamente mais tarde.");
                return alert(mensagem.length > 180 ? "Erro ao consultar Gemini. Tente novamente mais tarde." : mensagem);
            }

            let aplicadas = 0;
            (dados.sugestoes || []).forEach(s => {
                const produto = produtosGlobais.find(p => p.id === Number(s.id));
                if (!produto) return;
                const precoAtual = precoAtualProduto(produto);
                const novoPreco = Math.max(0, Number(s.preco || 0));
                if (!novoPreco || Math.abs(novoPreco - precoAtual) < 0.001) return;
                const motivo = String(s.motivo || 'preco medio Gemini').replace(/\s+/g, ' ').slice(0, 90);
                precosSugeridos[produto.id] = {
                    preco: novoPreco,
                    motivo
                };
                precosAlterados[produto.id] = novoPreco;
                aplicadas++;
            });
            modoSelecaoPrecos = false;
            precosSelecionadosGemini.clear();
            renderizarPrecos();
            alert(`${aplicadas} preco(s) medio(s) aplicado(s) para revisao.`);
        } catch (erro) {
            alert("Falha ao consultar Gemini. Verifique servidor, internet e GEMINI_API_KEY.");
        } finally {
            setSugerirPrecosLoading(false);
            lucide.createIcons();
        }
    }

    function descartarPrecos() {
        precosAlterados = {};
        precosSugeridos = {};
        modoSelecaoPrecos = false;
        precosSelecionadosGemini.clear();
        renderizarPrecos();
    }

    async function salvarPrecos() {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem alterar preços.");
        const itens = Object.entries(precosAlterados).map(([id, preco]) => ({ id: Number(id), preco: Number(preco) }));
        if (itens.length === 0) return alert("Nenhuma alteração de preço para salvar.");
        const ok = await enviarRequisicao('/api/precos/atualizar', { itens });
        if (!ok) return;
        precosAlterados = {};
        alert(`${itens.length} preço(s) atualizado(s).`);
        precosSugeridos = {};
        modoSelecaoPrecos = false;
        precosSelecionadosGemini.clear();
        await carregarDados();
        renderizarPrecos();
    }

    function carregarParaEdicao(produto) {
        if (!usuarioEhAdmin()) return;
        editandoId = produto.id;
        document.getElementById('nome').value = produto.nome;
        document.getElementById('categoria').value = produto.categoria;
        document.getElementById('lote').value = produto.lote;
        document.getElementById('quantidade').value = produto.quantidade;
        document.getElementById('preco').value = produto.preco || '';
        document.getElementById('imagem_url').value = produto.imagem_url || '';
        document.getElementById('validade').value = produto.validade;
        document.getElementById('entrada').value = produto.entrada;
        document.getElementById('titulo-form').textContent = "Editar Produto";
        document.getElementById('icone-form').setAttribute('data-lucide', 'edit');
        const btnAcao = document.getElementById('btn-acao-form');
        btnAcao.classList.remove('btn-accent');
        btnAcao.classList.add('btn-warning-fill');
        document.getElementById('icone-btn-form').setAttribute('data-lucide', 'refresh-cw');
        document.getElementById('texto-btn-form').textContent = "Atualizar";
        document.getElementById('btn-cancelar-form').style.display = "flex";
        lucide.createIcons();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function cancelarEdicao() {
        editandoId = null;
        document.getElementById('nome').value = '';
        document.getElementById('categoria').value = '';
        document.getElementById('lote').value = '';
        document.getElementById('quantidade').value = '';
        document.getElementById('preco').value = '';
        document.getElementById('imagem_url').value = '';
        document.getElementById('validade').value = '';
        document.getElementById('entrada').valueAsDate = new Date();
        document.getElementById('titulo-form').textContent = "Novo Produto";
        document.getElementById('icone-form').setAttribute('data-lucide', 'plus-circle');
        const btnAcao = document.getElementById('btn-acao-form');
        btnAcao.classList.remove('btn-warning-fill');
        btnAcao.classList.add('btn-accent');
        document.getElementById('icone-btn-form').setAttribute('data-lucide', 'save');
        document.getElementById('texto-btn-form').textContent = "Registrar";
        document.getElementById('btn-cancelar-form').style.display = "none";
        lucide.createIcons();
    }

    function abrirModalMovimentoBtn(btn) {
        abrirModalMovimento(
            Number(btn.dataset.produtoId),
            btn.dataset.produtoNome,
            Number(btn.dataset.produtoQtd)
        );
    }

    function abrirModalMovimento(id, nome, qtd) {
        produtoSelecionadoMovimento = { id, nome, qtd };
        document.getElementById('modalProdutoNome').textContent = nome;
        document.getElementById('modalProdutoQtd').textContent = qtd;
        document.getElementById('inputMovimentoQtd').value = 1;
        document.getElementById('inputMovimentoMotivo').value = '';
        document.getElementById('modalMovimento').classList.add('active');
    }

    function fecharModal() { document.getElementById('modalMovimento').classList.remove('active'); produtoSelecionadoMovimento = null; }

    function salvarMovimento(tipo) {
        const qtd = parseFloat(document.getElementById('inputMovimentoQtd').value);
        const motivo = document.getElementById('inputMovimentoMotivo').value || (tipo === 'entrada' ? 'Reposição' : (tipo === 'saida' ? 'Venda' : 'Descarte'));
        if (isNaN(qtd) || qtd <= 0) return alert("Quantidade inválida.");
        if ((tipo === 'saida' || tipo === 'desperdicio') && qtd > produtoSelecionadoMovimento.qtd) return alert("Erro: Quantidade excede o estoque atual!");
        enviarRequisicao('/api/movimentar', { id: produtoSelecionadoMovimento.id, tipo: tipo, quantidade: qtd, motivo: motivo }).then(() => fecharModal());
    }

    function atualizarGraficos() {
        const isDark = document.body.classList.contains('dark-theme');
        const colorTitle = isDark ? '#F0EDE8' : '#1A1613';
        const colorGrid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

        Chart.defaults.font.family = "'DM Sans', sans-serif";
        Chart.defaults.color = isDark ? '#9C9590' : '#6B6560';

        const palette = ['rgba(90,158,124,0.55)', 'rgba(107,138,191,0.55)', 'rgba(168,130,194,0.55)', 'rgba(212,154,78,0.55)'];
        const paletteBorder = ['rgba(90,158,124,1)', 'rgba(107,138,191,1)', 'rgba(168,130,194,1)', 'rgba(212,154,78,1)'];

        if (graficoStatus) graficoStatus.destroy();
        graficoStatus = new Chart(document.getElementById('graficoStatus').getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Válidos', 'Alerta', 'Vencidos'],
                datasets: [{
                    data: [contagemGlobal.normal, contagemGlobal.alerta, contagemGlobal.vencido],
                    backgroundColor: ['rgba(90,158,124,0.45)', 'rgba(212,154,78,0.45)', 'rgba(199,91,74,0.45)'],
                    borderColor: ['rgba(90,158,124,1)', 'rgba(212,154,78,1)', 'rgba(199,91,74,1)'],
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '75%',
                plugins: {
                    title: { display: true, text: 'Saúde do Estoque', color: colorTitle, font: { size: 13, weight: '600', family: "'DM Sans'" } },
                    legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } }
                }
            }
        });

        if (graficoCategoria) graficoCategoria.destroy();
        const catLabels = Object.keys(categoriasGlobal);
        graficoCategoria = new Chart(document.getElementById('graficoCategoria').getContext('2d'), {
            type: 'bar',
            data: {
                labels: catLabels,
                datasets: [{
                    label: 'Volume',
                    data: Object.values(categoriasGlobal),
                    backgroundColor: catLabels.map((_, i) => palette[i % palette.length]),
                    borderColor: catLabels.map((_, i) => paletteBorder[i % paletteBorder.length]),
                    borderWidth: 1,
                    borderRadius: 6,
                    barThickness: 24
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Volume por Categoria', color: colorTitle, font: { size: 13, weight: '600', family: "'DM Sans'" } },
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: colorGrid }, border: { display: false } },
                    x: { grid: { display: false }, border: { display: false } }
                }
            }
        });

    }

    function dataCurtaMovimento(valor) {
        if (!valor) return '--';
        const [data, hora = ''] = String(valor).split(' ');
        const partes = data.split('-');
        if (partes.length !== 3) return valor;
        return `${partes[2]}/${partes[1]} ${hora.slice(0, 5)}`;
    }

    function renderizarTabelaResumoMovimento(idTabela, tipo, textoVazio) {
        const tbody = document.querySelector(`#${idTabela} tbody`);
        if (!tbody) return;

        const itens = historicoGlobal
            .filter(m => m.tipo === tipo)
            .sort((a, b) => String(b.data_hora).localeCompare(String(a.data_hora)))
            .slice(0, 6);

        if (itens.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="mini-empty">${textoVazio}</td></tr>`;
            return;
        }

        tbody.innerHTML = itens.map(m => `
            <tr>
                <td>${dataCurtaMovimento(m.data_hora)}</td>
                <td title="${esc(m.produto_nome)}">${esc(m.produto_nome)}</td>
                <td><strong>${esc(m.quantidade)}</strong></td>
                <td title="${esc(m.motivo) || ''}">${esc(m.motivo) || '--'}</td>
            </tr>
        `).join('');
    }

    function renderizarResumoMovimentacoesDashboard() {
        renderizarTabelaResumoMovimento('tabela-dashboard-entradas', 'entrada', 'Nenhuma compra ou entrada registrada.');
        renderizarTabelaResumoMovimento('tabela-dashboard-saidas', 'saida', 'Nenhuma venda ou saida registrada.');
        renderizarTabelaResumoMovimento('tabela-dashboard-desperdicios', 'desperdicio', 'Nenhum desperdicio registrado.');
    }

    async function enviarRequisicao(url, dados) {
        try {
            const payload = { ...dados, token: tokenSessao() };
            const resposta = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!resposta.ok) {
                const erro = await resposta.json().catch(() => ({}));
                alert(erro.mensagem || "Erro interno no servidor.");
                return false;
            }
            carregarDados();
            return true;
        } catch (erro) { alert("Servidor Python desligado."); return false; }
    }

    function salvarFormulario() {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem cadastrar ou editar produtos.");
        const dados = {
            nome: document.getElementById('nome').value,
            categoria: document.getElementById('categoria').value,
            lote: document.getElementById('lote').value || 'S/Lote',
            quantidade: parseFloat(document.getElementById('quantidade').value),
            preco: parseFloat(document.getElementById('preco').value) || 0,
            validade: document.getElementById('validade').value,
            entrada: document.getElementById('entrada').value,
            imagem_url: document.getElementById('imagem_url').value.trim()
        };
        if (!dados.nome || isNaN(dados.quantidade) || !dados.validade) return alert("Preencha os campos obrigatórios.");
        if (editandoId) { dados.id = editandoId; enviarRequisicao('/api/editar', dados).then(() => cancelarEdicao()); }
        else { enviarRequisicao('/api/adicionar', dados).then(() => cancelarEdicao()); }
    }

    function excluirProduto(id) {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem excluir produtos.");
        if (confirm("Confirmar exclusão?")) enviarRequisicao('/api/excluir', { id: id });
    }

    async function resetarSistema() {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem resetar o sistema.");
        const aviso = "Isto vai apagar todos os produtos, movimentações e pedidos. Deseja continuar?";
        if (!confirm(aviso)) return;
        const confirmacao = prompt("Digite RESETAR para confirmar a limpeza do banco de dados:");
        if (confirmacao !== "RESETAR") return alert("Reset cancelado.");
        const ok = await enviarRequisicao('/api/resetar_sistema', {});
        if (!ok) return;
        produtosGlobais = [];
        historicoGlobal = [];
        precosAlterados = {};
        precosSugeridos = {};
        modoSelecaoPrecos = false;
        precosSelecionadosGemini.clear();
        cancelarEdicao();
        processarERenderizar();
        renderizarPrecos();
        renderizarHistoricoFiltrado();
        alert("Sistema resetado com sucesso.");
    }

    async function carregarPedidos() {
        const res = await fetchAutenticado('/api/pedidos');
        if (!res.ok) return alert("Apenas administradores podem visualizar pedidos.");
        const pedidos = await res.json();
        const tbody = document.querySelector('#tabela-pedidos tbody');
        tbody.innerHTML = '';
        if (pedidos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:32px;">Nenhum pedido recebido.</td></tr>';
            return;
        }
        pedidos.forEach(p => {
            const statusMap = {
                pendente: 'badge alerta', confirmado: 'badge normal',
                entregue: 'badge-entrada', cancelado: 'badge-desperdicio'
            };
            const statusNome = { pendente: 'Pendente', confirmado: 'Confirmado', entregue: 'Entregue', cancelado: 'Cancelado' };
            const pagMap = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
            const itensTexto = p.itens.map(i => `${i.nome} ×${i.quantidade}`).join(', ');
            const itensTextoEsc = esc(itensTexto);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600;color:var(--accent);">#${String(p.id).padStart(4,'0')}</td>
                <td style="font-weight:500;">${esc(p.nome_cliente)}</td>
                <td style="color:var(--text-tertiary);font-size:0.82rem;">${esc(p.data_hora)}</td>
                <td style="color:var(--text-secondary);">${esc(pagMap[p.pagamento] || p.pagamento)}</td>
                <td style="font-weight:600;">R$ ${parseFloat(p.total).toFixed(2).replace('.',',')}</td>
                <td>
                    <select class="filtro-mes" style="font-size:0.78rem;padding:4px 6px;" onchange="atualizarStatusPedido(${p.id}, this.value)">
                        <option value="pendente" ${p.status==='pendente'?'selected':''}>Pendente</option>
                        <option value="confirmado" ${p.status==='confirmado'?'selected':''}>Confirmado</option>
                        <option value="entregue" ${p.status==='entregue'?'selected':''}>Entregue</option>
                        <option value="cancelado" ${p.status==='cancelado'?'selected':''}>Cancelado</option>
                    </select>
                </td>
                <td style="color:var(--text-secondary);font-size:0.82rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${itensTextoEsc}">${itensTextoEsc}</td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    function atualizarStatusPedido(id, status) {
        if (!usuarioEhAdmin()) return alert("Apenas administradores podem alterar pedidos.");
        fetch('/api/pedidos/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status, token: tokenSessao() })
        });
    }

    async function carregarUsuarios() {
        if (!usuarioEhAdmin()) return;
        const res = await fetchAutenticado('/api/usuarios');
        if (!res.ok) return alert("Apenas administradores podem listar usuarios.");
        const usuarios = await res.json();
        const tbody = document.querySelector('#tabela-usuarios tbody');
        tbody.innerHTML = '';
        if (!usuarios.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);padding:32px;">Nenhum usuario cadastrado.</td></tr>';
            return;
        }
        usuarios.forEach(u => {
            const ehProprio = u.nome.toLowerCase() === usuarioAtual.toLowerCase();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:500;">${esc(u.nome)}${ehProprio ? ' <span style="color:var(--text-tertiary);font-size:0.78rem;">(você)</span>' : ''}</td>
                <td>
                    <select class="filtro-mes" style="font-size:0.78rem;padding:4px 6px;" data-nome="${esc(u.nome)}" onchange="alterarPerfilUsuario(this)">
                        <option value="operador" ${u.perfil==='operador'?'selected':''}>Operador</option>
                        <option value="admin" ${u.perfil==='admin'?'selected':''}>Admin</option>
                    </select>
                </td>
                <td style="color:var(--text-tertiary);font-size:0.82rem;">${esc(u.criado_em)}</td>
                <td class="action-btns">
                    <button class="icon-btn move" data-nome="${esc(u.nome)}" onclick="alterarSenhaUsuario(this)" title="Alterar senha">
                        <i data-lucide="key" size="16"></i>
                    </button>
                    ${ehProprio ? '' : `
                    <button class="icon-btn delete" data-nome="${esc(u.nome)}" onclick="excluirUsuarioBtn(this)" title="Excluir">
                        <i data-lucide="trash-2" size="16"></i>
                    </button>`}
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    }

    async function criarUsuario() {
        const nome = document.getElementById('usuarioNome').value.trim();
        const senha = document.getElementById('usuarioSenha').value;
        const perfil = document.getElementById('usuarioPerfil').value;
        if (!nome || !senha) return alert("Informe nome e senha.");
        const ok = await postUsuario('/api/usuarios/criar', { nome, senha, perfil });
        if (ok) {
            document.getElementById('usuarioNome').value = '';
            document.getElementById('usuarioSenha').value = '';
            document.getElementById('usuarioPerfil').value = 'operador';
            carregarUsuarios();
        }
    }

    async function alterarSenhaUsuario(btn) {
        const nome = btn.dataset.nome;
        const senha = prompt(`Nova senha para "${nome}" (mínimo 6 caracteres):`);
        if (senha === null) return;
        const ok = await postUsuario('/api/usuarios/senha', { nome, senha });
        if (ok) alert("Senha alterada. Sessoes ativas desse usuario foram encerradas.");
    }

    async function alterarPerfilUsuario(select) {
        const nome = select.dataset.nome;
        const perfil = select.value;
        if (!confirm(`Alterar perfil de "${nome}" para ${perfil}?`)) {
            carregarUsuarios();
            return;
        }
        const ok = await postUsuario('/api/usuarios/perfil', { nome, perfil });
        carregarUsuarios();
        if (!ok) return;
    }

    async function excluirUsuarioBtn(btn) {
        const nome = btn.dataset.nome;
        if (!confirm(`Excluir usuário "${nome}"?`)) return;
        const ok = await postUsuario('/api/usuarios/excluir', { nome });
        if (ok) carregarUsuarios();
    }

    async function postUsuario(url, dados) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...dados, token: tokenSessao() })
        });
        if (!res.ok) {
            const erro = await res.json().catch(() => ({}));
            alert(erro.mensagem || "Erro ao processar a solicitacao.");
            return false;
        }
        return true;
    }

    function processarCSVLegado(event) {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            const textoLimpo = e.target.result.replace(/\r/g, '');
            const linhas = textoLimpo.split('\n').map(l => l.trim()).filter(l => l);
            const loteArr = [];
            for (let i = 1; i < linhas.length; i++) {
                const col = linhas[i].split(',');
                if (col.length >= 5) {
                    let lote, qtd, val, ent, preco = 0;
                    if (col.length > 5) {
                        lote = col[2].trim(); qtd = parseFloat(col[3].trim()); val = col[4].trim(); ent = col[5].trim();
                        preco = parseFloat((col[6] || '0').replace(',', '.')) || 0;
                    } else {
                        qtd = parseFloat(col[2].trim()); val = col[3].trim(); ent = col[4].trim(); let [ano, mes] = ent.split('-'); lote = `Lote ${mes}/${ano}`;
                    }
                    loteArr.push({ nome: col[0].trim(), categoria: col[1].trim(), lote: lote, quantidade: qtd, validade: val, entrada: ent, preco: preco });
                }
            }
            if (loteArr.length > 0) enviarRequisicao('/api/importar_lote', { itens: loteArr }).then(() => alert(`${loteArr.length} produtos importados!`));
            else alert("Nenhum dado válido encontrado.");
        };
        reader.readAsText(file); event.target.value = '';
    }

    function processarCSV(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            const textoLimpo = e.target.result.replace(/\r/g, '');
            const linhas = textoLimpo.split('\n').map(l => l.trim()).filter(l => l);
            const loteArr = [];

            if (linhas.length < 2) {
                alert("Nenhum dado valido encontrado.");
                return;
            }

            const separador = (linhas[0].split(';').length > linhas[0].split(',').length) ? ';' : ',';
            const normalizar = valor => String(valor || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
            const cabecalhos = linhas[0].split(separador).map(c => normalizar(c));
            const indice = nomes => nomes.map(normalizar).map(n => cabecalhos.indexOf(n)).find(i => i >= 0);
            const idxNome = indice(['nome', 'produto']);
            const idxCategoria = indice(['categoria']);
            const idxLote = indice(['lote']);
            const idxQuantidade = indice(['quantidade', 'qtd']);
            const idxValidade = indice(['validade', 'data_validade']);
            const idxEntrada = indice(['entrada', 'data_entrada']);
            const idxPreco = indice(['preco', 'valor', 'valor unitario']);
            const temCabecalhoConhecido = idxNome !== undefined && idxCategoria !== undefined && idxQuantidade !== undefined && idxValidade !== undefined && idxEntrada !== undefined;
            const lerNumero = valor => {
                const bruto = String(valor || '').trim();
                const texto = bruto.includes(',')
                    ? bruto.replace(/\./g, '').replace(',', '.')
                    : bruto;
                const numero = parseFloat(texto);
                return Number.isFinite(numero) ? numero : 0;
            };

            for (let i = 1; i < linhas.length; i++) {
                const col = linhas[i].split(separador).map(c => c.trim());
                let nome, categoria, lote, qtd, val, ent, preco = 0;

                if (temCabecalhoConhecido) {
                    nome = col[idxNome];
                    categoria = col[idxCategoria];
                    lote = idxLote !== undefined ? col[idxLote] : '';
                    qtd = lerNumero(col[idxQuantidade]);
                    val = col[idxValidade];
                    ent = col[idxEntrada];
                    preco = idxPreco !== undefined ? lerNumero(col[idxPreco]) : 0;
                } else if (col.length >= 5) {
                    nome = col[0];
                    categoria = col[1];
                    if (col.length > 5) {
                        lote = col[2];
                        qtd = lerNumero(col[3]);
                        val = col[4];
                        ent = col[5];
                        preco = col.length > 6 ? lerNumero(col[6]) : 0;
                    } else {
                        qtd = lerNumero(col[2]);
                        val = col[3];
                        ent = col[4];
                    }
                }

                if (!nome || !categoria || !qtd || !val || !ent) continue;
                if (!lote) {
                    const [ano, mes] = ent.split('-');
                    lote = ano && mes ? `Lote ${mes}/${ano}` : 'Lote Padrao';
                }
                loteArr.push({ nome, categoria, lote, quantidade: qtd, validade: val, entrada: ent, preco });
            }

            if (loteArr.length > 0) {
                enviarRequisicao('/api/importar_lote', { itens: loteArr })
                    .then(() => alert(`${loteArr.length} produtos importados!`));
            } else {
                alert("Nenhum dado valido encontrado.");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    aplicarTema();
    if (temaSistemaQuery?.addEventListener) {
        temaSistemaQuery.addEventListener('change', () => {
            if (preferenciaTema() === 'system') aplicarTema('system');
        });
    } else if (temaSistemaQuery?.addListener) {
        temaSistemaQuery.addListener(() => {
            if (preferenciaTema() === 'system') aplicarTema('system');
        });
    }

    (function verificarSessao() {
        const token = sessionStorage.getItem('erp_token');
        const usuario = sessionStorage.getItem('erp_usuario');
        const perfil = sessionStorage.getItem('erp_perfil') || (usuario === 'admin' ? 'admin' : 'operador');
        if (!token) { window.location.href = '/'; return; }
        usuarioAtual = usuario || '';
        perfilAtual = perfil;
        document.getElementById('nomeUsuario').textContent = usuario || '---';
        document.getElementById('perfilUsuario').textContent = perfil === 'admin' ? 'Admin' : 'Operador';
        document.body.classList.toggle('operador', perfil !== 'admin');
        const hint = document.querySelector('.panel-header-left .hint');
        if (hint && perfil !== 'admin') hint.textContent = '(operador: movimenta estoque)';
    })();

    async function fazerLogout() {
        const token = sessionStorage.getItem('erp_token');
        try {
            await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        } catch (e) {}
        sessionStorage.removeItem('erp_token');
        sessionStorage.removeItem('erp_usuario');
        sessionStorage.removeItem('erp_perfil');
        window.location.href = '/';
    }

    carregarDados();
