/* global Module, Log, MMM_AICharacterLib */

Module.register("MMM-AICharacter", {
	defaults: {
		wakeWord: "hey mirror",
		model: "google/gemini-2.5-flash",
		voiceLang: "en-US",
		characterName: "Pixel",
		systemPrompt:
			"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). Be warm, slightly playful, and helpful. Avoid markdown, lists, and stage directions.",
		maxHistory: 10,
		silenceMs: 1500,
		postSpeakListenMs: 8000,
		enableTTS: true
	},

	getScripts () {
		return ["lib/character.js", "lib/conversation.js", "lib/voice.js"];
	},

	getStyles () {
		return [this.file("MMM-AICharacter.css")];
	},

	start () {
		Log.info(`Starting module: ${this.name}`);
		this.wrapper = null;
		this.character = null;
		this.conversation = null;
		this.voice = null;
		this.uiState = "idle";
		this.requestCounter = 0;
	},

	getDom () {
		const root = document.createElement("div");
		root.className = "mmm-ai-character mmm-ai-character--idle";
		this.wrapper = root;

		const stage = document.createElement("div");
		stage.className = "mmm-ai-character__stage";

		const canvas = document.createElement("canvas");
		canvas.className = "mmm-ai-character__canvas";
		canvas.setAttribute("aria-label", `${this.config.characterName} AI character`);
		stage.appendChild(canvas);

		const name = document.createElement("div");
		name.className = "mmm-ai-character__name";
		name.textContent = this.config.characterName;
		stage.appendChild(name);

		const captions = document.createElement("div");
		captions.className = "mmm-ai-character__captions";

		const statusEl = document.createElement("div");
		statusEl.className = "mmm-ai-character__status";
		statusEl.textContent = "Say \"" + this.config.wakeWord + "\"";

		const userEl = document.createElement("div");
		userEl.className = "mmm-ai-character__user";

		const assistantEl = document.createElement("div");
		assistantEl.className = "mmm-ai-character__assistant";

		captions.appendChild(statusEl);
		captions.appendChild(userEl);
		captions.appendChild(assistantEl);

		root.appendChild(stage);
		root.appendChild(captions);

		this.character = MMM_AICharacterLib.createPixelCharacter(canvas);
		this.character.setState("idle");
		this.character.start();

		this.conversation = MMM_AICharacterLib.createConversation({
			userEl,
			assistantEl,
			statusEl
		});

		this.voice = MMM_AICharacterLib.createVoiceController({
			wakeWord: this.config.wakeWord,
			lang: this.config.voiceLang,
			silenceMs: this.config.silenceMs,
			postSpeakListenMs: this.config.postSpeakListenMs,
			onState: (mode) => this.handleVoiceMode(mode),
			onPartial: (text, mode) => this.handlePartial(text, mode),
			onUtterance: (text) => this.handleUtterance(text),
			onBargeIn: () => this.handleBargeIn(),
			onError: (message) => this.handleVoiceError(message)
		});

		if (!this.voice.supported) {
			this.setUiState("error");
			this.conversation.setStatus("Speech recognition unavailable");
		} else {
			this.voice.start();
			this.conversation.setStatus(`Say "${this.config.wakeWord}"`);
		}

		this.sendSocketNotification("AI_CONFIG", {
			instanceId: this.identifier,
			model: this.config.model,
			systemPrompt: this.config.systemPrompt,
			maxHistory: this.config.maxHistory,
			characterName: this.config.characterName
		});

		return root;
	},

	suspend () {
		if (this.voice) this.voice.stop();
		if (this.character) this.character.stop();
	},

	resume () {
		if (this.character) this.character.start();
		if (this.voice && this.voice.supported) this.voice.start();
	},

	setUiState (state) {
		this.uiState = state;
		if (this.character) this.character.setState(state === "wake" ? "idle" : state);
		if (this.wrapper) {
			this.wrapper.className = `mmm-ai-character mmm-ai-character--${state === "wake" ? "idle" : state}`;
		}
	},

	handleVoiceMode (mode) {
		if (mode === "wake") {
			this.setUiState("idle");
			if (this.conversation && !this.conversation.getCurrentRequestId()) {
				this.conversation.setStatus(`Say "${this.config.wakeWord}"`);
			}
			return;
		}
		if (mode === "listening") {
			this.setUiState("listening");
			this.conversation.setStatus("Listening…");
			return;
		}
		if (mode === "speaking") {
			this.setUiState("speaking");
		}
	},

	handlePartial (text, mode) {
		if (mode === "listening" && text && text !== "Listening…") {
			this.conversation.setUserCaption(text);
		}
	},

	handleUtterance (text) {
		const cleaned = String(text || "").trim();
		if (!cleaned) return;

		this.requestCounter += 1;
		const requestId = `${this.identifier}-${this.requestCounter}-${Date.now()}`;
		this.conversation.beginRequest(requestId, cleaned);
		this.conversation.pushHistory(this.config.maxHistory, { role: "user", content: cleaned });
		this.setUiState("thinking");

		const messages = this.conversation.getHistory();
		this.sendSocketNotification("AI_CHAT_SEND", {
			instanceId: this.identifier,
			requestId,
			messages
		});
	},

	handleBargeIn () {
		const requestId = this.conversation.getCurrentRequestId();
		if (this.voice) this.voice.stopSpeaking();
		if (requestId) {
			this.sendSocketNotification("AI_CHAT_CANCEL", {
				instanceId: this.identifier,
				requestId
			});
			this.conversation.clearRequest();
		}
		this.setUiState("listening");
		this.conversation.setStatus("Listening…");
	},

	handleVoiceError (message) {
		Log.error(`${this.name}: ${message}`);
		this.setUiState("error");
		this.conversation.setStatus(message);
	},

	speakReply (text) {
		const finish = () => {
			if (this.voice) this.voice.armPostReplyListen();
			this.conversation.setStatus(`Say "${this.config.wakeWord}" or keep talking`);
			this.setUiState("idle");
		};

		if (!this.config.enableTTS || !this.voice) {
			finish();
			return;
		}
		this.voice.speak(text, finish);
	},

	socketNotificationReceived (notification, payload) {
		if (!payload || payload.instanceId !== this.identifier) return;

		if (notification === "AI_CHAT_DELTA") {
			if (!this.conversation.isCurrent(payload.requestId)) return;
			this.conversation.appendAssistantDelta(payload.delta);
			this.setUiState("speaking");
			return;
		}

		if (notification === "AI_CHAT_DONE") {
			if (!this.conversation.isCurrent(payload.requestId)) return;
			const text = payload.text || this.conversation.getAssistantText();
			this.conversation.setAssistantCaption(text);
			this.conversation.pushHistory(this.config.maxHistory, { role: "assistant", content: text });
			this.conversation.clearRequest();
			this.speakReply(text);
			return;
		}

		if (notification === "AI_CHAT_ERROR") {
			if (payload.requestId && !this.conversation.isCurrent(payload.requestId)) return;
			this.conversation.clearRequest();
			this.setUiState("error");
			this.conversation.setStatus(payload.message || "Something went wrong");
			if (this.voice) this.voice.markIdleWake();
			return;
		}

		if (notification === "AI_CONFIG_OK") {
			this.conversation.setStatus(`Say "${this.config.wakeWord}"`);
		}
	}
});
