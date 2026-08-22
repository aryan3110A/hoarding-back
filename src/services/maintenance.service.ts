import { prisma } from '../lib/prisma';
import { BadRequestError, NotFoundError } from '../lib/errors';

export const MAINTENANCE_TYPES = [
  { value: 'LAKDANI_PATTI', label: 'Lakdani Patti / Patti Badalvi' },
  { value: 'WIRING', label: 'Wiring' },
  { value: 'CHANGED_BANNER', label: 'Changed Banner' },
  { value: 'CONTACT_NUMBER', label: 'Contact Number Lagavano' },
  { value: 'OTHER', label: 'Other' },
] as const;

const TYPE_SET = new Set(MAINTENANCE_TYPES.map((t) => t.value));

export class MaintenanceService {
  listTypes() {
    return MAINTENANCE_TYPES;
  }

  async create(input: {
    hoardingId: string;
    maintenanceType: string;
    maintenanceDate: string;
    performedBy: string;
    remarks?: string;
    photoUrl?: string;
    photoPath?: string;
    createdById?: string;
  }) {
    const hoardingId = String(input.hoardingId || '').trim();
    if (!hoardingId) throw new BadRequestError('hoardingId is required');

    const type = String(input.maintenanceType || '').trim().toUpperCase();
    if (!TYPE_SET.has(type as any)) {
      throw new BadRequestError('Invalid maintenance type');
    }

    const performedBy = String(input.performedBy || '').trim();
    if (!performedBy) throw new BadRequestError('performedBy is required');
    if (!input.maintenanceDate) throw new BadRequestError('maintenanceDate is required');

    const hoarding = await prisma.hoarding.findFirst({
      where: { id: hoardingId, isDeleted: false },
      select: { id: true, status: true },
    });
    if (!hoarding) throw new NotFoundError('Hoarding not found');

    // Side-record only — never mutate hoarding status/availability.
    return prisma.hoardingMaintenance.create({
      data: {
        hoardingId,
        maintenanceType: type,
        maintenanceDate: new Date(input.maintenanceDate),
        performedBy,
        remarks: input.remarks ? String(input.remarks).trim() : null,
        photoUrl: input.photoUrl || null,
        photoPath: input.photoPath || null,
        createdById: input.createdById || null,
      },
      include: {
        hoarding: {
          select: {
            id: true,
            code: true,
            city: true,
            landmark: true,
            area: true,
            status: true,
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async listByHoarding(hoardingId: string) {
    const id = String(hoardingId || '').trim();
    if (!id) throw new BadRequestError('hoardingId is required');
    return prisma.hoardingMaintenance.findMany({
      where: { hoardingId: id },
      orderBy: { maintenanceDate: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async listRecent(params: { skip?: number; take?: number } = {}) {
    const skip = params.skip || 0;
    const take = params.take || 50;
    const [rows, total] = await prisma.$transaction([
      prisma.hoardingMaintenance.findMany({
        skip,
        take,
        orderBy: { maintenanceDate: 'desc' },
        include: {
          hoarding: {
            select: {
              id: true,
              code: true,
              city: true,
              landmark: true,
              area: true,
              status: true,
            },
          },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.hoardingMaintenance.count(),
    ]);
    return { rows, total };
  }
}
