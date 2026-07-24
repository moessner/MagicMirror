const {
	normalizeCalendars,
	isHttpUrl,
	invalidCalendarUrlReason
} = require("../../../../modules/MMM-AICharacter/lib/calendarFetch");

describe("MMM-AICharacter calendarFetch", () => {
	const secretName = ["SECRET", "GCAL", "ICS", "URL"].join("_");

	it("accepts Google private iCal URLs with %40-encoded emails", () => {
		const url = "https://calendar.google.com/calendar/ical/user%40gmail.com/private-abc123/basic.ics";
		expect(isHttpUrl(url)).toBe(true);
		expect(invalidCalendarUrlReason(url)).toBeNull();
		expect(normalizeCalendars([{ name: "Google", url }])).toEqual([{ name: "Google", url }]);
	});

	it("rejects unresolved placeholders and secret-name-as-value mistakes", () => {
		expect(invalidCalendarUrlReason(`\${${secretName}}`)).toMatch(/unresolved secret/);
		expect(invalidCalendarUrlReason(`**${secretName}**`)).toMatch(/unresolved secret/);
		expect(invalidCalendarUrlReason(secretName)).toMatch(/secret name/);
		expect(invalidCalendarUrlReason(`${secretName} `)).toMatch(/secret name/);
		expect(normalizeCalendars([{ url: secretName }])).toEqual([]);
		expect(normalizeCalendars([{ url: `\${${secretName}}` }])).toEqual([]);
	});

	it("rejects non-http values", () => {
		expect(invalidCalendarUrlReason("not-a-url")).toMatch(/not a valid http/);
		expect(normalizeCalendars(["ftp://example.com/cal.ics"])).toEqual([]);
	});
});
