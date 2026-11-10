// Cloudflare Pages Function: POST /api/ler-cupom
// Dois modos, ambos com a API do Google Gemini (camada gratuita do Google AI Studio):
//   1) Ler cupom:   { image: <base64>, mediaType: "image/jpeg" }
//                   -> { itens: [{ linha, ean, nome, indicacao }] }
//   2) Para que serve: { produtos: [{ nome, substancia?, classe? }] }
//                   -> { indicacoes: [{ nome, indicacao }] }
// Variáveis de ambiente (Cloudflare > Pages > Settings > Variables and Secrets):
//   GEMINI_API_KEY  (obrigatória, tipo Secret) — crie em https://aistudio.google.com/apikey
//   GEMINI_MODEL    (opcional; padrão "gemini-flash-latest")
//   ACCESS_CODE     (opcional; se definida, o app pede este código antes de ler)

const DEFAULT_MODEL = "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-2.5-flash";
const MAX_BASE64 = 6_500_000; // ~4,8 MB de imagem
const MAX_PRODUTOS = 30;

const REGRA_INDICACAO = `"indicacao": em português simples, 1 ou 2 frases curtas dizendo para que o produto serve, conforme a indicação da bula ou do rótulo (ex.: "Suplemento de cálcio e vitamina D, indicado para complementar a ingestão desses nutrientes e ajudar na saúde dos ossos."). Não dê dose, posologia nem recomendação de uso. Se não reconhecer o produto com segurança, escreva "" em vez de adivinhar.`;

const PROMPT_CUPOM = `A imagem é a captura de um cupom fiscal / nota de farmácia (Brasil).
Liste TODOS os produtos vendidos no cupom (medicamentos, vitaminas, suplementos e qualquer outro item da lista de produtos). Não inclua linhas de totais, pagamento, cabeçalho ou rodapé.
Para cada produto informe:
- "linha": a descrição do item exatamente como aparece no cupom;
- "ean": o código numérico do item (código de barras com 8 ou 13 dígitos, normalmente antes da descrição), ou "" se não houver;
- "nome": o nome comercial do produto OU a substância, por extenso e sem abreviações, sem dosagem, forma farmacêutica, quantidade ou laboratório. Expanda abreviações comuns de cupom (ex.: "DIPIR SOD" -> "DIPIRONA SODICA", "AMOXIC" -> "AMOXICILINA", "LOSART POT" -> "LOSARTANA POTASSICA"). Se o item for um genérico, use o nome da substância.
- ${REGRA_INDICACAO}
Não inclua dados pessoais do cupom (nome, CPF, endereço).
Responda apenas com um array JSON, por exemplo:
[{"linha":"7896094921139 ADDERA CAL 2.000UI FR CPD/90","ean":"7896094921139","nome":"ADDERA CAL","indicacao":"Suplemento de cálcio e vitamina D, indicado para complementar a ingestão desses nutrientes e ajudar na saúde dos ossos."}]
Se não houver produtos legíveis, responda [].`;

const promptIndicacao = (produtos) => `Para cada produto de farmácia vendido no Brasil listado abaixo, diga para que ele serve.
Quando houver, use a substância e a classe terapêutica informadas como referência.
Para cada um, devolva "nome" (igual ao recebido) e ${REGRA_INDICACAO}
Responda apenas com um array JSON na mesma ordem, por exemplo:
[{"nome":"ADDERA D3","indicacao":"Vitamina D (colecalciferol), indicada para prevenir e tratar a deficiência de vitamina D."}]

Produtos:
${produtos.map((p, i) => `${i + 1}. ${p.nome}${p.substancia ? ` | substância: ${p.substancia}` : ""}${p.classe ? ` | classe: ${p.classe}` : ""}`).join("\n")}`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function gemini(env, parts) {
  const call = (model) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
      }),
    });

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  let resp = await call(model);
  // Se o modelo configurado não existir, tenta um modelo Flash conhecido
  if (resp.status === 404 && model !== FALLBACK_MODEL) resp = await call(FALLBACK_MODEL);

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw { status: 429, erro: "Limite gratuito do Gemini atingido. Aguarde um minuto (ou até amanhã, se for o limite diário).", codigo: "quota" };
    throw { status: 502, erro: data?.error?.message || `Erro ${resp.status} na API do Gemini`, codigo: "api" };
  }
  const cand = data?.candidates?.[0];
  if (!cand) {
    const motivo = data?.promptFeedback?.blockReason;
    throw { status: 502, erro: motivo ? `Pedido recusado pelo Gemini (${motivo}).` : "O Gemini não retornou resposta.", codigo: "empty" };
  }
  const text = (cand.content?.parts || []).map(p => p.text || "").join("\n");
  try {
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    const arr = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    throw { status: 502, erro: "Resposta do Gemini em formato inesperado.", codigo: "parse" };
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return json({ erro: "GEMINI_API_KEY não configurada no Cloudflare.", codigo: "config" }, 500);
  }
  if (env.ACCESS_CODE && request.headers.get("x-codigo-acesso") !== env.ACCESS_CODE) {
    return json({ erro: "Código de acesso inválido.", codigo: "auth" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ erro: "Corpo da requisição inválido." }, 400); }

  try {
    // Modo 2: para que serve (só texto)
    if (Array.isArray(body?.produtos)) {
      const produtos = body.produtos.slice(0, MAX_PRODUTOS)
        .map(p => ({ nome: clip(p?.nome, 120), substancia: clip(p?.substancia, 200), classe: clip(p?.classe, 120) }))
        .filter(p => p.nome);
      if (!produtos.length) return json({ indicacoes: [] });
      const arr = await gemini(env, [{ text: promptIndicacao(produtos) }]);
      const indicacoes = produtos.map((p, i) => {
        const hit = arr.find(o => clip(o?.nome, 120).toUpperCase() === p.nome.toUpperCase()) || arr[i] || {};
        return { nome: p.nome, indicacao: clip(hit.indicacao, 400) };
      });
      return json({ indicacoes });
    }

    // Modo 1: ler cupom
    const image = typeof body?.image === "string" ? body.image : "";
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body?.mediaType) ? body.mediaType : "image/jpeg";
    if (!image) return json({ erro: "Imagem não enviada." }, 400);
    if (image.length > MAX_BASE64) return json({ erro: "Imagem muito grande." }, 413);

    const arr = await gemini(env, [
      { inline_data: { mime_type: mediaType, data: image } },
      { text: PROMPT_CUPOM },
    ]);
    const itens = arr
      .filter(o => o && (o.nome || o.linha))
      .map(o => ({
        linha: clip(o.linha, 200),
        nome: clip(o.nome || o.linha, 120),
        ean: String(o.ean || "").replace(/\D/g, "").slice(0, 14),
        indicacao: clip(o.indicacao, 400),
      }));
    return json({ itens });
  } catch (e) {
    if (e && e.erro) return json({ erro: e.erro, codigo: e.codigo }, e.status || 502);
    return json({ erro: "Falha inesperada na função.", codigo: "erro" }, 500);
  }
}
