const CAT_ICONS = {
    'Laticínios':  { icon: 'droplets',        color: '#3b82f6', bg: '#eff6ff' },
    'Carnes':      { icon: 'beef',             color: '#ef4444', bg: '#fef2f2' },
    'Frutas':      { icon: 'apple',            color: '#22c55e', bg: '#f0fdf4' },
    'Legumes':     { icon: 'leaf',             color: '#16a34a', bg: '#f0fdf4' },
    'Verduras':    { icon: 'leaf',             color: '#15803d', bg: '#f0fdf4' },
    'Hortifrúti':  { icon: 'leaf',             color: '#15803d', bg: '#f0fdf4' },
    'Padaria':     { icon: 'wheat',            color: '#d97706', bg: '#fffbeb' },
    'Bebidas':     { icon: 'coffee',           color: '#6366f1', bg: '#eef2ff' },
    'Congelados':  { icon: 'snowflake',        color: '#0ea5e9', bg: '#f0f9ff' },
    'Grãos':       { icon: 'wheat',            color: '#ca8a04', bg: '#fefce8' },
    'Cereais':     { icon: 'wheat',            color: '#ca8a04', bg: '#fefce8' },
    'Higiene':     { icon: 'sparkles',         color: '#8b5cf6', bg: '#f5f3ff' },
    'Limpeza':     { icon: 'wind',             color: '#64748b', bg: '#f8fafc' },
    'Mercearia':   { icon: 'shopping-basket',  color: '#f97316', bg: '#fff7ed' },
};
function catCfg(cat) { return CAT_ICONS[cat] || { icon: 'package', color: '#6b7280', bg: '#f9fafb' }; }

let todosProdutosLoja = [];
let produtos     = [];
let catAtiva     = null;
let cart         = {};
let step         = 1;
let pagAtivo     = 'pix';
let sortAtivo    = 'relevancia';
let filtroProdutoAtivo = 'todos';
let detalheAbertoId = null;
let produtoBuscaSelecionadoId = null;
const temaSistemaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const brl = v => 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
const cartTotal  = () => Object.values(cart).reduce((s,i) => s + i.preco * i.quantidade, 0);
const cartCount  = () => Object.values(cart).reduce((s,i) => s + i.quantidade, 0);

function preferenciaTema() {
    return localStorage.getItem('erp_theme_preference') || 'system';
}

function aplicarTema(tema = preferenciaTema()) {
    const usarEscuro = tema === 'dark' || (tema === 'system' && temaSistemaQuery?.matches);
    document.body.classList.toggle('dark-theme', !!usarEscuro);
    const icone = document.getElementById('icone-tema');
    if (icone) icone.setAttribute('data-lucide', usarEscuro ? 'sun' : 'moon');
    lucide.createIcons();
}


