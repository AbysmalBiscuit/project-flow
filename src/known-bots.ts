export const knownBots = ["grok", "codex", "greptile"] as const;
export type KnownBot = (typeof knownBots)[number];
