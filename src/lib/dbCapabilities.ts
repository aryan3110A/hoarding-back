export async function supportsPhase3BlockingSchema(): Promise<boolean> {
  // Temporarily force Phase 3 off to stay compatible with the unmigrated Neon DB.
  return false;
}