function diasAteValidade(dataValidade) {
    const partes = String(dataValidade || '').split('-').map(Number);
    if (partes.length !== 3 || partes.some(n => !Number.isFinite(n))) return Infinity;
    const validade = new Date(partes[0], partes[1] - 1, partes[2]);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.ceil((validade - hoje) / 86400000);
}
function arredondarPrecoLoja(valor) {
    if (!Number.isFinite(valor) || valor <= 0) return 0;
    if (valor < 1) return Number(valor.toFixed(2));
    return Number((Math.max(0, Math.floor(valor) - 0.10)).toFixed(2));
}
function promocaoProdutoLoja(produto) {
    const precoOriginal = parseFloat(produto.preco) || 0;
    const dias = diasAteValidade(produto.validade);
    if (precoOriginal <= 0 || dias < 0 || dias > 30) return null;
    const desconto = dias <= 7 ? 0.75 : 0.25;
    return {
        precoOriginal,
        preco: arredondarPrecoLoja(precoOriginal * (1 - desconto)),
        desconto,
        dias,
        prazo: dias === 0 ? 'vence hoje' : `vence em ${dias}d`
    };
}
function precoVendaProduto(produto) {
    const promo = promocaoProdutoLoja(produto);
    return {
        preco: promo ? promo.preco : (parseFloat(produto.preco) || 0),
        promo
    };
}
function validadeInfo(dataValidade) {
    const dias = diasAteValidade(dataValidade);
    if (!Number.isFinite(dias)) return { classe: 'validity-ok', texto: 'Validade nao informada' };
    if (dias < 0) return { classe: 'validity-expired', texto: 'Vencido' };
    if (dias <= 3) return { classe: 'validity-soon', texto: dias === 0 ? 'Vence hoje' : `Vence em ${dias}d` };
    if (dias <= 7) return { classe: 'validity-soon', texto: `Vence em ${dias}d` };
    return { classe: 'validity-ok', texto: `Val. ${dataValidade}` };
}
function aplicarOrdenacao(lista) {
    const ordenada = [...lista];
    if (sortAtivo === 'validade') ordenada.sort((a, b) => diasAteValidade(a.validade) - diasAteValidade(b.validade));
    else if (sortAtivo === 'preco-menor') ordenada.sort((a, b) => precoVendaProduto(a).preco - precoVendaProduto(b).preco);
    else if (sortAtivo === 'preco-maior') ordenada.sort((a, b) => precoVendaProduto(b).preco - precoVendaProduto(a).preco);
    else if (sortAtivo === 'nome') ordenada.sort((a, b) => a.nome.localeCompare(b.nome));
    return ordenada;
}
function ordenarLoja() {
    sortAtivo = document.getElementById('sortSelect').value;
    filtrar();
}
function mudarFiltroProdutos() {
    filtroProdutoAtivo = document.getElementById('viewSelect')?.value || 'todos';
    produtoBuscaSelecionadoId = null;
    document.getElementById('searchInput').value = '';
    fecharBuscaProdutos();
    filtrar();
}
function produtosFiltradosDaCategoria() {
    if (filtroProdutoAtivo === 'promocoes') return produtos.filter(p => promocaoProdutoLoja(p));
    return produtos;
}
function atualizarResumoLoja(lista) {
    const total = lista.length;
    const vencemLogo = lista.filter(p => {
        const dias = diasAteValidade(p.validade);
        return dias >= 0 && dias <= 7;
    }).length;
    const texto = total + (total === 1 ? ' produto' : ' produtos');
    const live = document.getElementById('liveCount');
    const livePanel = document.getElementById('liveCountPanel');
    if (live) live.textContent = texto;
    if (livePanel) livePanel.textContent = texto;
    const fresh = document.getElementById('freshnessSummary');
    if (fresh) fresh.textContent = vencemLogo > 0 ? `${vencemLogo} item(ns) vencem em ate 7 dias` : 'Itens ativos com validade confortavel';
}

function toggleTema() {
    const proximoTema = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
    localStorage.setItem('erp_theme_preference', proximoTema);
    aplicarTema(proximoTema);
}

async function init() {
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

    const categorias = await carregarCategorias();
    await carregarTodosProdutos();
    catAtiva = null;
    produtos = [];
    atualizarResumoLoja(todosProdutosLoja);
    document.getElementById('sectionTitle').textContent = categorias.length ? 'Escolha uma categoria' : 'Nenhuma categoria disponivel';
    document.getElementById('sectionCount').textContent = '';
    renderProdutos([]);
    observarDetalhesProduto();
    observarBuscaProdutos();
    atualizarCartUI();
    lucide.createIcons();
}

async function carregarCategorias() {
    const res  = await fetch('/api/loja/categorias');
    const cats = await res.json();
    const bar  = document.getElementById('catsBar');
    bar.innerHTML = '';

    cats.forEach(cat => {
        const cfg = catCfg(cat);
        const btn = document.createElement('button');
        btn.className   = 'cat-btn';
        btn.dataset.cat = cat;
        btn.innerHTML   = `<span class="cat-icon" style="background:${cfg.bg};color:${cfg.color};"><i data-lucide="${cfg.icon}" size="22"></i></span><span class="cat-name">${cat}</span><span class="cat-meta">Ver produtos</span>`;
        btn.onclick     = () => selecionarCat(cat, btn);
        bar.appendChild(btn);
    });
    lucide.createIcons();
    return cats;
}

async function carregarTodosProdutos() {
    const res = await fetch('/api/loja/produtos');
    todosProdutosLoja = await res.json();
    renderizarPromocoesLoja(todosProdutosLoja);
}

function carregarProdutos(categoria) {
    produtos = categoria
        ? todosProdutosLoja.filter(p => p.categoria === categoria)
        : [];
    atualizarResumoLoja(produtos);
    filtrar();
}

