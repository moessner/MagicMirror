const NodeHelper = require("node_helper");
const Log = require("logger");

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "sage";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

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
				wakeWord: payload.wakeWord || ""
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
		const instructions =
			settings.systemPrompt ||
			"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences).";

		const body = {
			session: {
				type: "realtime",
				model,
				instructions,
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
