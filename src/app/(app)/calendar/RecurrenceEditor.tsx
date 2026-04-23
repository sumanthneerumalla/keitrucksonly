"use client";
// TODO: This file is a local port of the ilamy-calendar RecurrenceEditor component.
// Once the PR #80 exporting RecurrenceEditor is merged and released
// (see: https://github.com/kcsujeet/ilamy-calendar), replace this file by importing directly:
//   import { RecurrenceEditor } from "@ilamy/calendar";
// and deleting this file. The T const below can also be removed — use t() from
// useIlamyResourceCalendarContext() instead once available.

import type { RRuleOptions } from "@ilamy/calendar";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import type { Weekday } from "rrule";
import { RRule } from "rrule";
import { Select } from "~/app/_components/shared/ui/select";

const T = {
	repeat: "Repeat",
	repeats: "Repeats",
	every: "Every",
	repeatOn: "Repeat on",
	ends: "Ends",
	never: "Never",
	after: "After",
	occurrences: "occurrences",
	on: "On",
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
	yearly: "Yearly",
	customRecurrence: "Custom recurrence",
	sun: "Sun",
	mon: "Mon",
	tue: "Tue",
	wed: "Wed",
	thu: "Thu",
	fri: "Fri",
	sat: "Sat",
} as const;

const FREQ_MAP = {
	DAILY: RRule.DAILY,
	WEEKLY: RRule.WEEKLY,
	MONTHLY: RRule.MONTHLY,
	YEARLY: RRule.YEARLY,
} as const;

const FREQ_TO_STR = Object.fromEntries(
	Object.entries(FREQ_MAP).map(([k, v]) => [v, k]),
) as Record<number, string>;

const WEEKDAYS = [
	RRule.SU,
	RRule.MO,
	RRule.TU,
	RRule.WE,
	RRule.TH,
	RRule.FR,
	RRule.SA,
];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const parseNum = (v: string) => Math.max(1, Number.parseInt(v, 10) || 1);

interface RecurrenceEditorProps {
	value?: RRuleOptions | null;
	onChange: (v: RRuleOptions | null) => void;
	disabled?: boolean;
	disabledReason?: string;
}

