export type PublicDemoLoadTestEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDemoLoadTestResult = Readonly<{
  sessionCount: number;
  p95Milliseconds: number;
}>;

export function runPublicDemoLoadTest(
  environment?: PublicDemoLoadTestEnvironment,
  fetchImplementation?: typeof fetch
): Promise<PublicDemoLoadTestResult>;

export function safePublicDemoLoadFailure(error: unknown): string;
