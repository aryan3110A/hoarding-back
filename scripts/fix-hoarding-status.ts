import { prisma } from '../src/lib/prisma';

async function main() {
  // Find hoardings that are marked on_rent but should NOT be linked by our S/L/R rule
  const all = await prisma.hoarding.findMany();

  const isCanonical = (code: string) => {
    if (!code) return false;
    if (!code.includes('-')) return true; // exact prefix
    const parts = code.split('-');
    // prefix-<face>
    const last = parts[parts.length - 1].toUpperCase();
    return last === 'S' || last === 'L' || last === 'R';
  };

  const toReset: string[] = [];
  for (const h of all) {
    if (h.status === 'on_rent') {
      const canonical = isCanonical(h.code || '');
      if (!canonical) {
        toReset.push(h.id);
      }
    }
  }

  if (toReset.length === 0) {
    console.log('No non-canonical on_rent hoardings found.');
  } else {
    console.log(`Resetting ${toReset.length} hoardings to available and unlinking groupId...`);
    await prisma.hoarding.updateMany({
      where: { id: { in: toReset } },
      data: { status: 'available', propertyGroupId: null },
    });
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
