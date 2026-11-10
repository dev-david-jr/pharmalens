# Leitor de Cupom PMC

Lê a foto de um cupom de farmácia e mostra, para cada medicamento, os dados da Lista PMC (CMED/ANVISA): substância, produto, classe terapêutica, tipo de produto, tarja e se a venda exige receita.

## Estrutura

```
wrangler.jsonc          ← configuração do Cloudflare Workers (nome "pharmalens")
package.json
src/index.js            ← Worker: serve a página e responde /api/ler-cupom (Gemini)
public/                 ← arquivos estáticos
  index.html            ← o aplicativo
  data/pmc.json         ← lista compacta usada pelo app (sem linhas repetidas, com EANs)
  data/lista_pmc.json   ← lista completa com as 5 colunas (referência; o app não usa)
scripts/gerar_json.py   ← gera os JSON a partir da planilha
```

## Publicar no Cloudflare Workers (pharmalens.*.workers.dev)

1. Coloque estes arquivos na **raiz** do repositório do GitHub (`wrangler.jsonc`, `package.json`, `src/`, `public/`, `scripts/`). Apague a pasta `functions/` antiga, se existir.
2. No Cloudflare, abra **Workers & Pages → pharmalens → Settings → Build** e confira:
   - Repositório ligado ao GitHub (Git repository)
   - Build command: *(vazio)*
   - Deploy command: **npx wrangler deploy**
   - Root directory: **/** (ou a pasta onde está o `wrangler.jsonc`)
3. Crie uma chave gratuita do Gemini em https://aistudio.google.com/apikey (basta uma conta Google, sem cartão).
4. Em **Settings → Variables and Secrets** do Worker, adicione:
   - `GEMINI_API_KEY` — a chave criada no passo 3 (tipo **Secret**).
   - `ACCESS_CODE` — *(opcional, recomendado)* um código qualquer. Se definido, o app pede esse código antes de ler a imagem, para que estranhos não consumam sua cota.
   - `GEMINI_MODEL` — *(opcional)* modelo usado. Padrão: `gemini-flash-latest`. Para mais cota diária, use `gemini-flash-lite-latest`.
5. Faça commit no GitHub. O Cloudflare publica sozinho.

O `wrangler.jsonc` tem `"name": "pharmalens"`. Se o seu Worker tiver outro nome no Cloudflare, troque esse valor para o nome exato.

## Limites e privacidade da camada gratuita

- A cota gratuita tem limite de leituras por minuto e por dia (veja o valor atual no Google AI Studio). Quando estoura, o app avisa e usa o leitor offline.
- Na camada gratuita o Google pode usar as imagens enviadas para melhorar seus modelos, e revisores humanos podem vê-las. Cupons podem ter CPF e nome do cliente: **recorte ou cubra esses dados antes de enviar**, ou ative o faturamento no projeto do Google para sair da camada gratuita.

## Conferir se a função foi publicada

Abra `https://pharmalens.david-junior-fee.workers.dev/api/ler-cupom` no navegador. Deve aparecer algo como `{"funcao":"ok","chave_gemini":"configurada",...}`.
Se aparecer a página do app ou um erro 404, o Worker publicado ainda é só de arquivos estáticos: confira se o `wrangler.jsonc` e a pasta `src/` estão na raiz do repositório e se o último deploy usou `npx wrangler deploy` sem erros (aba **Deployments**).

## Como a leitura funciona

- **Gemini (padrão):** a imagem é reduzida no navegador e enviada para `/api/ler-cupom`, que chama a API do Gemini pelo Worker. A chave fica só no Cloudflare, nunca no HTML.
- **Leitor offline (Tesseract.js):** roda no próprio navegador, sem custo, mas lê pior cupons térmicos. É usado quando você escolhe essa opção ou automaticamente se a função falhar (por exemplo, sem chave configurada).
- Em qualquer caso, você pode corrigir os nomes no campo 2 e consultar de novo.

## Para que serve

Cada item mostra um resumo curto de para que o produto serve, gerado pelo Gemini a partir do nome (e da substância e classe terapêutica da Lista PMC, quando o item está na lista). Na leitura pelo Gemini o resumo já vem junto com os itens; na leitura offline ou digitada o app faz uma consulta extra só de texto ao mesmo endereço (`/api/ler-cupom` com `{ produtos: [...] }`). É informação geral: não traz dose e não substitui a bula nem a orientação do farmacêutico.

## Regra da receita (pela coluna TARJA)

| Tarja | Receita |
|---|---|
| Sem Tarja | Não (venda livre) |
| Tarja Vermelha | Sim, receita simples |
| Tarja Vermelha sob restrição | Sim, com retenção da receita |
| Tarja Preta | Sim, com Notificação de Receita retida |
| - (*) | Não informado na lista; confirmar na ANVISA |

## Atualizar a lista

Quando sair uma nova Lista PMC, rode:

```
pip install openpyxl
python3 scripts/gerar_json.py Lista_PMC.xlsx public/data/lista_pmc.json public/data/pmc.json
```

e faça commit dos dois JSON.