function renderizarPromocoesLoja(lista) {
    const box = document.getElementById('storePromoStrip');
    if (!box) return;
    const promos = lista
        .map(p => ({ produto: p, promo: promocaoProdutoLoja(p) }))
        .filter(item => item.promo)
        .sort((a, b) => a.promo.dias - b.promo.dias);

    if (promos.length === 0) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }

    box.style.display = 'grid';
    const cards = promos.slice(0, 3).map(({ produto, promo }) => `
        <button type="button" class="store-promo-card" onclick="selecionarProdutoBusca(${produto.id})">
            <span class="store-promo-name">${produto.nome}</span>
            <span class="store-promo-meta">${Math.round(promo.desconto * 100)}% off - ${promo.prazo}</span>
            <span class="store-promo-price"><s>${brl(promo.precoOriginal)}</s><strong>${brl(promo.preco)}</strong></span>
        </button>
    `).join('');

    box.innerHTML = `
        <div class="store-promo-copy">
            <span><i data-lucide="badge-percent" size="15"></i> Promocoes por validade</span>
            <strong>${promos.length} item(ns) com desconto automatico</strong>
        </div>
        <div class="store-promo-list">${cards}</div>
        <button type="button" class="store-promo-action" onclick="verPromocoesAutomaticas()">Ver todas as promocoes</button>`;
    lucide.createIcons();
}

function fecharDetalhesProduto(atualizarGrid = false) {
    detalheAbertoId = null;
    const popover = document.getElementById('productDetailsPopover');
    if (popover) popover.remove();
    document.querySelectorAll('.btn-more.active').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
        const label = btn.querySelector('span');
        if (label) label.textContent = 'Ver mais';
    });
    if (atualizarGrid) filtrar();
}

function detalheProdutoHtml(p, validade) {
    const loteTexto = p.catalogo_tipo === 'produto'
        ? `${p.produto_ids?.length || 1} lote(s) disponiveis`
        : (p.lote || 'Lote unico');
    return `
        <div class="popover-head">
            <div>
                <span class="popover-kicker">Detalhes</span>
                <strong>${p.nome}</strong>
            </div>
            <button type="button" class="popover-close" onclick="fecharDetalhesProduto(true)" aria-label="Fechar detalhes">
                <i data-lucide="x" size="14"></i>
            </button>
        </div>
        <div class="detail-row"><span>Estoque</span><strong>${Math.floor(p.quantidade)} un.</strong></div>
        <div class="detail-row"><span>Validade</span><span class="validity-badge ${validade.classe}">${validade.texto}</span></div>
        <div class="detail-row"><span>Lote</span><strong>${loteTexto}</strong></div>
        <div class="detail-row"><span>Categoria</span><strong>${p.categoria}</strong></div>`;
}

