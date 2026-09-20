const cooldownMs = Math.max(0, Number(process.env.INVESTIGATION_COOLDOWN_MS ?? 300_000));
const activeUsers = new Set<string>();
const lastStartedAt = new Map<string, number>();

export class InvestigationLimitError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) {
    super(message);
  }
}

/**
 * Process-local guard for the synchronous investigation endpoint. The runner
 * has its own global lock, so duplicate requests are also rejected there.
 */
export function acquireInvestigationSlot(userId: string) {
  if (activeUsers.has(userId)) throw new InvestigationLimitError("An investigation is already running for your account.", 60);

  const lastStarted = lastStartedAt.get(userId);
  const remaining = lastStarted ? cooldownMs - (Date.now() - lastStarted) : 0;
  if (remaining > 0) {
    throw new InvestigationLimitError("Please wait before starting another investigation.", Math.ceil(remaining / 1_000));
  }

  activeUsers.add(userId);
  lastStartedAt.set(userId, Date.now());
  return () => activeUsers.delete(userId);
}
