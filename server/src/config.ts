// Reads and checks the environment variables.
import dotenv from "dotenv";
dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Check your server/.env file. See server/.env.example for the required keys.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  mongodbUri: requireEnv("MONGODB_URI"),
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  // U-M GPT Toolkit gateway endpoint (for example https://api.toolkit.umgpt.umich.edu/v1)
  openaiApiBase: requireEnv("OPENAI_API_BASE"),
  adminToken: requireEnv("ADMIN_TOKEN"),
  // The Observer is part of the controller by default. "shadow" and "off" are
  // comparison modes.
  conversationObserverMode:
    process.env.CONVERSATION_OBSERVER_MODE === "off"
      ? ("off" as const)
      : process.env.CONVERSATION_OBSERVER_MODE === "shadow"
        ? ("shadow" as const)
        : process.env.CONVERSATION_OBSERVER_MODE === "active"
          ? ("active" as const)
          : ("active" as const),
  // How Alex decides when to speak. "ledger_active" is the normal mode: the
  // Observer's reading of the conversation feeds the ledger, and the ledger Judge
  // decides. "rule_based" and "ledger_shadow" are comparison modes.
  conversationControllerMode:
    process.env.CONVERSATION_CONTROLLER_MODE === "rule_based"
      ? ("rule_based" as const)
      : process.env.CONVERSATION_CONTROLLER_MODE === "ledger_shadow"
        ? ("ledger_shadow" as const)
        : process.env.CONVERSATION_CONTROLLER_MODE === "ledger_active"
          ? ("ledger_active" as const)
          : ("ledger_active" as const),
};
