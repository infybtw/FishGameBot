export type Config = {
  botToken: string;
  adminUserId: number;
  catchSuccessChance: number;
  catchDelaySeconds: number;
  databaseUrl: string;
};

function readInt(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];

  const botToken = env.BOT_TOKEN;
  if (botToken === undefined || botToken.trim() === "") {
    problems.push("BOT_TOKEN must be a non-empty string");
  }

  const adminUserId = readInt(env.ADMIN_USER_ID);
  if (adminUserId === null) {
    problems.push("ADMIN_USER_ID must be an integer");
  }

  const catchSuccessChance = readInt(env.CATCH_SUCCESS_CHANCE);
  if (catchSuccessChance === null || catchSuccessChance < 0 || catchSuccessChance > 100) {
    problems.push("CATCH_SUCCESS_CHANCE must be an integer between 0 and 100");
  }

  const catchDelaySeconds = readInt(env.CATCH_DELAY);
  if (catchDelaySeconds === null || catchDelaySeconds < 0) {
    problems.push("CATCH_DELAY must be a non-negative integer");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl !== undefined && databaseUrl !== "" && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push("DATABASE_URL must be a postgres:// or postgresql:// connection string");
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
  }

  return {
    botToken: botToken!,
    adminUserId: adminUserId!,
    catchSuccessChance: catchSuccessChance!,
    catchDelaySeconds: catchDelaySeconds!,
    databaseUrl: databaseUrl || "postgres://localhost:5432/fishbot",
  };
}
