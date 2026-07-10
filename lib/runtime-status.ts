import { query } from "./db";
import { getArchiveId } from "./workspace-store";

export type RuntimeStatus = {
  product: "KinSleuth";
  version: "0.17.2";
  database: {
    configured: boolean;
    connected: boolean;
    archiveId: string;
    archiveCount: number;
    peopleCount: number;
    caseCount: number;
    aiRunCount: number;
    error?: string;
  };
  ai: {
    configured: boolean;
    baseUrl: string;
    chatModel: string;
    embeddingModel: string;
    mode: "responses" | "chat";
  };
};

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  const archiveId = getArchiveId();
  const ai = getAIStatus();

  if (!databaseUrl) {
    return {
      product: "KinSleuth",
      version: "0.17.2",
      ai,
      database: {
        configured: false,
        connected: false,
        archiveId,
        archiveCount: 0,
        peopleCount: 0,
        caseCount: 0,
        aiRunCount: 0,
        error: "DATABASE_URL is not configured"
      }
    };
  }

  try {
    const result = await query<{
      archive_count: string;
      people_count: string;
      case_count: string;
      ai_run_count: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM archives) AS archive_count,
        (SELECT COUNT(*) FROM people WHERE archive_id = $1) AS people_count,
        (SELECT COUNT(*) FROM research_cases WHERE archive_id = $1) AS case_count,
        (SELECT COUNT(*) FROM ai_runs WHERE archive_id = $1) AS ai_run_count`,
      [archiveId],
      { databaseUrl }
    );
    const row = result.rows[0];

    return {
      product: "KinSleuth",
      version: "0.17.2",
      ai,
      database: {
        configured: true,
        connected: true,
        archiveId,
        archiveCount: Number(row?.archive_count ?? 0),
        peopleCount: Number(row?.people_count ?? 0),
        caseCount: Number(row?.case_count ?? 0),
        aiRunCount: Number(row?.ai_run_count ?? 0)
      }
    };
  } catch (error) {
    return {
      product: "KinSleuth",
      version: "0.17.2",
      ai,
      database: {
        configured: true,
        connected: false,
        archiveId,
        archiveCount: 0,
        peopleCount: 0,
        caseCount: 0,
        aiRunCount: 0,
        error: error instanceof Error ? error.message : "Database health check failed"
      }
    };
  }
}

export function getAIStatus(): RuntimeStatus["ai"] {
  return {
    configured: Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY),
    baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
    embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    mode: process.env.AI_API_MODE === "chat" ? "chat" : "responses"
  };
}
