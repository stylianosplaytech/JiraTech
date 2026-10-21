import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DashboardGadget, GadgetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { BREAKDOWN_FIELDS, BreakdownField, SearchService } from '../search/search.service';
import { CreateDashboardDto, CreateGadgetDto, GadgetConfigDto, UpdateDashboardDto, UpdateGadgetDto } from './dashboards.dto';

const OWNER = { select: { id: true, name: true } };
const GADGET_INCLUDE = { filter: { select: { id: true, name: true } } };
const DEFAULT_ROWS = 10;

@Injectable()
export class DashboardsService {
  constructor(private prisma: PrismaService, private search: SearchService) {}

  // ─── Dashboards ────────────────────────────────────────────────────────────

  list(user: AuthUser) {
    return this.prisma.dashboard.findMany({
      where: { OR: [{ ownerId: user.id }, { shared: true }] },
      include: { owner: OWNER, _count: { select: { gadgets: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string, user: AuthUser) {
    const dashboard = await this.prisma.dashboard.findUnique({
      where: { id },
      include: { owner: OWNER, gadgets: { include: GADGET_INCLUDE, orderBy: { position: 'asc' } } },
    });
    if (!dashboard || (dashboard.ownerId !== user.id && !dashboard.shared)) throw new NotFoundException('Dashboard not found');
    return { ...dashboard, gadgets: dashboard.gadgets.map(withConfig) };
  }

  create(dto: CreateDashboardDto, user: AuthUser) {
    return this.prisma.dashboard.create({
      data: { name: dto.name.trim(), description: dto.description?.trim() || null, shared: dto.shared ?? false, ownerId: user.id },
      include: { owner: OWNER },
    });
  }

  async update(id: string, dto: UpdateDashboardDto, user: AuthUser) {
    await this.assertOwner(id, user);
    return this.prisma.dashboard.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.shared !== undefined && { shared: dto.shared }),
      },
      include: { owner: OWNER },
    });
  }

  async remove(id: string, user: AuthUser) {
    await this.assertOwner(id, user);
    await this.prisma.dashboard.delete({ where: { id } });
    return { deleted: true };
  }

  /** A private copy of a dashboard the user can see, to rearrange without touching the original. */
  async duplicate(id: string, user: AuthUser) {
    const source = await this.get(id, user);
    return this.prisma.dashboard.create({
      data: {
        name: source.ownerId === user.id ? `${source.name} (copy)` : source.name,
        description: source.description,
        ownerId: user.id,
        gadgets: {
          create: source.gadgets.map((g) => ({
            type: g.type, title: g.title, filterId: g.filterId, config: JSON.stringify(g.config), position: g.position, wide: g.wide,
          })),
        },
      },
      include: { owner: OWNER },
    });
  }

  // ─── Gadgets ───────────────────────────────────────────────────────────────

  async addGadget(dashboardId: string, dto: CreateGadgetDto, user: AuthUser) {
    await this.assertOwner(dashboardId, user);
    const filter = await this.search.getFilter(dto.filterId, user);
    const config = cleanConfig(dto.type, dto.config);
    const last = await this.prisma.dashboardGadget.aggregate({ where: { dashboardId }, _max: { position: true } });
    const gadget = await this.prisma.dashboardGadget.create({
      data: {
        dashboardId,
        type: dto.type,
        title: dto.title?.trim() || filter.name,
        filterId: filter.id,
        config: JSON.stringify(config),
        wide: dto.wide ?? dto.type === GadgetType.FILTER_RESULTS,
        position: (last._max.position ?? -1) + 1,
      },
      include: GADGET_INCLUDE,
    });
    await this.touch(dashboardId);
    return withConfig(gadget);
  }

  async updateGadget(dashboardId: string, gadgetId: string, dto: UpdateGadgetDto, user: AuthUser) {
    await this.assertOwner(dashboardId, user);
    const gadget = await this.findGadget(dashboardId, gadgetId);
    if (dto.filterId) await this.search.getFilter(dto.filterId, user);
    const updated = await this.prisma.dashboardGadget.update({
      where: { id: gadgetId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.filterId !== undefined && { filterId: dto.filterId }),
        ...(dto.wide !== undefined && { wide: dto.wide }),
        ...(dto.config !== undefined && { config: JSON.stringify(cleanConfig(gadget.type, dto.config)) }),
      },
      include: GADGET_INCLUDE,
    });
    await this.touch(dashboardId);
    return withConfig(updated);
  }

