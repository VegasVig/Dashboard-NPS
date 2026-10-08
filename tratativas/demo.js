/* =====================================================================
   Modo demonstração do Dashboard NPS (abrir index.html?demo=1)
   Dados fictícios, tudo em memória. Nada é enviado para a planilha
   nem para o Google Drive. Útil para treinar a supervisão.
   ===================================================================== */
(function () {
  'use strict';
  if (!/[?&]demo(=|&|$)/.test(location.search)) return;

  let semente = 20261008;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const agora = Date.now();
  const H = 3600 * 1000, D = 24 * H;

  const clientes = ['JOÃO DA SILVA', 'MARIA APARECIDA SOUZA', 'PADARIA PÃO DOURADO', 'CONDOMÍNIO RESIDENCIAL ATERRADO', 'CARLOS EDUARDO LIMA',
    'FARMÁCIA SANTA CECÍLIA', 'ANA BEATRIZ ROCHA', 'AUTO PEÇAS VILA', 'ROBERTO NUNES', 'MERCADO BOM PREÇO', 'LUCIANA FERREIRA',
    'CLÍNICA ODONTO SORRISO', 'PAULO HENRIQUE COSTA', 'ESCOLA PEQUENO PRÍNCIPE', 'FERNANDA OLIVEIRA', 'OFICINA DO TONINHO',
    'JULIANA MARTINS', 'POSTO ESTRELA', 'RICARDO ALMEIDA', 'LOJA CASA & CIA', 'SÔNIA REGINA DIAS', 'RESTAURANTE SABOR MINEIRO',
    'MARCOS VINÍCIUS', 'ACADEMIA FORÇA TOTAL', 'PATRÍCIA GOMES', 'DEPÓSITO CONSTRULAR', 'EDUARDO PEREIRA', 'PET SHOP AMIGO FIEL'];
  const produtos = ['Alarme Monitorado', 'Câmeras de Segurança', 'Rastreador Veicular', 'Vigilância/Portaria', 'Bombeiro/Limpeza'];
  const atendVR = ['Aleff', 'André', 'Bruna', 'Caio', 'Débora', 'Fabiana', 'Gilson', 'Larissa', 'Roberta', 'Yuri'];
  const atendNIT = ['Daiana', 'Eliana', 'Lais', 'Leticia', 'Talita', 'Vitor'];
  const ruins = ['Demoraram para atender quando o alarme disparou.', 'Técnico não apareceu no horário combinado.',
    'Câmera do portão fica offline toda semana.', 'Fui cobrado duas vezes neste mês.', 'Ninguém retornou minha ligação.',
    'O aplicativo das câmeras não abre no meu celular.', 'Atendimento ok, mas a instalação ficou mal feita.', ''];
  const bons = ['Equipe muito atenciosa!', 'Serviço excelente, recomendo.', 'Resposta rápida no último disparo.', '', '', 'Tudo certo.'];
  const notaAleatoria = () => { const x = rnd(); return x < .5 ? 9 + Math.round(rnd()) : x < .7 ? 8 : x < .8 ? 7 : 1 + Math.floor(rnd() * 6); };
  const telefone = ddd => `(${ddd}) 9${String(Math.floor(rnd() * 9000) + 1000)}-${String(Math.floor(rnd() * 9000) + 1000)}`;

  function gerar(qtd, dias, ddd, atend) {
    const lista = [];
    for (let i = 0; i < qtd; i++) {
      const nota = notaAleatoria();
      lista.push({
        carimbo: new Date(agora - rnd() * dias * D).toISOString(),
        nota, nome: pick(clientes), telefone: telefone(ddd), produtos: pick(produtos),
        comentarios: nota <= 7 ? pick(ruins) : pick(bons), funcionario: pick(atend)
      });
    }
    return lista.sort((a, b) => a.carimbo.localeCompare(b.carimbo)); // API devolve do mais antigo ao mais novo
  }

  const respostas = {
    vr: gerar(80, 40, '24', atendVR),
    niteroi: gerar(34, 40, '21', atendNIT),
    funcionarios: Array.from({ length: 22 }, () => ({
      carimbo: new Date(agora - rnd() * 40 * D).toISOString(), nota: notaAleatoria(), nome: rnd() < .6 ? 'Anônimo' : pick(['JOSÉ', 'MÁRCIA', 'TIAGO']),
      setor: pick(['Sede Volta Redonda', 'Sede Niterói', 'Postos de Serviços Externos']), tempoCasa: pick(['Menos de 1 ano', '1 a 3 anos', '3 a 5 anos']),
      comentarios: pick(['Gosto do ambiente.', 'Melhorar escala de folgas.', ''])
    }))
  };
  // Uma avaliação bem recente, para o alerta de "nova tratativa" aparecer na demonstração
  respostas.vr.push({ carimbo: new Date(agora - 12 * 60 * 1000).toISOString(), nota: 5, nome: 'JOÃO DA SILVA', telefone: '(24) 99999-9999',
    produtos: 'Alarme Monitorado', comentarios: 'O alarme disparou de madrugada e demoraram mais de 20 minutos para retornar.', funcionario: 'Bruna' });

  /* ---------- Tratativas derivadas das respostas com nota <= 7 ---------- */
  const usuarios = ['Ana Paula', 'Cristiane Moura', 'Supervisora (demo)'];
  const resultados = ['Cliente satisfeito com a solução', 'Cliente parcialmente satisfeito', 'Cliente continua insatisfeito', 'Aguardando retorno do cliente', 'Cliente não respondeu'];
  const tratativas = [];
  const historicos = {};
  const arquivos = {};
  let seq = 0;

  function criarTratativa(r, unidade, nomeUnidade, ddd) {
    const id = `${unidade}-${r.carimbo.slice(0, 10).replace(/-/g, '')}-${(++seq).toString(16).toUpperCase().padStart(6, '0')}`;
    const t = {
      id, unidade, nomeUnidade, ddd, cliente: r.nome, telefone: r.telefone, nota: r.nota, comentario: r.comentarios,
      dataAvaliacao: r.carimbo, atendente: r.funcionario, produtos: r.produtos, status: 'NOVO', responsavel: '',
      dataContato: '', horaContato: '', dataPrimeiroContato: '', dataResolucao: '', versao: 1,
      problema: '', solucao: '', resultado: '', observacao: '', imagens: [], atualizadoPor: 'Sistema'
    };
    historicos[id] = [{ data: r.carimbo, evento: `Cliente respondeu NPS com nota ${r.nota}.`, detalhe: r.comentarios ? 'Comentário: ' + r.comentarios : '', usuario: 'Sistema' }];
    tratativas.push(t);
    return t;
  }

  [['vr', 'VR', 'Volta Redonda', '24'], ['niteroi', 'NIT', 'Niterói', '21']].forEach(([k, u, n, d]) => {
    respostas[k].filter(r => r.nota <= 7 && Date.parse(r.carimbo) > agora - 30 * D).forEach(r => criarTratativa(r, u, n, d));
  });

  // Distribui status de forma plausível: as mais antigas tendem a estar resolvidas.
  tratativas.sort((a, b) => a.dataAvaliacao.localeCompare(b.dataAvaliacao));
  const total = tratativas.length;
  tratativas.forEach((t, i) => {
    const idade = (total - i) / total;
    const base = Date.parse(t.dataAvaliacao);
    let status;
    if (i >= total - 3) status = 'NOVO';
    else if (i >= total - 6) status = 'AGUARDANDO_CONTATO';
    else if (idade < .35) status = pick(['EM_TRATATIVA', 'CONTATO_REALIZADO', 'CONTATO_NAO_REALIZADO']);
    else status = pick(['RESOLVIDO', 'RESOLVIDO', 'RESOLVIDO', 'RESOLVIDO', 'NAO_RESOLVIDO', 'CLIENTE_NAO_LOCALIZADO']);
    if (t.cliente === 'JOÃO DA SILVA' && i === total - 1) status = 'NOVO';
    if (status === 'NOVO' || status === 'AGUARDANDO_CONTATO') {
      if (status === 'AGUARDANDO_CONTATO') historicos[t.id].push({ data: new Date(base + .4 * H).toISOString(), evento: 'Alerta visualizado por Ana Paula. Aguardando contato.', detalhe: '', usuario: 'Ana Paula' });
      t.status = status; return;
    }
    const resp = pick(usuarios.slice(0, 2));
    const contato = new Date(base + (0.3 + rnd() * 5) * H);
    t.responsavel = resp;
    t.dataContato = contato.toISOString().slice(0, 10);
    t.horaContato = `${String(contato.getHours()).padStart(2, '0')}:${String(contato.getMinutes()).padStart(2, '0')}`;
    const h = historicos[t.id];
    h.push({ data: new Date(base + .2 * H).toISOString(), evento: `Alerta visualizado por ${resp}. Aguardando contato.`, detalhe: '', usuario: resp });
    h.push({ data: contato.toISOString(), evento: `${resp} abriu conversa no WhatsApp com o cliente.`, detalhe: '', usuario: resp });
    if (status !== 'CONTATO_NAO_REALIZADO' && status !== 'CLIENTE_NAO_LOCALIZADO') {
      t.dataPrimeiroContato = contato.toISOString();
      t.problema = pick(['Atraso no retorno da central após disparo.', 'Visita técnica não realizada no prazo.', 'Falha recorrente de conexão da câmera.', 'Cobrança em duplicidade.']);
      h.push({ data: new Date(contato.getTime() + 12 * 60000).toISOString(), evento: 'Problema identificado.', detalhe: t.problema, usuario: resp });
    }
    if (status === 'RESOLVIDO' || status === 'NAO_RESOLVIDO') {
      t.solucao = pick(['Visita técnica agendada e realizada no mesmo dia.', 'Estorno da cobrança duplicada solicitado ao financeiro.', 'Equipamento substituído sem custo.', 'Revisão do protocolo de retorno da central.']);
      h.push({ data: new Date(contato.getTime() + 30 * 60000).toISOString(), evento: 'Solução apresentada ao cliente.', detalhe: t.solucao, usuario: resp });
      t.resultado = status === 'RESOLVIDO' ? resultados[0] : resultados[2];
    }
    if (status === 'RESOLVIDO') {
      t.dataResolucao = new Date(contato.getTime() + (0.5 + rnd() * 20) * H).toISOString();
      h.push({ data: t.dataResolucao, evento: 'Tratativa marcada como resolvida.', detalhe: 'Status: Em tratativa → Resolvido', usuario: resp });
      if (rnd() < .5) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) t.imagens.push({ id: `demo-${t.id}-${k}`, nome: `${t.id}_conversa_0${k + 1}.jpg`, em: t.dataResolucao, por: resp, fake: true });
      }
    } else if (status === 'NAO_RESOLVIDO') {
      h.push({ data: new Date(contato.getTime() + 2 * D).toISOString(), evento: 'Tratativa encerrada como não resolvida.', detalhe: '', usuario: resp });
    } else if (status === 'CONTATO_NAO_REALIZADO' || status === 'CLIENTE_NAO_LOCALIZADO') {
      h.push({ data: new Date(contato.getTime() + 5 * 60000).toISOString(), evento: status === 'CLIENTE_NAO_LOCALIZADO' ? 'Cliente não localizado.' : 'Não foi possível falar com o cliente.', detalhe: '', usuario: resp });
    } else {
      h.push({ data: new Date(contato.getTime() + 15 * 60000).toISOString(), evento: 'Tratativa em andamento.', detalhe: '', usuario: resp });
    }
    t.status = status;
  });

  /* ---------- Print fictício de conversa (desenhado no navegador) ---------- */
  function printFicticio(t, k, lado) {
    const w = lado, h = Math.round(lado * 2.1);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); const s = w / 360;
    g.fillStyle = '#0b141a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#202c33'; g.fillRect(0, 0, w, 56 * s);
    g.fillStyle = '#e9edef'; g.font = `${15 * s}px sans-serif`; g.fillText(t.cliente.slice(0, 26), 56 * s, 34 * s);
    g.fillStyle = '#6a7175'; g.beginPath(); g.arc(28 * s, 28 * s, 16 * s, 0, 7); g.fill();
    const falas = [[0, `Olá! Aqui é ${t.responsavel || 'a supervisão'} da Vegas.`], [1, 'Oi, tudo bem?'], [0, 'Vi sua avaliação e quero entender o que houve.'],
      [1, (t.comentario || 'Tive um problema com o serviço.').slice(0, 60)], [0, (t.solucao || 'Vamos resolver hoje mesmo.').slice(0, 60)], [1, 'Perfeito, obrigado pelo retorno!']];
    let y = 80 * s;
    falas.slice(0, 3 + (k % 3) + 1).forEach(([eu, txt]) => {
      g.font = `${13 * s}px sans-serif`;
      const linhas = []; let atual = '';
      txt.split(' ').forEach(p => { const tt = atual ? atual + ' ' + p : p; if (g.measureText(tt).width > 220 * s) { linhas.push(atual); atual = p; } else atual = tt; });
      linhas.push(atual);
      const bw = 240 * s, bh = (linhas.length * 18 + 14) * s, x = eu ? w - bw - 12 * s : 12 * s;
      g.fillStyle = eu ? '#005c4b' : '#202c33'; g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, bh, 8 * s) : g.rect(x, y, bw, bh); g.fill();
      g.fillStyle = '#e9edef'; linhas.forEach((l, n) => g.fillText(l, x + 10 * s, y + (20 + n * 18) * s));
      y += bh + 12 * s;
    });
    return c.toDataURL('image/jpeg', .8);
  }

  /* ---------- API simulada (mesmas ações e formato da API real) ---------- */
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const resumo = t => { const r = Object.assign({}, t); delete r.imagens; delete r.problema; delete r.solucao; delete r.resultado; delete r.observacao; r.qtdImagens = t.imagens.length; return r; };
  const completo = t => Object.assign({}, t, { imagens: t.imagens.map(i => ({ id: i.id, nome: i.nome, em: i.em, por: i.por })) });
  const achar = id => { const t = tratativas.find(x => x.id === id); if (!t) throw { ok: false, erro: 'Tratativa não encontrada.' }; return t; };
  const ev = (t, evento, detalhe, usuario) => historicos[t.id].push({ data: new Date().toISOString(), evento, detalhe: detalhe || '', usuario });
  const rot = { AGUARDANDO_CONTATO: 'Aguardando contato', CONTATO_REALIZADO: 'Contato realizado', EM_TRATATIVA: 'Em tratativa', RESOLVIDO: 'Resolvido',
    CONTATO_NAO_REALIZADO: 'Contato não realizado', CLIENTE_NAO_LOCALIZADO: 'Cliente não localizado', NAO_RESOLVIDO: 'Não resolvido', NOVO: 'Novo' };
  let nomeLogado = 'Supervisora (demo)';

  async function api(acao, p) {
    await espera(acao === 'enviarImagem' ? 500 : 220);
    try {
      if (acao === 'login') { nomeLogado = 'Supervisora (demo)'; return { ok: true, token: 'demo', usuario: { usuario: p.usuario, nome: nomeLogado } }; }
      if (p.token !== 'demo') return { ok: false, erro: 'Sua sessão expirou. Entre novamente.', codigo: 'AUTH' };
      if (acao === 'listar') return { ok: true, itens: tratativas.map(resumo), usuarios, resultados, agora: new Date().toISOString() };
      const t = achar(p.id);
      const hist = () => historicos[t.id].slice().sort((a, b) => a.data.localeCompare(b.data));
      switch (acao) {
        case 'detalhe':
          if (t.status === 'NOVO') { t.status = 'AGUARDANDO_CONTATO'; t.versao++; ev(t, `Alerta visualizado por ${nomeLogado}. Aguardando contato.`, '', nomeLogado); }
          return { ok: true, item: completo(t), historico: hist() };
        case 'salvar': {
          const c = p.campos;
          if (Number(p.versao) !== t.versao) return { ok: false, erro: 'Esta tratativa foi alterada por outra pessoa. Feche e abra novamente.', codigo: 'CONFLITO' };
          if (c.status === 'RESOLVIDO' && !c.solucao_apresentada) return { ok: false, erro: 'Para marcar como resolvido, descreva a solução apresentada ao cliente.' };
          const antes = Object.assign({}, t);
          if (c.responsavel !== antes.responsavel && c.responsavel) ev(t, `Responsável pelo contato: ${c.responsavel}.`, '', nomeLogado);
          if ((c.data_contato !== antes.dataContato || c.hora_contato !== antes.horaContato) && c.data_contato) ev(t, `Contato registrado em ${c.data_contato.split('-').reverse().join('/')}${c.hora_contato ? ' às ' + c.hora_contato : ''}.`, '', nomeLogado);
          if (c.problema_identificado !== antes.problema && c.problema_identificado) ev(t, 'Problema identificado.', c.problema_identificado, nomeLogado);
          if (c.solucao_apresentada !== antes.solucao && c.solucao_apresentada) ev(t, 'Solução apresentada ao cliente.', c.solucao_apresentada, nomeLogado);
          if (c.resultado_contato !== antes.resultado && c.resultado_contato) ev(t, `Resultado do contato: ${c.resultado_contato}.`, '', nomeLogado);
          if (c.observacao !== antes.observacao && c.observacao) ev(t, 'Observação registrada.', c.observacao, nomeLogado);
          if (c.status !== antes.status) ev(t, c.status === 'RESOLVIDO' ? 'Tratativa marcada como resolvida.' : 'Status alterado.', `Status: ${rot[antes.status]} → ${rot[c.status]}`, nomeLogado);
          Object.assign(t, { status: c.status, responsavel: c.responsavel, dataContato: c.data_contato, horaContato: c.hora_contato,
            problema: c.problema_identificado, solucao: c.solucao_apresentada, resultado: c.resultado_contato, observacao: c.observacao });
          if (c.status === 'RESOLVIDO' && antes.status !== 'RESOLVIDO') t.dataResolucao = new Date().toISOString();
          if (c.status !== 'RESOLVIDO') t.dataResolucao = '';
          t.versao++;
          return { ok: true, item: completo(t), historico: hist() };
        }
        case 'registrarEvento': ev(t, `${nomeLogado} abriu conversa no WhatsApp com o cliente.`, '', nomeLogado); return { ok: true };
        case 'enviarImagem': {
          const id = 'demo-up-' + (++seq);
          const nome = `${t.id}_conversa_${String(t.imagens.length + 1).padStart(2, '0')}.jpg`;
          arquivos[id] = 'data:image/jpeg;base64,' + p.dados;
          const meta = { id, n: nome, em: new Date().toISOString(), por: nomeLogado };
          t.imagens.push({ id, nome, em: meta.em, por: nomeLogado }); t.versao++;
          ev(t, `Print da conversa anexado (${nome}).`, '', nomeLogado);
          return { ok: true, imagem: meta, versao: t.versao, qtdImagens: t.imagens.length };
        }
        case 'miniaturas': {
          const m = {};
          t.imagens.forEach((img, k) => { m[img.id] = img.fake ? printFicticio(t, k, 180) : arquivos[img.id]; });
          return { ok: true, miniaturas: m };
        }
        case 'imagem': {
          const k = t.imagens.findIndex(i => i.id === p.fileId);
          if (k < 0) return { ok: false, erro: 'Imagem não pertence a esta tratativa.' };
          return { ok: true, dataUrl: t.imagens[k].fake ? printFicticio(t, k, 540) : arquivos[p.fileId] };
        }
        case 'excluirImagem': {
          const img = t.imagens.find(i => i.id === p.fileId);
          t.imagens = t.imagens.filter(i => i.id !== p.fileId); t.versao++;
          ev(t, `Print removido (${img ? img.nome : ''}).`, '', nomeLogado);
          return { ok: true, versao: t.versao, qtdImagens: t.imagens.length };
        }
      }
      return { ok: false, erro: 'Ação desconhecida.' };
    } catch (e) {
      return e && e.ok === false ? e : { ok: false, erro: String(e) };
    }
  }

  // Simula a chegada de uma nova avaliação ruim 40 segundos depois de entrar.
  setTimeout(() => {
    const r = { carimbo: new Date().toISOString(), nota: 4, nome: 'MERCADO BOM PREÇO', telefone: '(24) 98877-6655', produtos: 'Câmeras de Segurança',
      comentarios: 'Câmera da entrada parou de gravar e ninguém veio olhar.', funcionario: 'Caio' };
    respostas.vr.push(r);
    criarTratativa(r, 'VR', 'Volta Redonda', '24');
  }, 40000);

  window.VegasDemo = {
    respostas(cidade) { return JSON.parse(JSON.stringify(respostas[cidade] || [])); },
    api
  };
})();
