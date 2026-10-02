import express from "express";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const app = express();
app.use(express.json({ limit: "3mb" }));

const key = process.env.OPENAI_API_KEY;

const storyModel =
  process.env.STORY_MODEL || "gpt-6-luna";

const imageModel =
  process.env.IMAGE_MODEL || "gpt-image-2";

const ttsModel =
  process.env.TTS_MODEL || "gpt-4o-mini-tts";

const VERSION = "0.1.8.3";

/* =========================================================
   CONFIGURAÇÕES DE ÁUDIO
   ========================================================= */

const STORY_MUSIC = path.join(
  process.cwd(),
  "audio",
  "magic_story.mp3"
);

const NARRATOR_INSTRUCTIONS = `
Fale em português do Brasil como uma contadora de histórias infantil.

Use uma voz feminina suave, acolhedora, natural, calorosa e expressiva.

Conte a história como alguém que realmente ama contar histórias
para uma criança pequena.

Use ritmo tranquilo e envolvente.

Demonstre:
- encantamento nas cenas mágicas;
- curiosidade nas descobertas;
- alegria nos momentos felizes;
- suspense leve nas aventuras;
- ternura nos momentos emocionantes.

Faça pequenas pausas naturais.

Tenha um sorriso perceptível na voz.

Não soe como:
- assistente virtual;
- GPS;
- locução comercial;
- leitura mecânica.

A interpretação deve lembrar a atmosfera de um grande conto
infantil cinematográfico de fantasia, mas possuir identidade própria.
`.trim();

/* =========================================================
   HOME / HEALTH
   ========================================================= */

app.get("/", (_req, res) => {
  res.json({
    service: "Mundo Magico da Antonella API",
    ok: true,
    version: VERSION,
    features: [
      "story",
      "image",
      "narration",
      "soundscape"
    ]
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    ffmpeg: Boolean(ffmpegPath)
  });
});

/* =========================================================
   HELPERS
   ========================================================= */

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

async function generateNarrationBuffer(text) {
  if (!key) {
    const error = new Error(
      "OPENAI_API_KEY_not_configured"
    );

    error.code = "OPENAI_API_KEY_not_configured";
    throw error;
  }

  const input = String(text || "")
    .trim()
    .slice(0, 3500);

  if (!input) {
    const error = new Error("text_required");
    error.code = "text_required";
    throw error;
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
        instructions: NARRATOR_INSTRUCTIONS,
        response_format: "mp3"
      })
    }
  );

  if (!r.ok) {
    const erro = await openAIError(
      "NARRATION",
      r
    );

    const error = new Error(
      "openai_narration_error"
    );

    error.code = "openai_narration_error";
    error.openaiStatus = erro.status;
    error.details = erro.body;

    throw error;
  }

  return Buffer.from(
    await r.arrayBuffer()
  );
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(
        new Error("ffmpeg_not_available")
      );
    }

    const processFFmpeg = spawn(
      ffmpegPath,
      args,
      {
        stdio: [
          "ignore",
          "ignore",
          "pipe"
        ]
      }
    );

    let stderr = "";

    processFFmpeg.stderr.on(
      "data",
      chunk => {
        stderr += chunk.toString();
      }
    );

    processFFmpeg.on(
      "error",
      error => {
        reject(error);
      }
    );

    processFFmpeg.on(
      "close",
      code => {
        if (code === 0) {
          resolve();
          return;
        }

        const error = new Error(
          `ffmpeg_exit_${code}`
        );

        error.stderr =
          stderr.slice(-6000);

        reject(error);
      }
    );
  });
}

/* =========================================================
   NARRAÇÃO
   ========================================================= */

