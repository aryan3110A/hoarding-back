import { RentRepository } from '../repositories/rent.repository';
import { HoardingRepository } from '../repositories/hoarding.repository';
import { Prisma, Rent, Hoarding, User } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { NotificationService } from './notification.service';
import { UserRepository } from '../repositories/user.repository';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';

export class RentService {
  private rentRepository: RentRepository;
  private hoardingRepository: HoardingRepository;
  private userRepository: UserRepository;
  private notificationService: NotificationService;
  private propertyRentRepository: PropertyRentRepository;

  constructor() {
    this.rentRepository = new RentRepository();
    this.hoardingRepository = new HoardingRepository();
    this.userRepository = new UserRepository();
    this.notificationService = new NotificationService();
    this.propertyRentRepository = new PropertyRentRepository();
  }

  private extractLandlordName(hoarding: any): string {
    const fromRelation = String(hoarding?.landlord?.name || '').trim();
    if (fromRelation) return fromRelation;

    const rateHistory = hoarding?.rateHistory as any;
    const fromRateHistory =
      (rateHistory && typeof rateHistory === 'object'
        ? String(rateHistory.landlord || rateHistory.landlordName || '').trim()
        : '') || '';
    if (fromRateHistory) return fromRateHistory;

    const ownership = String(hoarding?.ownership || '');
    const match = ownership.match(/^(gov|govt|government)\s*-\s*(.+)$/i);
    if (match && match[2]) return String(match[2]).trim();
    return '';
  }

  async getRentDetails(hoardingId: string) {
    const hoarding = await this.hoardingRepository.findById(hoardingId);
    if (!hoarding) {
      throw new NotFoundError('Hoarding not found');
    }

    const landlordName = this.extractLandlordName(hoarding);
    if (landlordName) {
      const landlordRent = await this.propertyRentRepository.findByLandlord(landlordName);
      if (landlordRent) {
        return {
          ...landlordRent,
          source: 'landlord',
          landlordName,
          readOnly: true,
          hoardingId,
        } as any;
      }
    }

    return this.rentRepository.findByHoardingId(hoardingId);
  }

  async saveRent(
    hoardingId: string,
    data: Partial<{
      partyType: string;
      rentAmount: Prisma.Decimal | number | string;
      incrementYear?: number | null;
      paymentMode: string;
      lastPaymentDate?: string | Date | null;
    }>,
    actor?: User & { role: { name: string } },
  ) {
    throw new BadRequestError(
      'Hoarding-level rent creation is deprecated. Please use landlord rent editor.',
    );
  }

  async recalculateRent(hoardingId: string) {
    throw new BadRequestError(
      'Hoarding-level rent recalculation is deprecated. Please update landlord rent configuration.',
    );
  }

  async getAllRents(params: { skip?: number; take?: number }) {
    const list = await this.propertyRentRepository.list(params);
    type LandlordRentRow = (typeof list.rows)[number];
    return {
      rents: list.rows.map((row: LandlordRentRow) => ({
        ...row,
        source: 'landlord',
        readOnly: true,
      })),
      total: list.total,
    } as any;
  }

  private async updateHoardingStatusIfNeeded(hoarding: Hoarding) {
    if (!hoarding.status || hoarding.status.toLowerCase() !== 'on_rent') {
      await this.hoardingRepository.update(hoarding.id, { status: 'on_rent' });
    }
  }

  private async notifyRentChange(context: RentNotificationContext) {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const { hoarding, rent, actor, isNew } = context;
    const targetRoles = ['owner', 'manager', 'admin'];
    const recipients = await this.userRepository.findByRoles(targetRoles);
    const filteredRecipients = recipients.filter((user: any) => !actor || user.id !== actor.id);

    if (!filteredRecipients.length) {
      return;
    }

    const actionVerb = isNew ? 'placed on rent' : 'updated';
    const actorLabel = actor ? `${actor.name} (${actor.role?.name || 'User'})` : 'System';
    const locationParts = [hoarding.city, hoarding.area].filter(Boolean).join(', ');
    const amountNumber = Number(rent.rentAmount);
    const formattedAmount = isNaN(amountNumber)
      ? rent.rentAmount.toString()
      : amountNumber.toLocaleString('en-IN', { maximumFractionDigits: 2 });

    const title = isNew
      ? `Hoarding ${hoarding.code} placed on rent`
      : `Rent updated for ${hoarding.code}`;
    const body = `${actorLabel} ${actionVerb} ${hoarding.code}${locationParts ? ` (${locationParts})` : ''}. Current rent ₹${formattedAmount}.`;
    const link = `/hoardings/${hoarding.id}/rent`;

    await this.notificationService.notifyUsers(
      filteredRecipients.map((user: any) => user.id),
      title,
      body,
      link,
    );
  }

  async processAnnualIncrements() {
    const currentYear = new Date().getFullYear();

    // Find rents that are due for increment
    const rentsToIncrement = await this.rentRepository.findDueForIncrement(currentYear);

    console.log(`Found ${rentsToIncrement.length} rents due for annual increment.`);

    let count = 0;
    for (const rent of rentsToIncrement) {
      try {
        await this.recalculateRent(rent.hoardingId);
        count++;
      } catch (error) {
        console.error(`Failed to increment rent for hoarding ${rent.hoardingId}`, error);
      }
    }

    return count;
  }
}

interface RentNotificationContext {
  hoarding: Hoarding;
  rent: Rent;
  actor?: User & { role: { name: string } };
  isNew: boolean;
}
