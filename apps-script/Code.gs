/**
 * Apps Script - recebe formulários NPS (cliente e interno) e serve o dashboard.
 * Abas: 'Respostas' (VR), 'Respostas Niteroi', 'Respostas Funcionários'.
 *
 * + Tratativas (a partir de 10/2026): alerta de notas <= 7, registro do contato,
 *   prints no Google Drive e histórico. Ver a seção "TRATATIVAS" no fim do arquivo
 *   e o guia TRATATIVAS.md no repositório do Dashboard.
 */

function doPost(e) {
  // Chamadas do Dashboard de tratativas (JSON com "acao") vão para a API de tratativas.
  // Os formulários da pesquisa NPS continuam exatamente no fluxo de antes.
  var pedidoTratativa = lerPedidoTratativa_(e);
  if (pedidoTratativa) return apiTratativas_(pedidoTratativa);

  try {
    Logger.clear();

    var params = {};
    if (e && e.parameter && Object.keys(e.parameter).length > 0) {
      params = e.parameter;
    } else if (e && e.postData && e.postData.contents) {
      var contentType = (e.postData.type || '').toString();
      var raw = e.postData.contents.toString();
      if (contentType.indexOf('multipart/form-data') !== -1) {
        params = parseMultipart(raw, contentType);
      } else {
        params = parseUrlEncoded(raw);
      }
    }

    var nome = (params.nome || params.name || '').toString();
    var telefone = (params.telefone || params.phone || '').toString();
    var nota = (params.nota || params.nps || '').toString();
    var comentarios = (params.comentarios || params.comments || '').toString();
    var funcionario = (params.funcionario || '').toString();
    var unidade = (params.unidade || '').toString();
    var setor = (params.setor || '').toString();
    var tempoCasa = (params.tempoCasa || '').toString();

    var produtos = params.produtos || params.produto || params['produtos[]'] || '';
    if (Array.isArray(produtos)) produtos = produtos.join(', ');
    else produtos = produtos.toString();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = 'Respostas';

    switch (unidade) {
      case 'Niteroi':
        sheetName = 'Respostas Niteroi';
        break;
      case 'Funcionarios':
        sheetName = 'Respostas Funcionários';
        break;
      case 'Volta Redonda':
        sheetName = 'Respostas';
        break;
    }

    var isFuncionario = unidade === 'Funcionarios';
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      if (isFuncionario) {
        sheet.appendRow(['Data', 'Nome', 'Setor', 'Tempo de Casa', 'Nota', 'Comentários']);
      } else {
        sheet.appendRow(['Data', 'Nome', 'Telefone', 'Produtos', 'Funcionário', 'Nota', 'Comentários']);
      }
    }

    var row = isFuncionario
      ? [new Date(), nome, setor, tempoCasa, nota, comentarios]
      : [new Date(), nome, telefone, produtos, funcionario, nota, comentarios];

    sheet.appendRow(row);

    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    Logger.log('Erro no doPost: %s', err.toString());
    return ContentService.createTextOutput('ERROR: ' + err.toString());
  }
}

function parseMultipart(rawBody, contentTypeHeader) {
  var result = {};
  try {
    var boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    var boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
    if (!boundary) {
      var bstart = rawBody.indexOf('\r\n');
      boundary = rawBody.substring(0, bstart).replace(/^\-+/, '');
    }

    var parts = rawBody.split('--' + boundary);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === '--' || part.trim() === '') continue;

      var sections = part.split('\r\n\r\n');
      if (sections.length < 2) continue;

      var headers = sections[0];
      var value = sections.slice(1).join('\r\n\r\n');
      value = value.replace(/\r\n$/, '').replace(/--$/, '').trim();

      var nameMatch = headers.match(/name="([^"]+)"/i);
      var filenameMatch = headers.match(/filename="([^"]+)"/i);
      if (nameMatch) {
        var name = nameMatch[1];
        if (filenameMatch) continue;
        if (result.hasOwnProperty(name)) {
          if (Array.isArray(result[name])) result[name].push(value);
          else result[name] = [result[name], value];
        } else {
          result[name] = value;
        }
      }
    }
  } catch (e) {
    Logger.log('Erro parseMultipart: %s', e.toString());
  }
  return result;
}

function parseUrlEncoded(raw) {
  var obj = {};
  try {
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p) continue;
      var idx = p.indexOf('=');
      var key = idx > -1 ? decodeURIComponent(p.substring(0, idx).replace(/\+/g, ' ')) : decodeURIComponent(p.replace(/\+/g, ' '));
      var val = idx > -1 ? decodeURIComponent(p.substring(idx + 1).replace(/\+/g, ' ')) : '';
      if (obj.hasOwnProperty(key)) {
        if (Array.isArray(obj[key])) obj[key].push(val);
        else obj[key] = [obj[key], val];
      } else {
        obj[key] = val;
      }
    }
  } catch (e) {
    Logger.log('Erro parseUrlEncoded: %s', e.toString());
  }
  return obj;
}

