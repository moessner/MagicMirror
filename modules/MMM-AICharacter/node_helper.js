const NodeHelper = require("node_helper");
const Log = require("logger");
const { fetchWeather } = require("./lib/weatherFetch");
const { DEFAULT_FEEDS, fetchNews } = require("./lib/newsFetch");
const { fetchCalendar } = require("./lib/calendarFetch");

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "sage";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

const SPEAK_LANGUAGE_NAMES = {
	de: "German (Deutsch)",
	en: "English",
	es: "Spanish (Español)",
	fr: "French (Français)",
	it: "Italian (Italiano)",
	nl: "Dutch (Nederlands)",
	pt: "Portuguese (Português)"
};

/**
 * Realtime speech-to-speech mirrors detected input language unless instructions
 * lock the reply language. voiceLang alone only hints STT.
 * @param {string} [voiceLang]
 * @returns {string}
 */
function speakLanguageInstruction (voiceLang) {
	const code = String(voiceLang || "en").slice(0, 2).toLowerCase();
	const name = SPEAK_LANGUAGE_NAMES[code] || code;
	return `Always speak and reply in ${name}. Keep that language even if the transcript is noisy, the wake word is English, or a word sounds like another language. Never switch to Spanish or any other language unless the user explicitly asks to change language.`;
}

/**
 * @param {string} [systemPrompt]
 * @param {string} [voiceLang]
 * @returns {string}
 */
function buildRealtimeInstructions (systemPrompt, voiceLang) {
	const base =
		systemPrompt ||
		"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). When asked about weather or the forecast, call get_weather. When asked about news, headlines, or Schlagzeilen, call get_news. When asked about the calendar, schedule, appointments, or Termine, call get_calendar.";
	return `${base}\n\n${speakLanguageInstruction(voiceLang)}`;
}

const GET_WEATHER_TOOL = {
	type: "function",
	name: "get_weather",
	description:
		"Fetch current weather and a short daily forecast. Call this whenever the user asks about weather, temperature, or the forecast. Omit location to use the device coordinates.",
	parameters: {
		type: "object",
		properties: {
			location: {
				type: "string",
				description: "Optional city or place name. Omit to use the device location."
			}
		},
		required: [],
		additionalProperties: false
	}
};

const GET_NEWS_TOOL = {
	type: "function",
	name: "get_news",
	description:
		"Fetch current news headlines (Schlagzeilen). Call this whenever the user asks about news, headlines, current events, or Schlagzeilen. Optionally pass a topic keyword to filter.",
	parameters: {
		type: "object",
		properties: {
			topic: {
				type: "string",
				description: "Optional topic or keyword to filter headlines (e.g. politics, sport, Klima)."
			}
		},
		required: [],
		additionalProperties: false
	}
};

const GET_CALENDAR_TOOL = {
	type: "function",
	name: "get_calendar",
	description:
		"Fetch upcoming calendar events (Termine) from the user's calendars. Call this whenever the user asks about their schedule, calendar, appointments, Termine, or what is coming up.",
	parameters: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false
	}
};

