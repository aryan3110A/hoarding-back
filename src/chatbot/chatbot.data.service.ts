import { prisma } from '../lib/prisma';
import SalesPerformanceService from '../services/salesPerformance.service';
import { PropertyRentRepository } from '../repositories/propertyRent.repository';
import { ContractService } from '../services/contract.service';
import type {
  ChatbotAction,
  ChatbotActor,
  ChatbotExpandable,
  ChatbotFilters,
  ChatbotIntent,
  ChatbotResponse,
} from './chatbot.types';
import {
  dataFreshnessLabel,
  formatDate,
  formatInr,
  formatPeriod,
  resolveDateRange,
  resolvePreviousMonthRange,
  toIsoDate,
} from './chatbot.dateUtils';
import {
  extractSalespersonFromMessage,
  pickBestSalesUser,
  resolveSalesUser,
} from './chatbot.resolveUser';

const propertyRentRepo = new PropertyRentRepository();
const contractService = new ContractService();

const LIVE_STATUSES = new Set(['live', 'booked', 'under_process', 'tokenized']);
const AVAILABLE_STATUSES = new Set(['available']);

const buildReportsHref = (filters: ChatbotFilters, salespersonId?: string) => {
  const range = resolveDateRange(filters);
  const params = new URLSearchParams();
  if (salespersonId) params.set('salespersonId', salespersonId);
  params.set('startDate', toIsoDate(range.startDate));
  params.set('endDate', toIsoDate(range.endDate));
  params.set('groupBy', 'month');
  return `/reports?${params.toString()}`;
};

const resolveClient = async (name?: string) => {
  if (!name?.trim()) return null;
  return prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: name.trim(), mode: 'insensitive' } },
        { companyName: { contains: name.trim(), mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, companyName: true },
    take: 10,
  });
};

const hoardingWhere = (filters: ChatbotFilters) => {
  const where: any = { isDeleted: false };
  if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
  if (filters.area) where.area = { contains: filters.area, mode: 'insensitive' };
  if (filters.landmark) where.landmark = { contains: filters.landmark, mode: 'insensitive' };
  if (filters.zone) {
    where.OR = [
      { area: { contains: filters.zone, mode: 'insensitive' } },
      { landmark: { contains: filters.zone, mode: 'insensitive' } },
    ];
  }
  if (filters.hoardingType) where.type = { contains: filters.hoardingType, mode: 'insensitive' };
  return where;
};

const isActiveDuringRange = (
  start: Date | null | undefined,
  end: Date | null | undefined,
  rangeStart: Date,
  rangeEnd: Date,
) => {
  if (!start || !end) return false;
  return start <= rangeEnd && end >= rangeStart;
};

export class ChatbotDataService {
  async execute(
    intent: ChatbotIntent,
    filters: ChatbotFilters,
    actor: ChatbotActor,
    rawMessage?: string,
  ): Promise<ChatbotResponse> {
    switch (intent) {
      case 'SALES_TOTAL_MONTH':
        return this.salesTotalMonth(filters, actor);
      case 'SALES_COMPARE_MONTHS':
        return this.salesCompareMonths(filters, actor);
      case 'SALES_REMAINING_REVENUE':
        return this.salesRemainingRevenue(filters, actor);
      case 'SALES_PERSON_PERFORMANCE':
        return this.salesPersonPerformance(filters, actor, rawMessage);
      case 'SALES_TOP_PERFORMER':
        return this.salesTopPerformer(filters, actor);
      case 'HOARDING_STATUS_COUNT':
        return this.hoardingStatusCount(filters);
      case 'HOARDING_EMPTY_MONTH':
        return this.hoardingEmptyMonth(filters);
      case 'HOARDING_CITY_BREAKDOWN':
        return this.hoardingCityBreakdown(filters);
      case 'HOARDING_EXPIRING':
        return this.hoardingExpiring(filters);
      case 'HOARDING_OCCUPANCY_SNAPSHOT':
        return this.hoardingOccupancySnapshot(filters);
      case 'RENT_DUE':
        return this.rentDue(filters, false);
      case 'RENT_OVERDUE':
        return this.rentDue(filters, true);
      case 'RENT_LANDLORD_WISE':
        return this.rentLandlordWise(filters);
      case 'ENQUIRY_COUNT':
        return this.enquiryCount(filters);
      case 'ENQUIRY_BY_SOURCE':
        return this.enquiryBySource(filters);
      case 'ENQUIRY_PENDING_FOLLOWUP':
        return this.enquiryPendingFollowup(filters);
      case 'ENQUIRY_IN_PROCESS':
        return this.enquiryInProcess(filters);
      case 'ENQUIRY_INTEREST_BY_LOCATION':
        return this.enquiryInterestByLocation(filters);
      case 'PROPOSAL_STATS':
        return this.proposalStats(filters, actor);
      case 'PROPOSAL_NEW_PARTY':
        return this.proposalNewParty(filters, actor);
      case 'FOLLOWUP_STATS':
        return this.followupStats(filters);
      case 'CLIENT_SUMMARY':
        return this.clientSummary(filters);
      case 'CLIENT_RENEWALS_DUE':
        return this.clientRenewalsDue(filters, actor);
      case 'CLIENT_TOP_BY_REVENUE':
        return this.clientTopByRevenue(filters, actor);
      case 'CLIENT_ACTIVE_HOARDINGS':
        return this.clientActiveHoardings(filters);
      case 'GENERAL_HELP':
        return this.generalHelp();
      case 'CLARIFICATION_NEEDED':
      default:
        return {
          summary: 'Please provide more details or choose a suggested prompt.',
          dataFreshness: dataFreshnessLabel(),
          breakdown: [],
          actions: [],
          intent: 'CLARIFICATION_NEEDED',
          filters,
        };
    }
  }