function doGet(e) {
  try {
    var cidade = e.parameter.cidade || "vr";
    var nomeAba = "Respostas";

    switch (cidade) {
      case "niteroi":
        nomeAba = "Respostas Niteroi";
        break;
      case "funcionarios":
        nomeAba = "Respostas Funcionários";
        break;
      case "vr":
        nomeAba = "Respostas";
        break;
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();
    var results = [];
    var isFunc = cidade === "funcionarios";

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (isFunc) {
        results.push({
          data: row[0],
          nome: row[1] || '',
          setor: row[2] || '',
          tempoCasa: row[3] || '',
          nota: row[4] || '',
          comentarios: row[5] || ''
        });
      } else {
        results.push({
          data: row[0],
          nome: row[1] || '',
          telefone: row[2] || '',
          produtos: row[3] || '',
          funcionario: row[4] || '',
          nota: row[5] || '',
          comentarios: row[6] || ''
        });
      }
    }

    return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Erro no doGet: ' + err.toString());
    return ContentService.createTextOutput('ERROR: ' + err.toString());
  }
}


/* =====================================================================
 *  TRATATIVAS — DASHBOARD NPS VEGAS VIGILÂNCIA
 * =====================================================================
 *  - Lê as abas de respostas (não altera nada nelas).
 *  - Cria as abas: Tratativas, Tratativas_Historico, Tratativas_Usuarios.
 *  - Guarda os prints no Google Drive (privados, sem link público).
 *  - Acesso aberto (sem login): quem tem o link do Dashboard vê e registra tratativas.
 *  Primeira vez: executar a função configurarTratativas() pelo editor.
 * ===================================================================== */

const CONFIG = {
  // Deixe vazio: usa a própria planilha à qual este script está vinculado.
  SPREADSHEET_ID: '',

  // Abas de respostas de CLIENTES que geram tratativa.
  // ddd = usado quando o cliente digitou o telefone sem DDD.
  ABAS_CLIENTES: [
    { aba: 'Respostas',         unidade: 'VR',  nomeUnidade: 'Volta Redonda', ddd: '24' },
    { aba: 'Respostas Niteroi', unidade: 'NIT', nomeUnidade: 'Niterói',       ddd: '21' }
  ],

  // Regra: NOTA <= 7 gera alerta de tratativa. 8, 9 e 10 não geram.
  NOTA_LIMITE_ALERTA: 7,

  // Respostas anteriores a esta data NÃO viram tratativa (evita importar
  // o histórico antigo inteiro no primeiro dia). Formato AAAA-MM-DD.
  // Deixe '' para importar todas as respostas com nota <= 7.
  DATA_INICIO_TRATATIVAS: '2026-10-01',

  PASTA_RAIZ_DRIVE: 'NPS Vegas Vigilância',
  ABA_TRATATIVAS: 'Tratativas',
  ABA_HISTORICO: 'Tratativas_Historico',

  MAX_BYTES_IMAGEM: 8 * 1024 * 1024 // por imagem, já comprimida pelo navegador
};

/* ------------------------------------------------------------------ */
/*  Estrutura das abas                                                 */
/* ------------------------------------------------------------------ */

const COLS_TRATATIVAS = [
  'id_avaliacao', 'unidade', 'aba_origem', 'cliente', 'telefone', 'nota', 'comentario',
  'data_avaliacao', 'atendente', 'produtos', 'status_tratativa', 'responsavel',
  'data_contato', 'hora_contato', 'problema_identificado', 'solucao_apresentada',
  'resultado_contato', 'observacao', 'data_inicio_tratativa', 'data_primeiro_contato',
  'data_resolucao', 'imagens_tratativa', 'links_google_drive', 'pasta_drive_id',
  'criado_em', 'atualizado_em', 'atualizado_por', 'versao'
];
const COLS_TEXTO_TRATATIVAS = ['id_avaliacao', 'telefone', 'data_contato', 'hora_contato', 'imagens_tratativa'];

const COLS_HISTORICO = ['data_hora', 'id_avaliacao', 'evento', 'detalhe', 'usuario'];

const STATUS = {
  NOVO: 'Novo',
  AGUARDANDO_CONTATO: 'Aguardando contato',
  CONTATO_REALIZADO: 'Contato realizado',
  EM_TRATATIVA: 'Em tratativa',
  RESOLVIDO: 'Resolvido',
  CONTATO_NAO_REALIZADO: 'Contato não realizado',
  CLIENTE_NAO_LOCALIZADO: 'Cliente não localizado',
  NAO_RESOLVIDO: 'Não resolvido'
};
const STATUS_PENDENTES = ['NOVO', 'AGUARDANDO_CONTATO'];
const STATUS_COM_CONTATO = ['CONTATO_REALIZADO', 'EM_TRATATIVA', 'RESOLVIDO', 'NAO_RESOLVIDO'];

