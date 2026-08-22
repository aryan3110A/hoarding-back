import { BlockHoardingService } from '../services/bookingToken.service';
import { ContractService } from '../services/contract.service';

const svc = new BlockHoardingService();
const contractSvc = new ContractService();

export function startBookingTokenExpiryJob(intervalMinutes = 10) {
  const intervalMs = intervalMinutes * 60 * 1000;
  // Run once immediately on startup
  svc.expireAndPromote().catch((e) => console.error('[BookingTokenExpiryJob] error', e));
  contractSvc
    .reconcileExpiredLiveHoardings()
    .catch((e) => console.error('[BookingTokenExpiryJob] reconcile error', e));
  setInterval(() => {
    svc.expireAndPromote().catch((e) => console.error('[BookingTokenExpiryJob] error', e));
    contractSvc
      .reconcileExpiredLiveHoardings()
      .catch((e) => console.error('[BookingTokenExpiryJob] reconcile error', e));
  }, intervalMs);
}