  private base(
    intent: ChatbotIntent,
    filters: ChatbotFilters,
    summary: string,
    breakdown: ChatbotResponse['breakdown'],
    actions: ChatbotAction[] = [],
    expandable?: ChatbotExpandable[],
    resolvedPeriod?: string,
  ): ChatbotResponse {
    return {
      intent,
      filters,
      summary,
      resolvedPeriod,
      dataFreshness: dataFreshnessLabel(),
      breakdown,
      expandable,
      actions,
    };
  }

  private async salesTotalMonth(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getOverview({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      currentUserId: actor.userId,
      currentRole: actor.role,
      salespersonId: filters.salespersonId,
    });
    const s = data.summary;
    const period = formatPeriod(range.startDate, range.endDate);
    return this.base(
      'SALES_TOTAL_MONTH',
      filters,
      `Total recognised sales for ${period}: ${formatInr(s.recognizedRevenue)}`,
      [
        { label: 'New business', value: formatInr(s.newBusinessRevenue) },
        { label: 'Renewals', value: formatInr(s.renewalRevenue) },
        { label: 'Clients contributing', value: String(s.activeClients) },
        { label: 'Active hoarding cycles', value: String(s.activeHoardings) },
      ],
      [
        { type: 'navigate', label: 'Open Sales Performance', href: buildReportsHref(filters) },
        { type: 'export', label: 'Export details', exportType: 'csv', payload: { intent: 'SALES_TOTAL_MONTH', filters } },
      ],
      undefined,
      period,
    );
  }

  private async salesCompareMonths(filters: ChatbotFilters, actor: ChatbotActor) {
    const current = resolveDateRange(filters);
    const previous = resolvePreviousMonthRange(filters);
    const [cur, prev] = await Promise.all([
      SalesPerformanceService.getOverview({
        startDate: toIsoDate(current.startDate),
        endDate: toIsoDate(current.endDate),
        currentUserId: actor.userId,
        currentRole: actor.role,
      }),
      SalesPerformanceService.getOverview({
        startDate: toIsoDate(previous.startDate),
        endDate: toIsoDate(previous.endDate),
        currentUserId: actor.userId,
        currentRole: actor.role,
      }),
    ]);
    const diff = cur.summary.recognizedRevenue - prev.summary.recognizedRevenue;
    const pct =
      prev.summary.recognizedRevenue > 0
        ? ((diff / prev.summary.recognizedRevenue) * 100).toFixed(1)
        : '0';
    return this.base(
      'SALES_COMPARE_MONTHS',
      filters,
      `This period: ${formatInr(cur.summary.recognizedRevenue)} vs last period: ${formatInr(prev.summary.recognizedRevenue)} (${diff >= 0 ? '+' : ''}${pct}%)`,
      [
        { label: 'Current new business', value: formatInr(cur.summary.newBusinessRevenue) },
        { label: 'Current renewals', value: formatInr(cur.summary.renewalRevenue) },
        { label: 'Previous total', value: formatInr(prev.summary.recognizedRevenue) },
        { label: 'Change', value: formatInr(diff) },
      ],
      [{ type: 'navigate', label: 'Open Sales Performance', href: buildReportsHref(filters) }],
      undefined,
      `${formatPeriod(current.startDate, current.endDate)} vs ${formatPeriod(previous.startDate, previous.endDate)}`,
    );
  }

  private async salesRemainingRevenue(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getClients({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      currentUserId: actor.userId,
      currentRole: actor.role,
    });
    const clients = (data.clients || []).slice(0, 20);
    const total = clients.reduce((sum: number, c: any) => sum + Number(c.futureScheduledRevenue || 0), 0);
    const expandable: ChatbotExpandable[] = [
      {
        id: 'clients',
        title: 'Client-wise remaining revenue',
        rows: clients.map((c: any) => ({
          client: c.clientName,
          remaining: formatInr(Number(c.futureScheduledRevenue || 0)),
          hoardings: String(c.hoardingsCount || 0),
        })),
      },
    ];
    return this.base(
      'SALES_REMAINING_REVENUE',
      filters,
      `Total remaining scheduled revenue: ${formatInr(total)} across ${clients.length} client(s)`,
      clients.slice(0, 5).map((c: any) => ({
        label: c.clientName,
        value: formatInr(Number(c.futureScheduledRevenue || 0)),
      })),
      [
        { type: 'navigate', label: 'Open Sales Performance', href: buildReportsHref(filters) },
        { type: 'export', label: 'Export client breakdown', exportType: 'csv', payload: { intent: 'SALES_REMAINING_REVENUE', filters } },
      ],
      expandable,
    );
  }