const RESULTADOS_CONTATO = [
  'Cliente satisfeito com a solução',
  'Cliente parcialmente satisfeito',
  'Cliente continua insatisfeito',
  'Aguardando retorno do cliente',
  'Cliente não respondeu'
];

// Posição das colunas nas abas de respostas de clientes — a mesma usada no doPost/doGet acima:
// Data | Nome | Telefone | Produtos | Funcionário | Nota | Comentários
const COLUNAS_RESPOSTAS = { data: 0, nome: 1, telefone: 2, produtos: 3, atendente: 4, nota: 5, comentario: 6 };

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* ------------------------------------------------------------------ */
/*  Entrada HTTP                                                       */
/* ------------------------------------------------------------------ */

/** Identifica uma chamada do Dashboard de tratativas: corpo JSON com "acao". */
function lerPedidoTratativa_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  const tipo = String(e.postData.type || '');
  if (tipo.indexOf('multipart/form-data') >= 0 || tipo.indexOf('x-www-form-urlencoded') >= 0) return null;
  const raw = String(e.postData.contents).trim();
  if (raw.charAt(0) !== '{') return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p.acao === 'string' ? p : null;
  } catch (_) {
    return null;
  }
}

function apiTratativas_(p) {
  try {
    // Sem login: o nome de quem está usando vem do Dashboard (campo "Responsável").
    const sessao = { nome: limpar_(p.usuario, 80) || 'Supervisão' };
    const acoes = {
      listar: listar_,
      detalhe: detalhe_,
      salvar: salvar_,
      registrarEvento: registrarEvento_,
      enviarImagem: enviarImagem_,
      miniaturas: miniaturas_,
      imagem: imagem_,
      excluirImagem: excluirImagem_
    };
    const fn = acoes[p.acao];
    if (!fn) throw erro_('Ação desconhecida.');
    return json_(Object.assign({ ok: true }, fn(p, sessao)));
  } catch (err) {
    if (!err.publico) console.error(err && err.stack ? err.stack : err);
    return json_({
      ok: false,
      erro: err.publico ? err.message : 'Não foi possível concluir a operação. Tente novamente.',
      codigo: err.codigo || ''
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Configuração inicial (executar uma vez pelo editor)                */
/* ------------------------------------------------------------------ */

/** Cria abas, chave de sessão, pasta no Drive e o gatilho de 5 minutos. */
function configurarTratativas() {
  const ss = planilha_();
  garantirAbas_(ss, true);
  pastaRaiz_();
  instalarGatilho();
  const r = sincronizarTratativas();
  console.log('Configuração concluída. Tratativas criadas agora: ' + r.novas);
}

/** Verifica novas respostas a cada 5 minutos, mesmo com o Dashboard fechado. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarTratativas')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarTratativas').timeBased().everyMinutes(5).create();
}

/** Força uma nova leitura completa das abas de respostas (não duplica). */
function ressincronizarTudo() {
  const props = PropertiesService.getScriptProperties();
  CONFIG.ABAS_CLIENTES.forEach(c => props.deleteProperty('sync_' + c.aba));
  console.log(JSON.stringify(sincronizarTratativas()));
}

/* ------------------------------------------------------------------ */
/*  Sincronização: respostas com nota <= 7 viram tratativas            */
/* ------------------------------------------------------------------ */

function sincronizarTratativas() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { novas: 0, ignorado: true };
  try {
    return sincronizar_();
  } finally {
    lock.releaseLock();
  }
}

function sincronizar_() {
  const ss = planilha_();
  garantirAbas_(ss, false);
  const props = PropertiesService.getScriptProperties();
  const shT = ss.getSheetByName(CONFIG.ABA_TRATATIVAS);
  const corte = CONFIG.DATA_INICIO_TRATATIVAS ? dataDeISO_(CONFIG.DATA_INICIO_TRATATIVAS) : null;
  const agora = new Date();
  let existentes = null;
  const novas = [];

  CONFIG.ABAS_CLIENTES.forEach(cfg => {
    const sh = ss.getSheetByName(cfg.aba);
    if (!sh) { console.warn('Aba não encontrada: ' + cfg.aba); return; }

    const ultima = sh.getLastRow();
    const chave = 'sync_' + cfg.aba;
    if (String(ultima) === props.getProperty(chave)) return; // nada novo
    if (ultima < 2) { props.setProperty(chave, String(ultima)); return; }

    const valores = sh.getRange(1, 1, ultima, Math.max(7, sh.getLastColumn())).getValues();
    const ix = COLUNAS_RESPOSTAS;
    if (!existentes) existentes = new Set(lerColuna_(shT, 'id_avaliacao'));

    for (let r = 1; r < valores.length; r++) {
      const linha = valores[r];
      const bruta = linha[ix.nota];
      if (bruta === '' || bruta === null) continue;
      const nota = Number(String(bruta).replace(',', '.'));
      if (!isFinite(nota) || nota > CONFIG.NOTA_LIMITE_ALERTA) continue;

      const data = ix.data >= 0 ? paraData_(linha[ix.data]) : null;
      if (corte && data && data < corte) continue;

      const nome = ix.nome >= 0 ? String(linha[ix.nome] || '').trim() : '';
      const tel = ix.telefone >= 0 ? String(linha[ix.telefone] || '').trim() : '';
      const id = gerarId_(cfg, data, nome, tel, nota, r);
      if (existentes.has(id)) continue;
      existentes.add(id);

      novas.push({
        id_avaliacao: id,
        unidade: cfg.unidade,
        aba_origem: cfg.aba,
        cliente: nome || 'Sem nome',
        telefone: tel,
        nota: nota,
        comentario: ix.comentario >= 0 ? String(linha[ix.comentario] || '').trim() : '',
        data_avaliacao: data || agora,
        atendente: ix.atendente >= 0 ? String(linha[ix.atendente] || '').trim() : '',
        produtos: ix.produtos >= 0 ? String(linha[ix.produtos] || '').trim() : '',
        status_tratativa: 'NOVO',
        imagens_tratativa: '[]',
        criado_em: agora,
        atualizado_em: agora,
        atualizado_por: 'Sistema',
        versao: 1
      });
    }
    props.setProperty(chave, String(ultima));
  });

  if (novas.length) {
    const cab = cabecalho_(shT);
    const linhas = novas.map(o => objParaLinha_(cab, o, null));
    shT.getRange(shT.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);
    registrarHistorico_(novas.map(o => ({
      data: o.data_avaliacao,
      id: o.id_avaliacao,
      evento: 'Cliente respondeu NPS com nota ' + o.nota + '.',
      detalhe: o.comentario ? 'Comentário: ' + resumir_(o.comentario, 250) : '',
      usuario: 'Sistema'
    })));
  }
  return { novas: novas.length };
}

/* ------------------------------------------------------------------ */
/*  Ações da API                                                       */
/* ------------------------------------------------------------------ */

function listar_(p, s) {
  // Garante que respostas recém-chegadas apareçam sem esperar o gatilho.
  const lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) {
    try { sincronizar_(); } finally { lock.releaseLock(); }
  }

  const t = lerTratativas_();
  const itens = t.linhas.map(l => resumoParaCliente_(l.obj));
  return {
    itens: itens,
    usuarios: Array.from(new Set(t.linhas.map(l => String(l.obj.responsavel || '').trim()).filter(String))).sort(),
    resultados: RESULTADOS_CONTATO,
    agora: new Date().toISOString()
  };
}

function detalhe_(p, s) {
  const lock = travar_();
  try {
    const ctx = localizar_(p.id);
    let o = ctx.obj;
    if (o.status_tratativa === 'NOVO') {
      o.status_tratativa = 'AGUARDANDO_CONTATO';
      o.atualizado_em = new Date();
      o.atualizado_por = s.nome;
      o.versao = proximaVersao_(o);
      gravarLinha_(ctx, o);
      registrarHistorico_([{ id: o.id_avaliacao, evento: 'Alerta visualizado por ' + s.nome + '. Aguardando contato.', usuario: s.nome }]);
    }
    return { item: completoParaCliente_(o), historico: historicoDe_(o.id_avaliacao) };
  } finally {
    lock.releaseLock();
  }
}

function salvar_(p, s) {
  const c = p.campos || {};
  const lock = travar_();
  try {
    const ctx = localizar_(p.id);
    const antes = Object.assign({}, ctx.obj);
    const o = ctx.obj;

    if (p.versao !== undefined && p.versao !== null && Number(p.versao) !== (Number(antes.versao) || 0)) {
      throw erro_('Esta tratativa foi alterada por ' + (antes.atualizado_por || 'outra pessoa') +
        ' enquanto você editava. Feche e abra novamente para ver a versão atual.', 'CONFLITO');
    }

    const status = String(c.status || antes.status_tratativa);
    if (!STATUS[status] || status === 'NOVO') throw erro_('Status inválido.');

    const novo = {
      responsavel: limpar_(c.responsavel, 120),
      data_contato: dataTexto_(c.data_contato),
      hora_contato: horaTexto_(c.hora_contato),
      problema_identificado: limpar_(c.problema_identificado, 4000),
      solucao_apresentada: limpar_(c.solucao_apresentada, 4000),
      resultado_contato: limpar_(c.resultado_contato, 200),
      observacao: limpar_(c.observacao, 4000)
    };

    if (status === 'RESOLVIDO' && !novo.solucao_apresentada) {
      throw erro_('Para marcar como resolvido, descreva a solução apresentada ao cliente.');
    }
    if (STATUS_COM_CONTATO.indexOf(status) >= 0 && !novo.responsavel) {
      throw erro_('Informe o responsável pelo contato.');
    }

    Object.assign(o, novo);
    o.status_tratativa = status;
    const agora = new Date();

    if (STATUS_PENDENTES.indexOf(status) < 0 && !o.data_inicio_tratativa) o.data_inicio_tratativa = agora;
    if (STATUS_COM_CONTATO.indexOf(status) >= 0 && !o.data_primeiro_contato) {
      o.data_primeiro_contato = combinarDataHora_(novo.data_contato, novo.hora_contato) || agora;
    }
    if (status === 'RESOLVIDO' && antes.status_tratativa !== 'RESOLVIDO') o.data_resolucao = agora;
    if (status !== 'RESOLVIDO' && antes.status_tratativa === 'RESOLVIDO') o.data_resolucao = '';

    o.atualizado_em = agora;
    o.atualizado_por = s.nome;
    o.versao = proximaVersao_(o);
    gravarLinha_(ctx, o);

    const eventos = eventosDeAlteracao_(antes, o, s.nome);
    if (eventos.length) registrarHistorico_(eventos);

    return { item: completoParaCliente_(o), historico: historicoDe_(o.id_avaliacao) };
  } finally {
    lock.releaseLock();
  }
}

function registrarEvento_(p, s) {
  const lock = travar_();
  try {
    const ctx = localizar_(p.id);
    const o = ctx.obj;
    if (p.evento === 'whatsapp') {
      registrarHistorico_([{ id: o.id_avaliacao, evento: s.nome + ' abriu conversa no WhatsApp com o cliente.', usuario: s.nome }]);
    } else {
      throw erro_('Evento não permitido.');
    }
    return {};
  } finally {
    lock.releaseLock();
  }
}

function enviarImagem_(p, s) {
  const mime = String(p.mime || 'image/jpeg');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw erro_('Formato de imagem não aceito.');
  const bytes = Utilities.base64Decode(String(p.dados || ''));
  if (!bytes.length) throw erro_('Imagem vazia.');
  if (bytes.length > CONFIG.MAX_BYTES_IMAGEM) throw erro_('Imagem muito grande. Limite: 8 MB.');
  const bytesMini = p.miniatura ? Utilities.base64Decode(String(p.miniatura)) : null;

  const lock = travar_();
  try {
    const ctx = localizar_(p.id);
    const o = ctx.obj;
    const pasta = pastaDaTratativa_(o);
    const imagens = lerImagens_(o);

    const ext = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');
    const carimbo = Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd-HHmmss');
    const base = o.id_avaliacao + '_' + slug_(o.cliente) + '_' + carimbo;
    let seq = imagens.length + 1;
    let nome = base + '_conversa_' + pad_(seq) + '.' + ext;
    while (pasta.getFilesByName(nome).hasNext()) { seq++; nome = base + '_conversa_' + pad_(seq) + '.' + ext; }

    const arq = pasta.createFile(Utilities.newBlob(bytes, mime, nome));
    arq.setDescription('Comprovação da tratativa NPS ' + o.id_avaliacao + ' - ' + o.cliente + ' - enviado por ' + s.nome);

    let idMini = '';
    if (bytesMini && bytesMini.length) {
      const mini = subpasta_(pasta, '_miniaturas').createFile(
        Utilities.newBlob(bytesMini, 'image/jpeg', nome.replace(/\.\w+$/, '') + '_mini.jpg'));
      idMini = mini.getId();
    }

    const meta = { id: arq.getId(), t: idMini, n: nome, em: new Date().toISOString(), por: s.nome };
    imagens.push(meta);
    o.imagens_tratativa = JSON.stringify(imagens);
    o.links_google_drive = pasta.getUrl();
    o.pasta_drive_id = pasta.getId();
    o.atualizado_em = new Date();
    o.atualizado_por = s.nome;
    o.versao = proximaVersao_(o);
    gravarLinha_(ctx, o);
    registrarHistorico_([{ id: o.id_avaliacao, evento: 'Print da conversa anexado (' + nome + ').', usuario: s.nome }]);

    return { imagem: meta, versao: o.versao, qtdImagens: imagens.length };
  } finally {
    lock.releaseLock();
  }
}

function miniaturas_(p) {
  const ctx = localizar_(p.id);
  const mapa = {};
  lerImagens_(ctx.obj).forEach(img => {
    // Sem miniatura salva: devolve null e o navegador mostra um ícone.
    if (!img.t) { mapa[img.id] = null; return; }
    try {
      mapa[img.id] = dataUrl_(DriveApp.getFileById(img.t).getBlob());
    } catch (e) {
      mapa[img.id] = null;
    }
  });
  return { miniaturas: mapa };
}

function imagem_(p) {
  const ctx = localizar_(p.id);
  const img = lerImagens_(ctx.obj).filter(i => i.id === p.fileId)[0];
  if (!img) throw erro_('Imagem não pertence a esta tratativa.'); // impede acesso a outros arquivos do Drive
  return { dataUrl: dataUrl_(DriveApp.getFileById(img.id).getBlob()) };
}

function excluirImagem_(p, s) {
  const lock = travar_();
  try {
    const ctx = localizar_(p.id);
    const o = ctx.obj;
    const imagens = lerImagens_(o);
    const img = imagens.filter(i => i.id === p.fileId)[0];
    if (!img) throw erro_('Imagem não encontrada nesta tratativa.');

    // Vai para a lixeira do Drive (recuperável por 30 dias).
    try { DriveApp.getFileById(img.id).setTrashed(true); } catch (e) { console.warn(e); }
    if (img.t) { try { DriveApp.getFileById(img.t).setTrashed(true); } catch (e) { console.warn(e); } }

    o.imagens_tratativa = JSON.stringify(imagens.filter(i => i.id !== img.id));
    o.atualizado_em = new Date();
    o.atualizado_por = s.nome;
    o.versao = proximaVersao_(o);
    gravarLinha_(ctx, o);
    registrarHistorico_([{ id: o.id_avaliacao, evento: 'Print removido (' + img.n + ').', usuario: s.nome }]);
    return { versao: o.versao, qtdImagens: imagens.length - 1 };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Histórico                                                          */
/* ------------------------------------------------------------------ */

function eventosDeAlteracao_(a, d, usuario) {
  const ev = [];
  const add = (evento, detalhe) => ev.push({ id: d.id_avaliacao, evento: evento, detalhe: detalhe || '', usuario: usuario });

  if (a.responsavel !== d.responsavel && d.responsavel) add('Responsável pelo contato: ' + d.responsavel + '.');
  if ((a.data_contato !== d.data_contato || a.hora_contato !== d.hora_contato) && d.data_contato) {
    add('Contato registrado em ' + dataBR_(d.data_contato) + (d.hora_contato ? ' às ' + d.hora_contato : '') + '.');
  }
  if (a.problema_identificado !== d.problema_identificado && d.problema_identificado) {
    add(a.problema_identificado ? 'Problema identificado atualizado.' : 'Problema identificado.', resumir_(d.problema_identificado, 300));
  }
  if (a.solucao_apresentada !== d.solucao_apresentada && d.solucao_apresentada) {
    add(a.solucao_apresentada ? 'Solução apresentada atualizada.' : 'Solução apresentada ao cliente.', resumir_(d.solucao_apresentada, 300));
  }
  if (a.resultado_contato !== d.resultado_contato && d.resultado_contato) add('Resultado do contato: ' + d.resultado_contato + '.');
  if (a.observacao !== d.observacao && d.observacao) add('Observação registrada.', resumir_(d.observacao, 300));

  if (a.status_tratativa !== d.status_tratativa) {
    const textos = {
      AGUARDANDO_CONTATO: 'Tratativa voltou para aguardando contato.',
      CONTATO_REALIZADO: 'Contato com o cliente realizado.',
      EM_TRATATIVA: 'Tratativa em andamento.',
      RESOLVIDO: 'Tratativa marcada como resolvida.',
      CONTATO_NAO_REALIZADO: 'Não foi possível falar com o cliente.',
      CLIENTE_NAO_LOCALIZADO: 'Cliente não localizado.',
      NAO_RESOLVIDO: 'Tratativa encerrada como não resolvida.'
    };
    const reaberta = a.status_tratativa === 'RESOLVIDO';
    add((reaberta ? 'Tratativa reaberta. ' : '') + (textos[d.status_tratativa] || 'Status alterado.'),
      'Status: ' + STATUS[a.status_tratativa] + ' → ' + STATUS[d.status_tratativa]);
  }
  return ev;
}

function registrarHistorico_(eventos) {
  if (!eventos.length) return;
  const sh = planilha_().getSheetByName(CONFIG.ABA_HISTORICO);
  const agora = new Date();
  const linhas = eventos.map(e => [e.data || agora, e.id, textoSeguro_(e.evento), textoSeguro_(e.detalhe || ''), textoSeguro_(e.usuario || '')]);
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, COLS_HISTORICO.length).setValues(linhas);
}

function historicoDe_(id) {
  const sh = planilha_().getSheetByName(CONFIG.ABA_HISTORICO);
  const ultima = sh.getLastRow();
  if (ultima < 2) return [];
  const achados = sh.getRange(2, 2, ultima - 1, 1).createTextFinder(id).matchEntireCell(true).findAll();
  return achados
    .map(c => sh.getRange(c.getRow(), 1, 1, COLS_HISTORICO.length).getValues()[0])
    .map(l => ({ data: iso_(l[0]), evento: String(l[2]), detalhe: String(l[3] || ''), usuario: String(l[4] || '') }))
    .sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
}

function hash_(texto) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/* ------------------------------------------------------------------ */
/*  Google Drive                                                       */
/* ------------------------------------------------------------------ */

function pastaRaiz_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PASTA_RAIZ_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* recria abaixo */ }
  }
  const it = DriveApp.getRootFolder().getFoldersByName(CONFIG.PASTA_RAIZ_DRIVE);
  const pasta = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(CONFIG.PASTA_RAIZ_DRIVE);
  props.setProperty('PASTA_RAIZ_ID', pasta.getId());
  return pasta;
}

