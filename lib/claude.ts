import { GoogleGenAI } from "@google/genai";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

function getProvider() {
  return (process.env.LLM_PROVIDER || "openai").toLowerCase();
}

function extractProviderErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "The model request failed.";
  }

  const message = error.message || "The model request failed.";

  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
    return "Gemini free-tier quota has been exceeded. Wait a bit and try again, or switch to Ollama or a billed key.";
  }

  if (message.includes("ECONNREFUSED") || message.includes("127.0.0.1:11434")) {
    return "Ollama is not reachable. Start Ollama and make sure it is serving on http://127.0.0.1:11434.";
  }

  if (message.includes("Incorrect API key") || message.includes("invalid_api_key")) {
    return "The OpenAI API key is invalid. Double-check OPENAI_API_KEY and try again.";
  }

  if (message.includes("insufficient_quota")) {
    return "The OpenAI project does not have enough quota or billing enabled for this request.";
  }

  const jsonStart = message.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as {
        error?: { message?: string; status?: string };
      };
      if (parsed.error?.status === "RESOURCE_EXHAUSTED") {
        return "Gemini free-tier quota has been exceeded. Wait a bit and try again, or switch to Ollama or a billed key.";
      }
      if (parsed.error?.message) {
        return parsed.error.message;
      }
    } catch {
      // Fall back below.
    }
  }

  return message;
}

async function generateWithOpenAI(
  system: string,
  user: string,
  maxOutputTokens: number,
  responseJsonSchema?: unknown
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const modelName = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxOutputTokens,
      response_format: responseJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: "structured_response",
              strict: true,
              schema: responseJsonSchema,
            },
          }
        : { type: "json_object" },
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    error?: { message?: string; code?: string; type?: string };
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}.`);
  }

  const text = payload.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("OpenAI did not return a text response.");
  }

  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

async function generateWithGemini(
  system: string,
  user: string,
  maxOutputTokens: number,
  responseJsonSchema?: unknown
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema,
      maxOutputTokens,
      temperature: 0.2,
    },
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("The model did not return a text response.");
  }

  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

async function generateWithOllama(
  system: string,
  user: string,
  maxOutputTokens: number,
  responseJsonSchema?: unknown
) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: responseJsonSchema || "json",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: {
        temperature: 0.2,
        num_predict: maxOutputTokens,
      },
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    error?: string;
    message?: { content?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error || `Ollama request failed with status ${response.status}.`);
  }

  const text = payload.message?.content?.trim();

  if (!text) {
    throw new Error("Ollama did not return a text response.");
  }

  return text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
}

export async function generateJsonFromPrompt(
  system: string,
  user: string,
  maxOutputTokens = 4096,
  responseJsonSchema?: unknown
) {
  try {
    const provider = getProvider();

    if (provider === "gemini") {
      return await generateWithGemini(system, user, maxOutputTokens, responseJsonSchema);
    }

    if (provider === "ollama") {
      return await generateWithOllama(system, user, maxOutputTokens, responseJsonSchema);
    }

    return await generateWithOpenAI(system, user, maxOutputTokens, responseJsonSchema);
  } catch (error) {
    throw new Error(extractProviderErrorMessage(error));
  }
}
