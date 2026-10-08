# 🔴 Tratativas de clientes insatisfeitos — Dashboard NPS

Evolução do Dashboard NPS para acompanhar e tratar os clientes que deram **nota até 7**.

## Como funciona

Tudo fica no **mesmo Code.gs** e na **mesma URL** que a pesquisa já usa:

```
Code.gs (um único arquivo, uma única URL)
├── doPost  ── formulário da pesquisa (FormData)  →  grava em "Respostas" / "Respostas Niteroi" / "Respostas Funcionários"  (igual a antes)
│           └─ JSON do Dashboard com "acao"        →  API de tratativas
├── doGet   ── ?cidade=vr|niteroi|funcionarios     →  dados dos gráficos  (igual a antes)
└── gatilho a cada 5 min → notas <= 7 viram linhas na aba "Tratativas"
        ├── aba "Tratativas_Historico"  → tudo o que aconteceu (nunca é apagado)
        └── Google Drive                → prints das conversas (privados)
```

**O repositório NPS (pesquisa) não muda.** No Code.gs, o código que já existia ficou idêntico; foram acrescentadas só 3 linhas no começo do `doPost`, que desviam para as tratativas apenas as chamadas do Dashboard (corpo JSON com o campo `acao`). As abas de respostas são só lidas, nunca alteradas.

Regra do alerta: `NOTA <= 7 → gera tratativa`. Notas 8, 9 e 10 entram nos indicadores normalmente, sem alerta. A pesquisa interna de funcionários (anônima) não gera tratativa.

---

## Instalação (uma vez, cerca de 15 minutos)

> ⚠️ **A ordem importa.** Publique o Code.gs novo (passos 1 a 5) **antes** de enviar o Dashboard novo ao GitHub (passo 6). Se o Dashboard novo for ao ar antes, o Code.gs antigo vai receber as chamadas do Dashboard como se fossem respostas da pesquisa e gravar linhas vazias na aba "Respostas".

### 1. Faça uma cópia de segurança do Code.gs atual
Na planilha: **Extensões → Apps Script**. Copie todo o conteúdo do `Code.gs` atual e guarde num arquivo de texto. Se algo der errado, basta colar de volta.

### 2. Confira o runtime
Engrenagem **Configurações do projeto** → marque **Mostrar arquivo de manifesto "appsscript.json"**. Abra o `appsscript.json` e confira que existe a linha:

```json
"runtimeVersion": "V8",
```

Se não existir (ou estiver `DEPRECATED_ES5`), acrescente/troque por `V8` e salve. **Não altere** o restante do manifesto.

### 3. Substitua o Code.gs
Apague o conteúdo do `Code.gs` e cole todo o arquivo `apps-script/Code.gs` deste repositório. Salve (Ctrl+S).

No bloco `CONFIG` (seção TRATATIVAS, perto do meio do arquivo), confira:
- `DATA_INICIO_TRATATIVAS`: a partir de qual dia as notas baixas viram tratativa (`AAAA-MM-DD`). Assim o histórico antigo não entra todo de uma vez. Use `''` para importar tudo.
- `SPREADSHEET_ID`: deixe vazio (o script usa a própria planilha).

> Salvar o código **não** afeta a pesquisa no ar: a URL publicada continua rodando a versão antiga até o passo 5.

### 4. Rode a configuração inicial e autorize
No topo do editor, escolha a função **`configurarTratativas`** e clique em **Executar**. O Google vai pedir uma autorização nova (agora inclui o **Google Drive**). Aceite.

Isso cria as abas `Tratativas` e `Tratativas_Historico`, a pasta `NPS Vegas Vigilância` no Drive e um gatilho que verifica novas respostas a cada 5 minutos.

### 5. Publique como NOVA VERSÃO da implantação existente
**Implantar → Gerenciar implantações** → na implantação atual, clique no **lápis (editar)** → em *Versão* escolha **Nova versão** → **Implantar**.

> ❗ Não use "Nova implantação": isso gera **outra URL** e a pesquisa e o Dashboard deixariam de funcionar. Editando a implantação existente, a URL continua a mesma.

Teste rápido: abra a pesquisa, envie uma resposta e veja se chegou na planilha como sempre.

### 6. Publique o Dashboard
Copie os arquivos do Dashboard para o repositório, faça commit e push.

O Dashboard já vem apontando para a mesma URL usada hoje (`API_URL` em `tratativas/tratativas.js`). Não há usuário nem senha: ao abrir o Dashboard, as tratativas já aparecem.

---

## Uso diário (supervisão)

1. **Alerta**: no topo aparece "🔔 Nova tratativa" e o contador "🔴 N tratativas pendentes". A aba do navegador mostra `(N)` no título. O Dashboard se atualiza sozinho a cada 90 segundos e ao voltar do WhatsApp.
2. **💬 Conversar no WhatsApp**: no celular abre o aplicativo; no computador abre o WhatsApp Web, já com uma mensagem inicial. O número é limpo automaticamente (`(24) 99999-9999` → `5524999999999`). Se o cliente digitou sem DDD, usa o DDD da unidade (24 ou 21).
3. **Iniciar tratativa**: abre o registro. Ao abrir, o status muda de *Novo* para *Aguardando contato*.
4. Preencha responsável, data/hora (preenchidas sozinhas ao escolher um status de contato), problema, solução, resultado e observação.
5. **📸 Adicionar prints**: selecione vários de uma vez, ou cole com Ctrl+V no computador. As imagens são reduzidas e comprimidas no próprio aparelho antes do envio.
6. **Resolvido** exige a solução apresentada. Se não houver prints, o sistema pergunta antes de concluir.