/** NPS Vegas Vigilância / Tratativas / 2026 / 10 - Outubro / Cliente - Nome (ID) */
function pastaDaTratativa_(o) {
  if (o.pasta_drive_id) {
    try {
      const f = DriveApp.getFolderById(o.pasta_drive_id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* recria abaixo */ }
  }
  const d = paraData_(o.data_avaliacao) || new Date();
  const mes = Number(Utilities.formatDate(d, tz_(), 'M'));
  const ano = Utilities.formatDate(d, tz_(), 'yyyy');
  let p = subpasta_(pastaRaiz_(), 'Tratativas');
  p = subpasta_(p, ano);
  p = subpasta_(p, pad_(mes) + ' - ' + MESES[mes - 1]);
  const nomeCliente = String(o.cliente || 'Sem nome').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60);
  return subpasta_(p, 'Cliente - ' + nomeCliente + ' (' + o.id_avaliacao + ')');
}

function subpasta_(pai, nome) {
  const it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

function lerImagens_(o) {
  try {
    const v = JSON.parse(o.imagens_tratativa || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function dataUrl_(blob) {
  return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ------------------------------------------------------------------ */
/*  Planilha                                                           */
/* ------------------------------------------------------------------ */

function planilha_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw erro_('Script não vinculado a uma planilha. Preencha CONFIG.SPREADSHEET_ID.');
  return ss;
}

function garantirAbas_(ss, forcar) {
  const cache = CacheService.getScriptCache();
  if (!forcar && cache.get('abas_ok_v1')) return;
  garantirAba_(ss, CONFIG.ABA_TRATATIVAS, COLS_TRATATIVAS, COLS_TEXTO_TRATATIVAS);
  garantirAba_(ss, CONFIG.ABA_HISTORICO, COLS_HISTORICO, ['id_avaliacao']);
  cache.put('abas_ok_v1', '1', 21600);
}

function garantirAba_(ss, nome, colunas, colsTexto) {
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    sh.getRange(1, 1, 1, colunas.length).setValues([colunas]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    const n = Math.max(1, sh.getLastColumn());
    const atual = sh.getRange(1, 1, 1, n).getValues()[0].map(String).filter(String);
    const faltando = colunas.filter(c => atual.indexOf(c) < 0);
    if (faltando.length) {
      sh.getRange(1, atual.length + 1, 1, faltando.length).setValues([faltando]).setFontWeight('bold');
    }
  }
  const cab = cabecalho_(sh);
  (colsTexto || []).forEach(c => {
    if (cab[c] >= 0) sh.getRange(1, cab[c] + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

function cabecalho_(sh) {
  const n = Math.max(1, sh.getLastColumn());
  const mapa = {};
  sh.getRange(1, 1, 1, n).getValues()[0].forEach((c, i) => { if (c !== '') mapa[String(c)] = i; });
  return mapa;
}

function lerColuna_(sh, nome) {
  const cab = cabecalho_(sh);
  if (sh.getLastRow() < 2 || cab[nome] === undefined) return [];
  return sh.getRange(2, cab[nome] + 1, sh.getLastRow() - 1, 1).getValues().map(l => String(l[0]));
}

function lerTratativas_() {
  const sh = planilha_().getSheetByName(CONFIG.ABA_TRATATIVAS);
  const cab = cabecalho_(sh);
  const linhas = [];
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach((l, i) => {
      if (l[cab.id_avaliacao] === '') return;
      linhas.push({ linha: i + 2, obj: linhaParaObj_(cab, l) });
    });
  }
  return { sh: sh, cab: cab, linhas: linhas };
}

function localizar_(id) {
  if (!id) throw erro_('Tratativa não informada.');
  const sh = planilha_().getSheetByName(CONFIG.ABA_TRATATIVAS);
  const cab = cabecalho_(sh);
  const ultima = sh.getLastRow();
  if (ultima < 2) throw erro_('Tratativa não encontrada.');
  const cel = sh.getRange(2, cab.id_avaliacao + 1, ultima - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!cel) throw erro_('Tratativa não encontrada.');
  const linha = cel.getRow();
  const valores = sh.getRange(linha, 1, 1, sh.getLastColumn()).getValues()[0];
  return { sh: sh, cab: cab, linha: linha, valores: valores, obj: linhaParaObj_(cab, valores) };
}

function gravarLinha_(ctx, o) {
  const linha = objParaLinha_(ctx.cab, o, ctx.valores);
  ctx.sh.getRange(ctx.linha, 1, 1, linha.length).setValues([linha]);
  ctx.valores = linha;
}

function linhaParaObj_(cab, l) {
  const o = {};
  Object.keys(cab).forEach(k => { o[k] = l[cab[k]]; });
  ['data_contato', 'hora_contato'].forEach(k => {
    if (o[k] instanceof Date) o[k] = Utilities.formatDate(o[k], tz_(), k === 'data_contato' ? 'yyyy-MM-dd' : 'HH:mm');
  });
  ['id_avaliacao', 'telefone', 'responsavel', 'status_tratativa'].forEach(k => { o[k] = String(o[k] === undefined ? '' : o[k]); });
  return o;
}

function objParaLinha_(cab, o, base) {
  const n = Math.max.apply(null, Object.keys(cab).map(k => cab[k])) + 1;
  const l = base ? base.slice() : new Array(n).fill('');
  Object.keys(cab).forEach(k => {
    if (!(k in o)) return;
    const v = o[k];
    l[cab[k]] = (typeof v === 'string') ? textoSeguro_(v) : (v === undefined || v === null ? '' : v);
  });
  return l;
}

function proximaVersao_(o) {
  return (Number(o.versao) || 0) + 1;
}

function travar_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw erro_('Sistema ocupado. Tente novamente em instantes.');
  return lock;
}

/* ------------------------------------------------------------------ */
/*  Conversões para o navegador                                        */
/* ------------------------------------------------------------------ */

function infoUnidade_(sigla) {
  return CONFIG.ABAS_CLIENTES.filter(c => c.unidade === sigla)[0] || { unidade: sigla, nomeUnidade: sigla, ddd: '' };
}

function resumoParaCliente_(o) {
  const u = infoUnidade_(o.unidade);
  return {
    id: o.id_avaliacao,
    unidade: o.unidade,
    nomeUnidade: u.nomeUnidade,
    ddd: u.ddd,
    cliente: String(o.cliente || ''),
    telefone: String(o.telefone || ''),
    nota: Number(o.nota),
    comentario: String(o.comentario || ''),
    dataAvaliacao: iso_(o.data_avaliacao),
    atendente: String(o.atendente || ''),
    produtos: String(o.produtos || ''),
    status: o.status_tratativa || 'NOVO',
    responsavel: String(o.responsavel || ''),
    dataContato: String(o.data_contato || ''),
    horaContato: String(o.hora_contato || ''),
    dataPrimeiroContato: iso_(o.data_primeiro_contato),
    dataResolucao: iso_(o.data_resolucao),
    qtdImagens: lerImagens_(o).length,
    versao: Number(o.versao) || 0
  };
}

function completoParaCliente_(o) {
  return Object.assign(resumoParaCliente_(o), {
    problema: String(o.problema_identificado || ''),
    solucao: String(o.solucao_apresentada || ''),
    resultado: String(o.resultado_contato || ''),
    observacao: String(o.observacao || ''),
    imagens: lerImagens_(o).map(i => ({ id: i.id, nome: i.n, em: i.em, por: i.por })),
    atualizadoPor: String(o.atualizado_por || '')
  });
}

/* ------------------------------------------------------------------ */
/*  Utilitários                                                        */
/* ------------------------------------------------------------------ */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function erro_(msg, codigo) {
  const e = new Error(msg);
  e.publico = true;
  e.codigo = codigo || '';
  return e;
}

function tz_() {
  return Session.getScriptTimeZone() || 'America/Sao_Paulo';
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function gerarId_(cfg, data, nome, tel, nota, linha) {
  const marca = data ? data.toISOString() : 'linha' + linha;
  const base = [cfg.aba, marca, normalizar_(nome), String(tel).replace(/\D/g, ''), nota].join('|');
  const h = hash_(base).slice(0, 6).toUpperCase();
  const dia = Utilities.formatDate(data || new Date(), tz_(), 'yyyyMMdd');
  return cfg.unidade + '-' + dia + '-' + h;
}

function paraData_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)); // serial do Sheets
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) return new Date(+br[3], +br[2] - 1, +br[1], +(br[4] || 0), +(br[5] || 0), +(br[6] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function dataDeISO_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function iso_(v) {
  const d = paraData_(v);
  return d ? d.toISOString() : '';
}

function dataTexto_(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function horaTexto_(v) {
  const s = String(v || '').trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}

function combinarDataHora_(data, hora) {
  const d = dataDeISO_(data);
  if (!d) return null;
  if (hora) { const h = hora.split(':'); d.setHours(+h[0], +h[1]); }
  return d;
}

function dataBR_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
}

function limpar_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** Impede que um texto digitado seja interpretado como fórmula na planilha. */
function textoSeguro_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function resumir_(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function slug_(s) {
  return String(s || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'cliente';
}

function pad_(n) {
  return ('0' + n).slice(-2);
}
