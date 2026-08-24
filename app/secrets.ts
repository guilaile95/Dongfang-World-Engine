const REDACTED = "[redacted]";

export function redactSecret(value: string, secret: string): string {
  if (!secret) {
    return value;
  }
  return value.split(secret).join(REDACTED);
}

export function assertNoSecret(value: string, secret: string, label: string): void {
  if (secret && value.includes(secret)) {
    throw new Error(`${label} would leak a credential`);
  }
}

export function publicFields(input: {
  baseUrl: string;
  model: string;
  worldFile: string;
  apiKey: string;
}): Record<string, string> {
  return {
    baseUrl: input.baseUrl,
    model: input.model,
    worldFile: input.worldFile,
    apiKey: input.apiKey ? REDACTED : "",
  };
}
