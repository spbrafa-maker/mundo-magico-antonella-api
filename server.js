import express from "express";

const app = express();
app.use(express.json({ limit: "3mb" }));

const key = process.env.OPENAI_API_KEY;
const storyModel = process.env.STORY_MODEL || "gpt-6-luna";
const imageModel = process.env.IMAGE_MODEL || "gpt-image-2";
const ttsModel = process.env.TTS_MODEL || "gpt-4o-mini-tts";

app.get("/", (_req, res) =>
  res.json({
    service: "Mundo Magico da Antonella API",
    ok: true,
    version: "0.1.8.2"
  })
);

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    version: "0.1.8.2"
  })
);

function requireKey(res) {
  if (key) return true;

  res.status(503).json({
    error: "OPENAI_API_KEY_not_configured"
  });

  return false;
}

async function openAIError(route, response) {
  const body = await response.text();

  console.error(`OPENAI_${route}_ERROR`, {
    status: response.status,
    statusText: response.statusText,
    body
  });

  return {
    status: response.status,
    statusText: response.statusText,
    body
  };
}

/* =========================================================
   NARRAÇÃO
   ========================================================= */

app.post("/narration", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const input = String(req.body?.text || "")
      .trim()
      .slice(0, 3500);

    if (!input) {
      return res.status(400).json({
        error: "text_required"
      });
    }

    const r = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: ttsModel,
          voice: "coral",
          input,
          instructions:
            "Fale em português do Brasil como uma contadora de histórias infantil. Voz feminina suave, acolhedora, natural, calorosa e expressiva. Ritmo calmo, sorriso perceptível na voz e pausas delicadas. Evite entonação robótica, de GPS ou de locução comercial.",
          response_format: "mp3"
        })
      }
    );

    if (!r.ok) {
      const erro = await openAIError("NARRATION", r);

      return res.status(502).json({
        error: "openai_narration_error",
        openai_status: erro.status,
        details: erro.body
      });
    }

    res.type("audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));

  } catch (e) {
    console.error("NARRATION_INTERNAL_ERROR", e);

    res.status(500).json({
      error: "narration_failed",
      message: e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   HISTÓRIA
   ========================================================= */

app.post("/story", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const x = req.body || {};

    const characterBible = `
ANTONELLA:
menina de aproximadamente 5 anos,
pele clara,
cabelos longos castanho-avermelhados,
laço rosa grande,
roupa infantil rosa,
alegre e expressiva.

CACHORRINHO:
pequeno,
branco e caramelo,
olhos grandes,
coleira rosa com pingente de coração.

TOM TOM:
guia mágica infantil do mesmo universo visual.

Preserve as características,
roupas e identidade visual
em TODAS as cenas.
`;

    const prompt = `
Crie uma história infantil interativa em português do Brasil
para uma criança de aproximadamente 5 anos.

Protagonista: Antonella.
Guia: Tom Tom.

Ideia da criança:
${String(x.idea || "").slice(0, 1000)}

Personagens:
${String(x.character || "").slice(0, 500)}

Lugar:
${String(x.setting || "").slice(0, 500)}

Missão:
${String(x.goal || "").slice(0, 500)}

Crie EXATAMENTE 8 páginas curtas.

Cada página deve:
- ser adequada para narração;
- ter linguagem infantil;
- continuar naturalmente a página anterior;
- evitar medo intenso;
- não conter publicidade;
- não solicitar dados pessoais.

Para CADA página crie também um "imagePrompt"
autossuficiente descrevendo exatamente a cena.

As ilustrações deverão seguir:
- formato vertical;
- livro infantil;
- estética 3D cinematográfica;
- alta qualidade;
- personagens amigáveis;
- continuidade visual.

${characterBible}

Não inclua:
- letras;
- legendas;
- logotipos;
- marcas d'água;
- textos dentro das imagens.

Retorne SOMENTE JSON válido.

Formato obrigatório:

{
  "title": "Título da história",
  "pages": [
    {
      "narration": "Texto narrado",
      "caption": "máximo 6 palavras",
      "imagePrompt": "descrição visual completa"
    }
  ]
}
`;

    console.log("STORY_REQUEST", {
      model: storyModel,
      ideaLength: String(x.idea || "").length
    });

    const r = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: storyModel,
          input: prompt
        })
      }
    );

    if (!r.ok) {
      const erro = await openAIError("STORY", r);

      return res.status(502).json({
        error: "openai_story_error",
        openai_status: erro.status,
        details: erro.body
      });
    }

    const j = await r.json();

    const out =
      (j.output || [])
        .flatMap(item => item.content || [])
        .find(content => content.type === "output_text")
        ?.text || "";

    if (!out) {
      console.error(
        "STORY_EMPTY_OUTPUT",
        JSON.stringify(j).slice(0, 4000)
      );

      return res.status(502).json({
        error: "story_empty_output"
      });
    }

    const clean = out
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(clean);
    } catch (parseError) {
      console.error("STORY_JSON_PARSE_ERROR", {
        message: parseError.message,
        output: clean.slice(0, 4000)
      });

      return res.status(502).json({
        error: "story_invalid_json",
        message: parseError.message
      });
    }

    if (
      !parsed?.title ||
      !Array.isArray(parsed?.pages) ||
      parsed.pages.length !== 8
    ) {
      console.error("STORY_INVALID_SHAPE", {
        title: parsed?.title,
        pages: parsed?.pages?.length
      });

      return res.status(502).json({
        error: "invalid_story_shape",
        pages_received: parsed?.pages?.length ?? 0
      });
    }

    console.log("STORY_SUCCESS", {
      title: parsed.title,
      pages: parsed.pages.length
    });

    res.json(parsed);

  } catch (e) {
    console.error("STORY_INTERNAL_ERROR", {
      message: e?.message,
      stack: e?.stack
    });

    res.status(500).json({
      error: "story_failed",
      message: e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   IMAGEM
   ========================================================= */

app.post("/image", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt = String(req.body?.prompt || "")
      .trim()
      .slice(0, 7000);

    if (!prompt) {
      return res.status(400).json({
        error: "prompt_required"
      });
    }

    const finalPrompt = `
Ilustração vertical para livro infantil interativo.

${prompt}

Estética:
3D cinematográfica premium,
cores vivas,
iluminação mágica suave,
composição clara para tela de celular,
personagens expressivos e amigáveis,
detalhes ricos.

Sem texto.
Sem letras.
Sem logotipos.
Sem marca d'água.
`;

    const r = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: imageModel,
          prompt: finalPrompt,
          size: "1024x1536",
          quality: "medium",
          output_format: "png"
        })
      }
    );

    if (!r.ok) {
      const erro = await openAIError("IMAGE", r);

      return res.status(502).json({
        error: "openai_image_error",
        openai_status: erro.status,
        details: erro.body
      });
    }

    const j = await r.json();
    const b64 = j.data?.[0]?.b64_json;

    if (!b64) {
      console.error(
        "IMAGE_MISSING_DATA",
        JSON.stringify(j).slice(0, 2000)
      );

      return res.status(502).json({
        error: "image_missing"
      });
    }

    res.type("image/png");
    res.send(Buffer.from(b64, "base64"));

  } catch (e) {
    console.error("IMAGE_INTERNAL_ERROR", {
      message: e?.message,
      stack: e?.stack
    });

    res.status(500).json({
      error: "image_failed",
      message: e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   SERVIDOR
   ========================================================= */

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(
    `Mundo Magico Antonella API v0.1.8.2 ativa na porta ${port}`
  );
});
