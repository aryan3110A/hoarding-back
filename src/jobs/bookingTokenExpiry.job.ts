import { BlockHoardingService } from '../services/bookingToken.service';
import { ContractService } from '../services/contract.service';

const svc = new BlockHoardingService();
const contractSvc = new ContractService();

let running = false;

/** One tick: expire 48h blocks, promote the queue (fresh 48h), repair stale hoarding statuses. */
export async function runBookingTokenExpiryTick() {
  if (running) return; // never let two ticks overlap
  running = true;
  try {
    await svc.expireAndPromote().catch((e) => console.error('[BookingTokenExpiryJob] error', e));
    await contractSvc
      .reconcileExpiredLiveHoardings()
      .catch((e) => console.error('[BookingTokenExpiryJob] reconcile error', e));
  } finally {
    running = false;
  }
}

export function startBookingTokenExpiryJob(intervalMinutes = 1) {
  const intervalMs = intervalMinutes * 60 * 1000;
  // Run once immediately on startup (also repairs any stale blocked data), then on an interval
  void runBookingTokenExpiryTick();
  setInterval(() => {
    void runBookingTokenExpiryTick();
  }, intervalMs);
}
