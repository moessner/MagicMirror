/* global Module, Log, MMM_AICharacterLib */

Module.register("MMM-AICharacter", {
	defaults: {
		wakeWord: "hey mirror",
		realtimeModel: "gpt-realtime",
		voice: "marin",
		transcriptionModel: "gpt-4o-mini-transcribe",
		voiceLang: "en-US",
		characterName: "Pixel",
		systemPrompt:
			"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). Be warm, slightly playful, and helpful. Avoid markdown, lists, and stage directions.",
		postSpeakListenMs: 8000,
		wakeSilenceMs: 700,
		avatarPath: "/MMM-AICharacter/avatar-app/embed.html"
	},

	getScripts () {
		return [this.file("lib/conversation.js"), this.file("lib/realtimeVoice.js")];
	},

	getStyles () {
		return [this.file("MMM-AICharacter.css")];
	},

	getHeader () {
		return "";
	},

	start () {
		Log.info(`Starting module: ${this.name}`);
		this.wrapper = null;
		this.iframe = null;
		this.conversation = null;
		this.voice = null;
		this.uiState = "idle";
		this.avatarReady = false;
		this.pendingRemoteStream = null;
		this.avatarStreamRetries = 0;
		this.pendingTokenRequestId = null;
	},

	getDom () {
		const root = document.createElement("div");
		root.className = "mmm-ai-character mmm-ai-character--idle";
		this.wrapper = root;

		const stage = document.createElement("div");
		stage.className = "mmm-ai-character__stage mmm-ai-character__stage--holo";

		const iframe = document.createElement("iframe");
		iframe.className = "mmm-ai-character__avatar";
		iframe.src = this.config.avatarPath;
		iframe.setAttribute("allow", "autoplay; microphone");
		iframe.setAttribute("title", `${this.config.characterName || "Pixel"} holographic avatar`);
		iframe.addEventListener("load", () => {
			this.avatarReady = true;
			this.postAvatar({ type: "avatar:setState", state: "idle" });
			if (this.pendingRemoteStream) {
				this.attachAvatarStream(this.pendingRemoteStream);
			}
		});
		this.iframe = iframe;
		stage.appendChild(iframe);

		const captions = document.createElement("div");
		captions.className = "mmm-ai-character__captions";

		const statusEl = document.createElement("div");
		statusEl.className = "mmm-ai-character__status";
		statusEl.textContent = this.config.wakeWord
			? `Say "${this.config.wakeWord}"`
			: "Connecting live voice…";

		const userEl = document.createElement("div");
		userEl.className = "mmm-ai-character__user";

		const assistantEl = document.createElement("div");
		assistantEl.className = "mmm-ai-character__assistant";

		captions.appendChild(statusEl);
		captions.appendChild(userEl);
		captions.appendChild(assistantEl);

		root.appendChild(stage);
		root.appendChild(captions);

		const lib = (typeof MMM_AICharacterLib !== "undefined" && MMM_AICharacterLib) || null;
		if (!lib || !lib.createConversation || !lib.createRealtimeVoiceController) {
			statusEl.textContent = "Voice scripts failed to load.";
			root.classList.add("mmm-ai-character--error");
			return root;
		}

		this.conversation = lib.createConversation({
			userEl,
			assistantEl,
			statusEl
		});

		this.voice = lib.createRealtimeVoiceController({
			wakeWord: this.config.wakeWord,
			systemPrompt: this.config.systemPrompt,
			characterName: this.config.characterName,
			postSpeakListenMs: this.config.postSpeakListenMs,
			wakeSilenceMs: this.config.wakeSilenceMs,
			requestToken: (requestId) => {
				this.pendingTokenRequestId = requestId;
				this.sendSocketNotification("AI_REALTIME_TOKEN", {
					instanceId: this.identifier,
					requestId
				});
			},
			onTranscribeRequest: (audioPayload) => {
				this.sendSocketNotification("AI_STT_TRANSCRIBE", {
					instanceId: this.identifier,
					requestId: audioPayload.requestId,
					audioBase64: audioPayload.audioBase64,
					mimeType: audioPayload.mimeType
				});
			},
			onState: (mode) => this.handleVoiceMode(mode),
			onStatus: (text) => this.conversation.setStatus(text),
			onUserCaption: (text) => this.conversation.setUserCaption(text),
			onAssistantCaption: (text) => this.conversation.setAssistantCaption(text),
			onAssistantDelta: (delta) => {
				this.conversation.appendAssistantDelta(delta);
				this.setUiState("speaking");
			},
			onRemoteStream: (stream) => this.attachAvatarStream(stream),
			onError: (message) => this.handleVoiceError(message)
		});

		if (!this.voice.supported) {
			this.setUiState("error");
			this.conversation.setStatus("Realtime voice unavailable in this browser");
		} else {
			this.conversation.setStatus("Connecting live voice…");
		}

		this.sendSocketNotification("AI_CONFIG", {
			instanceId: this.identifier,
			realtimeModel: this.config.realtimeModel,
			voice: this.config.voice,
			transcriptionModel: this.config.transcriptionModel,
			systemPrompt: this.config.systemPrompt,
			characterName: this.config.characterName,
			voiceLang: this.config.voiceLang,
			wakeWord: this.config.wakeWord
		});

		return root;
	},

	notificationReceived (notification) {
		if (notification === "DOM_OBJECTS_CREATED" && this.voice && this.voice.supported) {
			this.voice.start();
		}
	},

	postAvatar (message) {
		if (!this.iframe || !this.iframe.contentWindow) return;
		this.iframe.contentWindow.postMessage(message, "*");
	},

	attachAvatarStream (stream) {
		this.pendingRemoteStream = stream || null;
		const win = this.iframe && this.iframe.contentWindow;
		if (!win) return;
		const api = win.__MMMAvatar;
		if (!api) {
			if (!stream || this.avatarStreamRetries > 25) return;
			this.avatarStreamRetries += 1;
			// Avatar boot is async; retry shortly after iframe load.
			setTimeout(() => {
				if (this.pendingRemoteStream === stream) this.attachAvatarStream(stream);
			}, 200);
			return;
		}
		this.avatarStreamRetries = 0;
		if (stream && typeof api.attachStream === "function") {
			api.attachStream(stream);
		} else if (!stream && typeof api.detachStream === "function") {
			api.detachStream();
		}
	},

	suspend () {
		if (this.voice) this.voice.stop();
		this.attachAvatarStream(null);
		this.postAvatar({ type: "avatar:setState", state: "dormant" });
	},

	resume () {
		if (this.voice && this.voice.supported) this.voice.start();
		this.postAvatar({ type: "avatar:setState", state: "idle" });
	},

	setUiState (state) {
		this.uiState = state;
		if (this.wrapper) {
			this.wrapper.className = `mmm-ai-character mmm-ai-character--${state === "wake" ? "idle" : state}`;
		}
		const avatarState =
			state === "wake" || state === "idle"
				? "idle"
				: state === "listening"
					? "listening"
					: state === "thinking"
						? "thinking"
						: state === "speaking"
							? "speaking"
							: state === "error"
								? "error"
								: "idle";
		this.postAvatar({ type: "avatar:setState", state: avatarState });
	},

	handleVoiceMode (mode) {
		if (mode === "wake") {
			this.setUiState("idle");
			return;
		}
		if (mode === "listening") {
			this.setUiState("listening");
			return;
		}
		if (mode === "thinking") {
			this.setUiState("thinking");
			return;
		}
		if (mode === "speaking") {
			this.setUiState("speaking");
		}
	},

	handleVoiceError (message) {
		Log.error(`${this.name}: ${message}`);
		this.setUiState("error");
		if (this.conversation) this.conversation.setStatus(message);
	},

	socketNotificationReceived (notification, payload) {
		if (!payload || payload.instanceId !== this.identifier) return;

		if (notification === "AI_REALTIME_TOKEN_RESULT") {
			if (this.voice) this.voice.handleTokenResult(payload);
			return;
		}

		if (notification === "AI_STT_RESULT") {
			if (this.voice) this.voice.handleSttResult(payload);
			return;
		}

		// AI_CONFIG_OK: voice controller owns status text after connect/error.
	}
});
