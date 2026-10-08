/* =====================================================================
   Módulo de Tratativas — Dashboard NPS Vegas Vigilância
   - Alerta de notas <= 7, indicadores, lista "Clientes para Tratativa"
   - Registro da tratativa, WhatsApp, prints no Google Drive, histórico
   Conversa com a API em apps-script/Code.gs
   ===================================================================== */
(function () {
  'use strict';

  /* -------------------- Configuração -------------------- */
  const CFG = Object.assign({
    // Mesma URL do Code.gs usada pela pesquisa e pelo dashboard (index.html).
    // Só muda se vocês criarem uma implantação nova do Apps Script.
    API_URL: 'https://script.google.com/macros/s/AKfycbynVCaW7QoKzgkmZG5d1U4lUdYPy_0gjYLmntVx5b-UdrhRjshZ2iz-W_frksVxlq8q3Q/exec',
    ATUALIZAR_A_CADA_MS: 90 * 1000,
    ITENS_POR_PAGINA: 24,
    // Mensagem já digitada ao abrir o WhatsApp. Deixe '' para abrir sem texto.
    MENSAGEM_WHATSAPP: 'Olá, {cliente}! Aqui é {responsavel}, da Vegas Vigilância. Recebemos sua avaliação e gostaríamos de conversar para entender melhor o que aconteceu.',
    IMAGEM_LADO_MAX: 1800,
    IMAGEM_QUALIDADE: 0.82,
    MINIATURA_LADO_MAX: 360,
    MINIATURA_QUALIDADE: 0.72
  }, window.VEGAS_TRATATIVAS_CONFIG || {});

  const DEMO = !!window.VegasDemo;
  const CONFIGURADO = DEMO || !/^COLE_AQUI/.test(CFG.API_URL);

  const STATUS = {
    NOVO:                   { rotulo: 'Novo',                    cor: 'vermelho', grupo: 'pendente' },
    AGUARDANDO_CONTATO:     { rotulo: 'Aguardando contato',      cor: 'vermelho', grupo: 'pendente' },
    CONTATO_NAO_REALIZADO:  { rotulo: 'Contato não realizado',   cor: 'preto',    grupo: 'pendente' },
    CONTATO_REALIZADO:      { rotulo: 'Contato realizado',       cor: 'amarelo',  grupo: 'andamento' },
    EM_TRATATIVA:           { rotulo: 'Em tratativa',            cor: 'amarelo',  grupo: 'andamento' },
    RESOLVIDO:              { rotulo: 'Resolvido',               cor: 'verde',    grupo: 'resolvido' },
    NAO_RESOLVIDO:          { rotulo: 'Não resolvido',           cor: 'vinho',    grupo: 'encerrado' },
    CLIENTE_NAO_LOCALIZADO: { rotulo: 'Cliente não localizado',  cor: 'preto',    grupo: 'encerrado' }
  };
  const STATUS_FLUXO = ['AGUARDANDO_CONTATO', 'CONTATO_REALIZADO', 'EM_TRATATIVA', 'RESOLVIDO'];
  const STATUS_OUTROS = ['CONTATO_NAO_REALIZADO', 'CLIENTE_NAO_LOCALIZADO', 'NAO_RESOLVIDO'];
  const STATUS_COM_CONTATO = ['CONTATO_REALIZADO', 'EM_TRATATIVA', 'RESOLVIDO', 'NAO_RESOLVIDO'];
  const ORDEM_GRUPO = { pendente: 0, andamento: 1, encerrado: 2, resolvido: 3 };

  const RAPIDOS = [
    { id: 'todos',      rotulo: 'Todos' },
    { id: 'notas06',    rotulo: 'Notas 0–6' },
    { id: 'nota7',      rotulo: 'Nota 7' },
    { id: 'aguardando', rotulo: 'Aguardando contato' },
    { id: 'andamento',  rotulo: 'Em tratativa' },
    { id: 'resolvidos', rotulo: 'Resolvidos' }
  ];

  const CHAVE_NOME = 'vegas_trat_nome'; // nome de quem usa este aparelho (sem login)
  const PREFIXO_RASCUNHO = 'vegas_trat_rascunho_';
  const TITULO_BASE = document.title;

  /* -------------------- Estado -------------------- */
  const estado = {
    itens: [], usuarios: [], resultados: [],
    carregou: false, carregando: false, erro: '', ultimaCarga: 0,
    rapido: 'todos', pagina: 1,
    filtros: { unidade: '', de: '', ate: '', nota: '', cliente: '', telefone: '', status: '', responsavel: '', situacao: '' },
    novosVistos: null,
    respostas: [], modoFuncionario: false,
    aberto: null,        // { item, historico, miniaturas: {}, carregando, salvando, enviando }
    lb: { indice: 0 },
    imagensCache: new Map(),
    timer: null
  };

  /* -------------------- Utilitários -------------------- */
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const digitos = v => String(v ?? '').replace(/\D/g, '');
  const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pad = n => String(n).padStart(2, '0');
  const st = s => STATUS[s] || STATUS.NOVO;

  function data(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d; }
  function diaISO(v) { const d = data(v); return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; }
  function fmtData(v) { const d = data(v); return d ? d.toLocaleDateString('pt-BR') : '—'; }
  function fmtHora(v) { const d = data(v); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; }
  function fmtDataHora(v) { const d = data(v); return d ? `${fmtData(d)} — ${fmtHora(d)}` : '—'; }
  function fmtDiaTexto(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
  function fmtDuracao(ms) {
    if (!isFinite(ms) || ms < 0) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `${h}h ${pad(m)}min` : `${h}h`;
    const d = Math.floor(h / 24), hr = h % 24;
    return hr ? `${d}d ${hr}h` : `${d}d`;
  }
  function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

  /** Limpa ( ) - espaços e devolve o número no formato 55 + DDD + número. */
  function numeroWhatsApp(telefone, ddd) {
    let d = digitos(telefone).replace(/^0+/, '');
    if (!d) return '';
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
    if (d.length === 10 || d.length === 11) return '55' + d;
    if ((d.length === 8 || d.length === 9) && ddd) return '55' + ddd + d;
    return '';
  }
  function mensagemWhatsApp(item) {
    if (!CFG.MENSAGEM_WHATSAPP) return '';
    const primeiroNome = String(item.cliente || '').trim().split(/\s+/)[0] || '';
    const nome = primeiroNome ? primeiroNome.charAt(0) + primeiroNome.slice(1).toLowerCase() : '';
    const resp = nomeAtual() || 'a supervisão';
    return CFG.MENSAGEM_WHATSAPP.replace('{cliente}', nome).replace('{responsavel}', resp);
  }
  function linkWhatsApp(item) {
    const n = numeroWhatsApp(item.telefone, item.ddd);
    if (!n) return '';
    const txt = mensagemWhatsApp(item);
    return `https://wa.me/${n}` + (txt ? `?text=${encodeURIComponent(txt)}` : '');
  }
  function ehCelular() {
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  }

  /** Mesma chave nos cards de comentário e nas tratativas: telefone + nota + dia. */
  function chave(telefone, nota, dataResposta) {
    return `${digitos(telefone).slice(-8)}|${Number(nota)}|${diaISO(dataResposta)}`;
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function lerLocal(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } }

  /* -------------------- Comunicação com a API -------------------- */
  async function api(acao, dados, opcoes) {
    const corpo = Object.assign({ acao, usuario: nomeAtual() }, dados || {});
    let j;
    if (DEMO) {
      j = await window.VegasDemo.api(acao, corpo);
    } else {
      let r;
      try {
        r = await fetch(CFG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita bloqueio de CORS no Apps Script
          body: JSON.stringify(corpo),
          keepalive: !!(opcoes && opcoes.keepalive)
        });
      } catch (e) {
        throw new Error('Sem conexão com o servidor. Verifique a internet e tente novamente.');
      }
      if (!r.ok) throw new Error(`O servidor respondeu com erro (${r.status}). Tente novamente.`);
      try { j = await r.json(); } catch (e) { throw new Error('Resposta inválida do servidor. Confira se o Code.gs novo foi publicado como nova versão (veja TRATATIVAS.md).'); }
    }
    if (!j.ok) {
      const e = new Error(j.erro || 'Não foi possível concluir a operação.');
      e.codigo = j.codigo;
      throw e;
    }
    return j;
  }

  /* -------------------- Quem está usando (sem login) -------------------- */
  // O nome vem do último "Responsável pelo contato" salvo neste aparelho.
  function nomeAtual() { return String(lerLocal(CHAVE_NOME) || '').trim(); }
  function lembrarNome(nome) { if (nome) gravarLocal(CHAVE_NOME, String(nome).trim().slice(0, 80)); }

  /* -------------------- Carga e atualização -------------------- */
  async function carregar(silencioso) {
    if (!CONFIGURADO || estado.carregando) return;
    estado.carregando = true;
    const primeiraCarga = !estado.carregou;
    if (!silencioso && primeiraCarga) renderLista();
    try {
      const j = await api('listar');
      estado.itens = j.itens || [];
      estado.usuarios = j.usuarios || [];
      estado.resultados = j.resultados || [];
      estado.erro = '';
      estado.carregou = true;
      estado.ultimaCarga = Date.now();
      avisarNovas();
    } catch (e) {
      estado.erro = e.message;
      if (!primeiraCarga && !silencioso) toast(e.message, 'alerta');
    } finally {
      estado.carregando = false;
    }
    // Na primeira carga monta os filtros (unidades/responsáveis); depois só a lista,
    // para não tirar o foco de quem estiver digitando num filtro.
    if (primeiraCarga || !$('#tp-lista')) renderTudo(); else atualizarSemRecriarFiltros();
  }

  function iniciarAtualizacao() {
    clearInterval(estado.timer);
    estado.timer = setInterval(() => { if (!document.hidden) carregar(true); }, CFG.ATUALIZAR_A_CADA_MS);
  }

  // Ao voltar do WhatsApp para o navegador, atualiza na hora.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && CONFIGURADO && Date.now() - estado.ultimaCarga > 20000) carregar(true);
  });

  function avisarNovas() {
    const novos = estado.itens.filter(i => i.status === 'NOVO');
    const ids = new Set(novos.map(i => i.id));
    if (estado.novosVistos) {
      const chegaram = novos.filter(i => !estado.novosVistos.has(i.id));
      if (chegaram.length) {
        const i = chegaram[0];
        toast(chegaram.length === 1
          ? `🔔 Nova tratativa: ${i.cliente} deu nota ${i.nota} e precisa de acompanhamento.`
          : `🔔 ${chegaram.length} novas tratativas aguardando contato.`, 'alerta', 8000);
        try { navigator.vibrate && navigator.vibrate(200); } catch (e) { /* opcional */ }
      }
    }
    estado.novosVistos = ids;
  }

  /* -------------------- Filtros -------------------- */
  function filtrar(itens, ignorarStatus) {
    const f = estado.filtros;
    const telF = digitos(f.telefone);
    const cliF = norm(f.cliente).trim();
    return itens.filter(it => {
      if (f.unidade && it.unidade !== f.unidade) return false;
      const dia = diaISO(it.dataAvaliacao);
      if (f.de && dia < f.de) return false;
      if (f.ate && dia > f.ate) return false;
      if (f.nota !== '' && it.nota !== Number(f.nota)) return false;
      if (cliF && !norm(it.cliente).includes(cliF)) return false;
      if (telF && !digitos(it.telefone).includes(telF)) return false;
      if (f.responsavel === '__sem' && it.responsavel) return false;
      if (f.responsavel && f.responsavel !== '__sem' && it.responsavel !== f.responsavel) return false;
      if (ignorarStatus) return true;
      if (f.status && it.status !== f.status) return false;
      if (f.situacao === 'resolvidas' && it.status !== 'RESOLVIDO') return false;
      if (f.situacao === 'nao_resolvidas' && it.status === 'RESOLVIDO') return false;
      return passaRapido(it, estado.rapido);
    });
  }
  function passaRapido(it, r) {
    switch (r) {
      case 'notas06': return it.nota <= 6;
      case 'nota7': return it.nota === 7;
      case 'aguardando': return st(it.status).grupo === 'pendente';
      case 'andamento': return st(it.status).grupo === 'andamento';
      case 'resolvidos': return it.status === 'RESOLVIDO';
      default: return true;
    }
  }
  function ordenar(itens) {
    return itens.slice().sort((a, b) => {
      const ga = ORDEM_GRUPO[st(a.status).grupo], gb = ORDEM_GRUPO[st(b.status).grupo];
      if (ga !== gb) return ga - gb;
      if ((a.status === 'NOVO') !== (b.status === 'NOVO')) return a.status === 'NOVO' ? -1 : 1;
      return String(b.dataAvaliacao).localeCompare(String(a.dataAvaliacao));
    });
  }
  function pendentes() {
    return ordenar(estado.itens.filter(i => st(i.status).grupo === 'pendente'));
  }

  /* -------------------- Renderização: indicadores -------------------- */
  function renderKpis() {
    const alvo = $('#kpis');
    if (!alvo) return;
    const r = estado.respostas;
    const total = r.length;
    const prom = r.filter(x => x.nota >= 9).length;
    const neut = r.filter(x => x.nota >= 7 && x.nota <= 8).length;
    const detr = r.filter(x => x.nota <= 6).length;
    const pct = n => total ? `${Math.round((n / total) * 100)}% das respostas` : '—';

    const logado = estado.carregou;
    const base = logado ? filtrar(estado.itens, true) : [];
    const qPend = base.filter(i => st(i.status).grupo === 'pendente').length;
    const qAnd = base.filter(i => st(i.status).grupo === 'andamento').length;
    const resolvidas = base.filter(i => i.status === 'RESOLVIDO');
    const taxa = base.length ? Math.round((resolvidas.length / base.length) * 100) : null;
    const tempos = resolvidas.map(i => data(i.dataResolucao) - data(i.dataAvaliacao)).filter(ms => isFinite(ms) && ms >= 0);
    const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : NaN;
    const aguardando = new Set(base.filter(i => i.status === 'NOVO' || i.status === 'AGUARDANDO_CONTATO')
      .map(i => digitos(i.telefone) || norm(i.cliente))).size;

    const valor = n => (logado ? n : '—');
    const subTrat = txt => (logado ? txt : (CONFIGURADO ? (estado.erro ? 'Sem conexão' : 'Carregando…') : 'Módulo não configurado'));

    alvo.innerHTML = `
      <div class="kpi"><span class="kpi-rotulo">📊 Total de respostas</span><span class="kpi-valor">${total}</span><span class="kpi-sub">${estado.modoFuncionario ? 'Pesquisa interna' : 'Período e filtros atuais'}</span></div>
      <div class="kpi" data-cor="verde"><span class="kpi-rotulo">😊 Promotores</span><span class="kpi-valor">${prom}</span><span class="kpi-sub">${pct(prom)} · notas 9–10</span></div>
      <div class="kpi" data-cor="amarelo"><span class="kpi-rotulo">😐 Neutros</span><span class="kpi-valor">${neut}</span><span class="kpi-sub">${pct(neut)} · notas 7–8</span></div>
      <div class="kpi" data-cor="vermelho"><span class="kpi-rotulo">😞 Detratores</span><span class="kpi-valor">${detr}</span><span class="kpi-sub">${pct(detr)} · notas 0–6</span></div>
      <button type="button" class="kpi ${logado ? '' : 'kpi-bloqueado'}" data-cor="vermelho" data-ir-rapido="aguardando"><span class="kpi-rotulo">🔴 Tratativas pendentes</span><span class="kpi-valor">${valor(qPend)}</span><span class="kpi-sub">${subTrat('Ainda sem contato com o cliente')}</span></button>
      <button type="button" class="kpi ${logado ? '' : 'kpi-bloqueado'}" data-cor="amarelo" data-ir-rapido="andamento"><span class="kpi-rotulo">🟡 Em tratativa</span><span class="kpi-valor">${valor(qAnd)}</span><span class="kpi-sub">${subTrat('Contato feito, em andamento')}</span></button>
      <button type="button" class="kpi ${logado ? '' : 'kpi-bloqueado'}" data-cor="verde" data-ir-rapido="resolvidos"><span class="kpi-rotulo">🟢 Resolvidas</span><span class="kpi-valor">${valor(resolvidas.length)}</span><span class="kpi-sub">${subTrat(`de ${plural(base.length, 'tratativa', 'tratativas')}`)}</span></button>
      <div class="kpi kpi-metricas ${logado ? '' : 'kpi-bloqueado'}">
        <div><span>Taxa de resolução</span><strong>${logado && taxa !== null ? taxa + '%' : '—'}</strong></div>
        <div><span>Tempo médio de atendimento</span><strong>${logado ? fmtDuracao(tempoMedio) : '—'}</strong></div>
        <div><span>Clientes aguardando contato</span><strong>${valor(aguardando)}</strong></div>
      </div>`;
  }

  /* -------------------- Renderização: alerta -------------------- */
  function renderAlerta() {
    const alvo = $('#tratAlerta');
    if (!alvo) return;
    const lista = pendentes();
    document.title = lista.length ? `(${lista.length}) ${TITULO_BASE}` : TITULO_BASE;
    if (!lista.length) { alvo.innerHTML = ''; alvo.className = ''; return; }

    const novo = lista.find(i => i.status === 'NOVO');
    const destaque = novo || lista[0];
    const manchete = novo
      ? `<strong>Nova tratativa</strong><p>Cliente ${esc(destaque.cliente)} deu nota ${esc(destaque.nota)} e precisa de acompanhamento.</p>`
      : `<strong>Clientes aguardando contato</strong><p>Há avaliações com nota até 7 que ainda não receberam contato da supervisão.</p>`;

    const cards = lista.slice(0, 3).map(i => {
      const wa = linkWhatsApp(i);
      return `
        <div class="ta-card">
          <span class="ta-titulo">🔴 ATENÇÃO — CLIENTE INSATISFEITO</span>
          <span><b>Cliente:</b> ${esc(i.cliente)}</span>
          <span><b>Nota NPS:</b> ${esc(i.nota)}</span>
          <span><b>Telefone:</b> ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">${esc(i.telefone)}</a>` : esc(i.telefone || '—')}</span>
          <span><b>Data:</b> ${fmtData(i.dataAvaliacao)}</span>
          <span><b>Status:</b> ⚠️ ${i.status === 'NOVO' ? 'Aguardando contato' : esc(st(i.status).rotulo)}</span>
          <div class="ta-acoes">
            ${wa ? `<a class="tb tb-wa" href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">💬 WhatsApp</a>` : ''}
            <button type="button" class="tb tb-primario" data-abrir="${esc(i.id)}">Iniciar tratativa</button>
          </div>
        </div>`;
    }).join('');

    alvo.className = 'trat-alerta';
    alvo.setAttribute('role', 'region');
    alvo.setAttribute('aria-label', 'Alertas de clientes insatisfeitos');
    alvo.innerHTML = `
      <div class="ta-topo">
        <span class="ta-sino" aria-hidden="true">🔔</span>
        <div class="ta-texto">${manchete}</div>
        <span class="ta-contador">🔴 ${plural(lista.length, 'tratativa pendente', 'tratativas pendentes')}</span>
      </div>
      <div class="ta-lista">${cards}</div>
      ${lista.length > 1 ? `<div class="ta-rodape ${lista.length > 3 ? '' : 'so-celular'}"><button type="button" class="tb" data-ir-rapido="aguardando">Ver todas as ${lista.length} pendentes</button></div>` : ''}`;
  }

  /* -------------------- Renderização: painel -------------------- */
  function renderPainel() {
    const alvo = $('#tratPainel');
    if (!alvo) return;
    const demo = DEMO ? '<div class="trat-demo">Modo demonstração: dados fictícios, nada é gravado.</div>' : '';

    if (!CONFIGURADO) {
      alvo.innerHTML = `<div class="tp-login"><div><h2>Clientes para Tratativa</h2>
        <p>O módulo de tratativas ainda não está conectado. Siga o guia <strong>TRATATIVAS.md</strong> e confira a URL em <code>tratativas/tratativas.js</code> (API_URL).</p></div></div>`;
      return;
    }

    const f = estado.filtros;
    const unidades = Array.from(new Map(estado.itens.map(i => [i.unidade, i.nomeUnidade])).entries());
    const responsaveis = Array.from(new Set([...estado.usuarios, ...estado.itens.map(i => i.responsavel).filter(Boolean)])).sort();
    const opt = (v, rot, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(rot)}</option>`;
    const filtrosAbertos = window.matchMedia('(min-width: 901px)').matches || Object.values(f).some(Boolean);

    alvo.innerHTML = `${demo}
      <div class="tp-cabecalho">
        <h2>Clientes para Tratativa<span class="tp-qtd" id="tp-qtd"></span></h2>
        <div class="tp-acoes">
          <button type="button" class="tb" id="tp-atualizar" title="Buscar novas avaliações">↻ Atualizar</button>
        </div>
      </div>
      <div class="tp-rapidos" role="group" aria-label="Filtro rápido" id="tp-rapidos"></div>
      <details class="tp-filtros" ${filtrosAbertos ? 'open' : ''}>
        <summary>Filtros</summary>
        <div class="top-bar">
          ${unidades.length > 1 ? `<select id="tf-unidade" aria-label="Unidade">${opt('', 'Todas as unidades', f.unidade)}${unidades.map(([u, n]) => opt(u, n, f.unidade)).join('')}</select>` : ''}
          <div class="periodo">
            <label for="tf-de">De:</label><input type="date" id="tf-de" value="${esc(f.de)}">
            <label for="tf-ate">Até:</label><input type="date" id="tf-ate" value="${esc(f.ate)}">
          </div>
          <select id="tf-nota" aria-label="Nota">${opt('', 'Nota: todas', f.nota)}${[0, 1, 2, 3, 4, 5, 6, 7].map(n => opt(n, 'Nota ' + n, f.nota)).join('')}</select>
          <input type="text" id="tf-cliente" placeholder="Cliente..." aria-label="Buscar cliente" value="${esc(f.cliente)}">
          <input type="tel" id="tf-telefone" placeholder="Telefone..." aria-label="Buscar telefone" value="${esc(f.telefone)}">
          <select id="tf-status" aria-label="Status">${opt('', 'Status: todos', f.status)}${Object.keys(STATUS).map(s => opt(s, STATUS[s].rotulo, f.status)).join('')}</select>
          <select id="tf-responsavel" aria-label="Responsável">${opt('', 'Responsável: todos', f.responsavel)}${opt('__sem', 'Sem responsável', f.responsavel)}${responsaveis.map(n => opt(n, n, f.responsavel)).join('')}</select>
          <select id="tf-situacao" aria-label="Resolvido ou não resolvido">${opt('', 'Resolvido / não resolvido', f.situacao)}${opt('resolvidas', 'Somente resolvidas', f.situacao)}${opt('nao_resolvidas', 'Somente não resolvidas', f.situacao)}</select>
          <button type="button" class="tb tb-link" id="tf-limpar">Limpar filtros</button>
        </div>
      </details>
      <div class="tp-lista" id="tp-lista" aria-live="polite"></div>
      <div class="tp-mais" id="tp-mais"></div>`;
    renderLista();
  }

  function renderRapidos() {
    const alvo = $('#tp-rapidos');
    if (!alvo) return;
    const base = filtrar(estado.itens, true);
    alvo.innerHTML = RAPIDOS.map(r => {
      const n = base.filter(i => passaRapido(i, r.id)).length;
      return `<button type="button" class="tp-chip" data-rapido="${r.id}" aria-pressed="${estado.rapido === r.id}">${r.rotulo}<span>${n}</span></button>`;
    }).join('');
  }

  function cardTratativa(i) {
    const s = st(i.status);
    const wa = linkWhatsApp(i);
    const acao = s.grupo === 'pendente' ? 'Iniciar tratativa' : (s.grupo === 'andamento' ? 'Continuar tratativa' : 'Ver tratativa');
    const contato = i.dataContato ? `${fmtDiaTexto(i.dataContato)}${i.horaContato ? ' às ' + esc(i.horaContato) : ''}` : '—';
    return `
      <article class="tc ${i.status === 'NOVO' ? 'tc-novo' : ''}" data-cor="${s.cor}">
        <div class="tc-topo">
          <span class="tc-nota ${i.nota === 7 ? 'n7' : ''}" aria-label="Nota ${esc(i.nota)}">${esc(i.nota)}</span>
          <div class="tc-id">
            ${i.status === 'NOVO' ? '<span class="tc-novo-selo">NOVA</span>' : ''}
            <div class="tc-nome">${esc(i.cliente)}</div>
            <div class="tc-meta">${esc(i.nomeUnidade)} — avaliou em ${fmtDataHora(i.dataAvaliacao)}</div>
          </div>
        </div>
        <span class="st-pill" data-cor="${s.cor}">${esc(s.rotulo)}</span>
        ${i.comentario ? `<p class="tc-comentario">"${esc(i.comentario)}"</p>` : ''}
        <dl class="tc-dados">
          <dt>Telefone</dt><dd>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">${esc(i.telefone)}</a>` : esc(i.telefone || '—')}</dd>
          <dt>Responsável</dt><dd>${esc(i.responsavel || '—')}</dd>
          <dt>Contato</dt><dd>${contato}</dd>
          ${i.qtdImagens ? `<dt>Prints</dt><dd>📸 ${i.qtdImagens}</dd>` : ''}
        </dl>
        <div class="tc-acoes">
          ${wa ? `<a class="tb tb-wa" href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">💬 Conversar no WhatsApp</a>` : ''}
          <button type="button" class="tb ${s.grupo === 'pendente' ? 'tb-primario' : ''}" data-abrir="${esc(i.id)}">${acao}</button>
        </div>
      </article>`;
  }

  function renderLista() {
    const alvo = $('#tp-lista');
    if (!alvo) return;
    renderRapidos();
    const mais = $('#tp-mais');
    if (!estado.carregou) {
      alvo.innerHTML = estado.erro
        ? `<div class="tp-vazio">${esc(estado.erro)}<br><button type="button" class="tb" id="tp-tentar" style="margin-top:10px">Tentar novamente</button></div>`
        : '<div class="tp-carregando">Carregando tratativas…</div>';
      mais.innerHTML = '';
      return;
    }
    const lista = ordenar(filtrar(estado.itens, false));
    const visiveis = lista.slice(0, estado.pagina * CFG.ITENS_POR_PAGINA);
    $('#tp-qtd').textContent = `${plural(lista.length, 'registro', 'registros')}`;
    alvo.innerHTML = visiveis.length
      ? visiveis.map(cardTratativa).join('')
      : `<div class="tp-vazio">${estado.itens.length ? 'Nenhuma tratativa com estes filtros.' : 'Nenhuma avaliação com nota até 7 até agora.'}</div>`;
    mais.innerHTML = lista.length > visiveis.length
      ? `<button type="button" class="tb" id="tp-carregar-mais">Carregar mais (${lista.length - visiveis.length} restantes)</button>` : '';
  }

  /** Coloca o status da tratativa nos cards de comentário que já existiam. */
  function decorarCardsRespostas() {
    const mapa = new Map(estado.itens.map(i => [chave(i.telefone, i.nota, i.dataAvaliacao), i]));
    $$('.card-comentario[data-trat-chave]').forEach(card => {
      const atual = card.querySelector('.trat-selo');
      if (atual) atual.remove();
      const it = mapa.get(card.dataset.tratChave);
      if (!it) return;
      const s = st(it.status);
      card.insertAdjacentHTML('beforeend',
        `<button type="button" class="st-pill trat-selo" data-cor="${s.cor}" data-abrir="${esc(it.id)}" title="Abrir tratativa">${esc(s.rotulo)}</button>`);
    });
  }

  function renderTudo() {
    renderAlerta();
    renderKpis();
    renderPainel();
    decorarCardsRespostas();
  }

  function atualizarSemRecriarFiltros() {
    renderAlerta();
    renderKpis();
    renderLista();
    decorarCardsRespostas();
  }

  /* -------------------- Modal da tratativa -------------------- */
  let modal, lightbox;

  function criarDialogs() {
    modal = document.createElement('dialog');
    modal.className = 'trat-modal';
    modal.setAttribute('aria-labelledby', 'tm-titulo');
    document.body.appendChild(modal);
    modal.addEventListener('close', () => { estado.aberto = null; });
    modal.addEventListener('cancel', e => { if (estado.aberto && estado.aberto.enviando) e.preventDefault(); });

    lightbox = document.createElement('dialog');
    lightbox.className = 'trat-lightbox';
    lightbox.setAttribute('aria-label', 'Visualizar print');
    document.body.appendChild(lightbox);
  }

  async function abrir(id) {
    const resumo = estado.itens.find(i => i.id === id);
    if (!resumo) return;
    estado.aberto = { item: Object.assign({ imagens: [] }, resumo), historico: [], miniaturas: {}, carregando: true };
    renderModal();
    if (!modal.open) modal.showModal();
    try {
      const j = await api('detalhe', { id });
      if (!estado.aberto || estado.aberto.item.id !== id) return;
      estado.aberto.item = j.item;
      estado.aberto.historico = j.historico;
      estado.aberto.carregando = false;
      mesclarNaLista(j.item);
      renderModal();
      aplicarRascunho();
      carregarMiniaturas();
      atualizarSemRecriarFiltros();
    } catch (e) {
      if (estado.aberto) { estado.aberto.carregando = false; estado.aberto.erroCarga = e.message; renderModal(); }
    }
  }

  function fecharModal() {
    if (modal && modal.open) modal.close();
    estado.aberto = null;
  }

  function mesclarNaLista(item) {
    const i = estado.itens.findIndex(x => x.id === item.id);
    const resumo = {};
    ['id', 'unidade', 'nomeUnidade', 'ddd', 'cliente', 'telefone', 'nota', 'comentario', 'dataAvaliacao', 'atendente', 'produtos',
      'status', 'responsavel', 'dataContato', 'horaContato', 'dataPrimeiroContato', 'dataResolucao', 'versao'].forEach(k => { resumo[k] = item[k]; });
    resumo.qtdImagens = (item.imagens || []).length;
    if (i >= 0) estado.itens[i] = Object.assign(estado.itens[i], resumo);
    if (estado.novosVistos && item.status !== 'NOVO') estado.novosVistos.delete(item.id);
  }

  function renderModal() {
    const a = estado.aberto;
    if (!a) return;
    const i = a.item;
    const s = st(i.status);
    const wa = linkWhatsApp(i);
    const conteudo = a.carregando
      ? '<div class="tp-carregando">Carregando tratativa…</div>'
      : a.erroCarga
        ? `<div class="tp-vazio">${esc(a.erroCarga)}<br><button type="button" class="tb" data-abrir="${esc(i.id)}" style="margin-top:10px">Tentar novamente</button></div>`
        : corpoModal(i);

    modal.innerHTML = `
      <div class="tm-cabecalho">
        <span class="tc-nota ${i.nota === 7 ? 'n7' : ''}">${esc(i.nota)}</span>
        <div style="min-width:0">
          <h2 id="tm-titulo">${esc(i.cliente)}</h2>
          <div class="tc-meta">${esc(i.nomeUnidade || '')} — <span class="st-pill" data-cor="${s.cor}" id="tm-pill">${esc(s.rotulo)}</span></div>
        </div>
        <button type="button" class="tm-fechar" id="tm-fechar" aria-label="Fechar">×</button>
      </div>
      <div class="tm-corpo" id="tm-corpo">${conteudo}</div>
      ${a.carregando || a.erroCarga ? '' : `
      <div class="tm-rodape">
        <span class="tm-msg" id="tm-msg" role="status"></span>
        <button type="button" class="tb" id="tm-cancelar">Fechar</button>
        <button type="button" class="tb tb-primario" id="tm-salvar">Salvar tratativa</button>
      </div>`}`;
    if (!a.carregando && !a.erroCarga) {
      atualizarExigencias();
      renderGaleria();
    }
  }

  function corpoModal(i) {
    const wa = linkWhatsApp(i);
    const resp = i.responsavel || nomeAtual();
    const resultados = estado.resultados.length ? estado.resultados : [];
    const radio = s => `<label data-cor="${STATUS[s].cor}"><input type="radio" name="tm-status" value="${s}" ${i.status === s || (i.status === 'NOVO' && s === 'AGUARDANDO_CONTATO') ? 'checked' : ''}><span>${STATUS[s].rotulo}</span></label>`;

    return `
      <section class="tm-secao" aria-labelledby="tm-s1">
        <h3 id="tm-s1">Avaliação do cliente</h3>
        <dl class="tm-avaliacao">
          <div><dt>Cliente</dt><dd>${esc(i.cliente)}</dd></div>
          <div><dt>Nota</dt><dd>${esc(i.nota)}</dd></div>
          <div><dt>Telefone</dt><dd>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">${esc(i.telefone)}</a>` : esc(i.telefone || '—')}</dd></div>
          <div><dt>Data da avaliação</dt><dd>${fmtDataHora(i.dataAvaliacao)}</dd></div>
          ${i.atendente ? `<div><dt>Atendente</dt><dd>${esc(i.atendente)}</dd></div>` : ''}
          ${i.produtos ? `<div><dt>Serviços</dt><dd>${esc(i.produtos)}</dd></div>` : ''}
          <div class="tm-largo"><dt>Comentário</dt><dd>${i.comentario ? `"${esc(i.comentario)}"` : 'Sem comentário.'}</dd></div>
        </dl>
        <div class="tm-wa">
          ${wa ? `<a class="tb tb-wa" href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(i.id)}">💬 CONVERSAR NO WHATSAPP</a>
                 <small>Depois da conversa, volte aqui para registrar a tratativa e anexar os prints.</small>`
               : '<small>Telefone inválido para WhatsApp. Confira o número informado pelo cliente.</small>'}
        </div>
      </section>

      <div id="tm-rascunho-aviso"></div>

      <section class="tm-secao" aria-labelledby="tm-s2">
        <h3 id="tm-s2">Registro da tratativa</h3>
        <div class="tm-campo" style="margin-bottom:12px">
          <span>Status</span>
          <div class="tm-status" role="radiogroup" aria-label="Status da tratativa">
            ${STATUS_FLUXO.map(radio).join('')}<span class="tm-status-sep"></span>${STATUS_OUTROS.map(radio).join('')}
          </div>
        </div>
        <div class="tm-grade">
          <label class="tm-campo" id="tmc-responsavel"><span>Responsável pelo contato <em class="tm-req" hidden>*</em></span>
            <input class="trat-campo" id="tm-responsavel" list="tm-usuarios" value="${esc(resp)}" maxlength="120">
            <datalist id="tm-usuarios">${estado.usuarios.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          </label>
          <label class="tm-campo"><span>Data do contato</span><input class="trat-campo" type="date" id="tm-data" value="${esc(i.dataContato)}"></label>
          <label class="tm-campo"><span>Horário do contato</span><input class="trat-campo" type="time" id="tm-hora" value="${esc(i.horaContato)}"></label>
          <label class="tm-campo tm-largo"><span>Problema identificado</span><textarea class="trat-campo" id="tm-problema" maxlength="4000">${esc(i.problema)}</textarea></label>
          <label class="tm-campo tm-largo" id="tmc-solucao"><span>Solução apresentada <em class="tm-req" hidden>* obrigatório para resolver</em></span><textarea class="trat-campo" id="tm-solucao" maxlength="4000">${esc(i.solucao)}</textarea></label>
          <label class="tm-campo"><span>Resultado do contato</span>
            <select class="trat-campo" id="tm-resultado">
              <option value="">Selecione…</option>
              ${resultados.map(r => `<option${r === i.resultado ? ' selected' : ''}>${esc(r)}</option>`).join('')}
              ${i.resultado && !resultados.includes(i.resultado) ? `<option selected>${esc(i.resultado)}</option>` : ''}
            </select>
          </label>
          <label class="tm-campo tm-largo" style="grid-column: span 2"><span>Observação da tratativa</span><textarea class="trat-campo" id="tm-observacao" maxlength="4000">${esc(i.observacao)}</textarea></label>
        </div>
      </section>

      <section class="tm-secao" aria-labelledby="tm-s3">
        <h3 id="tm-s3">📸 Comprovação da Tratativa</h3>
        <p class="tm-ajuda">Prints da conversa com o cliente. Ficam guardados na pasta da empresa no Google Drive, sem link público.</p>
        <div class="tm-upload">
          <label class="tb">
            <input type="file" id="tm-arquivos" accept="image/*" multiple>
            📸 Adicionar prints
          </label>
          <small style="color:var(--dim);font-size:12px">Selecione uma ou várias imagens de uma vez${ehCelular() ? '' : ', ou cole um print com Ctrl+V'}.</small>
        </div>
        <div class="tm-progresso" id="tm-progresso" hidden></div>
        <div class="tm-galeria" id="tm-galeria"></div>
      </section>

      <section class="tm-secao" aria-labelledby="tm-s4">
        <h3 id="tm-s4">Histórico</h3>
        ${renderHistorico()}
      </section>`;
  }

  function renderHistorico() {
    const h = estado.aberto.historico;
    if (!h.length) return '<p class="tm-ajuda">Sem registros ainda.</p>';
    return `<ol class="tm-historico">${h.map(e => `
      <li><time datetime="${esc(e.data)}">${fmtDataHora(e.data)}</time>
        ${esc(e.evento)}
        ${e.detalhe ? `<div class="tm-det">${esc(e.detalhe)}</div>` : ''}
        ${e.usuario && e.usuario !== 'Sistema' ? `<div class="tm-por">${esc(e.usuario)}</div>` : ''}
      </li>`).join('')}</ol>`;
  }

  function statusEscolhido() { const r = $('input[name="tm-status"]:checked', modal); return r ? r.value : ''; }

  function atualizarExigencias() {
    const s = statusEscolhido();
    const reqSol = s === 'RESOLVIDO';
    const reqResp = STATUS_COM_CONTATO.includes(s);
    const elSol = $('#tmc-solucao .tm-req', modal), elResp = $('#tmc-responsavel .tm-req', modal);
    if (elSol) elSol.hidden = !reqSol;
    if (elResp) elResp.hidden = !reqResp;
    const btn = $('#tm-salvar', modal);
    if (btn) btn.textContent = reqSol ? 'Salvar como resolvido' : 'Salvar tratativa';
    const pill = $('#tm-pill', modal);
    if (pill && s && estado.aberto) {
      // A pílula do cabeçalho mostra o status salvo; o rádio mostra o que vai ser salvo.
      const salvo = st(estado.aberto.item.status);
      pill.dataset.cor = salvo.cor; pill.textContent = salvo.rotulo;
    }
  }

  function preencherContatoAgora() {
    const d = $('#tm-data', modal), h = $('#tm-hora', modal);
    if (!d || d.value) return;
    const agora = new Date();
    d.value = diaISO(agora);
    h.value = `${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
  }

  function camposDoForm() {
    return {
      status: statusEscolhido(),
      responsavel: $('#tm-responsavel', modal).value.trim(),
      data_contato: $('#tm-data', modal).value,
      hora_contato: $('#tm-hora', modal).value,
      problema_identificado: $('#tm-problema', modal).value.trim(),
      solucao_apresentada: $('#tm-solucao', modal).value.trim(),
      resultado_contato: $('#tm-resultado', modal).value,
      observacao: $('#tm-observacao', modal).value.trim()
    };
  }

  function mensagemModal(txt, tipo) {
    const el = $('#tm-msg', modal);
    if (!el) return;
    el.textContent = txt || '';
    el.className = 'tm-msg' + (tipo ? ' ' + tipo : '');
  }

  async function salvar() {
    const a = estado.aberto;
    if (!a || a.salvando) return;
    const c = camposDoForm();
    $$('.tm-invalido', modal).forEach(e => e.classList.remove('tm-invalido'));
    if (c.status === 'RESOLVIDO' && !c.solucao_apresentada) {
      $('#tmc-solucao', modal).classList.add('tm-invalido');
      $('#tm-solucao', modal).focus();
      mensagemModal('Descreva a solução apresentada para marcar como resolvido.', 'erro');
      return;
    }
    if (STATUS_COM_CONTATO.includes(c.status) && !c.responsavel) {
      $('#tmc-responsavel', modal).classList.add('tm-invalido');
      $('#tm-responsavel', modal).focus();
      mensagemModal('Informe o responsável pelo contato.', 'erro');
      return;
    }
    if (c.status === 'RESOLVIDO' && !(a.item.imagens || []).length &&
        !confirm('Nenhum print da conversa foi anexado. Marcar como resolvido mesmo assim?')) return;

    a.salvando = true;
    const btn = $('#tm-salvar', modal);
    btn.disabled = true; btn.textContent = 'Salvando…';
    mensagemModal('');
    try {
      const j = await api('salvar', { id: a.item.id, versao: a.item.versao, campos: c });
      if (!estado.aberto || estado.aberto.item.id !== j.item.id) return;
      const miniaturas = a.miniaturas;
      a.item = j.item; a.historico = j.historico; a.miniaturas = miniaturas;
      gravarLocal(PREFIXO_RASCUNHO + j.item.id, null);
      lembrarNome(c.responsavel);
      mesclarNaLista(j.item);
      // Re-renderiza o corpo mantendo a rolagem
      const rol = $('#tm-corpo', modal).scrollTop;
      renderModal();
      $('#tm-corpo', modal).scrollTop = rol;
      mensagemModal(j.item.status === 'RESOLVIDO' ? '✔ Tratativa resolvida e salva.' : '✔ Tratativa salva.', 'ok');
      toast(j.item.status === 'RESOLVIDO' ? `Tratativa de ${j.item.cliente} resolvida.` : 'Tratativa salva.', 'ok');
      atualizarSemRecriarFiltros();
    } catch (e) {
      mensagemModal(e.message, 'erro');
      if (e.codigo === 'CONFLITO') {
        const el = $('#tm-msg', modal);
        el.insertAdjacentHTML('beforeend', ' <button type="button" class="tb tb-link" id="tm-recarregar">Recarregar agora</button>');
      }
    } finally {
      if (estado.aberto) estado.aberto.salvando = false;
      const b = $('#tm-salvar', modal);
      if (b) { b.disabled = false; atualizarExigencias(); }
    }
  }

  /* ----- Rascunho local: protege o que foi digitado ao ir e voltar do WhatsApp ----- */
  const salvarRascunho = debounce(() => {
    const a = estado.aberto;
    if (!a || a.carregando || !$('#tm-responsavel', modal)) return;
    gravarLocal(PREFIXO_RASCUNHO + a.item.id, { campos: camposDoForm(), versao: a.item.versao, em: Date.now() });
  }, 400);

  function aplicarRascunho() {
    const a = estado.aberto;
    const r = lerLocal(PREFIXO_RASCUNHO + a.item.id);
    if (!r || !r.campos) return;
    const c = r.campos;
    const atual = camposDoForm();
    const diferente = Object.keys(c).some(k => (c[k] || '') !== (atual[k] || ''));
    if (!diferente) { gravarLocal(PREFIXO_RASCUNHO + a.item.id, null); return; }
    const set = (sel, v) => { const el = $(sel, modal); if (el && v !== undefined) el.value = v; };
    set('#tm-responsavel', c.responsavel); set('#tm-data', c.data_contato); set('#tm-hora', c.hora_contato);
    set('#tm-problema', c.problema_identificado); set('#tm-solucao', c.solucao_apresentada);
    set('#tm-resultado', c.resultado_contato); set('#tm-observacao', c.observacao);
    const radio = c.status && $(`input[name="tm-status"][value="${c.status}"]`, modal);
    if (radio) radio.checked = true;
    atualizarExigencias();
    $('#tm-rascunho-aviso', modal).innerHTML = `<div class="tm-rascunho">✎ Recuperamos o que você digitou neste aparelho em ${fmtDataHora(r.em)} e ainda não foi salvo.
      <button type="button" class="tb tb-link" id="tm-descartar">Descartar</button></div>`;
  }

  /* -------------------- Prints / Google Drive -------------------- */
  function renderGaleria() {
    const alvo = $('#tm-galeria', modal);
    if (!alvo || !estado.aberto) return;
    const { item, miniaturas } = estado.aberto;
    alvo.innerHTML = (item.imagens || []).map((img, n) => {
      const mini = miniaturas[img.id];
      const conteudo = mini ? `<img src="${esc(mini)}" alt="Print ${n + 1}" loading="lazy" decoding="async">`
        : (mini === null ? '📷 Abrir' : '<span class="tm-carregando-mini">Carregando…</span>');
      return `<figure class="tm-print">
          <button type="button" class="tm-ver" data-ver="${n}" aria-label="Ampliar print ${n + 1}">${conteudo}</button>
          <button type="button" class="tm-excluir" data-excluir="${esc(img.id)}" aria-label="Excluir print ${n + 1}">×</button>
          <figcaption>📸 Print ${n + 1}</figcaption>
        </figure>`;
    }).join('');
  }

  async function carregarMiniaturas() {
    const a = estado.aberto;
    if (!a || !(a.item.imagens || []).length) return;
    const id = a.item.id;
    try {
      const j = await api('miniaturas', { id });
      if (!estado.aberto || estado.aberto.item.id !== id) return;
      Object.assign(estado.aberto.miniaturas, j.miniaturas);
      renderGaleria();
    } catch (e) {
      (a.item.imagens || []).forEach(img => { if (!(img.id in a.miniaturas)) a.miniaturas[img.id] = null; });
      renderGaleria();
    }
  }

  function carregarImagem(src) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error('formato'));
      img.src = src;
    });
  }

  /** Reduz e comprime no próprio aparelho antes de enviar (economiza dados e Drive). */
  async function comprimir(arquivo, ladoMax, qualidade) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await carregarImagem(url);
      const escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * escala));
      const h = Math.max(1, Math.round(img.naturalHeight * escala));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', qualidade);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function enviarArquivos(lista) {
    const a = estado.aberto;
    if (!a) return;
    const arquivos = Array.from(lista).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!arquivos.length) { toast('Selecione arquivos de imagem.', 'alerta'); return; }
    const id = a.item.id;
    a.enviando = true;
    const prog = $('#tm-progresso', modal);
    const entrada = $('#tm-arquivos', modal);
    entrada.disabled = true;
    const falhas = [];
    let enviados = 0;

    for (let n = 0; n < arquivos.length; n++) {
      const arq = arquivos[n];
      if (!estado.aberto || estado.aberto.item.id !== id) break;
      prog.hidden = false;
      prog.innerHTML = `Enviando print ${n + 1} de ${arquivos.length}…<div class="barra"><i style="width:${Math.round((n / arquivos.length) * 100)}%"></i></div>`;
      try {
        const full = await comprimir(arq, CFG.IMAGEM_LADO_MAX, CFG.IMAGEM_QUALIDADE);
        const mini = await comprimir(arq, CFG.MINIATURA_LADO_MAX, CFG.MINIATURA_QUALIDADE);
        const j = await api('enviarImagem', {
          id, mime: 'image/jpeg',
          dados: full.split(',')[1], miniatura: mini.split(',')[1]
        });
        const atual = estado.aberto;
        if (!atual || atual.item.id !== id) break;
        atual.item.imagens = (atual.item.imagens || []).concat([{ id: j.imagem.id, nome: j.imagem.n, em: j.imagem.em, por: j.imagem.por }]);
        atual.item.versao = j.versao;
        atual.miniaturas[j.imagem.id] = mini;
        estado.imagensCache.set(j.imagem.id, full);
        enviados++;
        renderGaleria();
      } catch (e) {
        falhas.push(`${arq.name}: ${e.message === 'formato' ? 'formato não suportado neste navegador' : e.message}`);
      }
    }

    if (estado.aberto && estado.aberto.item.id === id) {
      estado.aberto.enviando = false;
      entrada.disabled = false;
      entrada.value = '';
      prog.innerHTML = falhas.length
        ? `<span style="color:var(--st-vermelho)">Não foi possível enviar: ${falhas.map(esc).join('; ')}</span>`
        : `✔ ${plural(enviados, 'print enviado', 'prints enviados')} para o Google Drive.`;
      mesclarNaLista(estado.aberto.item);
      // Atualiza o histórico em segundo plano para mostrar os envios
      api('detalhe', { id }).then(j => {
        if (!estado.aberto || estado.aberto.item.id !== id) return;
        estado.aberto.historico = j.historico;
        estado.aberto.item.versao = j.item.versao;
        const hist = $('#tm-s4', modal)?.parentElement;
        if (hist) hist.innerHTML = `<h3 id="tm-s4">Histórico</h3>${renderHistorico()}`;
      }).catch(() => {});
      atualizarSemRecriarFiltros();
    }
  }

  async function excluirImagem(fileId) {
    const a = estado.aberto;
    if (!a) return;
    const n = (a.item.imagens || []).findIndex(i => i.id === fileId);
    if (n < 0) return;
    if (!confirm(`Excluir o print ${n + 1}? Ele vai para a lixeira do Google Drive.`)) return;
    try {
      const j = await api('excluirImagem', { id: a.item.id, fileId });
      a.item.imagens = a.item.imagens.filter(i => i.id !== fileId);
      a.item.versao = j.versao;
      delete a.miniaturas[fileId];
      estado.imagensCache.delete(fileId);
      renderGaleria();
      mesclarNaLista(a.item);
      atualizarSemRecriarFiltros();
      toast('Print excluído.', 'ok');
      return true;
    } catch (e) {
      toast(e.message, 'alerta');
      return false;
    }
  }

  /* ----- Visualizador ampliado ----- */
  function abrirLightbox(indice) {
    const a = estado.aberto;
    if (!a || !(a.item.imagens || []).length) return;
    estado.lb.indice = Math.max(0, Math.min(indice, a.item.imagens.length - 1));
    if (!lightbox.open) lightbox.showModal();
    renderLightbox();
  }

  async function renderLightbox() {
    const a = estado.aberto;
    if (!a) return;
    const imgs = a.item.imagens || [];
    if (!imgs.length) { lightbox.close(); return; }
    const n = estado.lb.indice;
    const img = imgs[n];
    lightbox.innerHTML = `
      <div class="lb-topo">
        <span class="lb-cont">Print ${n + 1} de ${imgs.length}</span>
        <button type="button" id="lb-zoom" aria-label="Ampliar">🔍 Zoom</button>
        <button type="button" id="lb-excluir" aria-label="Excluir este print">Excluir</button>
        <button type="button" id="lb-fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="lb-area" id="lb-area">
        <span class="lb-status">Carregando imagem…</span>
        ${imgs.length > 1 ? '<button type="button" class="lb-nav lb-ant" id="lb-ant" aria-label="Anterior">‹</button><button type="button" class="lb-nav lb-prox" id="lb-prox" aria-label="Próximo">›</button>' : ''}
      </div>`;
    let src = estado.imagensCache.get(img.id);
    if (!src) {
      try {
        src = (await api('imagem', { id: a.item.id, fileId: img.id })).dataUrl;
        estado.imagensCache.set(img.id, src);
      } catch (e) {
        const s = $('.lb-status', lightbox); if (s) s.textContent = e.message;
        return;
      }
    }
    if (estado.lb.indice !== n || !lightbox.open) return;
    const area = $('#lb-area', lightbox);
    $('.lb-status', area)?.remove();
    area.insertAdjacentHTML('afterbegin', `<img src="${esc(src)}" alt="Print ${n + 1} da conversa com ${esc(a.item.cliente)}" id="lb-img">`);
  }

  function navegarLightbox(passo) {
    const total = (estado.aberto?.item.imagens || []).length;
    if (total < 2) return;
    estado.lb.indice = (estado.lb.indice + passo + total) % total;
    renderLightbox();
  }

  /* -------------------- Avisos -------------------- */
  function toast(texto, tipo, ms) {
    const raiz = (lightbox && lightbox.open) ? lightbox : (modal && modal.open ? modal : document.body);
    let caixa = $(':scope > .trat-toasts', raiz);
    if (!caixa) { caixa = document.createElement('div'); caixa.className = 'trat-toasts'; caixa.setAttribute('aria-live', 'polite'); raiz.appendChild(caixa); }
    const el = document.createElement('div');
    el.className = 'trat-toast' + (tipo ? ' ' + tipo : '');
    el.textContent = texto;
    caixa.appendChild(el);
    setTimeout(() => el.remove(), ms || 4500);
  }

  /* -------------------- Eventos -------------------- */
  function registrarWhatsApp(e, link) {
    const id = link.dataset.wa;
    const item = estado.itens.find(i => i.id === id) || (estado.aberto && estado.aberto.item);
    if (id) api('registrarEvento', { id, evento: 'whatsapp' }, { keepalive: true }).catch(() => {});
    if (estado.aberto && estado.aberto.item.id === id) { preencherContatoAgora(); salvarRascunho(); }
    // No computador abre direto o WhatsApp Web; no celular o wa.me abre o aplicativo.
    if (!ehCelular() && item) {
      const n = numeroWhatsApp(item.telefone, item.ddd);
      const txt = mensagemWhatsApp(item);
      e.preventDefault();
      window.open(`https://web.whatsapp.com/send?phone=${n}${txt ? '&text=' + encodeURIComponent(txt) : ''}`, '_blank', 'noopener');
    }
  }

  function irParaRapido(r) {
    if (!estado.carregou) return;
    estado.rapido = r; estado.pagina = 1;
    estado.filtros.status = ''; estado.filtros.situacao = '';
    renderPainel();
    $('#tratPainel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.addEventListener('click', e => {
    const wa = e.target.closest('a[data-wa]');
    if (wa) { registrarWhatsApp(e, wa); return; }

    const abrirBtn = e.target.closest('[data-abrir]');
    if (abrirBtn) { abrir(abrirBtn.dataset.abrir); return; }

    const ir = e.target.closest('[data-ir-rapido]');
    if (ir) { irParaRapido(ir.dataset.irRapido); return; }

    const chip = e.target.closest('[data-rapido]');
    if (chip) { estado.rapido = chip.dataset.rapido; estado.pagina = 1; renderLista(); renderKpis(); return; }

    const t = e.target.closest('button');
    if (!t) return;
    switch (t.id) {
      case 'tp-atualizar': return carregar();
      case 'tp-tentar': estado.erro = ''; return carregar();
      case 'tp-carregar-mais': estado.pagina++; return renderLista();
      case 'tf-limpar':
        Object.keys(estado.filtros).forEach(k => { estado.filtros[k] = ''; });
        estado.rapido = 'todos'; estado.pagina = 1;
        renderPainel(); renderKpis(); return;
      case 'tm-fechar': case 'tm-cancelar': return fecharModal();
      case 'tm-salvar': return salvar();
      case 'tm-recarregar': return abrir(estado.aberto.item.id);
      case 'tm-descartar':
        gravarLocal(PREFIXO_RASCUNHO + estado.aberto.item.id, null);
        return abrir(estado.aberto.item.id);
      case 'lb-fechar': return lightbox.close();
      case 'lb-ant': return navegarLightbox(-1);
      case 'lb-prox': return navegarLightbox(1);
      case 'lb-zoom': return $('#lb-area', lightbox)?.classList.toggle('zoom');
      case 'lb-excluir': {
        const img = estado.aberto?.item.imagens[estado.lb.indice];
        if (img) excluirImagem(img.id).then(ok => { if (ok) { estado.lb.indice = Math.max(0, estado.lb.indice - 1); renderLightbox(); } });
        return;
      }
    }
    if (t.dataset.ver !== undefined) return abrirLightbox(Number(t.dataset.ver));
    if (t.dataset.excluir) return excluirImagem(t.dataset.excluir);
  });

  // Clique na imagem ampliada alterna o zoom; clique fora do conteúdo fecha o modal.
  document.addEventListener('click', e => {
    if (e.target.id === 'lb-img') $('#lb-area', lightbox).classList.toggle('zoom');
    if (e.target === modal && !(estado.aberto && estado.aberto.enviando)) fecharModal();
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'tm-status') {
      if (STATUS_COM_CONTATO.includes(t.value)) preencherContatoAgora();
      atualizarExigencias(); salvarRascunho(); return;
    }
    if (t.id === 'tm-arquivos') { enviarArquivos(t.files); return; }
    const mapa = { 'tf-unidade': 'unidade', 'tf-de': 'de', 'tf-ate': 'ate', 'tf-nota': 'nota', 'tf-status': 'status', 'tf-responsavel': 'responsavel', 'tf-situacao': 'situacao' };
    if (mapa[t.id]) { estado.filtros[mapa[t.id]] = t.value; estado.pagina = 1; renderLista(); renderKpis(); }
  });

  const filtrarTexto = debounce((campo, valor) => { estado.filtros[campo] = valor; estado.pagina = 1; renderLista(); renderKpis(); }, 250);
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'tf-cliente') return filtrarTexto('cliente', t.value);
    if (t.id === 'tf-telefone') return filtrarTexto('telefone', t.value);
    if (modal && modal.contains(t) && t.id && t.id.startsWith('tm-')) salvarRascunho();
  });

  // Ctrl+V de um print (ex.: WhatsApp Web) com a tratativa aberta envia direto.
  document.addEventListener('paste', e => {
    if (!modal || !modal.open || !estado.aberto || estado.aberto.carregando || estado.aberto.enviando) return;
    const arquivos = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
    if (!arquivos.length) return;
    e.preventDefault();
    enviarArquivos(arquivos);
  });

  document.addEventListener('keydown', e => {
    if (lightbox && lightbox.open) {
      if (e.key === 'ArrowLeft') navegarLightbox(-1);
      if (e.key === 'ArrowRight') navegarLightbox(1);
    }
  });

  // Deslizar para os lados no celular troca de print.
  let toqueX = null;
  document.addEventListener('touchstart', e => { if (lightbox && lightbox.open && e.touches.length === 1) toqueX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (toqueX === null || !lightbox.open) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    toqueX = null;
    if (Math.abs(dx) > 60 && !$('#lb-area', lightbox)?.classList.contains('zoom')) navegarLightbox(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* -------------------- Integração com o dashboard existente -------------------- */
  window.VegasTratativas = {
    /** Chamado pelo dashboard sempre que a lista de respostas é filtrada. */
    atualizarRespostas(respostas, modoFuncionario) {
      estado.respostas = respostas || [];
      estado.modoFuncionario = !!modoFuncionario;
      renderKpis();
      decorarCardsRespostas();
    },
    chave,
    abrir
  };

  /* -------------------- Início -------------------- */
  criarDialogs();
  renderTudo();
  if (CONFIGURADO) { carregar(); iniciarAtualizacao(); }
})();