export function RecurrenceEditor({
	value,
	onChange,
	disabled = false,
	disabledReason,
}: RecurrenceEditorProps) {
	const [show, setShow] = useState(value != null);
	const [opts, setOpts] = useState<RRuleOptions | null>(value ?? null);

	useEffect(() => {
		setShow(value != null);
		if (value) setOpts(value);
	}, [value]);

	const getDescription = (o: RRuleOptions | null): string => {
		if (!o) return T.customRecurrence;
		try {
			const text = new RRule(o).toText();
			return text && !text.toLowerCase().includes("error")
				? text.charAt(0).toUpperCase() + text.slice(1)
				: T.customRecurrence;
		} catch {
			return T.customRecurrence;
		}
	};

	const weekDays = useMemo(
		() => DAY_KEYS.map((k, i) => ({ value: WEEKDAYS[i]!, label: T[k] })),
		[],
	);

	const update = (u: Partial<RRuleOptions>) => {
		if (!opts) return;
		const next = { ...opts, ...u } as RRuleOptions;
		setOpts(next);
		onChange(show ? next : null);
	};

	const toggle = (checked: boolean) => {
		setShow(checked);
		if (!checked) {
			onChange(null);
			return;
		}
		if (opts) {
			onChange(opts);
			return;
		}
		const def = { freq: RRule.DAILY, interval: 1 } as RRuleOptions;
		setOpts(def);
		onChange(def);
	};

	const toggleDay = (i: number) => {
		const curr = (opts?.byweekday as Weekday[] | undefined) ?? [];
		const day = WEEKDAYS[i]!;
		const next = curr.some((d) => d.weekday === day.weekday)
			? curr.filter((d) => d.weekday !== day.weekday)
			: [...curr, day];
		update({ byweekday: next.length ? next : undefined });
	};

	const setEndType = (type: "never" | "count" | "until") => {
		const u: Partial<RRuleOptions> = { count: undefined, until: undefined };
		if (type === "count") u.count = opts?.count ?? 1;
		if (type === "until")
			u.until = opts?.until ?? dayjs().add(1, "month").endOf("day").toDate();
		update(u);
	};

	const endType = opts?.until ? "until" : opts?.count ? "count" : "never";
	const freq = FREQ_TO_STR[opts?.freq ?? RRule.DAILY] ?? "DAILY";
	const byweekday: Weekday[] = Array.isArray(opts?.byweekday)
		? (opts.byweekday as Weekday[])
		: opts?.byweekday
			? [opts.byweekday as Weekday]
			: [];

	return (
		<div
			className={`rounded-md border border-[var(--border)] bg-[var(--card,var(--background))] ${disabled ? "pointer-events-none opacity-50" : ""}`}
			title={disabled ? disabledReason : undefined}
		>
			{/* Toggle row */}
			<div className="flex items-center gap-2 px-4 py-3">
				<input
					type="checkbox"
					id="recurrence-toggle"
					checked={show}
					disabled={disabled}
					onChange={(e) => toggle(e.target.checked)}
					className="h-4 w-4 rounded border-input accent-[var(--primary)]"
				/>
				<label
					htmlFor="recurrence-toggle"
					className="cursor-pointer select-none font-medium text-[var(--foreground)] text-sm"
				>
					{T.repeat}
				</label>
				{show && opts && (
					<span className="ml-auto text-[var(--muted-foreground)] text-xs">
						{getDescription(opts)}
					</span>
				)}
			</div>

			{show && (
				<div className="space-y-4 border-[var(--border)] border-t px-4 py-3">
					{/* Frequency + Interval */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="font-medium text-[var(--muted-foreground)] text-xs">
								{T.repeats}
							</label>
							<Select
								value={freq}
								onChange={(e) =>
									update({
										freq: FREQ_MAP[e.target.value as keyof typeof FREQ_MAP],
									})
								}
								className="h-8"
							>
								{Object.keys(FREQ_MAP).map((f) => (
									<option key={f} value={f}>
										{T[f.toLowerCase() as keyof typeof T]}
									</option>
								))}
							</Select>
						</div>
						<div className="space-y-1">
							<label className="font-medium text-[var(--muted-foreground)] text-xs">
								{T.every}
							</label>
							<input
								type="number"
								min={1}
								value={opts?.interval ?? 1}
								onChange={(e) => update({ interval: parseNum(e.target.value) })}
								className="h-8"
							/>
						</div>
					</div>

					{/* Day-of-week picker (weekly only) */}
					{opts?.freq === RRule.WEEKLY && (
						<div className="space-y-1">
							<label className="font-medium text-[var(--muted-foreground)] text-xs">
								{T.repeatOn}
							</label>
							<div className="mt-1 flex flex-wrap gap-1">
								{weekDays.map((d, i) => {
									const active = byweekday.some(
										(w) => w.weekday === d.value.weekday,
									);
									return (
										<button
											key={d.label}
											type="button"
											onClick={() => toggleDay(i)}
											className={`h-7 w-9 rounded border font-medium text-xs transition-colors ${
												active
													? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
													: "border-input text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
											}`}
										>
											{d.label}
										</button>
									);
								})}
							</div>
						</div>
					)}

					{/* End condition */}
					<div className="space-y-2">
						<label className="font-medium text-[var(--muted-foreground)] text-xs">
							{T.ends}
						</label>
						<div className="space-y-2">
							{/* Never */}
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="radio"
									name="end-type"
									checked={endType === "never"}
									onChange={() => setEndType("never")}
									className="accent-[var(--primary)]"
								/>
								<span className="text-[var(--foreground)]">{T.never}</span>
							</label>

							{/* After N occurrences */}
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="radio"
									name="end-type"
									checked={endType === "count"}
									onChange={() => setEndType("count")}
									className="accent-[var(--primary)]"
								/>
								<span className="text-[var(--foreground)]">{T.after}</span>
								{endType === "count" && (
									<>
										<input
											type="number"
											min={1}
											value={opts?.count ?? 1}
											onChange={(e) =>
												update({ count: parseNum(e.target.value) })
											}
											className="h-6 w-16 rounded border border-input bg-transparent px-2 text-[var(--foreground)] text-xs outline-none focus-visible:border-ring"
										/>
										<span className="text-[var(--muted-foreground)]">
											{T.occurrences}
										</span>
									</>
								)}
							</label>

							{/* Until date */}
							<label className="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="radio"
									name="end-type"
									checked={endType === "until"}
									onChange={() => setEndType("until")}
									className="accent-[var(--primary)]"
								/>
								<span className="text-[var(--foreground)]">{T.on}</span>
								{endType === "until" && (
									<input
										type="date"
										value={
											opts?.until
												? dayjs(opts.until).format("YYYY-MM-DD")
												: dayjs().add(1, "month").format("YYYY-MM-DD")
										}
										onChange={(e) =>
											update({
												until: e.target.value
													? dayjs(e.target.value).endOf("day").toDate()
													: undefined,
											})
										}
										className="h-6 rounded border border-input bg-transparent px-2 text-[var(--foreground)] text-xs outline-none focus-visible:border-ring"
									/>
								)}
							</label>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
