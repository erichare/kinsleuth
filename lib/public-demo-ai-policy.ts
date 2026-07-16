export const publicDemoAiPrompts = Object.freeze({
  case_next_steps:
    "Using only the selected fictional research case and its cited evidence, identify the next three verification steps and explain what each could establish.",
  evidence_gaps:
    "Using only this fictional sandbox, identify the most important evidence gaps, distinguish missing evidence from contradictory evidence, and cite the relevant saved records.",
  dna_cluster_summary:
    "Using only the fictional DNA matches and documentary context in this sandbox, summarize the cluster, its uncertainty, and the documentary checks needed before drawing a relationship conclusion."
});

export type PublicDemoAiPromptId = keyof typeof publicDemoAiPrompts;

export const publicDemoAiLimits = Object.freeze({
  attemptsPerSession: 3,
  attemptsPerDay: 150,
  concurrentCalls: 5,
  timeoutMs: 20_000,
  maximumOutputTokens: 800
});

type AiUsage = {
  sessionAttempts: number;
  dailyAttempts: number;
  activeCalls: number;
};

export type PublicDemoAiReservation =
  | {
      allowed: true;
      sessionAttempts: number;
      dailyAttempts: number;
      activeCalls: number;
      remainingSessionAttempts: number;
    }
  | {
      allowed: false;
      reason: "session-limit" | "daily-limit" | "concurrency-limit";
      retryAfterSeconds: number;
    };

export function reservePublicDemoAiAttempt(usage: AiUsage): PublicDemoAiReservation {
  validateUsage(usage);
  if (usage.sessionAttempts >= publicDemoAiLimits.attemptsPerSession) {
    return { allowed: false, reason: "session-limit", retryAfterSeconds: 0 };
  }
  if (usage.dailyAttempts >= publicDemoAiLimits.attemptsPerDay) {
    return { allowed: false, reason: "daily-limit", retryAfterSeconds: 3600 };
  }
  if (usage.activeCalls >= publicDemoAiLimits.concurrentCalls) {
    return { allowed: false, reason: "concurrency-limit", retryAfterSeconds: 5 };
  }

  const sessionAttempts = usage.sessionAttempts + 1;
  return {
    allowed: true,
    sessionAttempts,
    dailyAttempts: usage.dailyAttempts + 1,
    activeCalls: usage.activeCalls + 1,
    remainingSessionAttempts: publicDemoAiLimits.attemptsPerSession - sessionAttempts
  };
}

function validateUsage(usage: AiUsage): void {
  for (const [label, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Public demo AI ${label} must be a nonnegative integer.`);
    }
  }
}
