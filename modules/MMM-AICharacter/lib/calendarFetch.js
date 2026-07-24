/**
 * One-shot Google/ICS calendar fetch for MMM-AICharacter (Node helper).
 * Reuses MagicMirror's calendar filter utilities; not coupled to the default calendar UI module.
 */

const ical = require("node-ical");
const CalendarFetcherUtils = require("../../../defaultmodules/calendar/calendarfetcherutils");

/**
 * True when `value` is a usable http(s) calendar URL.
 * Google private iCal addresses look like:
 * https://calendar.google.com/calendar/ical/user%40gmail.com/private-…/basic.ics
 * (`%40` is the encoded `@` in the calendar id — keep it as-is.)
 * @param {string} value
 * @returns {boolean}
 */
function isHttpUrl (value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Detect common misconfigurations of Cursor/env secrets (name pasted as value,
 * unresolved placeholders, empty/whitespace).
 * @param {string} url
 * @returns {string|null} Human-readable reason, or null if ok.
 */
function invalidCalendarUrlReason (url) {
	const value = typeof url === "string" ? url.trim() : "";
	if (!value) {
		return "empty calendar URL";
	}
	if (value.startsWith("**SECRET_") || value.includes("${SECRET_")) {
		return "unresolved secret placeholder (set SECRET_GCAL_ICS_URL=https://…/basic.ics, not the variable name)";
	}
	// e.g. env value mistakenly set to the secret name (optionally with trailing whitespace)
	if (/^SECRET_[A-Z0-9_]+$/i.test(value)) {
		return `calendar URL is the secret name "${value}" — set SECRET_GCAL_ICS_URL=https://calendar.google.com/calendar/ical/…/private-…/basic.ics`;
	}
	if (!isHttpUrl(value)) {
		return `calendar URL is not a valid http(s) URL (got "${value.slice(0, 48)}${value.length > 48 ? "…" : ""}")`;
	}
	return null;
}

function normalizeCalendars (calendars) {
	if (!Array.isArray(calendars) || calendars.length === 0) {
		return [];
	}
	return calendars
		.map((entry) => {
			if (typeof entry === "string") {
				const url = entry.trim();
				if (!url || invalidCalendarUrlReason(url)) {
					return null;
				}
				return { name: "Calendar", url };
			}
			if (entry && typeof entry.url === "string" && entry.url.trim()) {
				const url = entry.url.trim();
				if (invalidCalendarUrlReason(url)) {
					return null;
				}
				return {
					name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "Calendar",
					url
				};
			}
			return null;
		})
		.filter(Boolean);
}

async function fetchIcsText (url, timeoutMs = 15000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "MMM-AICharacter/1.0 (+MagicMirror)",
				Accept: "text/calendar, text/plain, */*"
			}
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} for calendar`);
		}
		return await response.text();
	} finally {
		clearTimeout(timer);
	}
}

function formatWhen (startMs, endMs, fullDayEvent, locale) {
	const start = new Date(Number(startMs));
	const end = new Date(Number(endMs));
	if (!Number.isFinite(start.getTime())) return "";

	if (fullDayEvent) {
		return start.toLocaleDateString(locale, {
			weekday: "short",
			month: "short",
			day: "numeric"
		});
	}

	const sameDay = start.toDateString() === end.toDateString();
	const datePart = start.toLocaleDateString(locale, {
		weekday: "short",
		month: "short",
		day: "numeric"
	});
	const startTime = start.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
	if (!Number.isFinite(end.getTime()) || sameDay) {
		const endTime = Number.isFinite(end.getTime())
			? end.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
			: null;
		return endTime ? `${datePart} ${startTime}–${endTime}` : `${datePart} ${startTime}`;
	}
	const endPart = end.toLocaleString(locale, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
	return `${datePart} ${startTime} → ${endPart}`;
}

async function fetchOneCalendar (calendar, options) {
	const ics = await fetchIcsText(calendar.url);
	const filteredData = await CalendarFetcherUtils.preFilterICS(ics, {
		includePastEvents: false,
		maximumNumberOfDays: options.maximumNumberOfDays
	});
	const parsed = await ical.async.parseICS(filteredData);
	const events = CalendarFetcherUtils.filterEvents(parsed, {
		excludedEvents: options.excludedEvents || [],
		includePastEvents: false,
		maximumEntries: options.maximumEntries,
		maximumNumberOfDays: options.maximumNumberOfDays
	});

	return events.map((event) => ({
		calendar: calendar.name,
		title: event.title,
		startDate: event.startDate,
		endDate: event.endDate,
		fullDayEvent: Boolean(event.fullDayEvent),
		location: event.location || null,
		when: formatWhen(event.startDate, event.endDate, event.fullDayEvent, options.locale)
	}));
}

/**
 * Fetch upcoming events from one or more ICS URLs (e.g. Google private iCal addresses).
 * @param {object} options
 * @param {Array<{name?: string, url: string}|string>} [options.calendars]
 * @param {number} [options.maximumEntries=8]
 * @param {number} [options.maximumNumberOfDays=365]
 * @param {string} [options.locale="en-US"]
 */
async function fetchCalendar ({
	calendars,
	maximumEntries = 8,
	maximumNumberOfDays = 365,
	locale = "en-US"
} = {}) {
	const rawEntries = Array.isArray(calendars) ? calendars : [];
	const rejectionReasons = [];
	for (const entry of rawEntries) {
		const url = typeof entry === "string" ? entry.trim() : entry?.url?.trim?.() || "";
		const reason = invalidCalendarUrlReason(url);
		if (reason) {
			rejectionReasons.push(reason);
		}
	}

	const resolved = normalizeCalendars(calendars);
	if (resolved.length === 0) {
		const detail = rejectionReasons[0]
			? ` ${rejectionReasons[0]}.`
			: " Set calendars in MMM-AICharacter config (e.g. Google secret ICS URL via ${SECRET_GCAL_ICS_URL}).";
		throw new Error(`No calendar URLs configured.${detail}`);
	}

	const max = Math.max(1, Math.min(Number(maximumEntries) || 8, 20));
	const days = Math.max(1, Math.min(Number(maximumNumberOfDays) || 365, 365));

	const results = await Promise.allSettled(
		resolved.map((calendar) =>
			fetchOneCalendar(calendar, {
				maximumEntries: max,
				maximumNumberOfDays: days,
				excludedEvents: [],
				locale
			})
		)
	);

	const events = [];
	const sources = [];
	const errors = [];

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const calendar = resolved[i];
		if (result.status === "fulfilled") {
			sources.push(calendar.name);
			events.push(...result.value);
		} else {
			errors.push({
				name: calendar.name,
				message: result.reason?.message || String(result.reason)
			});
		}
	}

	if (events.length === 0) {
		const detail = errors.map((e) => e.message).join("; ") || "No upcoming events.";
		throw new Error(detail);
	}

	events.sort((a, b) => Number(a.startDate) - Number(b.startDate));
	const top = events.slice(0, max);

	return {
		ok: true,
		sources: [...new Set(sources)],
		events: top,
		summary: {
			count: top.length,
			sources: [...new Set(top.map((e) => e.calendar))],
			events: top.map((e) => ({
				calendar: e.calendar,
				title: e.title,
				when: e.when,
				location: e.location,
				fullDayEvent: e.fullDayEvent
			}))
		}
	};
}

module.exports = {
	fetchCalendar,
	normalizeCalendars,
	isHttpUrl,
	invalidCalendarUrlReason
};