function posicionarDetalhesProduto(id) {
    const btn = document.querySelector(`[data-more-id="${id}"]`);
    const popover = document.getElementById('productDetailsPopover');
    if (!btn || !popover) return;

    const rect = btn.getBoundingClientRect();
    const largura = Math.min(280, Math.max(230, rect.width + 48));
    popover.style.width = `${largura}px`;

    const altura = popover.offsetHeight;
    const margem = 12;
    let left = rect.left + rect.width / 2 - largura / 2;
    left = Math.max(margem, Math.min(left, window.innerWidth - largura - margem));

    let top = rect.top - altura - 10;
    if (top < margem) top = rect.bottom + 10;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function abrirDetalhesProduto(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    const btn = document.querySelector(`[data-more-id="${id}"]`);
    if (!produto || !btn) return;

    const antigo = document.getElementById('productDetailsPopover');
    if (antigo) antigo.remove();

    const popover = document.createElement('div');
    popover.id = 'productDetailsPopover';
    popover.className = 'product-popover';
    popover.innerHTML = detalheProdutoHtml(produto, validadeInfo(produto.validade));
    popover.addEventListener('click', ev => ev.stopPropagation());
    document.body.appendChild(popover);

    requestAnimationFrame(() => {
        posicionarDetalhesProduto(id);
        popover.classList.add('show');
        lucide.createIcons();
    });
}

function toggleDetalhesProduto(id, event) {
    if (event) event.stopPropagation();
    if (detalheAbertoId === id) {
        fecharDetalhesProduto(true);
        return;
    }
    detalheAbertoId = id;
    filtrar();
}

function observarDetalhesProduto() {
    document.addEventListener('click', ev => {
        if (ev.target.closest('.product-popover') || ev.target.closest('.btn-more')) return;
        fecharDetalhesProduto(false);
    });
    window.addEventListener('resize', () => {
        if (detalheAbertoId !== null) posicionarDetalhesProduto(detalheAbertoId);
    });
    window.addEventListener('scroll', () => {
        if (detalheAbertoId !== null) posicionarDetalhesProduto(detalheAbertoId);
    }, true);
}

function renderProdutos(lista) {
    const listaOrdenada = aplicarOrdenacao(lista);
    const grid = document.getElementById('productGrid');
    document.getElementById('sectionCount').textContent =
        listaOrdenada.length + (listaOrdenada.length === 1 ? ' produto' : ' produtos');

    grid.innerHTML = '';

    if (listaOrdenada.length === 0) {
        const modoPromocoesGerais = filtroProdutoAtivo === 'promocoes' && !catAtiva;
        const mensagem = modoPromocoesGerais
            ? 'Nenhum produto em promocao no momento.'
            : catAtiva
            ? 'Nenhum produto disponivel nesta selecao.'
            : 'Selecione uma categoria para ver os produtos.';
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i data-lucide="${modoPromocoesGerais ? 'badge-percent' : (catAtiva ? 'package-x' : 'layout-grid')}" size="24"></i></div>
                <p style="color:var(--text-3);font-size:0.875rem;">${mensagem}</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    listaOrdenada.forEach(p => {
        const cfg    = catCfg(p.categoria);
        const inCart = cart[p.id]?.quantidade || 0;
        const precificacao = precoVendaProduto(p);
        const preco  = precificacao.preco;
        const promo = precificacao.promo;
        const imgUrl = p.imagem_url || '';
        const produtoIds = Array.isArray(p.produto_ids) && p.produto_ids.length ? p.produto_ids : [p.id];
        const validade = validadeInfo(p.validade);
        const detalhesAberto = detalheAbertoId === p.id;

        const warnHtml = p.quantidade <= 5
            ? `<div class="card-warn"><i data-lucide="alert-triangle" size="11"></i> Últimas ${Math.floor(p.quantidade)} unid.</div>`
            : '';

        const promoHtml = promo
            ? `<div class="card-promo"><span>${Math.round(promo.desconto * 100)}% off</span><small>${promo.prazo}</small></div>`
            : '';
        const precoHtml = promo
            ? `<div class="card-price promo-price-card"><span class="old-price">${brl(promo.precoOriginal)}</span><strong>${brl(preco)}</strong></div>`
            : `<div class="card-price"><span class="price-prefix">R$</span> ${preco.toFixed(2).replace('.', ',')}</div>`;

        const mediaHtml = imgUrl
            ? `<div class="card-media">
                   <img src="${imgUrl}" alt="${p.nome}" loading="lazy"
                        onerror="this.parentElement.innerHTML=fallbackMedia('${cfg.color}','${cfg.bg}','${cfg.icon}')">
               </div>`
            : `<div class="card-media">
                   <div class="card-media-placeholder" style="background:${cfg.bg};">
                       <i data-lucide="${cfg.icon}" size="36" style="color:${cfg.color};opacity:0.7;"></i>
                   </div>
               </div>`;

        let actionHtml;
        if (inCart > 0) {
            actionHtml = `
            <div class="qty-stepper">
                <button onclick="decItem(${p.id})"><i data-lucide="minus" size="12"></i></button>
                <span class="qty-num">${inCart}</span>
                <button onclick="incItem(${p.id}, ${p.quantidade})"><i data-lucide="plus" size="12"></i></button>
            </div>`;
        } else {
            actionHtml = `
            <button class="btn-add" onclick="addItem(${p.id},'${p.nome.replace(/'/g,"\\'")}','${p.categoria}',${preco},${p.quantidade},${promo ? promo.precoOriginal : preco},${promo ? Math.round(promo.desconto * 100) : 0},${JSON.stringify(produtoIds)})">
                <i data-lucide="plus" size="14"></i> Adicionar
            </button>`;
        }

        const card = document.createElement('div');
        card.className = `prod-card ${promo ? 'has-promo' : ''}`;
        card.id = `pc-${p.id}`;
        card.innerHTML = `
            ${mediaHtml}
            <div class="card-main">
                <div class="card-name">${p.nome}</div>
                <div class="card-cat">${p.categoria}</div>
                ${promoHtml}
                ${warnHtml}
                ${precoHtml}
                ${actionHtml}
                <button class="btn-more ${detalhesAberto ? 'active' : ''}" data-more-id="${p.id}" onclick="toggleDetalhesProduto(${p.id}, event)" aria-expanded="${detalhesAberto ? 'true' : 'false'}" aria-controls="productDetailsPopover">
                    <span>${detalhesAberto ? 'Ver menos' : 'Ver mais'}</span>
                    <i data-lucide="chevron-down" size="14"></i>
                </button>
            </div>`;
        grid.appendChild(card);
    });
    lucide.createIcons();
    if (detalheAbertoId !== null) {
        const existe = listaOrdenada.some(p => p.id === detalheAbertoId);
        if (existe) requestAnimationFrame(() => abrirDetalhesProduto(detalheAbertoId));
        else fecharDetalhesProduto(false);
    }
}

function selecionarCat(cat, btn) {
    catAtiva = cat;
    produtoBuscaSelecionadoId = null;
    filtroProdutoAtivo = 'todos';
    const viewSelect = document.getElementById('viewSelect');
    if (viewSelect) viewSelect.value = 'todos';
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('sectionTitle').textContent = cat;
    document.getElementById('searchInput').value = '';
    fecharBuscaProdutos();
    carregarProdutos(cat);
}

function verPromocoesAutomaticas() {
    catAtiva = null;
    produtos = todosProdutosLoja;
    produtoBuscaSelecionadoId = null;
    document.getElementById('searchInput').value = '';
    const viewSelect = document.getElementById('viewSelect');
    if (viewSelect) viewSelect.value = 'promocoes';
    filtroProdutoAtivo = 'promocoes';
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('sectionTitle').textContent = 'Produtos em promocao';
    atualizarResumoLoja(produtosFiltradosDaCategoria());
    fecharBuscaProdutos();
    filtrar();
    document.getElementById('productGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fecharBuscaProdutos() {
    const box = document.getElementById('searchResults');
    if (!box) return;
    box.classList.remove('show');
    box.innerHTML = '';
}

function renderBuscaProdutos(lista, termo) {
    const box = document.getElementById('searchResults');
    const input = document.getElementById('searchInput');
    if (!box) return;

    if (!termo || document.activeElement !== input) {
        fecharBuscaProdutos();
        return;
    }

    const resultados = lista.slice(0, 7);
    if (resultados.length === 0) {
        box.innerHTML = `
            <div class="search-empty">
                <i data-lucide="search-x" size="15"></i>
                Nenhum produto encontrado
            </div>`;
        box.classList.add('show');
        lucide.createIcons();
        return;
    }

    box.innerHTML = resultados.map(p => {
        const cfg = catCfg(p.categoria);
        const precificacao = precoVendaProduto(p);
        const preco = brl(precificacao.preco);
        const promo = precificacao.promo;
        const inCart = cart[p.id]?.quantidade || 0;
        const acaoBusca = inCart > 0
            ? `<span class="search-added"><i data-lucide="check" size="13"></i>${inCart}</span>`
            : `<button class="search-add-btn" type="button" onclick="addItemBusca(${p.id}, event)" aria-label="Adicionar ${p.nome} ao carrinho"><i data-lucide="plus" size="14"></i></button>`;
        return `
            <div class="search-result-item">
                <button class="search-pick-area" onclick="selecionarProdutoBusca(${p.id})" type="button">
                    <span class="search-result-icon" style="background:${cfg.bg};color:${cfg.color};">
                        <i data-lucide="${cfg.icon}" size="15"></i>
                    </span>
                    <span class="search-result-main">
                        <strong>${p.nome}</strong>
                        <small>${p.categoria} - ${Math.floor(p.quantidade)} un.</small>
                    </span>
                    <span class="search-result-price ${promo ? 'has-promo' : ''}">
                        ${promo ? `<small>${brl(promo.precoOriginal)}</small>` : ''}
                        ${preco}
                    </span>
                </button>
                ${acaoBusca}
            </div>`;
    }).join('');
    box.classList.add('show');
    lucide.createIcons();
}

function selecionarProdutoBusca(id) {
    const produto = todosProdutosLoja.find(p => p.id === id);
    if (!produto) return;
    produtoBuscaSelecionadoId = id;
    if (produto.categoria !== catAtiva) {
        const btn = [...document.querySelectorAll('.cat-btn')].find(b => b.dataset.cat === produto.categoria);
        catAtiva = produto.categoria;
        produtos = todosProdutosLoja.filter(p => p.categoria === produto.categoria);
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.getElementById('sectionTitle').textContent = produto.categoria;
        atualizarResumoLoja(produtos);
    }
    const viewSelect = document.getElementById('viewSelect');
    if (viewSelect) viewSelect.value = 'todos';
    filtroProdutoAtivo = 'todos';
    document.getElementById('searchInput').value = produto.nome;
    fecharBuscaProdutos();
    renderProdutos([produto]);
    requestAnimationFrame(() => {
        const card = document.getElementById(`pc-${id}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function addItemBusca(id, event) {
    if (event) event.stopPropagation();
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;
    const precificacao = precoVendaProduto(produto);
    const produtoIds = Array.isArray(produto.produto_ids) && produto.produto_ids.length ? produto.produto_ids : [produto.id];
    addItem(
        produto.id,
        produto.nome,
        produto.categoria,
        precificacao.preco,
        produto.quantidade,
        precificacao.promo ? precificacao.promo.precoOriginal : precificacao.preco,
        precificacao.promo ? Math.round(precificacao.promo.desconto * 100) : 0,
        produtoIds
    );
    buscarProdutos();
}

function observarBuscaProdutos() {
    const input = document.getElementById('searchInput');
    if (input) input.addEventListener('focus', () => buscarProdutos());
    document.addEventListener('click', ev => {
        if (ev.target.closest('.nav-search')) return;
        fecharBuscaProdutos();
    });
}

function buscarProdutos() {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const base = produtosFiltradosDaCategoria();
    const lista = q
        ? base.filter(p => p.nome.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q))
        : base;
    produtoBuscaSelecionadoId = null;
    if (!q) filtrar();
    renderBuscaProdutos(lista, q);
}

function filtrar() {
    if (produtoBuscaSelecionadoId !== null) {
        const produto = produtos.find(p => p.id === produtoBuscaSelecionadoId);
        renderProdutos(produto ? [produto] : produtosFiltradosDaCategoria());
        return;
    }
    renderProdutos(produtosFiltradosDaCategoria());
}

function addItem(id, nome, cat, preco, maxQtd, precoOriginal = preco, descontoPct = 0, produtoIds = [id]) {
    if (cart[id]) cart[id].quantidade++;
    else cart[id] = { nome, categoria: cat, preco, precoOriginal, descontoPct, produtoIds, quantidade: 1, maxQtd };
    atualizarCartUI();
    filtrar();
}

function incItem(id, maxQtd) {
    if (!cart[id] || cart[id].quantidade >= maxQtd) return;
    cart[id].quantidade++;
    atualizarCartUI();
    filtrar();
}

function decItem(id) {
    if (!cart[id]) return;
    cart[id].quantidade--;
    if (cart[id].quantidade <= 0) delete cart[id];
    atualizarCartUI();
    filtrar();
}

function limparCarrinho() {
    cart = {};
    atualizarCartUI();
    filtrar();
}

function atualizarCartUI() {
    const count = cartCount();
    const total = cartTotal();

    document.getElementById('cartBadge').textContent = count;
    document.getElementById('cartTotalVal').textContent = brl(total);
    const summaryBar = document.getElementById('cartSummaryBar');
    document.getElementById('summaryCount').textContent = count + (count === 1 ? ' item' : ' itens');
    document.getElementById('summaryTotal').textContent = brl(total);
    summaryBar.classList.toggle('active', count > 0);

    const countEl = document.getElementById('cartHeadCount');
    if (count > 0) { countEl.textContent = count; countEl.style.display = 'inline'; }
    else countEl.style.display = 'none';

    const list     = document.getElementById('cartList');
    const emptyMsg = document.getElementById('cartEmptyMsg');

    if (Object.keys(cart).length === 0) {
        list.innerHTML = '';
        list.appendChild(emptyMsg);
        lucide.createIcons();
        return;
    }

    list.innerHTML = '';
    Object.entries(cart).forEach(([id, item]) => {
        const cfg = catCfg(item.categoria);
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            <div class="ci-icon" style="background:${cfg.bg};">
                <i data-lucide="${cfg.icon}" size="16" style="color:${cfg.color};"></i>
            </div>
            <div class="ci-info">
                <div class="ci-name">${item.nome}</div>
                <div class="ci-price">${brl(item.preco * item.quantidade)}${item.descontoPct ? `<small>${item.descontoPct}% off sobre ${brl(item.precoOriginal)}</small>` : ''}</div>
            </div>
            <div class="ci-stepper">
                <button onclick="decItem(${id})"><i data-lucide="minus" size="10"></i></button>
                <span class="ci-qty">${item.quantidade}</span>
                <button onclick="incItem(${id}, ${item.maxQtd})"><i data-lucide="plus" size="10"></i></button>
            </div>`;
        list.appendChild(div);
    });
    lucide.createIcons();
}

function toggleCart() {
    const drawer  = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    const open    = drawer.classList.toggle('open');
    overlay.classList.toggle('show', open);
}

function abrirCheckout() {
    if (cartCount() === 0) { toggleCart(); return; }
    toggleCart();
    step = 1;
    renderSteps();
    preencherReview();
    gerarQr();
    document.getElementById('modalBackdrop').classList.add('show');
}

function fecharCheckout() {
    document.getElementById('modalBackdrop').classList.remove('show');
}

function preencherReview() {
    const items = document.getElementById('reviewItems');
    items.innerHTML = '';
    Object.values(cart).forEach(item => {
        const cfg = catCfg(item.categoria);
        const row = document.createElement('div');
        row.className = 'review-row';
        row.innerHTML = `
            <div class="review-row-left">
                <div class="review-row-icon">
                    <i data-lucide="${cfg.icon}" size="15" style="color:${cfg.color};"></i>
                </div>
                <div>
                    <div class="review-row-name">${item.nome}</div>
                    <div class="review-row-qty">${item.quantidade}× ${brl(item.preco)}${item.descontoPct ? ` - ${item.descontoPct}% off` : ''}</div>
                </div>
            </div>
            <span class="review-row-price">${brl(item.preco * item.quantidade)}</span>`;
        items.appendChild(row);
    });
    document.getElementById('reviewTotal').textContent = brl(cartTotal());
    lucide.createIcons();
}

function gerarQr() {
    document.getElementById('pixAmt').textContent = brl(cartTotal());
    document.getElementById('pixQrBox').innerHTML = svgQr();
}

function renderSteps() {
    const titles = { 1: 'Revisar pedido', 2: 'Entrega e pagamento', 3: 'Pedido confirmado' };
    document.getElementById('modalTitle').textContent = titles[step];

    ['1','2','3'].forEach(n => {
        const d = document.getElementById('sd' + n);
        const ni = parseInt(n);
        d.classList.remove('active','done');
        if (ni === step)      { d.classList.add('active'); d.textContent = n; }
        else if (ni < step)   { d.classList.add('done');  d.innerHTML = '<i data-lucide="check" size="12"></i>'; }
        else                  { d.textContent = n; }
    });
    ['1','2'].forEach(n => {
        document.getElementById('sf' + n).style.width = parseInt(n) < step ? '100%' : '0';
    });

    document.getElementById('s1').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('s2').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('s3').style.display = step === 3 ? 'block' : 'none';

    const foot = document.getElementById('modalFoot');
    const back = document.getElementById('btnBack');
    const next = document.getElementById('btnNext');

    if (step === 3) { foot.style.display = 'none'; return; }
    foot.style.display = 'flex';
    back.style.display = step > 1 ? 'block' : 'none';
    next.textContent   = step === 1 ? 'Continuar' : 'Confirmar pedido';
    lucide.createIcons();
}

function stepNext() {
    if (step === 1) { step = 2; renderSteps(); }
    else if (step === 2) {
        const nome = document.getElementById('fNome').value.trim();
        const end  = document.getElementById('fEnd').value.trim();
        if (!nome || !end) { alert('Preencha nome e endereço.'); return; }
        enviarPedido();
    }
}
function stepBack() { if (step > 1) { step--; renderSteps(); } }

async function enviarPedido() {
    const itens = Object.entries(cart).map(([id, i]) => ({
        produto_id: parseInt(id), nome_produto: i.nome,
        produto_ids: i.produtoIds || [parseInt(id)],
        quantidade: i.quantidade, preco_unitario: i.preco
    }));
    try {
        const res  = await fetch('/api/loja/pedido', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome_cliente: document.getElementById('fNome').value.trim(),
                telefone:     document.getElementById('fTel').value.trim(),
                endereco:     document.getElementById('fEnd').value.trim(),
                complemento:  document.getElementById('fComp').value.trim(),
                observacao:   document.getElementById('fObs').value.trim(),
                pagamento:    pagAtivo, itens
            })
        });
        const data = await res.json();
        if (data.status === 'sucesso') confirmarPedido(data.pedido_id);
        else alert('Erro: ' + (data.mensagem || 'Tente novamente.'));
    } catch { alert('Erro de conexão.'); }
}

function confirmarPedido(pedidoId) {
    const total = cartTotal();
    const pagLabels = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };
    const nome = document.getElementById('fNome').value.trim();
    const end  = document.getElementById('fEnd').value.trim();

    document.getElementById('orderBadge').textContent = '#' + String(pedidoId).padStart(4, '0');
    document.getElementById('successDetail').innerHTML = `
        <div class="sd-row"><span class="lbl">Cliente</span><span class="val">${nome}</span></div>
        <div class="sd-row"><span class="lbl">Endereço</span><span class="val">${end}</span></div>
        <div class="sd-row"><span class="lbl">Pagamento</span><span class="val">${pagLabels[pagAtivo]}</span></div>
        <div class="sd-row"><span class="lbl">Total</span><span class="val" style="color:var(--green);">${brl(total)}</span></div>`;

    cart = {};
    atualizarCartUI();
    carregarProdutos(catAtiva);
    step = 3;
    renderSteps();
}