app.post("/narration", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const input = String(
      req.body?.text || ""
    )
      .trim()
      .slice(0, 3500);

    if (!input) {
      return res.status(400).json({
        error: "text_required"
      });
    }

    const audio =
      await generateNarrationBuffer(input);

    res.type("audio/mpeg");
    res.send(audio);

  } catch (e) {
    console.error(
      "NARRATION_INTERNAL_ERROR",
      {
        message: e?.message,
        stack: e?.stack
      }
    );

    if (
      e?.code ===
      "openai_narration_error"
    ) {
      return res.status(502).json({
        error:
          "openai_narration_error",
        openai_status:
          e.openaiStatus,
        details:
          e.details
      });
    }

    res.status(500).json({
      error: "narration_failed",
      message:
        e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   SOUNDSCAPE
   VOZ + TRILHA MÁGICA
   ========================================================= */

app.post("/soundscape", async (req, res) => {
  let tempDir = null;

  try {
    if (!requireKey(res)) return;

    const input = String(
      req.body?.text || ""
    )
      .trim()
      .slice(0, 3500);

    if (!input) {
      return res.status(400).json({
        error: "text_required"
      });
    }

    try {
      await fs.access(STORY_MUSIC);
    } catch {
      console.error(
        "SOUNDSCAPE_MUSIC_NOT_FOUND",
        STORY_MUSIC
      );

      return res.status(500).json({
        error: "background_music_not_found",
        expected: "audio/magic_story.mp3"
      });
    }

    console.log("SOUNDSCAPE_REQUEST", {
      textLength: input.length,
      music: "magic_story.mp3"
    });

    /*
      1. Gera a narração usando exatamente
         a mesma narradora do /narration.
    */

    const narrationBuffer =
      await generateNarrationBuffer(input);

    /*
      2. Cria diretório temporário exclusivo
         para esta requisição.
    */

    tempDir = await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        `antonella-${crypto.randomUUID()}-`
      )
    );

    const narrationFile =
      path.join(
        tempDir,
        "narration.mp3"
      );

    const outputFile =
      path.join(
        tempDir,
        "soundscape.mp3"
      );

    await fs.writeFile(
      narrationFile,
      narrationBuffer
    );

    /*
      MIXAGEM

      Entrada 0:
      narração.

      Entrada 1:
      música mágica em loop.

      A música fica em aproximadamente
      10% do volume original.

      A voz permanece em primeiro plano.

      Fade-in curto evita que a música
      entre abruptamente.

      O áudio termina quando a narração
      terminar.
    */

    const filter = [
      "[0:a]volume=1.0[voice]",
      "[1:a]volume=0.10,afade=t=in:st=0:d=2[music]",
      "[voice][music]amix=inputs=2:duration=first:dropout_transition=2[mix]"
    ].join(";");

    await runFFmpeg([
      "-y",

      "-i",
      narrationFile,

      "-stream_loop",
      "-1",
      "-i",
      STORY_MUSIC,

      "-filter_complex",
      filter,

      "-map",
      "[mix]",

      "-c:a",
      "libmp3lame",

      "-b:a",
      "192k",

      "-ar",
      "44100",

      "-ac",
      "2",

      outputFile
    ]);

    const finalAudio =
      await fs.readFile(outputFile);

    console.log(
      "SOUNDSCAPE_SUCCESS",
      {
        bytes: finalAudio.length
      }
    );

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Disposition":
        'inline; filename="antonella_soundscape.mp3"',
      "Cache-Control": "no-store"
    });

    res.send(finalAudio);

  } catch (e) {
    console.error(
      "SOUNDSCAPE_INTERNAL_ERROR",
      {
        message: e?.message,
        stack: e?.stack,
        ffmpeg:
          e?.stderr?.slice(-3000)
      }
    );

    if (
      e?.code ===
      "openai_narration_error"
    ) {
      return res.status(502).json({
        error:
          "openai_narration_error",
        openai_status:
          e.openaiStatus,
        details:
          e.details
      });
    }

    res.status(500).json({
      error: "soundscape_failed",
      message:
        e?.message || "unknown_error"
    });

  } finally {
    if (tempDir) {
      try {
        await fs.rm(
          tempDir,
          {
            recursive: true,
            force: true
          }
        );
      } catch (cleanupError) {
        console.error(
          "SOUNDSCAPE_CLEANUP_ERROR",
          cleanupError?.message
        );
      }
    }
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

    console.log(
      "STORY_REQUEST",
      {
        model: storyModel,
        ideaLength:
          String(x.idea || "").length
      }
    );

    const r = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          model: storyModel,
          input: prompt
        })
      }
    );

    if (!r.ok) {
      const erro =
        await openAIError(
          "STORY",
          r
        );

      return res.status(502).json({
        error:
          "openai_story_error",
        openai_status:
          erro.status,
        details:
          erro.body
      });
    }

    const j = await r.json();

    const out =
      (j.output || [])
        .flatMap(
          item =>
            item.content || []
        )
        .find(
          content =>
            content.type ===
            "output_text"
        )
        ?.text || "";

    if (!out) {
      console.error(
        "STORY_EMPTY_OUTPUT",
        JSON.stringify(j).slice(
          0,
          4000
        )
      );

      return res.status(502).json({
        error:
          "story_empty_output"
      });
    }

    const clean = out
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /```\s*$/i,
        ""
      )
      .trim();

    let parsed;

    try {
      parsed =
        JSON.parse(clean);
    } catch (parseError) {
      console.error(
        "STORY_JSON_PARSE_ERROR",
        {
          message:
            parseError.message,
          output:
            clean.slice(
              0,
              4000
            )
        }
      );

      return res.status(502).json({
        error:
          "story_invalid_json",
        message:
          parseError.message
      });
    }

    if (
      !parsed?.title ||
      !Array.isArray(
        parsed?.pages
      ) ||
      parsed.pages.length !== 8
    ) {
      console.error(
        "STORY_INVALID_SHAPE",
        {
          title:
            parsed?.title,
          pages:
            parsed?.pages?.length
        }
      );

      return res.status(502).json({
        error:
          "invalid_story_shape",
        pages_received:
          parsed?.pages?.length ?? 0
      });
    }

    console.log(
      "STORY_SUCCESS",
      {
        title: parsed.title,
        pages:
          parsed.pages.length
      }
    );

    res.json(parsed);

  } catch (e) {
    console.error(
      "STORY_INTERNAL_ERROR",
      {
        message:
          e?.message,
        stack:
          e?.stack
      }
    );

    res.status(500).json({
      error: "story_failed",
      message:
        e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   IMAGEM
   ========================================================= */

app.post("/image", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt = String(
      req.body?.prompt || ""
    )
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
          Authorization:
            `Bearer ${key}`,
          "Content-Type":
            "application/json"
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
      const erro =
        await openAIError(
          "IMAGE",
          r
        );

      return res.status(502).json({
        error:
          "openai_image_error",
        openai_status:
          erro.status,
        details:
          erro.body
      });
    }

    const j = await r.json();

    const b64 =
      j.data?.[0]?.b64_json;

    if (!b64) {
      console.error(
        "IMAGE_MISSING_DATA",
        JSON.stringify(j).slice(
          0,
          2000
        )
      );

      return res.status(502).json({
        error: "image_missing"
      });
    }

    res.type("image/png");

    res.send(
      Buffer.from(
        b64,
        "base64"
      )
    );

  } catch (e) {
    console.error(
      "IMAGE_INTERNAL_ERROR",
      {
        message:
          e?.message,
        stack:
          e?.stack
      }
    );

    res.status(500).json({
      error: "image_failed",
      message:
        e?.message || "unknown_error"
    });
  }
});

/* =========================================================
   SERVIDOR
   ========================================================= */

const port =
  process.env.PORT || 3000;

app.listen(port, () => {
  console.log(
    `Mundo Magico Antonella API v${VERSION} ativa na porta ${port}`
  );

  console.log(
    "FFmpeg:",
    ffmpegPath
      ? "disponivel"
      : "indisponivel"
  );

  console.log(
    "Trilha:",
    STORY_MUSIC
  );
});
