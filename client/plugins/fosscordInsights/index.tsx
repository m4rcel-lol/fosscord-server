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

import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { RestAPI, Text, useEffect, useState, useStateFromStores } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

const GuildSettingsStore = findStoreLazy("GuildSettingsStore") as { getGuildId(): string | null };

const DAY = 86_400_000;
const RANGES = [7, 30, 90];
const SOURCES: [string, string][] = [
    ["invites", "Invites"],
    ["vanity_joins", "Vanity URL"],
    ["discovery_joins", "Server discovery"],
    ["bot_joins", "Added by a member or bot"],
    ["integration_joins", "Integrations"],
    ["hubs_joins", "Hubs"],
    ["other_joins", "Other"],
];

type Row = Record<string, string | number | null | undefined>;
type Series = { label: string; tone: "primary" | "secondary"; values: number[] };
type Report = {
    days: string[];
    engagement: Map<string, Row>;
    joins: Map<string, number>;
    leaves: Map<string, number>;
    textChannels: Row[];
    voiceChannels: Row[];
    invites: Row[];
    sources: Row[];
};

const number = new Intl.NumberFormat();
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const load = async (guildId: string, range: number): Promise<Report> => {
    const end = new Date();
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (range - 1) * DAY);
    const query = { start: start.toISOString(), end: end.toISOString(), interval: 1 };
    const get = (path: string) => RestAPI.get({ url: `/guilds/${guildId}/analytics/${path}`, query }).then((res: { body: Row[] }) => res.body);
    const [engagement, joins, leavers, textChannels, voiceChannels, invites, sources] = await Promise.all([
        get("engagement/overview"),
        get("growth-activation/joins"),
        get("growth-activation/leavers"),
        get("engagement/text-channels"),
        get("engagement/voice-channels"),
        get("growth-activation/joins-by-invite-link"),
        get("growth-activation/joins-by-source"),
    ]);
    const day = (row: Row) => String(row.day_pt).slice(0, 10);
    const days = Array.from({ length: range }, (_, i) => new Date(start.getTime() + i * DAY).toISOString().slice(0, 10));
    const leaves = new Map<string, number>();
    for (const row of leavers) leaves.set(day(row), (leaves.get(day(row)) ?? 0) + Number(row.leavers));
    return {
        days,
        engagement: new Map(engagement.map((row) => [day(row), row])),
        joins: new Map(joins.map((row) => [day(row), Number(row.joins)])),
        leaves,
        textChannels,
        voiceChannels,
        invites,
        sources,
    };
};

