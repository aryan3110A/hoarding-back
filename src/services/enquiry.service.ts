import EnquiryRepository from '../repositories/enquiry.repository';

function normalizeEnquirySource(raw: unknown) {
  const v = String(raw || '')
    .trim()
    .toUpperCase();
  const allowed = [
    'WALK_IN',
    'SELF_GENERATED',
    'VIA_TELEPHONIC',
    'VIA_WHATSAPP',
    'REFERENCE',
    'OTHERS',
  ];
  if (allowed.includes(v)) return v;
  return null;
}

export class EnquiryService {
  private repo = EnquiryRepository;

  async createEnquiry(payload: any, createdById: string) {
    const data = {
      clientName: String(payload.clientName || '').trim(),
      contact: String(payload.contact || '').trim(),
      source: normalizeEnquirySource(payload.source),
      preferredArea: payload.preferredArea || null,
      campaignDates: payload.campaignDates || null,
      budget: payload.budget || null,
      hoardingId: payload.hoardingId || null,
      assignedToId: payload.assignedToId || null,
      notes: payload.notes || null,
      createdById,
    } as any;
    const created = await this.repo.create(data);
    return created;
  }

  async listAll() {
    return this.repo.listAll();
  }

  async getById(id: string) {
    return this.repo.findById(id);
  }

  async update(id: string, data: any) {
    return this.repo.update(id, data);
  }
}

export default new EnquiryService();
