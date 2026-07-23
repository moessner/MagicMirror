/* global window, navigator, MediaRecorder, Blob, FileReader, RTCPeerConnection */
/**
 * OpenAI Realtime WebRTC voice session for MMM-AICharacter.
 * Local STT is used only to arm the wake word; conversation audio is speech-to-speech.
 */
(function (global) {
	"use strict";

	function normalize (text) {
		return String(text || "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	/** Collapse vowels / repeats so "mirror"≈"miror"≈"mere" style STT slips still match. */
	function soften (text) {
		return normalize(text)
			.replace(/(.)\1+/g, "$1")
			.replace(/[aeiouy]+/g, "a")
			.replace(/\s+/g, "");
	}

	function editDistance (a, b) {
		const s = String(a || "");
		const t = String(b || "");
		const rows = s.length + 1;
		const cols = t.length + 1;
		const dp = new Array(rows);
		for (let i = 0; i < rows; i++) {
			dp[i] = new Array(cols);
			dp[i][0] = i;
		}
		for (let j = 0; j < cols; j++) dp[0][j] = j;
		for (let i = 1; i < rows; i++) {
			for (let j = 1; j < cols; j++) {
				const cost = s[i - 1] === t[j - 1] ? 0 : 1;
				dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
			}
		}
		return dp[s.length][t.length];
	}

	function defaultWakeAliases (wakeWord) {
		const w = normalize(wakeWord);
		if (w === "alexa") {
			return [
				"alexa",
				"alexia",
				"alex ah",
				"a lexa",
				"alex er",
				"alexa alexa",
				"hey alexa",
				"ok alexa"
			];
		}
		if (w === "hey mirror") {
			return [
				"hey mirror",
				"a mirror",
				"hey mere",
				"hey mira",
				"hey mirra",
				"hey miror",
				"hey mirro",
				"hey myrrh",
				"hey miller",
				"hey nearer",
				"hey mayor",
				"hey mera",
				"hey meera",
				"hay mirror",
				"hey mirar",
				"hey merror",
				"hey mirror mirror"
			];
		}
		return [w];
	}

	/**
	 * Fuzzy wake match tolerant of STT mishears (not just exact pronunciation).
	 * @param {string} transcript
	 * @param {string} wakeWord
	 * @param {string[]} [aliases]
	 * @returns {{matched:boolean, remainder:string, heard:string}}
	 */
	function matchWakeWord (transcript, wakeWord, aliases) {
		const t = normalize(transcript);
		const w = normalize(wakeWord);
		if (!w) return { matched: true, remainder: t, heard: t };
		if (!t) return { matched: false, remainder: "", heard: "" };

		const phrases = Array.from(
			new Set(
				[w]
					.concat(Array.isArray(aliases) ? aliases : [])
					.concat(defaultWakeAliases(w))
					.map(normalize)
					.filter(Boolean)
			)
		);

		for (const phrase of phrases) {
			const idx = t.indexOf(phrase);
			if (idx !== -1) {
				return { matched: true, remainder: t.slice(idx + phrase.length).trim(), heard: t };
			}
		}

		// Soft phonetic containment, e.g. "hey miror" ≈ "hey mirror"
		const softT = soften(t);
		for (const phrase of phrases) {
			const softP = soften(phrase);
			if (softP.length >= 4 && softT.includes(softP)) {
				return { matched: true, remainder: "", heard: t };
			}
		}

		// Token window: require each wake token to fuzzy-match a transcript token in order.
		const wakeTokens = w.split(" ").filter(Boolean);
		const heardTokens = t.split(" ").filter(Boolean);
		if (wakeTokens.length >= 1 && heardTokens.length >= wakeTokens.length) {
			for (let start = 0; start <= heardTokens.length - wakeTokens.length; start++) {
				let ok = true;
				for (let i = 0; i < wakeTokens.length; i++) {
					const want = wakeTokens[i];
					const got = heardTokens[start + i];
					const maxDist = want.length <= 3 ? 1 : 2;
					const close =
						got === want ||
						soften(got) === soften(want) ||
						editDistance(got, want) <= maxDist ||
						editDistance(soften(got), soften(want)) <= 1;
					if (!close) {
						ok = false;
						break;
					}
				}
				if (ok) {
					return {
						matched: true,
						remainder: heardTokens.slice(start + wakeTokens.length).join(" "),
						heard: t
					};
				}
			}
		}

		return { matched: false, remainder: "", heard: t };
	}

	function blobToBase64 (blob) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const result = String(reader.result || "");
				const comma = result.indexOf(",");
				resolve(comma >= 0 ? result.slice(comma + 1) : result);
			};
			reader.onerror = () => reject(reader.error || new Error("Failed to read audio"));
			reader.readAsDataURL(blob);
		});
	}

	function pickMimeType () {
		const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
		for (const type of candidates) {
			if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
				return type;
			}
		}
		return "";
	}

	/**
	 * @param {object} config
	 * @param {string} config.wakeWord
	 * @param {string[]} [config.wakeAliases]
	 * @param {string} config.systemPrompt
	 * @param {number} config.postSpeakListenMs
	 * @param {number} [config.wakeSilenceMs]
	 * @param {number} [config.vadThreshold]
	 * @param {function} config.requestToken - () => Promise<{value:string}>
	 * @param {function} config.onTranscribeRequest - ({requestId, audioBase64, mimeType}) => void
	 * @param {function} config.onState - (mode) => void
	 * @param {function} config.onStatus - (text) => void
	 * @param {function} config.onUserCaption - (text) => void
	 * @param {function} config.onAssistantCaption - (text) => void
	 * @param {function} config.onAssistantDelta - (delta) => void
	 * @param {function} config.onRemoteStream - (MediaStream|null) => void
	 * @param {function} config.onError - (message) => void
	 */
	function createRealtimeVoiceController (config) {
		const supported = Boolean(
			global.navigator &&
				navigator.mediaDevices &&
				navigator.mediaDevices.getUserMedia &&
				global.RTCPeerConnection &&
				global.MediaRecorder
		);

		let active = false;
		let mode = "wake";
		let armedUntil = 0;
		let localStream = null;
		let rtcTrack = null;
		let peer = null;
		let dataChannel = null;
		let remoteStream = null;
		let audioEl = null;
		let connecting = false;
		let connected = false;
		let tokenRequestId = 0;
		let pendingTokenResolve = null;
		let pendingTokenReject = null;

		// Local wake-arming VAD / recorder (mic muted to OpenAI until armed)
		let audioContext = null;
		let analyser = null;
		let vadTimer = null;
		let mediaRecorder = null;
		let recordChunks = [];
		let recording = false;
		let speechStartedAt = 0;
		let lastLoudAt = 0;
		let sttInFlight = false;
		let sttRequestId = 0;
		let remuteTimer = null;
		let assistantBuffer = "";
		let userBuffer = "";

		const mimeType = pickMimeType();
		// Slightly more sensitive mic gate — quiet wake words were often missed.
		const vadThreshold = typeof config.vadThreshold === "number" ? config.vadThreshold : 0.015;
		const wakeSilenceMs = typeof config.wakeSilenceMs === "number" ? config.wakeSilenceMs : 550;
		const minSpeechMs = 220;
		const maxWakeClipMs = 6000;

		function wakeEnabled () {
			return Boolean(normalize(config.wakeWord || ""));
		}

		function setMode (next) {
			mode = next;
			if (typeof config.onState === "function") config.onState(next);
		}

		function setStatus (text) {
			if (typeof config.onStatus === "function") config.onStatus(text);
		}

		function setMicOpen (open) {
			if (rtcTrack) rtcTrack.enabled = Boolean(open);
		}

		function clearRemuteTimer () {
			if (remuteTimer) {
				global.clearTimeout(remuteTimer);
				remuteTimer = null;
			}
		}

		function scheduleRemute () {
			clearRemuteTimer();
			const windowMs = config.postSpeakListenMs || 8000;
			armedUntil = Date.now() + windowMs;
			remuteTimer = global.setTimeout(() => {
				remuteTimer = null;
				if (!active) return;
				if (Date.now() < armedUntil) return;
				closeConversationGate();
			}, windowMs + 50);
		}

		function openConversationGate (seedUserText) {
			clearRemuteTimer();
			setMicOpen(true);
			setMode("listening");
			userBuffer = seedUserText || "";
			assistantBuffer = "";
			if (userBuffer && typeof config.onUserCaption === "function") {
				config.onUserCaption(userBuffer);
			}
			if (typeof config.onAssistantCaption === "function") config.onAssistantCaption("");
			setStatus("Listening…");
			armedUntil = Date.now() + (config.postSpeakListenMs || 8000);
		}

		function closeConversationGate () {
			clearRemuteTimer();
			setMicOpen(false);
			armedUntil = 0;
			setMode("wake");
			if (wakeEnabled()) {
				setStatus(`Say "${config.wakeWord}"`);
			} else {
				setStatus("Listening…");
			}
		}

		function rmsLevel () {
			if (!analyser) return 0;
			const data = new Uint8Array(analyser.fftSize);
			analyser.getByteTimeDomainData(data);
			let sum = 0;
			for (let i = 0; i < data.length; i++) {
				const v = (data[i] - 128) / 128;
				sum += v * v;
			}
			return Math.sqrt(sum / data.length);
		}

		function beginWakeRecording () {
			if (!localStream || recording || sttInFlight || !wakeEnabled()) return;
			// Only use local STT while mic is gated closed
			if (rtcTrack && rtcTrack.enabled) return;
			try {
				recordChunks = [];
				mediaRecorder = mimeType ? new MediaRecorder(localStream, { mimeType }) : new MediaRecorder(localStream);
				mediaRecorder.ondataavailable = (event) => {
					if (event.data && event.data.size > 0) recordChunks.push(event.data);
				};
				mediaRecorder.onerror = () => {
					config.onError("Wake-word recording failed.");
				};
				mediaRecorder.start(200);
				recording = true;
				speechStartedAt = Date.now();
				lastLoudAt = Date.now();
				setStatus("Heard you…");
			} catch (error) {
				config.onError(error.message || "Could not start wake recording.");
			}
		}

		async function finishWakeRecording () {
			if (!recording || !mediaRecorder) return;
			recording = false;
			const recorder = mediaRecorder;
			mediaRecorder = null;

			const blob = await new Promise((resolve) => {
				recorder.onstop = () => {
					resolve(new Blob(recordChunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
				};
				try {
					recorder.stop();
				} catch {
					resolve(new Blob([]));
				}
			});

			recordChunks = [];
			if (!active || !blob || blob.size < 1000) return;
			if (rtcTrack && rtcTrack.enabled) return;

			sttInFlight = true;
			sttRequestId += 1;
			const requestId = `wake-${sttRequestId}-${Date.now()}`;
			setStatus("Checking wake word…");

			try {
				const audioBase64 = await blobToBase64(blob);
				config.onTranscribeRequest({
					requestId,
					audioBase64,
					mimeType: blob.type || mimeType || "audio/webm"
				});
			} catch (error) {
				sttInFlight = false;
				config.onError(error.message || "Failed to encode wake audio.");
			}
		}

		function tickVad () {
			if (!active || !analyser || !wakeEnabled()) return;
			if (rtcTrack && rtcTrack.enabled) return;
			if (!connected) return;

			const level = rmsLevel();
			const now = Date.now();
			if (level >= vadThreshold) {
				lastLoudAt = now;
				if (!recording && !sttInFlight) beginWakeRecording();
			}

			if (recording) {
				const silentFor = now - lastLoudAt;
				const spokenFor = now - speechStartedAt;
				if (spokenFor >= maxWakeClipMs || (spokenFor >= minSpeechMs && silentFor >= wakeSilenceMs)) {
					finishWakeRecording();
				}
			}
		}

		function handleSttResult (payload) {
			if (!payload) return;
			if (payload.error) {
				sttInFlight = false;
				config.onError(payload.message || "Wake transcription failed.");
				return;
			}
			sttInFlight = false;
			if (!wakeEnabled() || (rtcTrack && rtcTrack.enabled)) return;

			const wake = matchWakeWord(payload.text || "", config.wakeWord || "", config.wakeAliases);
			if (!wake.matched) {
				if (wake.heard) {
					setStatus(`Heard "${wake.heard}" — say "${config.wakeWord}"`);
				} else {
					setStatus(`Say "${config.wakeWord}"`);
				}
				return;
			}
			openConversationGate(wake.remainder);
		}

		/** @type {Set<string>} */
		const pendingCallIds = new Set();
		let assistantAudioPlaying = false;
		const handledCallIds = new Set();

		function sendEvent (event) {
			if (!dataChannel || dataChannel.readyState !== "open") return;
			dataChannel.send(JSON.stringify(event));
		}

		function hasPendingFunctionCalls () {
			return pendingCallIds.size > 0;
		}

		function responseHasFunctionCall (event) {
			const output = event?.response?.output || event?.output || [];
			if (!Array.isArray(output)) return false;
			return output.some((item) => item && item.type === "function_call");
		}

		function finishAssistantTurn () {
			if (hasPendingFunctionCalls() || assistantAudioPlaying) return;
			setMode("listening");
			setStatus("Listening…");
			scheduleRemute();
		}

		function sendFunctionOutput (callId, outputObject) {
			if (!callId) return;
			const output =
				typeof outputObject === "string" ? outputObject : JSON.stringify(outputObject ?? {});
			sendEvent({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: callId,
					output
				}
			});
			pendingCallIds.delete(callId);
			sendEvent({ type: "response.create" });
		}

		function handleFunctionCallDone (event) {
			const name = event.name || event.item?.name || "";
			const callId = event.call_id || event.callId || event.item?.call_id;
			if (!callId || handledCallIds.has(callId)) return;
			handledCallIds.add(callId);
			// Bound memory for long sessions
			if (handledCallIds.size > 50) {
				handledCallIds.clear();
			}

			let args = {};
			const rawArgs = event.arguments ?? event.item?.arguments;
			try {
				args = rawArgs ? JSON.parse(rawArgs) : {};
			} catch {
				args = {};
			}

			pendingCallIds.add(callId);
			clearRemuteTimer();
			assistantAudioPlaying = false;
			setMode("thinking");
			setStatus("Fetching…");
			if (typeof config.onFunctionCall === "function") {
				config.onFunctionCall({ name, callId, arguments: args });
			} else {
				sendFunctionOutput(callId, { error: true, message: "No function handler registered." });
			}
		}

		function handleServerEvent (event) {
			if (!event || !event.type) return;

			switch (event.type) {
				case "session.created":
				case "session.updated":
					break;
				case "input_audio_buffer.speech_started":
					clearRemuteTimer();
					armedUntil = Date.now() + (config.postSpeakListenMs || 8000);
					assistantBuffer = "";
					if (typeof config.onAssistantCaption === "function") config.onAssistantCaption("");
					setMode("listening");
					setStatus("Listening…");
					break;
				case "input_audio_buffer.speech_stopped":
					setMode("thinking");
					setStatus("Thinking…");
					break;
				case "conversation.item.input_audio_transcription.delta":
					if (event.delta) {
						userBuffer += event.delta;
						if (typeof config.onUserCaption === "function") config.onUserCaption(userBuffer);
					}
					break;
				case "conversation.item.input_audio_transcription.completed":
					userBuffer = event.transcript || userBuffer;
					if (typeof config.onUserCaption === "function") config.onUserCaption(userBuffer);
					break;
				case "response.created":
					assistantBuffer = "";
					if (typeof config.onAssistantCaption === "function") config.onAssistantCaption("");
					if (!hasPendingFunctionCalls()) {
						setMode("thinking");
						setStatus("Thinking…");
					}
					break;
				case "response.function_call_arguments.done":
					handleFunctionCallDone(event);
					break;
				case "response.output_item.done":
					if (event.item?.type === "function_call") {
						handleFunctionCallDone(event.item);
					}
					break;
				case "response.output_audio_transcript.delta":
				case "response.audio_transcript.delta":
					if (event.delta) {
						assistantBuffer += event.delta;
						if (typeof config.onAssistantDelta === "function") config.onAssistantDelta(event.delta);
						else if (typeof config.onAssistantCaption === "function") config.onAssistantCaption(assistantBuffer);
						clearRemuteTimer();
						setMode("speaking");
					}
					break;
				case "response.output_audio_transcript.done":
				case "response.audio_transcript.done":
					assistantBuffer = event.transcript || assistantBuffer;
					if (typeof config.onAssistantCaption === "function") config.onAssistantCaption(assistantBuffer);
					break;
				case "output_audio_buffer.started":
				case "response.output_audio.delta":
					assistantAudioPlaying = true;
					clearRemuteTimer();
					setMode("speaking");
					setStatus(`${config.characterName || "Pixel"} is speaking…`);
					break;
				case "output_audio_buffer.stopped":
					assistantAudioPlaying = false;
					finishAssistantTurn();
					break;
				case "response.done":
					// Tool-only responses must not arm remute — that was dematerializing
					// mid-session and breaking subsequent get_weather UI updates.
					if (hasPendingFunctionCalls() || responseHasFunctionCall(event)) {
						assistantAudioPlaying = false;
						setMode("thinking");
						setStatus("Fetching…");
						break;
					}
					if (assistantAudioPlaying) {
						// Wait for output_audio_buffer.stopped so we don't remute early.
						break;
					}
					finishAssistantTurn();
					break;
				case "error":
					config.onError(event.error?.message || event.message || "Realtime session error");
					break;
				default:
					break;
			}
		}

		function ensureAudioElement () {
			if (audioEl) return audioEl;
			audioEl = global.document.createElement("audio");
			audioEl.autoplay = true;
			audioEl.playsInline = true;
			audioEl.style.display = "none";
			if (global.document?.body) global.document.body.appendChild(audioEl);
			return audioEl;
		}

		async function connectPeer (ephemeralKey) {
			peer = new RTCPeerConnection();
			remoteStream = new MediaStream();
			ensureAudioElement();

			peer.ontrack = (event) => {
				const stream = event.streams?.[0] || new MediaStream([event.track]);
				remoteStream = stream;
				audioEl.srcObject = stream;
				audioEl.play().catch(() => {});
				if (typeof config.onRemoteStream === "function") config.onRemoteStream(stream);
			};

			peer.onconnectionstatechange = () => {
				if (!peer) return;
				if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
					connected = false;
					config.onError("Realtime connection lost. Reconnecting…");
					reconnect();
				}
			};

			dataChannel = peer.createDataChannel("oai-events");
			dataChannel.addEventListener("open", () => {
				sendEvent({
					type: "session.update",
					session: {
						type: "realtime",
						instructions:
							config.systemPrompt ||
							"You are Pixel, a concise AI mirror companion. Speak in short, clear spoken answers (1-3 sentences). When asked about weather or the forecast, call get_weather, then summarize briefly from the tool result — never invent numbers.",
						tools: [
							{
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
							}
						],
						tool_choice: "auto",
						audio: {
							input: {
								transcription: {
									model: "gpt-4o-mini-transcribe"
								},
								turn_detection: {
									type: "server_vad",
									create_response: true,
									interrupt_response: true,
									silence_duration_ms: 400
								}
							}
						}
					}
				});
			});
			dataChannel.addEventListener("message", (event) => {
				try {
					handleServerEvent(JSON.parse(event.data));
				} catch {
					// ignore malformed
				}
			});

			const localTrack = localStream.getAudioTracks()[0];
			rtcTrack = localTrack.clone();
			rtcTrack.enabled = !wakeEnabled();
			const rtcStream = new MediaStream([rtcTrack]);
			peer.addTrack(rtcTrack, rtcStream);

			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);

			const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
				method: "POST",
				body: offer.sdp,
				headers: {
					Authorization: `Bearer ${ephemeralKey}`,
					"Content-Type": "application/sdp"
				}
			});

			if (!sdpResponse.ok) {
				const errText = await sdpResponse.text();
				throw new Error(errText || `Realtime SDP exchange failed (${sdpResponse.status})`);
			}

			const answer = {
				type: "answer",
				sdp: await sdpResponse.text()
			};
			await peer.setRemoteDescription(answer);
			connected = true;

			if (!wakeEnabled()) {
				openConversationGate("");
			} else {
				closeConversationGate();
			}
		}

		function destroyPeer () {
			connected = false;
			pendingCallIds.clear();
			handledCallIds.clear();
			assistantAudioPlaying = false;
			if (dataChannel) {
				try {
					dataChannel.close();
				} catch {
					// ignore
				}
				dataChannel = null;
			}
			if (peer) {
				try {
					peer.close();
				} catch {
					// ignore
				}
				peer = null;
			}
			if (rtcTrack) {
				try {
					rtcTrack.stop();
				} catch {
					// ignore
				}
				rtcTrack = null;
			}
			if (audioEl) {
				audioEl.srcObject = null;
			}
			if (typeof config.onRemoteStream === "function") config.onRemoteStream(null);
			remoteStream = null;
		}

		function requestToken () {
			tokenRequestId += 1;
			const requestId = `token-${tokenRequestId}-${Date.now()}`;
			return new Promise((resolve, reject) => {
				pendingTokenResolve = resolve;
				pendingTokenReject = reject;
				try {
					config.requestToken(requestId);
				} catch (error) {
					pendingTokenResolve = null;
					pendingTokenReject = null;
					reject(error);
				}
				// Fail closed if the node helper never answers.
				global.setTimeout(() => {
					if (pendingTokenReject === reject) {
						pendingTokenResolve = null;
						pendingTokenReject = null;
						reject(new Error("Timed out waiting for Realtime token."));
					}
				}, 15000);
			});
		}

		function handleTokenResult (payload) {
			if (!payload) return;
			if (payload.error) {
				if (pendingTokenReject) pendingTokenReject(new Error(payload.message || "Token error"));
				pendingTokenResolve = null;
				pendingTokenReject = null;
				return;
			}
			if (pendingTokenResolve) pendingTokenResolve(payload);
			pendingTokenResolve = null;
			pendingTokenReject = null;
		}

		async function reconnect () {
			if (!active || connecting) return;
			connecting = true;
			setStatus("Connecting live voice…");
			try {
				destroyPeer();
				const token = await requestToken();
				if (!token?.value) throw new Error("No ephemeral Realtime key returned.");
				await connectPeer(token.value);
				setStatus(wakeEnabled() ? `Say "${config.wakeWord}"` : "Listening…");
			} catch (error) {
				config.onError(error.message || "Could not connect Realtime voice.");
			} finally {
				connecting = false;
			}
		}

		async function startMic () {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: false
			});

			audioContext = new (global.AudioContext || global.webkitAudioContext)();
			const source = audioContext.createMediaStreamSource(localStream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 2048;
			source.connect(analyser);
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			if (vadTimer) global.clearInterval(vadTimer);
			vadTimer = global.setInterval(tickVad, 80);
		}

		async function start () {
			if (!supported) {
				config.onError("Realtime voice requires getUserMedia + WebRTC in this browser.");
				return;
			}
			active = true;
			setMode("wake");
			setStatus("Connecting live voice…");
			try {
				await startMic();
				await reconnect();
			} catch (error) {
				active = false;
				if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
					config.onError("Microphone permission denied. Allow mic access for live voice.");
				} else {
					config.onError(error.message || "Could not start live voice.");
				}
			}
		}

		function stop () {
			active = false;
			clearRemuteTimer();
			if (vadTimer) {
				global.clearInterval(vadTimer);
				vadTimer = null;
			}
			if (recording && mediaRecorder) {
				try {
					mediaRecorder.onstop = null;
					mediaRecorder.stop();
				} catch {
					// ignore
				}
			}
			recording = false;
			mediaRecorder = null;
			sttInFlight = false;
			destroyPeer();
			if (localStream) {
				localStream.getTracks().forEach((track) => track.stop());
				localStream = null;
			}
			if (audioContext) {
				audioContext.close().catch(() => {});
				audioContext = null;
			}
			analyser = null;
			if (audioEl && audioEl.parentNode) {
				audioEl.parentNode.removeChild(audioEl);
			}
			audioEl = null;
		}

		function getMode () {
			return mode;
		}

		return {
			start,
			stop,
			handleSttResult,
			handleTokenResult,
			sendFunctionOutput,
			getMode,
			matchWakeWord,
			supported
		};
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createRealtimeVoiceController = createRealtimeVoiceController;
	global.MMM_AICharacterLib.matchWakeWord = matchWakeWord;
})(typeof window !== "undefined" ? window : this);
