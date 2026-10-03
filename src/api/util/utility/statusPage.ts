/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { In, MoreThan, Not } from "typeorm";
import { RESOLVED_INCIDENT_STATES, StatusComponent, StatusComponentStatus, StatusIncident } from "@spacebar/database";
import { Config, Snowflake } from "@spacebar/util";

// statuspage.io-compatible shapes, so existing status tooling (and the discord client's upcoming.json poll) understand them
const IMPACT_SEVERITY = { none: 0, maintenance: 1, minor: 2, major: 3, critical: 4 } as const;
type Indicator = keyof typeof IMPACT_SEVERITY;

const INDICATOR_DESCRIPTIONS: Record<Indicator, string> = {
    none: "All Systems Operational",
    maintenance: "Service Under Maintenance",
    minor: "Minor Service Outage",
    major: "Partial System Outage",
    critical: "Major Service Outage",
};

const COMPONENT_INDICATOR: Record<StatusComponentStatus, Indicator> = {
    operational: "none",
    under_maintenance: "maintenance",
    degraded_performance: "minor",
    partial_outage: "major",
    major_outage: "critical",
};

export function serializeComponent(component: StatusComponent) {
    return {
        id: component.id,
        name: component.name,
        description: component.description ?? null,
        status: component.status,
        position: component.position,
        updated_at: component.updated_at,
    };
}

export function serializeIncident(incident: StatusIncident, components: StatusComponent[]) {
    return {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        impact: incident.impact,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        resolved_at: incident.resolved_at ?? null,
        scheduled_for: incident.scheduled_for ?? null,
        scheduled_until: incident.scheduled_until ?? null,
        components: components.filter((c) => incident.component_ids.includes(c.id)).map(serializeComponent),
        incident_updates: [...incident.updates].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
}

const DAY = 24 * 60 * 60 * 1000;
const UPTIME_DAYS = 90;
const OUTAGE_WEIGHT: Partial<Record<Indicator, number>> = { major: 0.3, critical: 1 };

function componentUptime(component: StatusComponent, incidents: StatusIncident[], now: number) {
    const today = Math.floor(now / DAY) * DAY;
    const firstDay = today - (UPTIME_DAYS - 1) * DAY;
    const createdAt = Number(BigInt(component.id) >> 22n) + Snowflake.EPOCH;
    const tracked = Math.max(firstDay, createdAt);
    const days = Array.from({ length: UPTIME_DAYS }, (_, i) => ({
        date: new Date(firstDay + i * DAY).toISOString().slice(0, 10),
        indicator: (firstDay + (i + 1) * DAY <= createdAt ? null : "none") as Indicator | null,
    }));
    let downtime = 0;
    for (const incident of incidents) {
        if (incident.is_maintenance || !incident.component_ids.includes(component.id)) continue;
        const start = Math.max(incident.created_at.getTime(), tracked);
        const end = Math.min(incident.resolved_at?.getTime() ?? now, now);
        if (end <= start) continue;
        downtime += (end - start) * (OUTAGE_WEIGHT[incident.impact] ?? 0);
        for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
            const entry = days[(day - firstDay) / DAY];
            if (entry?.indicator && IMPACT_SEVERITY[incident.impact] > IMPACT_SEVERITY[entry.indicator]) entry.indicator = incident.impact;
        }
    }
    const current = COMPONENT_INDICATOR[component.status];
    const last = days[days.length - 1];
    if (current !== "maintenance" && IMPACT_SEVERITY[current] > IMPACT_SEVERITY[last.indicator ?? "none"]) last.indicator = current;
    const span = now - tracked;
    return { uptime: span > 0 ? Math.max(0, Math.round((1 - downtime / span) * 10000) / 100) : 100, uptime_days: days };
}

export async function getStatusSummary() {
    const now = Date.now();
    const components = await StatusComponent.find({ order: { position: "ASC", id: "ASC" } });
    const open = await StatusIncident.find({ where: { status: Not(In(RESOLVED_INCIDENT_STATES)) }, order: { created_at: "DESC" } });
    const recent = await StatusIncident.find({
        where: { status: In(RESOLVED_INCIDENT_STATES), resolved_at: MoreThan(new Date(now - 14 * DAY)) },
        order: { resolved_at: "DESC" },
        take: 25,
    });
    const quarter = components.length
        ? await StatusIncident.find({ where: { status: In(RESOLVED_INCIDENT_STATES), resolved_at: MoreThan(new Date(now - UPTIME_DAYS * DAY)) } })
        : [];

    const incidents = open.filter((i) => !i.is_maintenance);
    const maintenances = open.filter((i) => i.is_maintenance);
    // upcoming maintenance shouldn't colour the page until it starts
    const activeMaintenances = maintenances.filter((i) => i.status !== "scheduled");

    let indicator: Indicator = "none";
    const raise = (candidate: Indicator) => {
        if (IMPACT_SEVERITY[candidate] > IMPACT_SEVERITY[indicator]) indicator = candidate;
    };
    for (const incident of [...incidents, ...activeMaintenances]) raise(incident.impact);
    for (const component of components) raise(COMPONENT_INDICATOR[component.status]);

    const updatedAt = [...components.map((c) => c.updated_at), ...open.map((i) => i.updated_at), ...recent.map((i) => i.updated_at)].reduce(
        (latest: Date | null, d) => (!latest || d > latest ? d : latest),
        null,
    );

    return {
        page: {
            id: Config.get().general.instanceId,
            name: Config.get().general.instanceName,
            url: Config.get().general.frontPage,
            updated_at: updatedAt ?? new Date(0),
        },
        status: { indicator, description: INDICATOR_DESCRIPTIONS[indicator] },
        components: components.map((c) => ({ ...serializeComponent(c), ...componentUptime(c, [...open, ...quarter], now) })),
        incidents: incidents.map((i) => serializeIncident(i, components)),
        scheduled_maintenances: maintenances.map((i) => serializeIncident(i, components)),
        history: recent.map((i) => serializeIncident(i, components)),
    };
}

export async function setComponentsStatus(ids: string[], status: StatusComponentStatus) {
    if (!ids.length) return;
    await StatusComponent.update({ id: In(ids) }, { status, updated_at: new Date() });
}

// once an incident closes, put its components back to operational unless another open incident still covers them
export async function releaseComponents(incident: StatusIncident) {
    if (!incident.component_ids.length) return;
    const stillOpen = await StatusIncident.find({ where: { status: Not(In(RESOLVED_INCIDENT_STATES)), id: Not(incident.id) }, select: { id: true, component_ids: true } });
    const busy = new Set(stillOpen.flatMap((i) => i.component_ids));
    await setComponentsStatus(
        incident.component_ids.filter((id) => !busy.has(id)),
        "operational",
    );
}
