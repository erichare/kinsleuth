type PublicDemoAiGatewayExpectations = Readonly<{
  apiKeyId: string;
  monthlyBudgetUsd: number;
  teamId: string;
}>;

export function validatePublicDemoAiGatewayContract(
  value: unknown,
  expectations: PublicDemoAiGatewayExpectations
): Readonly<{
  currentSpendUsd: number;
  monthlyBudgetUsd: number;
}> {
  validateExpectations(expectations);
  const document = objectValue(value);
  if (!document || !Array.isArray(document.apiKeys)) {
    throw new Error("AI Gateway key metadata must contain an apiKeys array.");
  }
  validateCompletePage(document.pagination, document.apiKeys.length);

  const matchingKeys = document.apiKeys.filter((entry) => (
    objectValue(entry)?.id === expectations.apiKeyId
  ));
  if (matchingKeys.length !== 1) {
    throw new Error("AI Gateway key metadata must contain the dedicated demo key exactly once.");
  }

  const key = objectValue(matchingKeys[0]);
  const quota = objectValue(key?.quota);
  if (!key || !quota) {
    throw new Error("The dedicated demo AI Gateway key metadata is invalid.");
  }
  if (
    key.id !== expectations.apiKeyId
    || key.name !== "kinresolve-demo-production"
    || key.purpose !== "ai-gateway"
    || key.teamId !== expectations.teamId
    || key.projectId !== null
    || key.expiresAt !== null
    || key.leakedAt !== null
    || key.leakedUrl !== null
  ) {
    throw new Error("The dedicated demo AI Gateway key identity or safety state is invalid.");
  }
  if (
    quota.quotaEntityId !== `api_key_id_${expectations.apiKeyId}`
    || quota.limitAmount !== expectations.monthlyBudgetUsd
    || quota.refreshPeriod !== "monthly"
    || quota.includeByokInQuota !== false
    || quota.active !== true
    || quota.archived !== false
  ) {
    throw new Error("The dedicated demo AI Gateway monthly hard-budget contract is invalid.");
  }

  const currentSpend = quota.currentSpend;
  const currentByokSpend = quota.currentByokSpend;
  if (
    typeof currentSpend !== "number"
    || !Number.isFinite(currentSpend)
    || currentSpend < 0
    || currentSpend >= expectations.monthlyBudgetUsd
    || typeof currentByokSpend !== "number"
    || !Number.isFinite(currentByokSpend)
    || currentByokSpend !== 0
  ) {
    throw new Error("The dedicated demo AI Gateway spend state is invalid or exhausted.");
  }

  return Object.freeze({
    currentSpendUsd: currentSpend,
    monthlyBudgetUsd: expectations.monthlyBudgetUsd
  });
}

function validateExpectations(expectations: PublicDemoAiGatewayExpectations): void {
  if (
    typeof expectations.apiKeyId !== "string"
    || !/^[A-Za-z0-9]{20,128}$/.test(expectations.apiKeyId)
    || typeof expectations.teamId !== "string"
    || !/^team_[A-Za-z0-9]{8,128}$/.test(expectations.teamId)
    || !Number.isSafeInteger(expectations.monthlyBudgetUsd)
    || expectations.monthlyBudgetUsd < 1
    || expectations.monthlyBudgetUsd > 250
  ) {
    throw new Error("The expected public demo AI Gateway contract is invalid.");
  }
}

function validateCompletePage(value: unknown, entryCount: number): void {
  const pagination = objectValue(value);
  if (
    !pagination
    || pagination.next !== null
    || pagination.prev !== null
    || pagination.count !== entryCount
  ) {
    throw new Error("AI Gateway key metadata must be a complete, unpaginated response.");
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
