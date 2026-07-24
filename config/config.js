/*
 * MagicMirror config for this fork (tracked in git).
 *
 * Secrets stay out of the repo: set Cursor Cloud / shell env vars and reference
 * them as ${SECRET_NAME}. With hideConfigSecrets: true they are redacted for
 * the browser and restored only in node helpers.
 *
 * Required secrets:
 * - OPENAI_API_KEY (read by MMM-AICharacter directly)
 * - SECRET_GCAL_ICS_URL (Google Calendar secret iCal address)
 *
 * Optional local overrides: config/config.env (gitignored).
 */
let config = {
	address: "::",
	port: 8080,
	basePath: "/",
	ipWhitelist: [],

	useHttps: false,
	httpsPrivateKey: "",
	httpsCertificate: "",

	language: "de",
	locale: "de-DE",
	logLevel: ["INFO", "LOG", "WARN", "ERROR"],
	timeFormat: 24,
	units: "metric",

	// Keep SECRET_* values out of the browser /config payload.
	hideConfigSecrets: true,

	modules: [
		{
			module: "clock",
			position: "top_left"
		},
		{
			module: "newsfeed",
			position: "bottom_bar",
			config: {
				feeds: [
					{
						title: "Tagesschau",
						url: "https://www.tagesschau.de/xml/rss2/"
					}
				],
				showSourceTitle: true,
				showPublishDate: true,
				broadcastNewsFeeds: true,
				broadcastNewsUpdates: true
			}
		},
		{
			module: "MMM-AICharacter",
			position: "middle_center",
			config: {
				wakeWord: "alexa",
				wakeAliases: ["hey pixel"],
				voiceLang: "de-DE",
				characterName: "Pixel",
				lat: null,
				lon: null,
				units: "metric",
				showWeatherCard: true,
				showNewsCard: true,
				showCalendarCard: true,
				newsLimit: 5,
				newsFeeds: [
					{
						title: "Tagesschau",
						url: "https://www.tagesschau.de/xml/rss2/"
					}
				],
				// Google Calendar → Settings → Integrate calendar → Secret address in iCal format.
				calendars: [
					{
						name: "Google",
						url: "${SECRET_GCAL_ICS_URL}"
					}
				],
				calendarMaximumEntries: 8,
				calendarMaximumNumberOfDays: 365
			}
		}
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
