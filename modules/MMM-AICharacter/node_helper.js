const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
	start () {
		this.instances = new Map();
		this.activeRequests = new Map();
		Log.log(`Starting node helper for: ${this.name}`);
	},

	stop () {
		for (const controller of this.activeRequests.values()) {
			try {
				controller.abort();
			} catch {
				// ignore
			}
		}
		this.activeRequests.clear();
	},

	socketNotificationReceived (notification, payload) {
		if (!payload) return;

		if (notification === "AI_CONFIG") {
			this.instances.set(payload.instanceId, {
				model: payload.model || "google/gemini-2.5-flash",
				transcriptionModel: payload.transcriptionModel || "openai/gpt-4o-mini-transcribe",
				systemPrompt: payload.systemPrompt,
				maxHistory: payload.maxHistory || 10,
				characterName: payload.characterName || "Pixel",
				voiceLang: payload.voiceLang || "en"
			});
			this.sendSocketNotification("AI_CONFIG_OK", { instanceId: payload.instanceId });
			return;
		}

		if (notification === "AI_CHAT_CANCEL") {
			this.cancelRequest(payload.instanceId, payload.requestId);
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
			return;
		}

		if (notification === "AI_CHAT_SEND") {
			this.handleChatSend(payload).catch((error) => {
				Log.error(`${this.name} chat error: ${error.message}`);
				this.sendSocketNotification("AI_CHAT_ERROR", {
					instanceId: payload.instanceId,
					requestId: payload.requestId,
					message: error.message || "Chat request failed"
				});
			});
		}
	},

	cancelRequest (instanceId, requestId) {
		const key = `${instanceId}:${requestId}`;
		const controller = this.activeRequests.get(key);
		if (controller) {
			controller.abort();
			this.activeRequests.delete(key);
		}
	},

	async handleTranscribe (payload) {
		const { instanceId, requestId, audioBase64, mimeType } = payload;
		const settings = this.instances.get(instanceId) || {};

		if (!process.env.AI_GATEWAY_API_KEY) {
			this.sendSocketNotification("AI_STT_RESULT", {
				instanceId,
				requestId,
				error: true,
				message: "Missing AI_GATEWAY_API_KEY in the MagicMirror process environment."
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

		const { transcribe, gateway } = await import("ai");
		const audio = Buffer.from(audioBase64, "base64");
		const modelId = settings.transcriptionModel || "openai/gpt-4o-mini-transcribe";

		const transcript = await transcribe({
			model: gateway.transcription(modelId),
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
	},

	async handleChatSend (payload) {
		const { instanceId, requestId, messages } = payload;
		const settings = this.instances.get(instanceId) || {
			model: "google/gemini-2.5-flash",
			systemPrompt: "You are a concise AI mirror companion.",
			maxHistory: 10
		};

		if (!process.env.AI_GATEWAY_API_KEY) {
			this.sendSocketNotification("AI_CHAT_ERROR", {
				instanceId,
				requestId,
				message: "Missing AI_GATEWAY_API_KEY in the MagicMirror process environment."
			});
			return;
		}

		this.cancelRequest(instanceId, requestId);

		const controller = new AbortController();
		const key = `${instanceId}:${requestId}`;
		this.activeRequests.set(key, controller);

		const { streamText } = await import("ai");

		const safeMessages = Array.isArray(messages)
			? messages
					.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
					.slice(-(settings.maxHistory * 2))
			: [];

		try {
			const result = streamText({
				model: settings.model,
				system: settings.systemPrompt,
				messages: safeMessages,
				abortSignal: controller.signal
			});

			let fullText = "";
			for await (const delta of result.textStream) {
				if (controller.signal.aborted) break;
				fullText += delta;
				this.sendSocketNotification("AI_CHAT_DELTA", {
					instanceId,
					requestId,
					delta
				});
			}

			if (controller.signal.aborted) return;

			const finalText = (await result.text) || fullText;
			this.sendSocketNotification("AI_CHAT_DONE", {
				instanceId,
				requestId,
				text: finalText
			});
		} catch (error) {
			if (controller.signal.aborted || error?.name === "AbortError") {
				return;
			}
			throw error;
		} finally {
			this.activeRequests.delete(key);
		}
	}
});