  private async salesPersonPerformance(
    filters: ChatbotFilters,
    actor: ChatbotActor,
    rawMessage?: string,
  ) {
    const nameFromMessage = rawMessage ? extractSalespersonFromMessage(rawMessage) : undefined;
    const lookupName = nameFromMessage || filters.salespersonName;
    const users = lookupName ? await resolveSalesUser(lookupName) : [];

    if (!users.length) {
      return this.base(
        'SALES_PERSON_PERFORMANCE',
        filters,
        lookupName
          ? `No matching salesperson found for "${lookupName}". Try the exact name, e.g. Sales User or Rahul.`
          : 'Please specify a salesperson name, e.g. "Sales User performance for May".',
        [],
        [],
      );
    }

    const user =
      (filters.salespersonId
        ? users.find((u) => u.id === filters.salespersonId) || null
        : null) || pickBestSalesUser(users, lookupName || '');

    if (!user) {
      return this.base(
        'CLARIFICATION_NEEDED',
        filters,
        `Multiple salespersons match "${lookupName}". Please select one:`,
        users.map((u) => ({ label: u.name, value: u.id })),
        users.map((u) => ({
          type: 'navigate',
          label: `View ${u.name}`,
          href: buildReportsHref(filters, u.id),
        })),
      );
    }

    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getOverview({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      salespersonId: user.id,
      currentUserId: actor.userId,
      currentRole: actor.role,
    });
    const sp =
      data.salespersonBreakdown.find((row: any) => row.salespersonId === user.id) ||
      data.salespersonBreakdown[0] ||
      {};
    const proposals = await this.countProposals(range.startDate, range.endDate, user.id);
    const followups = await this.countFollowups(range.startDate, range.endDate, user.id);
    const period = formatPeriod(range.startDate, range.endDate);
    const reportFilters = { ...filters, salespersonId: user.id, salespersonName: user.name };

    return this.base(
      'SALES_PERSON_PERFORMANCE',
      reportFilters,
      `${user.name} — ${period}`,
      [
        { label: 'Enquiries generated', value: String(sp.enquiries || data.summary.totalEnquiries || 0) },
        { label: 'Enquiries won', value: String(sp.won || data.enquiryFunnel?.won || 0) },
        { label: 'In process', value: String(sp.inProcess || data.enquiryFunnel?.inProcess || 0) },
        { label: 'Dead / not interested', value: String((sp.deadFollowUpLater || 0) + (sp.notInterested || 0)) },
        { label: 'Unique proposals sent', value: String(proposals.total) },
        { label: 'New-party proposals', value: String(proposals.newParty) },
        { label: 'Recognised revenue', value: formatInr(Number(sp.recognizedRevenue || 0)) },
        { label: 'Remaining scheduled revenue', value: formatInr(Number(sp.remainingScheduledRevenue || 0)) },
        { label: 'Follow-ups completed', value: String(followups.completed) },
        { label: 'Follow-ups pending', value: String(followups.pending) },
      ],
      [
        {
          type: 'navigate',
          label: 'Open Full Sales Report',
          href: buildReportsHref(reportFilters, user.id),
        },
      ],
      undefined,
      period,
    );
  }

  private async salesTopPerformer(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getOverview({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      currentUserId: actor.userId,
      currentRole: actor.role,
    });
    const rows = (data.salespersonBreakdown || []).slice(0, 10);
    if (!rows.length) {
      return this.base('SALES_TOP_PERFORMER', filters, 'No salesperson performance data found for this period.', [], []);
    }
    const top = rows[0];
    return this.base(
      'SALES_TOP_PERFORMER',
      filters,
      `${top.salespersonName} generated the most recognised revenue: ${formatInr(Number(top.recognizedRevenue || 0))}`,
      rows.slice(0, 5).map((r: any) => ({
        label: r.salespersonName,
        value: formatInr(Number(r.recognizedRevenue || 0)),
      })),
      [{ type: 'navigate', label: 'Open Sales Performance', href: buildReportsHref(filters) }],
      [
        {
          id: 'sales-team',
          title: 'Salesperson breakdown',
          rows: rows.map((r: any) => ({
            name: r.salespersonName,
            revenue: formatInr(Number(r.recognizedRevenue || 0)),
            enquiries: String(r.enquiries || 0),
            remaining: formatInr(Number(r.remainingScheduledRevenue || 0)),
          })),
        },
      ],
      formatPeriod(range.startDate, range.endDate),
    );
  }

