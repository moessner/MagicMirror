/* global Module, Log, MMM_AICharacterLib */

Module.register("MMM-AICharacter", {
	defaults: {
		wakeWord: "Spiegel",
		wakeAliases: [],
		realtimeModel: "gpt-realtime",
		voice: "sage",
		transcriptionModel: "gpt-4o-mini-transcribe",
		voiceLang: "en-US",
		characterName: "Pixel",
		systemPrompt:
			"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). Be warm, slightly playful, and helpful. Avoid markdown, lists, and stage directions. Always reply in the language configured via voiceLang (for de-DE: German/Deutsch). When asked about weather, temperature, or the forecast, always call get_weather first, then summarize briefly from the tool result — never invent numbers. Call get_weather again on every weather question, even if you already answered weather earlier in the session. When asked about news, headlines, current events, or Schlagzeilen, always call get_news first, then summarize briefly from the tool result — never invent headlines. Call get_news again on every news question, even if you already answered news earlier in the session. When asked about the calendar, schedule, appointments, upcoming events, or Termine, always call get_calendar first, then summarize briefly from the tool result — never invent events. Call get_calendar again on every calendar question, even if you already answered calendar earlier in the session.",
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
		showNewsCard: true,
		showCalendarCard: true,
		newsLimit: 5,
		newsFeeds: [
			{
				title: "Tagesschau",
				url: "https://www.tagesschau.de/xml/rss2/"
			}
		],
		/** Google Calendar private ICS URLs (or other iCal feeds). Prefer ${SECRET_GCAL_ICS_URL}. */
		calendars: [],
		calendarMaximumEntries: 8,
		calendarMaximumNumberOfDays: 365,
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
		this.newsEl = null;
		this.calendarEl = null;
		this.pendingWeather = new Map();
		this.pendingNews = new Map();
		this.pendingCalendar = new Map();
		this.cachedGeo = null;
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
			? `Sag "${this.config.wakeWord}"`
			: "Connecting live voice…";

		const userEl = document.createElement("div");
		userEl.className = "mmm-ai-character__user";

		const assistantEl = document.createElement("div");
		assistantEl.className = "mmm-ai-character__assistant";

		const weatherEl = document.createElement("div");
		weatherEl.className = "mmm-ai-character__weather";
		weatherEl.hidden = true;
		this.weatherEl = weatherEl;

		const newsEl = document.createElement("div");
		newsEl.className = "mmm-ai-character__news";
		newsEl.hidden = true;
		this.newsEl = newsEl;

		const calendarEl = document.createElement("div");
		calendarEl.className = "mmm-ai-character__calendar";
		calendarEl.hidden = true;
		this.calendarEl = calendarEl;

		captions.appendChild(statusEl);
		captions.appendChild(userEl);
		captions.appendChild(assistantEl);
		captions.appendChild(weatherEl);
		captions.appendChild(newsEl);
		captions.appendChild(calendarEl);

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
			voiceLang: this.config.voiceLang,
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
			units: this.config.units,
			newsFeeds: this.config.newsFeeds,
			newsLimit: this.config.newsLimit,
			calendars: this.config.calendars,
			calendarMaximumEntries: this.config.calendarMaximumEntries,
			calendarMaximumNumberOfDays: this.config.calendarMaximumNumberOfDays
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
			this.clearNewsCard();
			this.clearCalendarCard();
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
			this.clearNewsCard();
			this.clearCalendarCard();
		}, 1300);
	},

	clearWeatherCard () {
		const weatherEl = this.ensureWeatherElement();
		if (!weatherEl) return;
		weatherEl.hidden = true;
		weatherEl.setAttribute("hidden", "hidden");
		weatherEl.innerHTML = "";
		if (this.wrapper) this.wrapper.classList.remove("mmm-ai-character--weather");
	},

	clearNewsCard () {
		const newsEl = this.ensureNewsElement();
		if (!newsEl) return;
		newsEl.hidden = true;
		newsEl.setAttribute("hidden", "hidden");
		newsEl.innerHTML = "";
		if (this.wrapper) this.wrapper.classList.remove("mmm-ai-character--news");
	},

	clearCalendarCard () {
		const calendarEl = this.ensureCalendarElement();
		if (!calendarEl) return;
		calendarEl.hidden = true;
		calendarEl.setAttribute("hidden", "hidden");
		calendarEl.innerHTML = "";
		if (this.wrapper) this.wrapper.classList.remove("mmm-ai-character--calendar");
	},

	escapeHtml (value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	},

	formatDayLabel (dateStr) {
		try {
			const date = new Date(`${dateStr}T12:00:00`);
			return date.toLocaleDateString(this.config.voiceLang || undefined, { weekday: "short" });
		} catch {
			return dateStr;
		}
	},

	ensureWeatherElement () {
		if (this.weatherEl && this.wrapper && this.wrapper.contains(this.weatherEl)) {
			return this.weatherEl;
		}
		if (this.wrapper) {
			this.weatherEl = this.wrapper.querySelector(".mmm-ai-character__weather");
		}
		return this.weatherEl;
	},

	showWeatherCard (data) {
		const weatherEl = this.ensureWeatherElement();
		if (!this.config.showWeatherCard || !weatherEl || !data || data.error) return;

		this.clearNewsCard();
		this.clearCalendarCard();

		// A pending dematerialize would clear the card right after a follow-up ask.
		if (this.vanishTimer) {
			this.clearAppearVanishTimers();
			this.avatarVisible = true;
			if (this.wrapper) this.wrapper.classList.add("mmm-ai-character--present");
		}

		const lib = (typeof MMM_AICharacterLib !== "undefined" && MMM_AICharacterLib) || {};
		const iconClass =
			typeof lib.weatherIconClass === "function"
				? lib.weatherIconClass(data.current?.weatherCode, data.current?.isDay !== false)
				: "wi wi-na";
		const temp = Math.round(Number(data.current?.temperature));
		const symbol = data.tempSymbol || "°";
		const place = this.escapeHtml(data.place || "");
		const condition = this.escapeHtml(data.current?.condition || "");

		const days = (data.daily || [])
			.map((day) => {
				const dayIcon =
					typeof lib.weatherIconClass === "function"
						? lib.weatherIconClass(day.weatherCode, true)
						: "wi wi-na";
				const hi = Math.round(Number(day.tempMax));
				const lo = Math.round(Number(day.tempMin));
				return `<div class="mmm-ai-character__weather-day">
					<span class="mmm-ai-character__weather-day-name">${this.escapeHtml(this.formatDayLabel(day.date))}</span>
					<i class="${dayIcon}" aria-hidden="true"></i>
					<span class="mmm-ai-character__weather-day-temps">${hi}${symbol}/${lo}${symbol}</span>
				</div>`;
			})
			.join("");

		weatherEl.innerHTML = `
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
		weatherEl.hidden = false;
		weatherEl.removeAttribute("hidden");
		if (this.wrapper) {
			this.wrapper.classList.add("mmm-ai-character--weather");
			if (this.avatarVisible || !this.wakeGatedAppearance()) {
				this.wrapper.classList.add("mmm-ai-character--present");
			}
		}
	},

	ensureNewsElement () {
		if (this.newsEl && this.wrapper && this.wrapper.contains(this.newsEl)) {
			return this.newsEl;
		}
		if (this.wrapper) {
			this.newsEl = this.wrapper.querySelector(".mmm-ai-character__news");
		}
		return this.newsEl;
	},

	showNewsCard (data) {
		const newsEl = this.ensureNewsElement();
		if (!this.config.showNewsCard || !newsEl || !data || data.error) return;

		this.clearWeatherCard();
		this.clearCalendarCard();

		// A pending dematerialize would clear the card right after a follow-up ask.
		if (this.vanishTimer) {
			this.clearAppearVanishTimers();
			this.avatarVisible = true;
			if (this.wrapper) this.wrapper.classList.add("mmm-ai-character--present");
		}

		const headlines = Array.isArray(data.headlines) ? data.headlines : [];
		const items = headlines
			.map((item) => {
				const source = this.escapeHtml(item.source || "");
				const title = this.escapeHtml(item.title || "");
				return `<div class="mmm-ai-character__news-item">
					<span class="mmm-ai-character__news-source">${source}</span>
					<span class="mmm-ai-character__news-title">${title}</span>
				</div>`;
			})
			.join("");

		const heading = data.topic
			? `Schlagzeilen · ${this.escapeHtml(data.topic)}`
			: "Schlagzeilen";

		newsEl.innerHTML = `
			<div class="mmm-ai-character__news-heading">${heading}</div>
			<div class="mmm-ai-character__news-list">${items}</div>
		`;
		newsEl.hidden = false;
		newsEl.removeAttribute("hidden");
		if (this.wrapper) {
			this.wrapper.classList.add("mmm-ai-character--news");
			if (this.avatarVisible || !this.wakeGatedAppearance()) {
				this.wrapper.classList.add("mmm-ai-character--present");
			}
		}
	},

	ensureCalendarElement () {
		if (this.calendarEl && this.wrapper && this.wrapper.contains(this.calendarEl)) {
			return this.calendarEl;
		}
		if (this.wrapper) {
			this.calendarEl = this.wrapper.querySelector(".mmm-ai-character__calendar");
		}
		return this.calendarEl;
	},

	showCalendarCard (data) {
		const calendarEl = this.ensureCalendarElement();
		if (!this.config.showCalendarCard || !calendarEl || !data || data.error) return;

		this.clearWeatherCard();
		this.clearNewsCard();

		if (this.vanishTimer) {
			this.clearAppearVanishTimers();
			this.avatarVisible = true;
			if (this.wrapper) this.wrapper.classList.add("mmm-ai-character--present");
		}

		const events = Array.isArray(data.events) ? data.events : [];
		const items = events
			.map((item) => {
				const when = this.escapeHtml(item.when || "");
				const title = this.escapeHtml(item.title || "");
				return `<div class="mmm-ai-character__calendar-item">
					<span class="mmm-ai-character__calendar-when">${when}</span>
					<span class="mmm-ai-character__calendar-title">${title}</span>
				</div>`;
			})
			.join("");

		calendarEl.innerHTML = `
			<div class="mmm-ai-character__calendar-heading">Termine</div>
			<div class="mmm-ai-character__calendar-list">${items}</div>
		`;
		calendarEl.hidden = false;
		calendarEl.removeAttribute("hidden");
		if (this.wrapper) {
			this.wrapper.classList.add("mmm-ai-character--calendar");
			if (this.avatarVisible || !this.wakeGatedAppearance()) {
				this.wrapper.classList.add("mmm-ai-character--present");
			}
		}
	},

	resolveWeatherLocation (locationHint) {
		const place = typeof locationHint === "string" ? locationHint.trim() : "";
		if (place) {
			return Promise.resolve({ location: place });
		}

		if (this.cachedGeo && Date.now() - this.cachedGeo.at < 15 * 60 * 1000) {
			return Promise.resolve({ lat: this.cachedGeo.lat, lon: this.cachedGeo.lon });
		}

		const fallbackLat = this.config.lat;
		const fallbackLon = this.config.lon;
		const hasFallback =
			fallbackLat != null &&
			fallbackLon != null &&
			!Number.isNaN(Number(fallbackLat)) &&
			!Number.isNaN(Number(fallbackLon));
		const fallback = hasFallback
			? { lat: Number(fallbackLat), lon: Number(fallbackLon) }
			: { error: "Geolocation unavailable and no lat/lon configured." };

		return new Promise((resolve) => {
			if (!navigator.geolocation) {
				resolve(fallback);
				return;
			}
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
					this.cachedGeo = { ...coords, at: Date.now() };
					resolve(coords);
				},
				() => resolve(fallback),
				{ enableHighAccuracy: false, timeout: 4000, maximumAge: 10 * 60 * 1000 }
			);
		});
	},

	async handleFunctionCall (call) {
		if (!call || !call.callId) return;

		if (call.name === "get_news") {
			await this.handleNewsFunctionCall(call);
			return;
		}

		if (call.name === "get_calendar") {
			await this.handleCalendarFunctionCall(call);
			return;
		}

		if (call.name !== "get_weather") {
			if (this.voice) {
				this.voice.sendFunctionOutput(call.callId, {
					error: true,
					message: `Unknown function: ${call.name}`
				});
			}
			return;
		}

		// Keep the hologram up while weather is fetched/rendered.
		if (this.wakeGatedAppearance()) {
			this.materializeAvatar("thinking");
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

	async handleNewsFunctionCall (call) {
		// Keep the hologram up while news is fetched/rendered.
		if (this.wakeGatedAppearance()) {
			this.materializeAvatar("thinking");
		}

		const requestId = `news_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		this.pendingNews.set(requestId, call.callId);

		try {
			this.sendSocketNotification("AI_NEWS_FETCH", {
				instanceId: this.identifier,
				requestId,
				callId: call.callId,
				topic: call.arguments?.topic,
				feeds: this.config.newsFeeds,
				limit: this.config.newsLimit
			});
		} catch (error) {
			this.pendingNews.delete(requestId);
			if (this.voice) {
				this.voice.sendFunctionOutput(call.callId, {
					error: true,
					message: error.message || "News lookup failed"
				});
			}
		}
	},

	async handleCalendarFunctionCall (call) {
		if (this.wakeGatedAppearance()) {
			this.materializeAvatar("thinking");
		}

		const requestId = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		this.pendingCalendar.set(requestId, call.callId);

		try {
			this.sendSocketNotification("AI_CALENDAR_FETCH", {
				instanceId: this.identifier,
				requestId,
				callId: call.callId,
				calendars: this.config.calendars,
				maximumEntries: this.config.calendarMaximumEntries,
				maximumNumberOfDays: this.config.calendarMaximumNumberOfDays,
				locale: this.config.voiceLang || "en-US"
			});
		} catch (error) {
			this.pendingCalendar.delete(requestId);
			if (this.voice) {
				this.voice.sendFunctionOutput(call.callId, {
					error: true,
					message: error.message || "Calendar lookup failed"
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
			const weatherOpen = Boolean(this.weatherEl && !this.weatherEl.hidden);
			const newsOpen = Boolean(this.newsEl && !this.newsEl.hidden);
			const calendarOpen = Boolean(this.calendarEl && !this.calendarEl.hidden);
			this.wrapper.className = `mmm-ai-character mmm-ai-character--${shellState}${
				present ? " mmm-ai-character--present" : ""
			}${weatherOpen ? " mmm-ai-character--weather" : ""}${newsOpen ? " mmm-ai-character--news" : ""}${
				calendarOpen ? " mmm-ai-character--calendar" : ""
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

		if (notification === "AI_NEWS_RESULT") {
			const callId = payload.callId || this.pendingNews.get(payload.requestId);
			if (payload.requestId) this.pendingNews.delete(payload.requestId);

			if (payload.error) {
				if (this.voice && callId) {
					this.voice.sendFunctionOutput(callId, {
						error: true,
						message: payload.message || "News fetch failed"
					});
				}
				return;
			}

			this.showNewsCard(payload);
			if (this.voice && callId) {
				this.voice.sendFunctionOutput(callId, payload.summary || payload);
			}
			return;
		}

		if (notification === "AI_CALENDAR_RESULT") {
			const callId = payload.callId || this.pendingCalendar.get(payload.requestId);
			if (payload.requestId) this.pendingCalendar.delete(payload.requestId);

			if (payload.error) {
				if (this.voice && callId) {
					this.voice.sendFunctionOutput(callId, {
						error: true,
						message: payload.message || "Calendar fetch failed"
					});
				}
				return;
			}

			this.showCalendarCard(payload);
			if (this.voice && callId) {
				this.voice.sendFunctionOutput(callId, payload.summary || payload);
			}
			return;
		}

		// AI_CONFIG_OK: voice controller owns status text after connect/error.
	}
});
