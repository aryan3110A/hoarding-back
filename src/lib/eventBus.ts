import { EventEmitter } from 'events';

export type HoardingStatusEvent = {
  hoardingId: string;
  status?: string;
  hasActiveToken?: boolean;
  propertyRent?: unknown;
  updatedAt?: string;
};

class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