  async removeGadget(dashboardId: string, gadgetId: string, user: AuthUser) {
    await this.assertOwner(dashboardId, user);
    await this.findGadget(dashboardId, gadgetId);
    await this.prisma.dashboardGadget.delete({ where: { id: gadgetId } });
    await this.touch(dashboardId);
    return { deleted: true };
  }

  /** Lay the gadgets out in the given order. Every gadget on the dashboard must be listed once. */
  async reorder(dashboardId: string, ids: string[], user: AuthUser) {
    await this.assertOwner(dashboardId, user);
    const existing = await this.prisma.dashboardGadget.findMany({ where: { dashboardId }, select: { id: true } });
    const same = ids.length === existing.length && new Set(ids).size === ids.length && existing.every((g) => ids.includes(g.id));
    if (!same) throw new BadRequestException('List every gadget on the dashboard exactly once');
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.dashboardGadget.update({ where: { id }, data: { position } })));
    await this.touch(dashboardId);
    return this.get(dashboardId, user);
  }

  /**
   * What one gadget shows right now. The saved filter runs as the viewer, so `currentUser()` means them
   * and they only ever see issues from projects they can browse, however the dashboard was shared.
   */
  async gadgetData(dashboardId: string, gadgetId: string, user: AuthUser) {
    await this.get(dashboardId, user);
    const gadget = await this.findGadget(dashboardId, gadgetId);
    const filter = gadget.filterId ? await this.prisma.savedFilter.findUnique({ where: { id: gadget.filterId } }) : null;
    if (!filter) return { type: gadget.type, filterMissing: true as const };
    const config = parseConfig(gadget.config);
    const base = { jql: filter.jql, filterId: filter.id, filterName: filter.name };

    switch (gadget.type) {
      case GadgetType.FILTER_COUNT:
        return { type: gadget.type, ...base, total: await this.search.count(filter.jql, user) };
      case GadgetType.BREAKDOWN: {
        const groupBy = config.groupBy ?? 'status';
        return { type: gadget.type, ...base, groupBy, chart: pick(config.chart, BREAKDOWN_CHARTS), ...(await this.search.countBy(filter.jql, groupBy, user)) };
      }
      case GadgetType.TREND: {
        const days = config.days ?? 30;
        const bucket = config.bucket ?? 'day';
        return { type: gadget.type, ...base, days, bucket, chart: pick(config.chart, SERIES_CHARTS), ...(await this.trend(filter.jql, days, bucket, user)) };
      }
      case GadgetType.CREATED_VS_RESOLVED: {
        const days = config.days ?? 30;
        const bucket = config.bucket ?? 'day';
        return { type: gadget.type, ...base, days, bucket, chart: pick(config.chart, SERIES_CHARTS, 'line'), ...(await this.createdVsResolved(filter.jql, days, bucket, user)) };
      }
      case GadgetType.FILTER_RESULTS: {
        const result = await this.search.search(filter.jql, user, 0, config.maxRows ?? DEFAULT_ROWS);
        return { type: gadget.type, ...base, total: result.total, issues: result.issues };
      }
    }
  }

  /** Issues created per day (or per week, weeks starting Monday) over the last `days` days, empty buckets included. */
  private async trend(jql: string, days: number, bucket: 'day' | 'week', user: AuthUser) {
    const { first, counts, bump } = buckets(days, bucket);
    for (const created of await this.search.createdSince(jql, first, user)) bump(counts, created);
    const points = [...counts].map(([date, count]) => ({ date, count }));
    return { total: points.reduce((n, p) => n + p.count, 0), points };
  }

  /** Created and resolved counts in each bucket, from the same filter. */
  private async createdVsResolved(jql: string, days: number, bucket: 'day' | 'week', user: AuthUser) {
    const { first, counts: created, bump } = buckets(days, bucket);
    const resolved = new Map([...created].map(([k]) => [k, 0]));
    for (const row of await this.search.createdAndResolvedSince(jql, first, user)) {
      if (row.createdAt >= first) bump(created, row.createdAt);
      if (row.resolvedAt && row.resolvedAt >= first) bump(resolved, row.resolvedAt);
    }
    const points = [...created].map(([date, c]) => ({ date, created: c, resolved: resolved.get(date) ?? 0 }));
    return {
      createdTotal: points.reduce((n, p) => n + p.created, 0),
      resolvedTotal: points.reduce((n, p) => n + p.resolved, 0),
      points,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async assertOwner(id: string, user: AuthUser) {
    const dashboard = await this.prisma.dashboard.findUnique({ where: { id }, select: { ownerId: true, shared: true } });
    if (!dashboard || (dashboard.ownerId !== user.id && !dashboard.shared)) throw new NotFoundException('Dashboard not found');
    if (dashboard.ownerId !== user.id) throw new ForbiddenException('Only the owner can change this dashboard');
  }

  private async findGadget(dashboardId: string, gadgetId: string) {
    const gadget = await this.prisma.dashboardGadget.findFirst({ where: { id: gadgetId, dashboardId } });
    if (!gadget) throw new NotFoundException('Gadget not found');
    return gadget;
  }

  private touch(id: string) {
    return this.prisma.dashboard.update({ where: { id }, data: { updatedAt: new Date() } });
  }
}

const BREAKDOWN_CHARTS = ['bars', 'donut', 'pie'] as const;
const SERIES_CHARTS = ['bars', 'line'] as const;

/** The chart if it suits this kind of gadget, else the first (or given) default. */
function pick<T extends string>(chart: string | undefined, allowed: readonly T[], fallback: T = allowed[0]): T {
  return allowed.includes(chart as T) ? (chart as T) : fallback;
}

/** Empty per-day or per-week counters for the last `days` days (weeks start Monday), and how to count a date into them. */
function buckets(days: number, bucket: 'day' | 'week') {
  const today = startOfDay(new Date());
  const first = addDays(today, -(days - 1));
  const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
  const counts = new Map<string, number>();
  for (let d = bucket === 'week' ? monday(first) : first; d <= today; d = addDays(d, bucket === 'week' ? 7 : 1)) counts.set(dayKey(d), 0);
  const bump = (into: Map<string, number>, date: Date) => {
    const day = startOfDay(date);
    const key = dayKey(bucket === 'week' ? monday(day) : day);
    if (into.has(key)) into.set(key, into.get(key)! + 1);
  };
  return { first, counts, bump };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** yyyy-mm-dd in the server's local time. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseConfig(raw: string): GadgetConfigDto {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Keep only the settings that mean something for this kind of gadget. */
function cleanConfig(type: GadgetType, config?: GadgetConfigDto): GadgetConfigDto {
  if (type === GadgetType.FILTER_RESULTS) return { maxRows: config?.maxRows ?? DEFAULT_ROWS };
  if (type === GadgetType.BREAKDOWN) {
    const groupBy: BreakdownField = config?.groupBy ?? 'status';
    if (!BREAKDOWN_FIELDS.includes(groupBy)) throw new BadRequestException('Unknown field to count by');
    return { groupBy, chart: pick(config?.chart, BREAKDOWN_CHARTS) };
  }
  if (type === GadgetType.TREND || type === GadgetType.CREATED_VS_RESOLVED) {
    const days = config?.days ?? 30;
    return {
      days,
      bucket: config?.bucket ?? (days > 30 ? 'week' : 'day'),
      chart: pick(config?.chart, SERIES_CHARTS, type === GadgetType.TREND ? 'bars' : 'line'),
    };
  }
  return {};
}

function withConfig<T extends DashboardGadget>(gadget: T) {
  return { ...gadget, config: parseConfig(gadget.config) };
}
