# Leitor de Cupom PMC

Lê a foto de um cupom de farmácia e mostra, para cada medicamento, os dados da Lista PMC (CMED/ANVISA): substância, produto, classe terapêutica, tipo de produto, tarja e se a venda exige receita.

## Estrutura

```
public/                 ← pasta publicada (Build output directory)
  index.html            ← o aplicativo
  data/pmc.json         ← lista compacta usada pelo app (sem linhas repetidas)
  data/lista_pmc.json   ← lista completa com as 5 colunas (referência; o app não usa)
functions/
  api/ler-cupom.js      ← função que envia a imagem para a API do Gemini (Google)
```

## Publicar no Cloudflare Pages

1. Suba esta pasta inteira para um repositório no GitHub (com `public/` e `functions/` na raiz).
2. No Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** e escolha o repositório.
3. Configuração do build:
   - Framework preset: **None**
   - Build command: *(deixe vazio)*
   - Build output directory: **public**
4. Crie uma chave gratuita do Gemini em https://aistudio.google.com/apikey (basta uma conta Google, sem cartão).
5. Em **Settings → Variables and Secrets**, adicione (em Production):
   - `GEMINI_API_KEY` — a chave criada no passo 4 (tipo **Secret**).
   - `ACCESS_CODE` — *(opcional, recomendado)* um código qualquer. Se definido, o app pede esse código antes de ler a imagem, para que estranhos não consumam sua cota.
   - `GEMINI_MODEL` — *(opcional)* modelo usado. Padrão: `gemini-flash-latest`. Para mais cota diária, use `gemini-flash-lite-latest`.
6. Depois de salvar as variáveis, faça um novo deploy (**Deployments → Retry deployment**) para elas valerem.

## Limites e privacidade da camada gratuita

- A cota gratuita tem limite de leituras por minuto e por dia (veja o valor atual no Google AI Studio). Quando estoura, o app avisa e usa o leitor offline.
- Na camada gratuita o Google pode usar as imagens enviadas para melhorar seus modelos, e revisores humanos podem vê-las. Cupons podem ter CPF e nome do cliente: **recorte ou cubra esses dados antes de enviar**, ou ative o faturamento no projeto do Google para sair da camada gratuita.

## Como a leitura funciona

- **Gemini (padrão):** a imagem é reduzida no navegador e enviada para `/api/ler-cupom`, que chama a API do Gemini. A chave fica só no Cloudflare, nunca no HTML.
- **Leitor offline (Tesseract.js):** roda no próprio navegador, sem custo, mas lê pior cupons térmicos. É usado quando você escolhe essa opção ou automaticamente se a função falhar (por exemplo, sem chave configurada).
- Em qualquer caso, você pode corrigir os nomes no campo 2 e consultar de novo.

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
