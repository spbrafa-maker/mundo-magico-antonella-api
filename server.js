import express from "express";

const app = express();
app.use(express.json({ limit: "3mb" }));

const key = process.env.OPENAI_API_KEY;
const storyModel = process.env.STORY_MODEL || "gpt-6-luna";
const imageModel = process.env.IMAGE_MODEL || "gpt-image-2";
const ttsModel = process.env.TTS_MODEL || "gpt-4o-mini-tts";

app.get("/", (_req, res) => res.json({ service: "Mundo Magico da Antonella API", ok: true, version: "0.1.8.1" }));
app.get("/health", (_req, res) => res.json({ ok: true, version: "0.1.8.1" }));

function requireKey(res) {
  if (key) return true;
  res.status(503).json({ error: "OPENAI_API_KEY_not_configured" });
  return false;
}

app.post("/narration", async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const input = String(req.body?.text || "").trim().slice(0, 3500);
    if (!input) return res.status(400).json({ error: "text_required" });

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModel,
        voice: "coral",
        input,
        instructions: "Fale em português do Brasil como uma contadora de histórias infantil. Voz feminina suave, acolhedora, natural, calorosa e expressiva. Ritmo calmo, sorriso perceptível na voz e pausas delicadas. Evite qualquer entonação de GPS, robótica ou de locução comercial.",
        response_format: "mp3"
      })
    });
    if (!r.ok) return res.status(502).send(await r.text());
    res.type("audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error("narration", e);
    res.status(500).json({ error: "narration_failed" });
  }
});

app.post("/story", async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const x = req.body || {};
    const characterBible = `ANTONELLA: menina de aproximadamente 5 anos, pele clara, cabelos longos castanho-avermelhados, laço rosa grande e roupa infantil rosa; alegre e expressiva. CACHORRINHO: pequeno, branco e caramelo, olhos grandes, coleira rosa com pingente de coração. TOM TOM: guia mágica infantil do mesmo universo visual. Preserve as características, roupas e identidade visual em TODAS as cenas.`;
    const prompt = `Crie uma história infantil interativa em português do Brasil para uma criança de aproximadamente 5 anos. Protagonista: Antonella. Guia: Tom Tom. Ideia da criança: ${String(x.idea || "").slice(0,1000)}. Personagens: ${String(x.character || "").slice(0,500)}. Lugar: ${String(x.setting || "").slice(0,500)}. Missão: ${String(x.goal || "").slice(0,500)}. Faça exatamente 8 páginas curtas, adequadas para narração, sem publicidade, sem pedir dados pessoais e sem medo intenso ou conteúdo impróprio. Para CADA página crie também um imagePrompt autossuficiente em português descrevendo exatamente a cena para uma ilustração vertical 3D cinematográfica infantil de alta qualidade. ${characterBible} Não inclua letras, legendas, logotipos ou texto nas imagens. Mantenha continuidade de personagens, roupa, objetos e cenário. Retorne SOMENTE JSON válido no formato: {"title":"...","pages":[{"narration":"...","caption":"até 6 palavras","imagePrompt":"descrição visual completa"}]}.`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: storyModel, input: prompt })
    });
    if (!r.ok) return res.status(502).send(await r.text());
    const j = await r.json();
    const out = (j.output || []).flatMap(i => i.content || []).find(c => c.type === "output_text")?.text || "";
    const clean = out.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed?.title || !Array.isArray(parsed?.pages) || parsed.pages.length !== 8) throw new Error("invalid_story_shape");
    res.json(parsed);
  } catch (e) {
    console.error("story", e);
    res.status(500).json({ error: "story_failed" });
  }
});

app.post("/image", async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const prompt = String(req.body?.prompt || "").trim().slice(0, 7000);
    if (!prompt) return res.status(400).json({ error: "prompt_required" });
    const finalPrompt = `Ilustração vertical para livro infantil interativo. ${prompt}. Estética 3D cinematográfica premium, cores vivas, iluminação mágica suave, composição clara para tela de celular, personagens expressivos e amigáveis, detalhes ricos. Sem texto, sem letras, sem logotipos e sem marca d'água.`;

    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: imageModel, prompt: finalPrompt, size: "1024x1536", quality: "medium", output_format: "png" })
    });
    if (!r.ok) return res.status(502).send(await r.text());
    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: "image_missing" });
    res.type("image/png");
    res.send(Buffer.from(b64, "base64"));
  } catch (e) {
    console.error("image", e);
    res.status(500).json({ error: "image_failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mundo Magico Antonella API ativa na porta ${port}`));