module.exports = NodeHelper.create({
	start () {
		this.instances = new Map();
		Log.log(`Starting node helper for: ${this.name}`);
	},

	requireOpenAiKey () {
		return Boolean(process.env.OPENAI_API_KEY);
	},

	socketNotificationReceived (notification, payload) {
		if (!payload) return;

		if (notification === "AI_CONFIG") {
			this.instances.set(payload.instanceId, {
				realtimeModel: payload.realtimeModel || DEFAULT_REALTIME_MODEL,
				voice: payload.voice || DEFAULT_VOICE,
				transcriptionModel: payload.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL,
				systemPrompt: payload.systemPrompt,
				characterName: payload.characterName || "Pixel",
				voiceLang: payload.voiceLang || "en",
				wakeWord: payload.wakeWord || "",
				units: payload.units || "metric",
				newsFeeds: Array.isArray(payload.newsFeeds) ? payload.newsFeeds : DEFAULT_FEEDS,
				newsLimit: payload.newsLimit || 5,
				calendars: Array.isArray(payload.calendars) ? payload.calendars : [],
				calendarMaximumEntries: payload.calendarMaximumEntries || 8,
				calendarMaximumNumberOfDays: payload.calendarMaximumNumberOfDays || 365
			});
			this.sendSocketNotification("AI_CONFIG_OK", { instanceId: payload.instanceId });
			return;
		}

		if (notification === "AI_REALTIME_TOKEN") {
			this.handleRealtimeToken(payload).catch((error) => {
				Log.error(`${this.name} realtime token error: ${error.message}`);
				this.sendSocketNotification("AI_REALTIME_TOKEN_RESULT", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					error: true,
					message: error.message || "Failed to mint Realtime token"
				});
			});
			return;
		}

		if (notification === "AI_WEATHER_FETCH") {
			this.handleWeatherFetch(payload).catch((error) => {
				Log.error(`${this.name} weather fetch error: ${error.message}`);
				this.sendSocketNotification("AI_WEATHER_RESULT", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					callId: payload.callId,
					error: true,
					message: error.message || "Weather fetch failed"
				});
			});
			return;
		}

		if (notification === "AI_NEWS_FETCH") {
			this.handleNewsFetch(payload).catch((error) => {
				Log.error(`${this.name} news fetch error: ${error.message}`);
				this.sendSocketNotification("AI_NEWS_RESULT", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					callId: payload.callId,
					error: true,
					message: error.message || "News fetch failed"
				});
			});
			return;
		}

		if (notification === "AI_CALENDAR_FETCH") {
			this.handleCalendarFetch(payload).catch((error) => {
				Log.error(`${this.name} calendar fetch error: ${error.message}`);
				this.sendSocketNotification("AI_CALENDAR_RESULT", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					callId: payload.callId,
					error: true,
					message: error.message || "Calendar fetch failed"
				});
			});
			return;
		}

		if (notification === "AI_STT_TRANSCRIBE") {
			this.handleTranscribe(payload).catch((error) => {
				Log.error(`${this.name} STT error: ${error.message}`);
				this.sendSocketNotification("AI_STT_RESULT", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					error: true,
					message: error.message || "Transcription failed"
				});
			});
		}
	},

	async handleRealtimeToken (payload) {
		const { instanceId, requestId } = payload;
		const settings = this.instances.get(instanceId) || {};

		if (!this.requireOpenAiKey()) {
			this.sendSocketNotification("AI_REALTIME_TOKEN_RESULT", {
				instanceId,
				requestId,
				error: true,
				message: "Missing OPENAI_API_KEY in the MagicMirror process environment."
			});
			return;
		}

		const model = settings.realtimeModel || DEFAULT_REALTIME_MODEL;
		const voice = settings.voice || DEFAULT_VOICE;
		const transcriptionModel = settings.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL;
		const language = String(settings.voiceLang || "en").slice(0, 2);
		const instructions = buildRealtimeInstructions(settings.systemPrompt, settings.voiceLang);

		const body = {
			session: {
				type: "realtime",
				model,
				instructions,
				tools: [GET_WEATHER_TOOL, GET_NEWS_TOOL, GET_CALENDAR_TOOL],
				tool_choice: "auto",
				audio: {
					input: {
						transcription: {
							model: transcriptionModel,
							language
						},
						turn_detection: {
							type: "server_vad",
							threshold: 0.5,
							prefix_padding_ms: 300,
							silence_duration_ms: 400,
							create_response: true,
							interrupt_response: true
						}
					},
					output: {
						voice
					}
				}
			}
		};

		const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
			throw new Error(detail);
		}

		if (!data?.value) {
			throw new Error("Realtime client secret response missing value.");
		}

		this.sendSocketNotification("AI_REALTIME_TOKEN_RESULT", {
			instanceId,
			requestId,
			value: data.value,
			expiresAt: data.expires_at,
			model,
			voice
		});
	},

	async handleWeatherFetch (payload) {
		const { instanceId, requestId, callId } = payload;
		const settings = this.instances.get(instanceId) || {};
		const language = String(settings.voiceLang || "en").slice(0, 2);
		const units = payload.units || settings.units || "metric";

		const weather = await fetchWeather({
			lat: payload.lat,
			lon: payload.lon,
			location: payload.location,
			units,
			language
		});

		this.sendSocketNotification("AI_WEATHER_RESULT", {
			instanceId,
			requestId,
			callId,
			...weather
		});
	},

	async handleNewsFetch (payload) {
		const { instanceId, requestId, callId } = payload;
		const settings = this.instances.get(instanceId) || {};
		const feeds = Array.isArray(payload.feeds) && payload.feeds.length
			? payload.feeds
			: settings.newsFeeds || DEFAULT_FEEDS;
		const limit = payload.limit || settings.newsLimit || 5;

		const news = await fetchNews({
			feeds,
			limit,
			topic: payload.topic
		});

		this.sendSocketNotification("AI_NEWS_RESULT", {
			instanceId,
			requestId,
			callId,
			...news
		});
	},

	async handleCalendarFetch (payload) {
		const { instanceId, requestId, callId } = payload;
		const settings = this.instances.get(instanceId) || {};
		const calendars = Array.isArray(payload.calendars) && payload.calendars.length
			? payload.calendars
			: settings.calendars || [];
		const maximumEntries = payload.maximumEntries || settings.calendarMaximumEntries || 8;
		const maximumNumberOfDays
			= payload.maximumNumberOfDays || settings.calendarMaximumNumberOfDays || 365;
		const locale = payload.locale || settings.voiceLang || "en-US";

		const calendar = await fetchCalendar({
			calendars,
			maximumEntries,
			maximumNumberOfDays,
			locale
		});

		this.sendSocketNotification("AI_CALENDAR_RESULT", {
			instanceId,
			requestId,
			callId,
			...calendar
		});
	},

	async handleTranscribe (payload) {
		const { instanceId, requestId, audioBase64, mimeType } = payload;
		const settings = this.instances.get(instanceId) || {};

		if (!this.requireOpenAiKey()) {
			this.sendSocketNotification("AI_STT_RESULT", {
				instanceId,
				requestId,
				error: true,
				message: "Missing OPENAI_API_KEY in the MagicMirror process environment."
			});
			return;
		}

		if (!audioBase64) {
			this.sendSocketNotification("AI_STT_RESULT", {
				instanceId,
				requestId,
				error: true,
				message: "No audio received for transcription."
			});
			return;
		}

		const { transcribe } = await import("ai");
		const { openai } = await import("@ai-sdk/openai");
		const audio = Buffer.from(audioBase64, "base64");
		const modelId = settings.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL;

		try {
			const transcript = await transcribe({
				model: openai.transcription(modelId),
				audio,
				providerOptions: {
					openai: {
						language: (settings.voiceLang || "en").slice(0, 2)
					}
				}
			});

			this.sendSocketNotification("AI_STT_RESULT", {
				instanceId,
				requestId,
				text: transcript.text || "",
				mimeType: mimeType || "audio/webm"
			});
		} catch (error) {
			const message = error?.message || String(error);
			// Silence / non-speech clips are common during wake listening.
			if (/no transcript/i.test(message)) {
				this.sendSocketNotification("AI_STT_RESULT", {
					instanceId,
					requestId,
					text: "",
					mimeType: mimeType || "audio/webm"
				});
				return;
			}
			throw error;
		}
	}
});