  private async hoardingStatusCount(filters: ChatbotFilters) {
    const where = hoardingWhere(filters);
    const hoardings = await prisma.hoarding.findMany({
      where,
      select: { id: true, code: true, status: true, city: true },
    });
    let live = 0;
    let available = 0;
    let other = 0;
    for (const h of hoardings) {
      const st = String(h.status || '').toLowerCase();
      if (LIVE_STATUSES.has(st)) live += 1;
      else if (AVAILABLE_STATUSES.has(st)) available += 1;
      else other += 1;
    }
    const status = filters.hoardingStatus || 'all';
    let summary = `Total hoardings${filters.city ? ` in ${filters.city}` : ''}: ${hoardings.length}`;
    if (status === 'live') summary = `${live} hoarding(s) are currently live${filters.city ? ` in ${filters.city}` : ''}.`;
    if (status === 'available' || status === 'vacant')
      summary = `${available} hoarding(s) are currently available/vacant${filters.city ? ` in ${filters.city}` : ''}.`;

    return this.base(
      'HOARDING_STATUS_COUNT',
      filters,
      summary,
      [
        { label: 'Live / occupied', value: String(live) },
        { label: 'Available', value: String(available) },
        { label: 'Other statuses', value: String(other) },
      ],
      [
        {
          type: 'navigate',
          label: 'View Hoardings',
          href: filters.city ? `/hoardings?city=${encodeURIComponent(filters.city)}` : '/hoardings',
        },
      ],
    );
  }

  private async hoardingEmptyMonth(filters: ChatbotFilters) {
    const range = resolveDateRange(filters);
    const hoardings = await prisma.hoarding.findMany({
      where: hoardingWhere(filters),
      select: { id: true, code: true, city: true, area: true, status: true },
    });
    const contracts = await prisma.contract.findMany({
      where: {
        OR: [
          { startDate: { lte: range.endDate }, endDate: { gte: range.startDate } },
          { status: { in: ['ACTIVE', 'PENDING_ACTIVATION', 'EXPIRING_SOON'] } },
        ],
      },
      select: { hoardingId: true, startDate: true, endDate: true, status: true },
    });
    const tokens = await prisma.bookingToken.findMany({
      where: {
        status: { in: ['BLOCKED', 'CONFIRMED', 'APPROVED'] },
        dateFrom: { lte: range.endDate },
        dateTo: { gte: range.startDate },
      },
      select: { hoardingId: true, dateFrom: true, dateTo: true },
    });

    const occupiedIds = new Set<string>();
    for (const c of contracts) {
      if (isActiveDuringRange(c.startDate, c.endDate, range.startDate, range.endDate)) {
        occupiedIds.add(c.hoardingId);
      }
    }
    for (const t of tokens) {
      if (isActiveDuringRange(t.dateFrom, t.dateTo, range.startDate, range.endDate)) {
        occupiedIds.add(t.hoardingId);
      }
    }

    const vacant = hoardings.filter((h: { id: string }) => !occupiedIds.has(h.id));
    const cityMap = new Map<string, number>();
    for (const h of vacant) {
      const city = h.city || 'Other';
      cityMap.set(city, (cityMap.get(city) || 0) + 1);
    }
    const period = formatPeriod(range.startDate, range.endDate);
    return this.base(
      'HOARDING_EMPTY_MONTH',
      filters,
      `${vacant.length} hoarding(s) remained vacant throughout ${period}.`,
      Array.from(cityMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([city, count]) => ({ label: city, value: String(count) })),
      [
        { type: 'navigate', label: 'View Hoardings', href: '/hoardings' },
        { type: 'export', label: 'Export vacant list', exportType: 'csv', payload: { intent: 'HOARDING_EMPTY_MONTH', filters } },
      ],
      [
        {
          id: 'vacant-list',
          title: 'Vacant hoardings',
          rows: vacant.slice(0, 50).map((h: { code: string; city: string | null; area: string | null; status: string }) => ({
            code: h.code,
            city: h.city || 'N/A',
            area: h.area || 'N/A',
            status: h.status,
          })),
        },
      ],
      period,
    );
  }

