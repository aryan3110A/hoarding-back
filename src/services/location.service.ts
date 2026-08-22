import { LocationRepository } from '../repositories/location.repository';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

const locationRepository = new LocationRepository();

export class LocationService {
  async logLocation(data: Prisma.LocationLogUncheckedCreateInput) {
    return locationRepository.create(data);
  }

  async getSuggestions(query: string, limit = 12): Promise<string[]> {
    const q = String(query || '').trim();
    if (!q) return [];

    const [landmarks, roadNames, areas, titles, sides] = await Promise.all([
      prisma.hoarding.findMany({
        where: { landmark: { contains: q, mode: 'insensitive' } },
        select: { landmark: true },
        take: limit,
        distinct: ['landmark'],
      }),
      prisma.hoarding.findMany({
        where: { roadName: { contains: q, mode: 'insensitive' } },
        select: { roadName: true },
        take: limit,
        distinct: ['roadName'],
      }),
      prisma.hoarding.findMany({
        where: { area: { contains: q, mode: 'insensitive' } },
        select: { area: true },
        take: limit,
        distinct: ['area'],
      }),
      prisma.hoarding.findMany({
        where: { title: { contains: q, mode: 'insensitive' } },
        select: { title: true },
        take: limit,
        distinct: ['title'],
      }),
      prisma.hoarding.findMany({
        where: { side: { contains: q, mode: 'insensitive' } },
        select: { side: true },
        take: limit,
        distinct: ['side'],
      }),
    ]);

    const merged = [
      ...landmarks.map((x: { landmark: string | null }) => x.landmark),
      ...roadNames.map((x: { roadName: string | null }) => x.roadName),
      ...areas.map((x: { area: string | null }) => x.area),
      ...titles.map((x: { title: string | null }) => x.title),
      ...sides.map((x: { side: string | null }) => x.side),
    ]
      .map((x: string | null) => String(x || '').trim())
      .filter(Boolean);

    return Array.from(new Set(merged)).slice(0, limit);
  }
}