function TimeChart({ title, kind, days, series, unit, average }: { title: string; kind: "bar" | "line"; days: string[]; series: Series[]; unit?: string; average?: boolean }) {
    const [hovered, setHovered] = useState<number | null>(null);
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const width = 600;
    const height = 140;
    const column = width / days.length;
    const barWidth = Math.max(1, (column - 4) / series.length - (series.length > 1 ? 1 : 0));
    const y = (value: number) => height - (value / max) * (height - 6);
    const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);

    return (
        <section className="fosscord-insights-card" aria-label={title}>
            <header className="fosscord-insights-card-header">
                <Text variant="text-md/semibold" color="text-strong">
                    {title}
                </Text>
                <div className="fosscord-insights-legend">
                    {series.map((s) => (
                        <span key={s.label} className="fosscord-insights-legend-item">
                            <span className={`fosscord-insights-swatch fosscord-insights-${s.tone}`} />
                            <Text variant="text-xs/normal" color="text-muted">
                                {s.label}
                            </Text>
                            <Text variant="text-sm/semibold" color="text-default" className="fosscord-insights-number">
                                {average ? number.format(Math.round((sum(s.values) / Math.max(1, s.values.length)) * 10) / 10) : number.format(sum(s.values))}
                                {unit ? ` ${unit}` : ""}
                                {average ? " a day" : ""}
                            </Text>
                        </span>
                    ))}
                </div>
            </header>
            <div className="fosscord-insights-plot" onMouseLeave={() => setHovered(null)}>
                <div className="fosscord-insights-axis-y">
                    <Text variant="text-xxs/normal" color="text-muted" className="fosscord-insights-number">
                        {number.format(max)}
                    </Text>
                    <Text variant="text-xxs/normal" color="text-muted" className="fosscord-insights-number">
                        0
                    </Text>
                </div>
                <div className="fosscord-insights-canvas">
                    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
                        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="fosscord-insights-baseline" vectorEffect="non-scaling-stroke" />
                        <line x1={0} x2={width} y1={6} y2={6} className="fosscord-insights-gridline" vectorEffect="non-scaling-stroke" />
                        {hovered !== null && <rect x={hovered * column} y={0} width={column} height={height} className="fosscord-insights-hover" />}
                        {kind === "bar"
                            ? series.map((s, si) =>
                                  s.values.map((value, i) =>
                                      value > 0 ? (
                                          <rect
                                              key={`${si}:${i}`}
                                              x={i * column + 2 + si * (barWidth + 1)}
                                              y={y(value)}
                                              width={barWidth}
                                              height={height - y(value)}
                                              rx={Math.min(2, barWidth / 2)}
                                              className={`fosscord-insights-${s.tone}`}
                                          />
                                      ) : null,
                                  ),
                              )
                            : series.map((s) => (
                                  <polyline
                                      key={s.label}
                                      points={s.values.map((value, i) => `${i * column + column / 2},${y(value)}`).join(" ")}
                                      className={`fosscord-insights-line fosscord-insights-${s.tone}`}
                                      vectorEffect="non-scaling-stroke"
                                  />
                              ))}
                        {days.map((day, i) => (
                            <rect key={day} x={i * column} y={0} width={column} height={height} fill="transparent" onMouseEnter={() => setHovered(i)} />
                        ))}
                    </svg>
                    {hovered !== null && (
                        <div
                            className="fosscord-insights-tooltip"
                            role="status"
                            style={{ left: `${((hovered + 0.5) / days.length) * 100}%`, translate: hovered > days.length / 2 ? "-100% 0" : "0 0" }}
                        >
                            <Text variant="text-xs/semibold" color="text-strong">
                                {dayLabel(days[hovered])}
                            </Text>
                            {series.map((s) => (
                                <span key={s.label} className="fosscord-insights-legend-item">
                                    <span className={`fosscord-insights-swatch fosscord-insights-${s.tone}`} />
                                    <Text variant="text-xs/normal" color="text-default" className="fosscord-insights-number">
                                        {s.label}: {number.format(s.values[hovered])}
                                        {unit ? ` ${unit}` : ""}
                                    </Text>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="fosscord-insights-axis-x">
                        {ticks.map((i) => (
                            <Text key={i} variant="text-xxs/normal" color="text-muted" style={{ left: `${((i + 0.5) / days.length) * 100}%` }}>
                                {dayLabel(days[i])}
                            </Text>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function Ranking({ title, rows, unit, empty }: { title: string; rows: [string, number][]; unit: string; empty: string }) {
    const max = Math.max(1, ...rows.map(([, value]) => value));
    return (
        <section className="fosscord-insights-card" aria-label={title}>
            <Text variant="text-md/semibold" color="text-strong">
                {title}
            </Text>
            {rows.length ? (
                <ol className="fosscord-insights-ranking">
                    {rows.map(([label, value]) => (
                        <li key={label}>
                            <div className="fosscord-insights-ranking-label">
                                <Text variant="text-sm/medium" color="text-default" className="fosscord-insights-ellipsis" title={label}>
                                    {label}
                                </Text>
                                <Text variant="text-sm/normal" color="text-muted" className="fosscord-insights-number">
                                    {number.format(value)} {unit}
                                </Text>
                            </div>
                            <div className="fosscord-insights-meter">
                                <div className="fosscord-insights-primary" style={{ width: `${(value / max) * 100}%` }} />
                            </div>
                        </li>
                    ))}
                </ol>
            ) : (
                <Text variant="text-sm/normal" color="text-muted" className="fosscord-insights-empty">
                    {empty}
                </Text>
            )}
        </section>
    );
}

const totals = (rows: Row[], key: string, field: string, top = 5) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(String(row[key]), (map.get(String(row[key])) ?? 0) + Number(row[field] ?? 0));
    return [...map.entries()]
        .filter(([, value]) => value > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, top);
};

function InsightsCharts() {
    const guildId = useStateFromStores([GuildSettingsStore as never], () => GuildSettingsStore.getGuildId());
    const [range, setRange] = useState(30);
    const [report, setReport] = useState<Report | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!guildId) return;
        let cancelled = false;
        setFailed(false);
        load(guildId, range).then(
            (result) => !cancelled && setReport(result),
            () => !cancelled && setFailed(true),
        );
        return () => {
            cancelled = true;
        };
    }, [guildId, range]);

    if (!guildId) return null;
    const days = report?.days ?? [];
    const metric = (field: string) => days.map((day) => Number(report?.engagement.get(day)?.[field] ?? 0));
    const channelName = (rows: Row[], prefix: string) => new Map(rows.map((row) => [String(row.channel_id), `${prefix}${row.channel_name ?? row.channel_id}`]));
    const textNames = channelName(report?.textChannels ?? [], "#");
    const voiceNames = channelName(report?.voiceChannels ?? [], "");
    const sourceTotals = SOURCES.map(([field, label]) => [label, sum((report?.sources ?? []).map((row) => Number(row[field] ?? 0)))] as [string, number]).filter(
        ([, value]) => value > 0,
    );

    return (
        <div className="fosscord-insights">
            <div className="fosscord-insights-toolbar">
                <Text variant="text-lg/semibold" color="text-strong">
                    Activity
                </Text>
                <div className="fosscord-insights-range" role="group" aria-label="Time range">
                    {RANGES.map((days) => (
                        <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>
                            {days} days
                        </button>
                    ))}
                </div>
            </div>
            {failed ? (
                <Text variant="text-sm/normal" color="text-feedback-critical">
                    Insights could not be loaded. Close and reopen this page to try again.
                </Text>
            ) : !report ? (
                <Text variant="text-sm/normal" color="text-muted">
                    Loading insights
                </Text>
            ) : (
                <div className="fosscord-insights-grid">
                    <TimeChart
                        title="Members joined and left"
                        kind="bar"
                        days={days}
                        series={[
                            { label: "Joined", tone: "primary", values: days.map((day) => report.joins.get(day) ?? 0) },
                            { label: "Left", tone: "secondary", values: days.map((day) => report.leaves.get(day) ?? 0) },
                        ]}
                    />
                    <TimeChart title="Messages sent" kind="bar" days={days} series={[{ label: "Messages", tone: "primary", values: metric("messages") }]} />
                    <TimeChart
                        title="Visitors and communicators"
                        kind="line"
                        average
                        days={days}
                        series={[
                            { label: "Visitors", tone: "primary", values: metric("visitors") },
                            { label: "Communicators", tone: "secondary", values: metric("communicators") },
                        ]}
                    />
                    <TimeChart title="Time in voice" kind="bar" days={days} unit="min" series={[{ label: "Voice", tone: "primary", values: metric("speaking_minutes") }]} />
                    <Ranking
                        title="Top text channels"
                        unit="messages"
                        rows={totals(report.textChannels, "channel_id", "messages_sent").map(([id, value]) => [textNames.get(id) ?? id, value])}
                        empty="Nobody has sent a message in this time range."
                    />
                    <Ranking
                        title="Top voice channels"
                        unit="min"
                        rows={totals(report.voiceChannels, "channel_id", "speaking_minutes").map(([id, value]) => [voiceNames.get(id) ?? id, value])}
                        empty="Nobody has joined a voice channel in this time range."
                    />
                    <Ranking title="Invites used" unit="joins" rows={totals(report.invites, "invite_link", "joins")} empty="No one joined with an invite in this time range." />
                    <Ranking title="How members joined" unit="joins" rows={sourceTotals.sort(([, a], [, b]) => b - a)} empty="No one joined in this time range." />
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    name: "FosscordInsights",
    description: "Shows Server Insights in server settings for every server, with charts for members, messages, voice, channels and invites served by this instance.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    renderCharts: () => <InsightsCharts />,

    patches: [
        {
            find: ".GUILD_ANALYTICS_GUILD_SETTINGS_MENU)",
            replacement: [
                {
                    match: /(\.GuildFeatures\.VERIFIED\)\))&&\i<500/,
                    replace: "$1&&!1",
                },
                {
                    match: /\(0,(\i)\.jsxs\)\("div",\{className:\i\.\i,children:\[\(0,\1\.jsx\)\("div",\{className:\i\.\i\}\),\(0,\1\.jsx\)\(\i\.\i,\{className:\i\.\i,variant:"text-sm\/normal",children:\i\.intl\.string\(\i\.t#{intl::A5vswv::raw}\)\}\),\(0,\1\.jsx\)\(\i,\{\}\)\]\}\),((\i)\?\(0,\1\.jsx\)\("div",\{className:\i\.\i,children:\(0,\1\.jsx\)\(\i\.\i,\{\}\)\}\):\i)\]/,
                    replace: "$2,!$3&&$self.renderCharts()]",
                },
            ],
        },
    ],
});