function selecionarPag(tipo) {
    pagAtivo = tipo;
    ['Pix','Cartao','Dinheiro'].forEach(t => {
        const key = t.toLowerCase();
        document.getElementById('tab' + t).classList.toggle('active', key === tipo);
        document.getElementById('panel' + t).classList.toggle('show', key === tipo);
    });
    if (tipo === 'pix') gerarQr();
}

function fmtNum(el) {
    let v = el.value.replace(/\D/g,'').substring(0,16);
    el.value = v.match(/.{1,4}/g)?.join(' ') || v;
    document.getElementById('cfNum').textContent =
        v.padEnd(16,'•').match(/.{1,4}/g)?.join(' ') || '•••• •••• •••• ••••';
}
function fmtExp(el) {
    let v = el.value.replace(/\D/g,'');
    if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2,4);
    el.value = v;
    document.getElementById('cfExp').textContent = v || 'MM/AA';
}

function copiarPix() {
    navigator.clipboard.writeText(document.getElementById('pixKeyText').textContent).catch(()=>{});
    const btn = event.target; btn.textContent = 'Copiado!';
    setTimeout(() => btn.textContent = 'Copiar', 1500);
}

function svgQr() {
    const n = 23, c = 100/n;
    const s = Date.now();
    const rng = x => { let v = s ^ (x * 2654435761); v ^= v>>17; v ^= v<<31; v ^= v>>8; return (v>>>0)/4294967296; };
    let r = '';
    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            let b = false;
            if ((row<7&&col<7)||(row<7&&col>n-8)||(row>n-8&&col<7)) {
                const rr = row<7?row:row-(n-7), cc = col<7?col:col-(n-7);
                b = rr===0||rr===6||cc===0||cc===6||(rr>=2&&rr<=4&&cc>=2&&cc<=4);
            } else if ((row===6&&col>7&&col<n-8)||(col===6&&row>7&&row<n-8)) {
                b = (row+col)%2===0;
            } else { b = rng(row*n+col) > 0.47; }
            if (b) r += `<rect x="${col*c}" y="${row*c}" width="${c}" height="${c}"/>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/><g fill="#000">${r}</g></svg>`;
}

function fallbackMedia(color, bg, icon) {
    return `<div class="card-media-placeholder" style="background:${bg};">
                <i data-lucide="${icon}" size="36" style="color:${color};opacity:0.7;"></i>
            </div>`;
}

init();
