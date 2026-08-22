import { BadRequestError, ConflictError } from '../lib/errors';
import { LandlordRepository } from '../repositories/landlord.repository';

interface CreateLandlordInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

type LandlordGroupedRow = {
  landlordId: string | null;
  landlordName: string;
  hoardingCount: number;
  hoardings: Array<{
    id: string;
    code: string;
    city: string | null;
    area: string | null;
    landmark: string | null;
    roadName: string | null;
    side: string | null;
    widthCm: number | null;
    heightCm: number | null;
    status: string;
    category: { id: string; name: string } | null;
    ownership: string | null;
    standardRate: unknown;
    minimumRate: unknown;
  }>;
};

type HoardingGroupSource = {
  id: string;
  code: string;
  city: string | null;
  area: string | null;
  landmark: string | null;
  roadName: string | null;
  side: string | null;
  widthCm: number | null;
  heightCm: number | null;
  status: string | null;
  ownership: string | null;
  standardRate: unknown;
  minimumRate: unknown;
  rateHistory: unknown;
  landlord: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
};

export class LandlordService {
  private landlordRepository: LandlordRepository;

  constructor() {
    this.landlordRepository = new LandlordRepository();
  }

  private normalize(value: unknown) {
    return String(value || '').trim();
  }

  private normalizeKey(value: unknown) {
    return this.normalize(value)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractLandlordNameFromHoarding(hoarding: HoardingGroupSource) {
    const relationName = this.normalize(hoarding?.landlord?.name);
    if (relationName) return relationName;

    const rateHistory = hoarding?.rateHistory;
    if (rateHistory && typeof rateHistory === 'object') {
      const history = rateHistory as Record<string, unknown>;
      const fromHistory = this.normalize(
        history.landlord ||
          history.landlordName ||
          history.landloard,
      );
      if (fromHistory) return fromHistory;
    }

    const ownership = this.normalize(hoarding?.ownership);
    const match = ownership.match(/^(gov|govt|government)\s*-\s*(.+)$/i);
    if (match && match[2]) {
      return this.normalize(match[2]);
    }

    return 'Unknown';
  }

  async list(params: { q?: string } = {}) {
    const query = this.normalize(params.q);
    let { rows } = await this.landlordRepository.list({
      q: query,
      take: 2000,
    });

    if (query.length >= 2 && rows.length === 0) {
      const legacyNames = await this.landlordRepository.listLegacyNamesByQuery(query, 50);
      if (legacyNames.length > 0) {
        await this.landlordRepository.ensureByNames(legacyNames);
        const refreshed = await this.landlordRepository.list({
          q: query,
          take: 2000,
        });
        rows = refreshed.rows;
      }
    }

    return rows.map((row: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
    }) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
    }));
  }

  async listWithHoardings(params: { q?: string } = {}): Promise<LandlordGroupedRow[]> {
    const query = this.normalize(params.q);

    if (query.length >= 2) {
      const legacyNames = await this.landlordRepository.listLegacyNamesByQuery(query, 100);
      if (legacyNames.length > 0) {
        await this.landlordRepository.ensureByNames(legacyNames);
      }
    }

    const hoardings =
      (await this.landlordRepository.listHoardingsForLandlordGrouping()) as HoardingGroupSource[];
    const grouped = new Map<string, LandlordGroupedRow>();

    for (const hoarding of hoardings) {
      const landlordName = this.extractLandlordNameFromHoarding(hoarding);
      const landlordKey = this.normalizeKey(landlordName) || 'unknown';

      if (query && !landlordKey.includes(this.normalizeKey(query))) {
        continue;
      }

      if (!grouped.has(landlordKey)) {
        grouped.set(landlordKey, {
          landlordId: hoarding?.landlord?.id || null,
          landlordName,
          hoardingCount: 0,
          hoardings: [],
        });
      }

      const current = grouped.get(landlordKey);
      if (!current) continue;
      if (!current.landlordId && hoarding?.landlord?.id) {
        current.landlordId = String(hoarding.landlord.id);
      }

      current.hoardings.push({
        id: String(hoarding.id),
        code: String(hoarding.code || ''),
        city: hoarding.city || null,
        area: hoarding.area || null,
        landmark: hoarding.landmark || null,
        roadName: hoarding.roadName || null,
        side: hoarding.side || null,
        widthCm: hoarding.widthCm ?? null,
        heightCm: hoarding.heightCm ?? null,
        status: String(hoarding.status || ''),
        category: hoarding.category
          ? {
              id: String(hoarding.category.id),
              name: String(hoarding.category.name),
            }
          : null,
        ownership: hoarding.ownership || null,
        standardRate: hoarding.standardRate,
        minimumRate: hoarding.minimumRate,
      });

      current.hoardingCount = current.hoardings.length;
    }

    const rows = Array.from(grouped.values()).map((row) => ({
      ...row,
      hoardings: row.hoardings.sort((a, b) => a.code.localeCompare(b.code)),
    }));

    rows.sort((a, b) => a.landlordName.localeCompare(b.landlordName));
    return rows;
  }

  async create(payload: CreateLandlordInput) {
    const name = this.normalize(payload.name);
    const phone = this.normalize(payload.phone) || undefined;
    const email = this.normalize(payload.email) || undefined;
    const address = this.normalize(payload.address) || undefined;

    if (!name) {
      throw new BadRequestError('Landlord name is required');
    }

    const duplicate = await this.landlordRepository.findDuplicate(name, phone);
    if (duplicate) {
      throw new ConflictError('Landlord with same name or phone already exists', {
        existing: {
          id: duplicate.id,
          name: duplicate.name,
          phone: duplicate.phone,
          email: duplicate.email,
          address: duplicate.address,
        },
      });
    }

    const data = {
      name,
      phone,
      email,
      address,
    };

    return this.landlordRepository.create(data);
  }

  async assertExists(landlordId: string) {
    const id = this.normalize(landlordId);
    if (!id) throw new BadRequestError('landlordId is required');

    const landlord = await this.landlordRepository.findById(id);
    if (!landlord) throw new BadRequestError('Invalid landlord selected');

    return landlord;
  }
}

export default new LandlordService();