  private async hoardingCityBreakdown(filters: ChatbotFilters) {
    const hoardings = await prisma.hoarding.findMany({
      where: hoardingWhere(filters),
      select: { city: true, status: true },
    });
    const map = new Map<string, { live: number; available: number; total: number }>();
    for (const h of hoardings) {
      const city = h.city || 'Unknown';
      const row = map.get(city) || { live: 0, available: 0, total: 0 };
      row.total += 1;
      const st = String(h.status || '').toLowerCase();
      if (LIVE_STATUSES.has(st)) row.live += 1;
      if (AVAILABLE_STATUSES.has(st)) row.available += 1;
      map.set(city, row);
    }
    const rows = Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
    return this.base(
      'HOARDING_CITY_BREAKDOWN',
      filters,
      `City-wise hoarding occupancy across ${hoardings.length} hoarding(s).`,
      rows.slice(0, 6).map(([city, v]) => ({
        label: city,
        value: `${v.live} occupied, ${v.available} available`,
      })),
      [{ type: 'navigate', label: 'View Hoardings', href: '/hoardings' }],
      [
        {
          id: 'city-breakdown',
          title: 'City breakdown',
          rows: rows.map(([city, v]) => ({
            city,
            occupied: String(v.live),
            available: String(v.available),
            total: String(v.total),
          })),
        },
      ],
    );
  }

  private async hoardingExpiring(filters: ChatbotFilters) {
    const days = filters.daysAhead || 10;
    const renewals = await contractService.listRenewalsDue({
      actorId: 'chatbot',
      actorRole: 'owner',
      days,
    });
    const list = Array.isArray(renewals) ? renewals : (renewals as any)?.items || [];
    return this.base(
      'HOARDING_EXPIRING',
      filters,
      `${list.length} contract(s) / hoarding(s) expiring in the next ${days} day(s).`,
      list.slice(0, 5).map((r: any) => ({
        label: `${r.clientName || r.client?.name || 'Client'} — ${r.hoarding?.code || r.hoardingCode || 'Hoarding'}`,
        value: formatDate(r.endDate),
      })),
      [
        {
          type: 'navigate',
          label: 'Open Expiry List',
          href: `/sales/renewals-due?days=${days}`,
        },
        { type: 'export', label: 'Export expiry list', exportType: 'csv', payload: { intent: 'HOARDING_EXPIRING', filters } },
      ],
      [
        {
          id: 'expiring',
          title: 'Expiring hoardings',
          rows: list.slice(0, 50).map((r: any) => ({
            client: r.clientName || r.client?.name || 'N/A',
            hoarding: r.hoarding?.code || r.hoardingCode || 'N/A',
            endDate: formatDate(r.endDate),
            city: r.hoarding?.city || r.city || 'N/A',
          })),
        },
      ],
    );
  }

  private async hoardingOccupancySnapshot(filters: ChatbotFilters) {
    const snapshot = filters.snapshotDate ? new Date(filters.snapshotDate) : new Date();
    const where = hoardingWhere(filters);
    const hoardings = await prisma.hoarding.findMany({
      where,
      select: {
        id: true,
        code: true,
        city: true,
        area: true,
        landmark: true,
        status: true,
        expiryDate: true,
      },
    });
    const contracts = await prisma.contract.findMany({
      where: { hoardingId: { in: hoardings.map((h: { id: string }) => h.id) } },
      select: { hoardingId: true, startDate: true, endDate: true, status: true, client: { select: { name: true } } },
    });

    let occupied = 0;
    let available = 0;
    let expiringSoon = 0;
    const nearDays = filters.daysAhead || 10;
    const nearEnd = new Date(snapshot.getTime() + nearDays * 86400000);

    for (const h of hoardings) {
      const st = String(h.status || '').toLowerCase();
      const activeContract = contracts.find(
        (c: { hoardingId: string; startDate: Date; endDate: Date; status: string }) =>
          c.hoardingId === h.id &&
          c.startDate <= snapshot &&
          c.endDate >= snapshot &&
          ['ACTIVE', 'EXPIRING_SOON', 'PENDING_ACTIVATION'].includes(String(c.status)),
      );
      if (activeContract || LIVE_STATUSES.has(st)) occupied += 1;
      else if (AVAILABLE_STATUSES.has(st)) available += 1;
      if (h.expiryDate && h.expiryDate >= snapshot && h.expiryDate <= nearEnd) expiringSoon += 1;
    }

    const label = [filters.city, filters.zone || filters.area].filter(Boolean).join(' — ') || 'All locations';
    return this.base(
      'HOARDING_OCCUPANCY_SNAPSHOT',
      filters,
      `${label} on ${formatDate(snapshot)}: ${occupied} occupied, ${available} available, ${expiringSoon} expiring within ${nearDays} days.`,
      [
        { label: 'Occupied', value: String(occupied) },
        { label: 'Available', value: String(available) },
        { label: 'Expiring soon', value: String(expiringSoon) },
        { label: 'Total in scope', value: String(hoardings.length) },
      ],
      [{ type: 'navigate', label: 'View Hoarding Details', href: '/hoardings' }],
    );
  }

