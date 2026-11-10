// Cloudflare Pages Function: POST /api/ler-cupom
// Recebe { image: <base64>, mediaType: "image/jpeg" } e devolve { itens: [{ linha, nome }] }
// Usa a API do Google Gemini (camada gratuita do Google AI Studio).
// Variáveis de ambiente (Cloudflare > Pages > Settings > Variables and Secrets):
//   GEMINI_API_KEY  (obrigatória, tipo Secret) — crie em https://aistudio.google.com/apikey
//   GEMINI_MODEL    (opcional; padrão "gemini-flash-latest")
//   ACCESS_CODE     (opcional; se definida, o app pede este código antes de ler)

const DEFAULT_MODEL = "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-2.5-flash";
const MAX_BASE64 = 6_500_000; // ~4,8 MB de imagem

const PROMPT = `A imagem é a captura de um cupom fiscal / nota de farmácia (Brasil).
Liste TODOS os produtos vendidos no cupom (medicamentos, vitaminas, suplementos e qualquer outro item da lista de produtos). Não inclua linhas de totais, pagamento, cabeçalho ou rodapé.
Para cada produto informe:
- "linha": a descrição do item exatamente como aparece no cupom;
- "ean": o código numérico do item (código de barras com 8 ou 13 dígitos, normalmente antes da descrição), ou "" se não houver;
- "nome": o nome comercial do produto OU a substância, por extenso e sem abreviações, sem dosagem, forma farmacêutica, quantidade ou laboratório. Expanda abreviações comuns de cupom (ex.: "DIPIR SOD" -> "DIPIRONA SODICA", "AMOXIC" -> "AMOXICILINA", "LOSART POT" -> "LOSARTANA POTASSICA"). Se o item for um genérico, use o nome da substância.
Não inclua dados pessoais do cupom (nome, CPF, endereço).
Responda apenas com um array JSON, por exemplo:
[{"linha":"7896094921139 ADDERA CAL 2.000UI FR CPD/90","ean":"7896094921139","nome":"ADDERA CAL"},{"linha":"DIPIR SOD 500MG 10CP EMS","ean":"","nome":"DIPIRONA SODICA"}]
Se não houver produtos legíveis, responda [].`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function callGemini(model, key, image, mediaType) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mediaType, data: image } },
          { text: PROMPT },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
      },
    }),
  });
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
  const image = typeof body?.image === "string" ? body.image : "";
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(body?.mediaType) ? body.mediaType : "image/jpeg";
  if (!image) return json({ erro: "Imagem não enviada." }, 400);
  if (image.length > MAX_BASE64) return json({ erro: "Imagem muito grande." }, 413);

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  let resp = await callGemini(model, env.GEMINI_API_KEY, image, mediaType);
  // Se o modelo configurado não existir, tenta um modelo Flash conhecido
  if (resp.status === 404 && model !== FALLBACK_MODEL) {
    resp = await callGemini(FALLBACK_MODEL, env.GEMINI_API_KEY, image, mediaType);
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) {
      return json({ erro: "Limite gratuito do Gemini atingido. Aguarde um minuto (ou até amanhã, se for o limite diário).", codigo: "quota" }, 429);
    }
    const msg = data?.error?.message || `Erro ${resp.status} na API do Gemini`;
    return json({ erro: msg, codigo: "api" }, 502);
  }

  const cand = data?.candidates?.[0];
  if (!cand) {
    const motivo = data?.promptFeedback?.blockReason;
    return json({ erro: motivo ? `Imagem recusada pelo Gemini (${motivo}).` : "O Gemini não retornou resposta.", codigo: "empty" }, 502);
  }
  const text = (cand.content?.parts || []).map(p => p.text || "").join("\n");

  let itens = [];
  try {
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    itens = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : "[]");
  } catch {
    return json({ erro: "Resposta da leitura em formato inesperado.", codigo: "parse" }, 502);
  }
  if (!Array.isArray(itens)) itens = [];
  itens = itens
    .filter(o => o && (o.nome || o.linha))
    .map(o => ({ linha: String(o.linha || "").slice(0, 200), nome: String(o.nome || o.linha || "").slice(0, 120), ean: String(o.ean || "").replace(/\D/g, "").slice(0, 14) }));

  return json({ itens });
}
