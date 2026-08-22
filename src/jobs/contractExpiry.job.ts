import { ContractService } from '../services/contract.service';

const DEFAULT_ALERT_DAYS = parseInt(process.env.CONTRACT_EXPIRY_ALERT_DAYS || '10', 10);

export async function runContractExpiryJob() {
  console.log(`[contractExpiry.job] starting job with alertDays=${DEFAULT_ALERT_DAYS}`);
  const svc = new ContractService();
  try {
    await svc.runExpiryJob(DEFAULT_ALERT_DAYS);
    console.log('[contractExpiry.job] completed successfully');
  } catch (err) {
    console.error('[contractExpiry.job] error running job:', err);
    throw err;
  }
}

// If run directly (for dev), execute once
if (require.main === module) {
  runContractExpiryJob()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('runContractExpiryJob failed:', err);
      process.exit(1);
    });
}