O nome usado em "Responsável pelo contato" fica lembrado no aparelho e já vem preenchido nas próximas tratativas. É esse nome que aparece no histórico ("Alerta visualizado por…", "Print anexado…"). Enquanto ninguém tiver salvo um responsável naquele aparelho, o histórico registra "Supervisão".

O que foi digitado e ainda não salvo fica guardado no aparelho. Se o celular recarregar a página ao voltar do WhatsApp, o texto é recuperado.

### Status e cores

| Status | Cor | Conta como |
|---|---|---|
| Novo | 🔴 | Pendente (alerta destacado) |
| Aguardando contato | 🔴 | Pendente |
| Contato não realizado | ⚫ | Pendente (tentar de novo) |
| Contato realizado | 🟡 | Em tratativa |
| Em tratativa | 🟡 | Em tratativa |
| Resolvido | 🟢 | Resolvida |
| Não resolvido | 🟣 | Encerrada |
| Cliente não localizado | ⚫ | Encerrada |

### Indicadores
- **Total, Promotores (9–10), Neutros (7–8), Detratores (0–6)**: seguem os filtros atuais do Dashboard.
- **Pendentes, Em tratativa, Resolvidas, Taxa de resolução, Tempo médio, Aguardando contato**: seguem os filtros do painel de tratativas (período, unidade, nota, cliente, telefone, responsável).
- **Tempo médio de atendimento** = da resposta do cliente até a tratativa ser marcada como resolvida.

---

## Google Drive

```
NPS Vegas Vigilância/
└── Tratativas/
    └── 2026/
        └── 10 - Outubro/
            └── Cliente - JOÃO DA SILVA (VR-20261008-A1B2C3)/
                ├── VR-20261008-A1B2C3_joao-da-silva_20261008-093512_conversa_01.jpg
                ├── VR-20261008-A1B2C3_joao-da-silva_20261008-093540_conversa_02.jpg
                └── _miniaturas/   (versões pequenas usadas na tela)
```

- Arquivos e pastas ficam **privados** na conta que publicou o Apps Script. Nenhum link público é criado.
- O Dashboard recebe as imagens pela API, e só imagens que pertencem àquela tratativa. Nenhum link do Drive fica exposto.
- Na tela aparecem só miniaturas; a imagem grande é baixada ao clicar. As miniaturas só carregam quando a tratativa é aberta.
- Excluir um print o envia para a **lixeira do Drive** (recuperável por 30 dias) e registra no histórico.

---

## Planilha: colunas criadas

**Tratativas**: `id_avaliacao, unidade, aba_origem, cliente, telefone, nota, comentario, data_avaliacao, atendente, produtos, status_tratativa, responsavel, data_contato, hora_contato, problema_identificado, solucao_apresentada, resultado_contato, observacao, data_inicio_tratativa, data_primeiro_contato, data_resolucao, imagens_tratativa, links_google_drive, pasta_drive_id, criado_em, atualizado_em, atualizado_por, versao`

- `imagens_tratativa`: lista (JSON) com os IDs dos arquivos no Drive.
- `links_google_drive`: link da pasta do cliente (privada).
- `versao`: evita que duas pessoas sobrescrevam a mesma tratativa ao mesmo tempo.

**Tratativas_Historico**: `data_hora, id_avaliacao, evento, detalhe, usuario`. Só recebe linhas novas; mudar o status nunca apaga nada.

> Evite editar as abas de tratativas manualmente. Se precisar corrigir algo, edite a célula, mas não apague linhas nem mude os nomes das colunas.

---

## Administração

| Tarefa | Como |
|---|---|
| Alterar o Code.gs | Cole a nova versão → **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão**. A URL continua a mesma. |
| Reprocessar respostas | Execute `ressincronizarTudo` no editor. Não duplica tratativas. |
| Ver erros | No editor do Apps Script → **Execuções**. |

## Modo demonstração

Abra `index.html?demo=1` para ver tudo funcionando com dados fictícios, sem tocar na planilha nem no Drive. Bom para treinar a equipe.

## Problemas comuns

- **"Resposta inválida do servidor" no painel de tratativas**: o Code.gs novo ainda não foi publicado como *Nova versão* (passo 5).
- **Apareceram linhas vazias na aba "Respostas"**: o Dashboard novo foi ao ar antes do passo 5. Apague essas linhas (sem nome e sem nota) e conclua o passo 5.
- **"Authorization is required" / pesquisa parou de gravar**: faltou executar `configurarTratativas` e autorizar o Drive (passo 4) antes de publicar. Execute, autorize e publique uma nova versão de novo.
- **Nenhuma tratativa aparece**: confira `DATA_INICIO_TRATATIVAS` e os nomes das abas em `ABAS_CLIENTES`. Depois execute `ressincronizarTudo`.
- **Erro de sintaxe ao salvar** (`const`, `=>`): o projeto está no runtime antigo. Ajuste para `V8` (passo 2).

## ⚠️ Sobre o acesso

As tratativas **não têm login**: quem tiver o link do Dashboard vê nomes, telefones, comentários e prints das conversas, e também consegue registrar e alterar tratativas. É o mesmo modelo do Dashboard atual, cujo `doGet` já devolve nomes e telefones a quem tiver o link. Por isso, evite divulgar o endereço do Dashboard fora da equipe. Se no futuro quiserem restringir o acesso, dá para acrescentar uma proteção sem mudar o restante.

Ponto antigo mantido como estava: o `doPost` da pesquisa grava o comentário com `appendRow` sem tratamento, então um texto começando com `=` vira fórmula na planilha. As abas de tratativas já se protegem disso.
