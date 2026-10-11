import { prisma } from '../lib/prisma';
import { BadRequestError, ConflictError, ForbiddenError } from '../lib/errors';

const DEFAULT_CATEGORY_NAMES = ['Automobile', 'Education', 'Gems & Jewellery', 'Others'] as const;

export class CategoryService {
  async list() {
    await Promise.all(
      DEFAULT_CATEGORY_NAMES.map((name) =>
        prisma.category.upsert({ where: { name }, update: {}, create: { name } }),
      ),
    );

    const rows = await prisma.category.findMany({
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    const order = new Map<string, number>(
      DEFAULT_CATEGORY_NAMES.map((name, index) => [name, index]),
    );
    return rows.sort(
      (a: { name: string }, b: { name: string }) => {
        const orderA = order.get(a.name) ?? 999;
        const orderB = order.get(b.name) ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      }
    );
  }

  async create(input: { name?: string; actorRole?: string }) {
    const roleName = String(input.actorRole || '').toLowerCase();
    if (!['owner', 'manager', 'admin', 'sales'].includes(roleName)) {
      throw new ForbiddenError('Only Owner/Manager/Admin/Sales can create categories');
    }

    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestError('Category name is required');

    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictError('Category already exists');
    }

    return prisma.category.create({ data: { name } });
  }
}

export default new CategoryService();
