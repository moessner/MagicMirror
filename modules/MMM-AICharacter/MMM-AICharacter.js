/* global Module, Log, MMM_AICharacterLib */

Module.register("MMM-AICharacter", {
	defaults: {
		wakeWord: "alexa",
		wakeAliases: [],
		realtimeModel: "gpt-realtime",
		voice: "sage",
		transcriptionModel: "gpt-4o-mini-transcribe",
		voiceLang: "en-US",
		characterName: "Pixel",
		systemPrompt:
			"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). Be warm, slightly playful, and helpful. Avoid markdown, lists, and stage directions. When asked about weather, temperature, or the forecast, always call get_weather first, then summarize briefly from the tool result — never invent numbers.",
		postSpeakListenMs: 8000,
		wakeSilenceMs: 550,
		vadThreshold: 0.015,
		/** When true (and wakeWord is set), avatar stays invisible until wake, then dematerializes after the session. */
		appearOnWake: true,
		/** Fallback coordinates when browser geolocation is denied/unavailable. */
		lat: null,
		lon: null,
		units: "metric",
		showWeatherCard: true,
		avatarPath: "/MMM-AICharacter/avatar-app/embed.html"
	},

	getScripts () {
		return [
			this.file("lib/conversation.js"),
			this.file("lib/weatherIcons.js"),
			this.file("lib/realtimeVoice.js")
		];
	},

	getStyles () {
		return ["font-awesome.css", "weather-icons.css", this.file("MMM-AICharacter.css")];
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
		this.avatarVisible = false;
		this.appearTimer = null;
		this.vanishTimer = null;
		this.pendingRemoteStream = null;
		this.avatarStreamRetries = 0;
		this.pendingTokenRequestId = null;
		this.weatherEl = null;
		this.pendingWeather = new Map();
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
			this.avatarVisible = false;
			this.postAvatar({ type: "avatar:setState", state: "dormant" });
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

		const weatherEl = document.createElement("div");
		weatherEl.className = "mmm-ai-character__weather";
		weatherEl.hidden = true;
		this.weatherEl = weatherEl;

		captions.appendChild(statusEl);
		captions.appendChild(userEl);
		captions.appendChild(assistantEl);
		captions.appendChild(weatherEl);

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
			wakeAliases: this.config.wakeAliases,
			systemPrompt: this.config.systemPrompt,
			characterName: this.config.characterName,
			postSpeakListenMs: this.config.postSpeakListenMs,
			wakeSilenceMs: this.config.wakeSilenceMs,
			vadThreshold: this.config.vadThreshold,
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
			onFunctionCall: (call) => this.handleFunctionCall(call),
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
			wakeWord: this.config.wakeWord,
			units: this.config.units
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

	wakeGatedAppearance () {
		return this.config.appearOnWake !== false && Boolean(this.config.wakeWord);
	},

	clearAppearVanishTimers () {
		if (this.appearTimer) {
			clearTimeout(this.appearTimer);
			this.appearTimer = null;
		}
		if (this.vanishTimer) {
			clearTimeout(this.vanishTimer);
			this.vanishTimer = null;
		}
	},

	materializeAvatar (nextState) {
		this.clearAppearVanishTimers();
		if (this.avatarVisible) {
			this.postAvatar({ type: "avatar:setState", state: nextState });
			return;
		}
		this.avatarVisible = true;
		if (this.wrapper) this.wrapper.classList.add("mmm-ai-character--present");
		this.postAvatar({ type: "avatar:setState", state: "materializing" });
		this.appearTimer = setTimeout(() => {
			this.appearTimer = null;
			this.postAvatar({ type: "avatar:setState", state: nextState });
		}, 1150);
	},

	dematerializeAvatar () {
		this.clearAppearVanishTimers();
		if (!this.avatarVisible) {
			this.postAvatar({ type: "avatar:setState", state: "dormant" });
			if (this.wrapper) this.wrapper.classList.remove("mmm-ai-character--present");
			this.clearWeatherCard();
			return;
		}
		// Keep --present until the fade finishes so the stage doesn't collapse mid-animation.
		this.postAvatar({ type: "avatar:setState", state: "dematerializing" });
		this.vanishTimer = setTimeout(() => {
			this.vanishTimer = null;
			this.avatarVisible = false;
			this.postAvatar({ type: "avatar:setState", state: "dormant" });
			if (this.wrapper) {
				this.wrapper.classList.remove("mmm-ai-character--present");
			}
			if (this.conversation) {
				this.conversation.setUserCaption("");
				this.conversation.setAssistantCaption("");
			}
			this.clearWeatherCard();
		}, 1300);
	},

	clearWeatherCard () {
		if (!this.weatherEl) return;
		this.weatherEl.hidden = true;
		this.weatherEl.innerHTML = "";
		if (this.wrapper) this.wrapper.classList.remove("mmm-ai-character--weather");
	},

	formatDayLabel (dateStr) {
		try {
			const date = new Date(`${dateStr}T12:00:00`);
			return date.toLocaleDateString(this.config.voiceLang || undefined, { weekday: "short" });
		} catch {
			return dateStr;
		}
	},

	showWeatherCard (data) {
		if (!this.config.showWeatherCard || !this.weatherEl || !data || data.error) return;
		const lib = (typeof MMM_AICharacterLib !== "undefined" && MMM_AICharacterLib) || {};
		const iconClass =
			typeof lib.weatherIconClass === "function"
				? lib.weatherIconClass(data.current?.weatherCode, data.current?.isDay !== false)
				: "wi wi-na";
		const temp = Math.round(Number(data.current?.temperature));
		const symbol = data.tempSymbol || "°";
		const place = data.place || "";
		const condition = data.current?.condition || "";

		const days = (data.daily || [])
			.map((day) => {
				const dayIcon =
					typeof lib.weatherIconClass === "function"
						? lib.weatherIconClass(day.weatherCode, true)
						: "wi wi-na";
				const hi = Math.round(Number(day.tempMax));
				const lo = Math.round(Number(day.tempMin));
				return `<div class="mmm-ai-character__weather-day">
					<span class="mmm-ai-character__weather-day-name">${this.formatDayLabel(day.date)}</span>
					<i class="${dayIcon}" aria-hidden="true"></i>
					<span class="mmm-ai-character__weather-day-temps">${hi}${symbol}/${lo}${symbol}</span>
				</div>`;
			})
			.join("");

		this.weatherEl.innerHTML = `
			<div class="mmm-ai-character__weather-main">
				<i class="mmm-ai-character__weather-icon ${iconClass}" aria-hidden="true"></i>
				<div class="mmm-ai-character__weather-now">
					<div class="mmm-ai-character__weather-temp">${Number.isFinite(temp) ? temp + symbol : "—"}</div>
					<div class="mmm-ai-character__weather-place">${place}</div>
					<div class="mmm-ai-character__weather-condition">${condition}</div>
				</div>
			</div>
			<div class="mmm-ai-character__weather-days">${days}</div>
		`;
		this.weatherEl.hidden = false;
		if (this.wrapper) this.wrapper.classList.add("mmm-ai-character--weather");
	},

	resolveWeatherLocation (locationHint) {
		const place = typeof locationHint === "string" ? locationHint.trim() : "";
		if (place) {
			return Promise.resolve({ location: place });
		}

		const fallbackLat = this.config.lat;
		const fallbackLon = this.config.lon;
		const hasFallback =
			fallbackLat != null &&
			fallbackLon != null &&
			!Number.isNaN(Number(fallbackLat)) &&
			!Number.isNaN(Number(fallbackLon));

		return new Promise((resolve) => {
			if (!navigator.geolocation) {
				resolve(
					hasFallback
						? { lat: Number(fallbackLat), lon: Number(fallbackLon) }
						: { error: "Geolocation unavailable and no lat/lon configured." }
				);
				return;
			}
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
				},
				() => {
					resolve(
						hasFallback
							? { lat: Number(fallbackLat), lon: Number(fallbackLon) }
							: { error: "Geolocation denied and no lat/lon configured." }
					);
				},
				{ enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000 }
			);
		});
	},

	async handleFunctionCall (call) {
		if (!call || !call.callId) return;
		if (call.name !== "get_weather") {
			if (this.voice) {
				this.voice.sendFunctionOutput(call.callId, {
					error: true,
					message: `Unknown function: ${call.name}`
				});
			}
			return;
		}

		const requestId = `wx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		this.pendingWeather.set(requestId, call.callId);

		try {
			const coords = await this.resolveWeatherLocation(call.arguments?.location);
			if (coords.error) {
				this.pendingWeather.delete(requestId);
				if (this.voice) {
					this.voice.sendFunctionOutput(call.callId, { error: true, message: coords.error });
				}
				return;
			}
			this.sendSocketNotification("AI_WEATHER_FETCH", {
				instanceId: this.identifier,
				requestId,
				callId: call.callId,
				lat: coords.lat,
				lon: coords.lon,
				location: coords.location,
				units: this.config.units || "metric"
			});
		} catch (error) {
			this.pendingWeather.delete(requestId);
			if (this.voice) {
				this.voice.sendFunctionOutput(call.callId, {
					error: true,
					message: error.message || "Weather lookup failed"
				});
			}
		}
	},

	suspend () {
		if (this.voice) this.voice.stop();
		this.attachAvatarStream(null);
		this.dematerializeAvatar();
	},

	resume () {
		if (this.voice && this.voice.supported) this.voice.start();
		if (!this.wakeGatedAppearance()) {
			this.materializeAvatar("idle");
		} else {
			this.dematerializeAvatar();
		}
	},

	setUiState (state) {
		this.uiState = state;
		const shellState = state === "wake" ? "idle" : state;
		if (this.wrapper) {
			const present = this.avatarVisible || !this.wakeGatedAppearance();
			this.wrapper.className = `mmm-ai-character mmm-ai-character--${shellState}${
				present ? " mmm-ai-character--present" : ""
			}`;
		}

		const gated = this.wakeGatedAppearance();
		if (gated && (state === "wake" || state === "idle")) {
			this.dematerializeAvatar();
			return;
		}

		const avatarState =
			state === "listening"
				? "listening"
				: state === "thinking"
					? "thinking"
					: state === "speaking"
						? "speaking"
						: state === "error"
							? "error"
							: "idle";

		if (gated) {
			this.materializeAvatar(avatarState);
			return;
		}

		this.avatarVisible = true;
		this.postAvatar({ type: "avatar:setState", state: avatarState });
	},

	handleVoiceMode (mode) {
		if (mode === "wake") {
			this.setUiState("wake");
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

		if (notification === "AI_WEATHER_RESULT") {
			const callId = payload.callId || this.pendingWeather.get(payload.requestId);
			if (payload.requestId) this.pendingWeather.delete(payload.requestId);

			if (payload.error) {
				if (this.voice && callId) {
					this.voice.sendFunctionOutput(callId, {
						error: true,
						message: payload.message || "Weather fetch failed"
					});
				}
				return;
			}

			this.showWeatherCard(payload);
			if (this.voice && callId) {
				this.voice.sendFunctionOutput(callId, payload.summary || payload);
			}
			return;
		}

		// AI_CONFIG_OK: voice controller owns status text after connect/error.
	}
});