  private async rentDue(filters: ChatbotFilters, overdue: boolean) {
    const days = filters.daysAhead || (overdue ? 365 : 7);
    const rows = overdue ? await propertyRentRepo.overdueDues() : await propertyRentRepo.upcomingDues(days);
    const total = rows.reduce((sum: number, r: { rentAmount: unknown }) => sum + Number(r.rentAmount || 0), 0);
    const expandable: ChatbotExpandable = {
      id: 'landlords',
      title: overdue ? 'Overdue landlords' : 'Upcoming rent',
      rows: rows.slice(0, 30).map((r: any) => ({
        landlord: r.landlord || 'N/A',
        amount: formatInr(Number(r.rentAmount || 0)),
        dueDate: formatDate(r.nextDueDate),
        hoardings: String(r.hoardings?.length || 0),
        location: r.location || 'N/A',
      })),
    };
    return this.base(
      overdue ? 'RENT_OVERDUE' : 'RENT_DUE',
      filters,
      overdue
        ? `Total overdue rent: ${formatInr(total)} across ${rows.length} landlord record(s).`
        : `Total rent due in the next ${days} day(s): ${formatInr(total)} across ${rows.length} landlord(s).`,
      rows.slice(0, 5).map((r: any) => ({
        label: String(r.landlord || 'Landlord'),
        value: `${formatInr(Number(r.rentAmount || 0))} — Due ${formatDate(r.nextDueDate)}`,
      })),
      [
        { type: 'navigate', label: 'Open Rent Section', href: '/vendors' },
        { type: 'export', label: 'Export rent list', exportType: 'csv', payload: { intent: overdue ? 'RENT_OVERDUE' : 'RENT_DUE', filters } },
      ],
      [expandable],
    );
  }

  private async rentLandlordWise(filters: ChatbotFilters) {
    return this.rentDue({ ...filters, daysAhead: filters.daysAhead || 30 }, false);
  }

  private async enquiryCount(filters: ChatbotFilters) {
    const range = resolveDateRange(filters);
    const count = await prisma.inquiry.count({
      where: { createdAt: { gte: range.startDate, lte: range.endDate } },
    });
    return this.base(
      'ENQUIRY_COUNT',
      filters,
      `${count} enquiry/enquiries created for ${formatPeriod(range.startDate, range.endDate)}.`,
      [{ label: 'Total enquiries', value: String(count) }],
      [{ type: 'navigate', label: 'Open Enquiries', href: '/enquiries' }],
      undefined,
      formatPeriod(range.startDate, range.endDate),
    );
  }

  private async enquiryBySource(filters: ChatbotFilters) {
    const range = resolveDateRange(filters);
    const rows = await prisma.inquiry.groupBy({
      by: ['source'],
      where: { createdAt: { gte: range.startDate, lte: range.endDate } },
      _count: { _all: true },
    });
    return this.base(
      'ENQUIRY_BY_SOURCE',
      filters,
      `Enquiry sources for ${formatPeriod(range.startDate, range.endDate)}.`,
      rows.map((r: any) => ({ label: String(r.source), value: String(r._count._all) })),
      [{ type: 'navigate', label: 'Open Enquiries', href: '/enquiries' }],
      undefined,
      formatPeriod(range.startDate, range.endDate),
    );
  }

  private async enquiryPendingFollowup(filters: ChatbotFilters) {
    const now = new Date();
    const start = filters.daysAhead === 0 ? startOfDay(now) : startOfDay(now);
    const end = endOfDay(now);
    const rows = await prisma.inquiry.findMany({
      where: {
        followupStatus: 'PENDING',
        nextFollowupDate: { lte: end },
      },
      include: {
        assignedSales: { select: { name: true } },
      },
      take: 50,
      orderBy: { nextFollowupDate: 'asc' },
    });
    return this.base(
      'ENQUIRY_PENDING_FOLLOWUP',
      filters,
      `${rows.length} enquiry/enquiries require follow-up today or earlier.`,
      rows.slice(0, 5).map((r: any) => ({
        label: r.clientName,
        value: `${r.assignedSales?.name || 'Unassigned'} — ${formatDate(r.nextFollowupDate)}`,
      })),
      [{ type: 'navigate', label: 'View Pending Follow-Ups', href: '/sales/enquiry-reminders?range=today' }],
      [
        {
          id: 'followups',
          title: 'Pending follow-ups',
          rows: rows.map((r: any) => ({
            client: r.clientName,
            phone: r.phone,
            salesperson: r.assignedSales?.name || 'Unassigned',
            due: formatDate(r.nextFollowupDate),
            city: r.city,
          })),
        },
      ],
    );
  }

  private async enquiryInProcess(filters: ChatbotFilters) {
    const range = resolveDateRange(filters);
    const count = await prisma.inquiry.count({
      where: {
        createdAt: { gte: range.startDate, lte: range.endDate },
        performanceStage: 'IN_PROCESS',
      },
    });
    return this.base(
      'ENQUIRY_IN_PROCESS',
      filters,
      `${count} enquiry/enquiries are still in process.`,
      [{ label: 'In process', value: String(count) }],
      [{ type: 'navigate', label: 'Open Enquiries', href: '/enquiries' }],
    );
  }

