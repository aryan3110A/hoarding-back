import { prisma } from '../lib/prisma';
import { AuditRepository } from '../repositories/audit.repository';
import { Prisma } from '@prisma/client';
import type { StoredImageAsset } from './mediaStorage.service';

const auditRepo = new AuditRepository();

export class ChecklistService {
  async upsertChecklist(
    hoardingId: string,
    data: {
      isCorrectSize?: boolean;
      isGoodCondition?: boolean;
      isFlexReceived?: boolean;
      isReadyForInstall?: boolean;
      isSiteImageUploaded?: boolean;
    },
    actorId: string,
  ) {
    const updated = await prisma.supervisorChecklist.upsert({
      where: { hoardingId },
      create: {
        hoarding: { connect: { id: hoardingId } },
        updatedBy: { connect: { id: actorId } },
        isCorrectSize: !!data.isCorrectSize,
        isGoodCondition: !!data.isGoodCondition,
        isFlexReceived: !!data.isFlexReceived,
        isReadyForInstall: !!data.isReadyForInstall,
        isSiteImageUploaded: !!data.isSiteImageUploaded,
      },
      update: {
        updatedById: actorId,
        ...(typeof data.isCorrectSize === 'boolean' ? { isCorrectSize: data.isCorrectSize } : {}),
        ...(typeof data.isGoodCondition === 'boolean'
          ? { isGoodCondition: data.isGoodCondition }
          : {}),
        ...(typeof data.isFlexReceived === 'boolean'
          ? { isFlexReceived: data.isFlexReceived }
          : {}),
        ...(typeof data.isReadyForInstall === 'boolean'
          ? { isReadyForInstall: data.isReadyForInstall }
          : {}),
        ...(typeof data.isSiteImageUploaded === 'boolean'
          ? { isSiteImageUploaded: data.isSiteImageUploaded }
          : {}),
      },
    });

    if (typeof data.isGoodCondition === 'boolean') {
      await prisma.hoarding.update({
        where: { id: hoardingId },
        data: { condition: data.isGoodCondition ? 'GOOD' : 'DAMAGED' },
      });
    }

    await auditRepo.create({
      userId: actorId || null,
      action: 'supervisor.checklist_update',
      entityType: 'Hoarding',
      entityId: hoardingId,
      payload: data as unknown as Prisma.InputJsonValue,
    });

    return updated;
  }

  async getChecklist(hoardingId: string) {
    return prisma.supervisorChecklist.findUnique({ where: { hoardingId } });
  }

  async addSiteImages(hoardingId: string, actorId: string, files: StoredImageAsset[]) {
    const existing = await prisma.supervisorChecklist.findUnique({ where: { hoardingId } });
    const rawExisting = existing?.siteImages as unknown;
    const existingList = Array.isArray(rawExisting)
      ? rawExisting
      : rawExisting
        ? [rawExisting]
        : [];
    const now = new Date().toISOString();
    const toAdd = files.map((f) => ({
      filename: f.filename,
      url: f.url,
      image_url: f.image_url || f.url,
      uploadedAt: f.uploadedAt || now,
      storage_provider: f.storage_provider,
      storage_path: f.storage_path,
      original_name: f.original_name,
      content_type: f.content_type,
      size_bytes: f.size_bytes,
    }));
    const merged = [...existingList, ...toAdd];

    const updated = await prisma.supervisorChecklist.upsert({
      where: { hoardingId },
      create: {
        hoarding: { connect: { id: hoardingId } },
        updatedBy: { connect: { id: actorId } },
        isSiteImageUploaded: true,
        siteImages: merged as unknown as Prisma.InputJsonValue,
      },
      update: {
        updatedById: actorId,
        isSiteImageUploaded: true,
        siteImages: merged as unknown as Prisma.InputJsonValue,
      },
    });

    await auditRepo.create({
      userId: actorId || null,
      action: 'supervisor.checklist_image_upload',
      entityType: 'Hoarding',
      entityId: hoardingId,
      payload: { count: files.length } as unknown as Prisma.InputJsonValue,
    });

    return updated;
  }
}
