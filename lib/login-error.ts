const genericLoginError = "Sign-in failed. Check your email and password and try again.";

export function toPublicLoginError(error: unknown): string {
  void error;
  return genericLoginError;
}