  private async enquiryInterestByLocation(filters: ChatbotFilters) {
    const where: any = {};
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
    if (filters.area) where.area = { contains: filters.area, mode: 'insensitive' };
    if (filters.landmark) where.location = { contains: filters.landmark, mode: 'insensitive' };
    const rows = await prisma.inquiry.findMany({
      where,
      select: { id: true, clientName: true, phone: true, city: true, area: true, location: true, status: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    return this.base(
      'ENQUIRY_INTEREST_BY_LOCATION',
      filters,
      `${rows.length} enquiry/enquiries found for the selected location interest.`,
      rows.slice(0, 5).map((r: any) => ({
        label: r.clientName,
        value: `${r.city}${r.area ? `, ${r.area}` : ''}`,
      })),
      [{ type: 'navigate', label: 'Open Enquiries', href: '/enquiries' }],
      [
        {
          id: 'interest',
          title: 'Interested clients',
          rows: rows.map((r: any) => ({
            client: r.clientName,
            phone: r.phone,
            location: [r.city, r.area, r.location].filter(Boolean).join(', '),
            status: String(r.status),
          })),
        },
      ],
    );
  }

  private async countProposals(start: Date, end: Date, salesUserId?: string) {
    const proposals = await prisma.proposal.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(salesUserId ? { salesUserId } : {}),
        status: { in: ['SENT', 'PARTIAL_FINALIZED', 'FINALIZED'] },
      },
      select: { id: true, clientId: true, createdAt: true },
    });
    const clientFirstProposal = new Map<string, Date>();
    const allClientProposals = await prisma.proposal.findMany({
      select: { clientId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const p of allClientProposals) {
      if (!clientFirstProposal.has(p.clientId)) clientFirstProposal.set(p.clientId, p.createdAt);
    }
    let newParty = 0;
    for (const p of proposals) {
      const first = clientFirstProposal.get(p.clientId);
      if (first && first.getTime() === p.createdAt.getTime()) newParty += 1;
    }
    return { total: proposals.length, newParty };
  }

  private async proposalStats(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const counts = await this.countProposals(range.startDate, range.endDate, filters.salespersonId);
    return this.base(
      'PROPOSAL_STATS',
      filters,
      `${counts.total} proposal(s) sent in ${formatPeriod(range.startDate, range.endDate)}.`,
      [
        { label: 'Unique proposals sent', value: String(counts.total) },
        { label: 'New-party proposals', value: String(counts.newParty) },
      ],
      [{ type: 'navigate', label: 'Open Proposal List', href: '/proposals' }],
      undefined,
      formatPeriod(range.startDate, range.endDate),
    );
  }

  private async proposalNewParty(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getOverview({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      currentUserId: actor.userId,
      currentRole: actor.role,
    });
    const rows = await Promise.all(
      (data.salespersonBreakdown || []).map(async (sp: any) => {
        const c = await this.countProposals(range.startDate, range.endDate, sp.salespersonId);
        return { name: sp.salespersonName, ...c };
      }),
    );
    return this.base(
      'PROPOSAL_NEW_PARTY',
      filters,
      `New-party proposals by salesperson for ${formatPeriod(range.startDate, range.endDate)}.`,
      rows.slice(0, 6).map((r) => ({
        label: r.name,
        value: `${r.newParty} new-party / ${r.total} total`,
      })),
      [{ type: 'navigate', label: 'Open Proposals', href: '/proposals' }],
    );
  }

  private async countFollowups(start: Date, end: Date, salesUserId?: string) {
    const where: any = {
      nextFollowupDate: { gte: start, lte: end },
    };
    if (salesUserId) where.assignedSalesId = salesUserId;
    const [completed, pending] = await Promise.all([
      prisma.inquiry.count({ where: { ...where, followupStatus: 'DONE' } }),
      prisma.inquiry.count({ where: { ...where, followupStatus: 'PENDING' } }),
    ]);
    return { completed, pending };
  }

  private async followupStats(filters: ChatbotFilters) {
    const range = resolveDateRange(filters);
    const stats = await this.countFollowups(range.startDate, range.endDate);
    const overdue = await prisma.inquiry.count({
      where: {
        followupStatus: 'PENDING',
        nextFollowupDate: { lt: new Date() },
      },
    });
    return this.base(
      'FOLLOWUP_STATS',
      filters,
      `Follow-ups for ${formatPeriod(range.startDate, range.endDate)}: ${stats.completed} completed, ${stats.pending} pending, ${overdue} overdue overall.`,
      [
        { label: 'Completed', value: String(stats.completed) },
        { label: 'Pending', value: String(stats.pending) },
        { label: 'Overdue (all time)', value: String(overdue) },
      ],
      [{ type: 'navigate', label: 'View Pending Follow-Ups', href: '/sales/enquiry-reminders' }],
      undefined,
      formatPeriod(range.startDate, range.endDate),
    );
  }

  private async clientSummary(filters: ChatbotFilters) {
    const clients = await resolveClient(filters.clientName);
    if (!clients?.length) {
      return this.base('CLIENT_SUMMARY', filters, 'No matching client found.', [], []);
    }
    const client = clients[0];
    const [contracts, tokens] = await Promise.all([
      prisma.contract.findMany({ where: { clientId: client.id }, include: { hoarding: { select: { code: true, status: true } } } }),
      prisma.bookingToken.findMany({ where: { clientId: client.id }, include: { hoarding: { select: { code: true } } } }),
    ]);
    const live = contracts.filter((c: { status: string }) => ['ACTIVE', 'EXPIRING_SOON'].includes(String(c.status))).length;
    return this.base(
      'CLIENT_SUMMARY',
      { ...filters, clientName: client.name },
      `${client.name} — booking history summary`,
      [
        { label: 'Total contracts', value: String(contracts.length) },
        { label: 'Currently active', value: String(live) },
        { label: 'Booking tokens', value: String(tokens.length) },
      ],
      [{ type: 'navigate', label: 'View Client History', href: `/clients/history?clientId=${client.id}` }],
      [
        {
          id: 'client-hoardings',
          title: 'Hoarding cycles',
          rows: contracts.slice(0, 30).map((c: any) => ({
            hoarding: c.hoarding?.code || 'N/A',
            status: String(c.status),
            start: formatDate(c.startDate),
            end: formatDate(c.endDate),
            value: formatInr(Number(c.totalValue || 0)),
          })),
        },
      ],
    );
  }

  private async clientRenewalsDue(filters: ChatbotFilters, actor: ChatbotActor) {
    const days = 30;
    const renewals = await contractService.listRenewalsDue({
      actorId: actor.userId,
      actorRole: actor.role,
      days,
    });
    const list = Array.isArray(renewals) ? renewals : (renewals as any)?.items || [];
    const clientMap = new Map<string, number>();
    for (const r of list) {
      const name = r.clientName || r.client?.name || 'Unknown';
      clientMap.set(name, (clientMap.get(name) || 0) + 1);
    }
    return this.base(
      'CLIENT_RENEWALS_DUE',
      filters,
      `${clientMap.size} client(s) have renewals due in the next ${days} days.`,
      Array.from(clientMap.entries())
        .slice(0, 8)
        .map(([name, count]) => ({ label: name, value: `${count} hoarding(s)` })),
      [{ type: 'navigate', label: 'Open Upcoming Expiries', href: `/sales/renewals-due?days=${days}` }],
    );
  }

  private async clientTopByRevenue(filters: ChatbotFilters, actor: ChatbotActor) {
    const range = resolveDateRange(filters);
    const data = await SalesPerformanceService.getClients({
      startDate: toIsoDate(range.startDate),
      endDate: toIsoDate(range.endDate),
      currentUserId: actor.userId,
      currentRole: actor.role,
    });
    const clients = (data.clients || [])
      .sort((a: any, b: any) => Number(b.recognizedRevenue || 0) - Number(a.recognizedRevenue || 0))
      .slice(0, 10);
    return this.base(
      'CLIENT_TOP_BY_REVENUE',
      filters,
      clients.length
        ? `Top client: ${clients[0].clientName} with ${formatInr(Number(clients[0].recognizedRevenue || 0))} recognised revenue.`
        : 'No client revenue data found for this period.',
      clients.slice(0, 5).map((c: any) => ({
        label: c.clientName,
        value: formatInr(Number(c.recognizedRevenue || 0)),
      })),
      [{ type: 'navigate', label: 'View Client History', href: '/clients/history' }],
    );
  }

  private async clientActiveHoardings(filters: ChatbotFilters) {
    const contracts = await prisma.contract.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] } },
      include: { client: { select: { name: true } }, hoarding: { select: { code: true } } },
    });
    const map = new Map<string, number>();
    for (const c of contracts) {
      const name = c.client?.name || 'Unknown';
      map.set(name, (map.get(name) || 0) + 1);
    }
    const top = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return this.base(
      'CLIENT_ACTIVE_HOARDINGS',
      filters,
      top.length
        ? `${top[0][0]} has the most active hoardings (${top[0][1]}).`
        : 'No active client hoardings found.',
      top.slice(0, 5).map(([name, count]) => ({ label: name, value: String(count) })),
      [{ type: 'navigate', label: 'View Client History', href: '/clients/history' }],
    );
  }

  private generalHelp(): ChatbotResponse {
    return this.base(
      'GENERAL_HELP',
      {},
      'Ask me about sales, hoardings, rent, enquiries, proposals, renewals, and business performance.',
      [
        { label: 'Languages', value: 'English, Hinglish, Gujlish' },
        { label: 'Examples', value: 'Total sales this month, rent due in 7 days, Mehsana ma ketla hoarding khali che?' },
      ],
      [],
    );
  }
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export const chatbotDataService = new ChatbotDataService();
