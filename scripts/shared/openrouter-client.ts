const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

const model = "minimax/minimax-m2.5";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatCompletion(
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/rearview-mirror",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter API error ${response.status}: ${body}`,
    );
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  return data.choices[0].message.content;
}

export function getModelName(): string {
  return model;
}
