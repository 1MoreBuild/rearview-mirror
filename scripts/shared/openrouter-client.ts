export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  siteUrl?: string;
  siteName?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function chatCompletion(
  config: OpenRouterConfig,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
  },
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  if (config.siteUrl) headers["HTTP-Referer"] = config.siteUrl;
  if (config.siteName) headers["X-Title"] = config.siteName;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };

  if (options?.temperature !== undefined)
    body.temperature = options.temperature;
  if (options?.maxTokens) body.max_tokens = options.maxTokens;
  if (options?.responseFormat) body.response_format = options.responseFormat;

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    { method: "POST", headers, body: JSON.stringify(body) },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error ${response.status}: ${errorText}`,
    );
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned empty response");
  }

  return content;
}
