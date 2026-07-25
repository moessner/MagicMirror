/* global window, navigator, MediaRecorder, Blob, FileReader, speechSynthesis, SpeechSynthesisUtterance */
/**
 * Hands-free voice I/O for MMM-AICharacter.
 * Uses microphone + VAD locally, and server-side STT (AI Gateway) for transcripts.
 * Browser Web Speech API is intentionally avoided (network errors on many hosts).
 */
(function (global) {
	"use strict";

	/**
	 * @param {string} text
	 * @returns {string}
	 */
	function normalize (text) {
		return String(text || "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * @param {string} transcript
	 * @param {string} wakeWord
	 * @returns {{matched:boolean, remainder:string}}
	 */
	function matchWakeWord (transcript, wakeWord) {
		const t = normalize(transcript);
		const w = normalize(wakeWord);
		if (!w) return { matched: true, remainder: t };
		const idx = t.indexOf(w);
		if (idx === -1) return { matched: false, remainder: "" };
		return { matched: true, remainder: t.slice(idx + w.length).trim() };
	}

	/**
	 * @param {Blob} blob
	 * @returns {Promise<string>}
	 */
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

	/**
	 * Pick a MediaRecorder mime type supported by this browser.
	 * @returns {string}
	 */
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
	 * @param {string} config.lang
	 * @param {number} config.silenceMs
	 * @param {number} config.postSpeakListenMs
	 * @param {number} [config.vadThreshold]
	 * @param {function} config.onState
	 * @param {function} config.onPartial
	 * @param {function} config.onUtterance
	 * @param {function} config.onBargeIn
	 * @param {function} config.onError
	 * @param {function} config.onTranscribeRequest - ({requestId, audioBase64, mimeType}) => void
	 * @returns {object}
	 */
	function createVoiceController (config) {
		const supported = Boolean(global.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder);

		let mode = "wake";
		let armedUntil = 0;
		let active = false;
		let speaking = false;
		let stream = null;
		let audioContext = null;
		let analyser = null;
		let vadTimer = null;
		let mediaRecorder = null;
		let recordChunks = [];
		let recording = false;
		let speechStartedAt = 0;
		let lastLoudAt = 0;
		let pendingTranscript = "";
		let sttInFlight = false;
		let sttRequestId = 0;
		const mimeType = pickMimeType();
		const vadThreshold = typeof config.vadThreshold === "number" ? config.vadThreshold : 0.025;
		const minSpeechMs = 350;
		const maxUtteranceMs = 15000;

		function setMode (next) {
			mode = next;
			if (typeof config.onState === "function") config.onState(next);
		}

		function clearVad () {
			if (vadTimer) {
				global.clearInterval(vadTimer);
				vadTimer = null;
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

		function beginRecording () {
			if (!stream || recording || sttInFlight) return;
			try {
				recordChunks = [];
				mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
				mediaRecorder.ondataavailable = (event) => {
					if (event.data && event.data.size > 0) recordChunks.push(event.data);
				};
				mediaRecorder.onerror = () => {
					config.onError("Microphone recording failed.");
				};
				mediaRecorder.start(250);
				recording = true;
				speechStartedAt = Date.now();
				lastLoudAt = Date.now();
			} catch (error) {
				config.onError(error.message || "Could not start recording.");
			}
		}

		async function finishRecording () {
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
			if (!active || !blob || blob.size < 1200) return;

			sttInFlight = true;
			sttRequestId += 1;
			const requestId = `stt-${sttRequestId}-${Date.now()}`;
			config.onPartial("Transcribing…", mode === "speaking" ? "listening" : mode);

			try {
				const audioBase64 = await blobToBase64(blob);
				config.onTranscribeRequest({
					requestId,
					audioBase64,
					mimeType: blob.type || mimeType || "audio/webm"
				});
			} catch (error) {
				sttInFlight = false;
				config.onError(error.message || "Failed to encode audio.");
			}
		}

		function handleTranscript (text, requestId) {
			sttInFlight = false;
			const cleaned = normalize(text);
			if (!cleaned) {
				if (mode === "listening" && !pendingTranscript) {
					config.onPartial("Listening…", "listening");
				}
				return;
			}

			if (speaking || mode === "speaking") {
				speaking = false;
				config.onBargeIn();
				armedUntil = Date.now() + (config.postSpeakListenMs || 8000);
				setMode("listening");
				pendingTranscript = cleaned;
				config.onPartial(pendingTranscript, "listening");
				maybeCommitListening(true);
				return;
			}

			if (mode === "wake") {
				const openMic = Date.now() < armedUntil;
				const wake = matchWakeWord(cleaned, config.wakeWord || "pixel");
				if (!openMic && !wake.matched) {
					config.onPartial(`Say "${config.wakeWord || "pixel"}"`, "wake");
					return;
				}
				setMode("listening");
				pendingTranscript = openMic && !wake.matched ? cleaned : wake.remainder;
				if (pendingTranscript) {
					config.onPartial(pendingTranscript, "listening");
					maybeCommitListening(true);
				} else {
					config.onPartial("Listening…", "listening");
				}
				return;
			}

			// listening — append continuation phrases
			pendingTranscript = `${pendingTranscript} ${cleaned}`.trim();
			config.onPartial(pendingTranscript, "listening");
			maybeCommitListening(false);
		}

		function maybeCommitListening (force) {
			if (!pendingTranscript) return;
			if (!force && Date.now() < armedUntil) {
				// still gathering follow-up; wait for next silence-ended clip unless forced
			}
			const text = pendingTranscript.trim();
			pendingTranscript = "";
			setMode("wake");
			config.onUtterance(text);
		}

		/**
		 * Called by module when server returns STT result.
		 * @param {{requestId:string, text?:string, message?:string, error?:boolean}} payload
		 */
		function handleSttResult (payload) {
			if (!payload) return;
			if (payload.error) {
				sttInFlight = false;
				config.onError(payload.message || "Transcription failed.");
				return;
			}
			handleTranscript(payload.text || "", payload.requestId);
		}

		function tickVad () {
			if (!active || !analyser) return;
			const level = rmsLevel();
			const now = Date.now();
			const loud = level >= vadThreshold;

			// While TTS is playing, require slightly louder signal to barge in
			const thresholdOk = speaking ? level >= vadThreshold * 1.8 : loud;

			if (thresholdOk) {
				lastLoudAt = now;
				if (!recording && !sttInFlight) {
					beginRecording();
					if (mode === "wake") {
						config.onPartial("Heard you…", "wake");
					} else if (mode === "listening") {
						config.onPartial(pendingTranscript || "Listening…", "listening");
					}
				}
			}

			if (recording) {
				const silentFor = now - lastLoudAt;
				const spokenFor = now - speechStartedAt;
				if (spokenFor >= maxUtteranceMs || (spokenFor >= minSpeechMs && silentFor >= (config.silenceMs || 1500))) {
					finishRecording();
				}
			}
		}

		async function startMic () {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: false
			});

			audioContext = new (global.AudioContext || global.webkitAudioContext)();
			const source = audioContext.createMediaStreamSource(stream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 2048;
			source.connect(analyser);
			if (audioContext.state === "suspended") {
				await audioContext.resume();
			}

			clearVad();
			vadTimer = global.setInterval(tickVad, 80);
		}

		async function start () {
			if (!supported) {
				config.onError("Microphone APIs are not available in this browser.");
				return;
			}
			active = true;
			setMode("wake");
			try {
				await startMic();
				config.onPartial(`Say "${config.wakeWord || "pixel"}"`, "wake");
			} catch (error) {
				active = false;
				if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
					config.onError("Microphone permission denied. Allow mic access for hands-free talk.");
				} else {
					config.onError(error.message || "Could not open microphone.");
				}
			}
		}

		function stop () {
			active = false;
			clearVad();
			stopSpeaking();
			sttInFlight = false;
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
			recordChunks = [];
			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
				stream = null;
			}
			if (audioContext) {
				audioContext.close().catch(() => {});
				audioContext = null;
			}
			analyser = null;
		}

		function markSpeaking () {
			speaking = true;
			setMode("speaking");
		}

		function markIdleWake () {
			speaking = false;
			armedUntil = 0;
			pendingTranscript = "";
			setMode("wake");
		}

		function armPostReplyListen () {
			speaking = false;
			armedUntil = Date.now() + (config.postSpeakListenMs || 8000);
			pendingTranscript = "";
			setMode("wake");
		}

		function speak (text, onEnd) {
			stopSpeaking();
			if (!text || !global.speechSynthesis) {
				if (onEnd) onEnd();
				return;
			}
			markSpeaking();
			const utter = new SpeechSynthesisUtterance(text);
			utter.lang = config.lang || "en-US";
			utter.onend = () => {
				speaking = false;
				if (onEnd) onEnd();
			};
			utter.onerror = () => {
				speaking = false;
				if (onEnd) onEnd();
			};
			global.speechSynthesis.speak(utter);
		}

		function stopSpeaking () {
			if (global.speechSynthesis) global.speechSynthesis.cancel();
			speaking = false;
		}

		function getMode () {
			return mode;
		}

		return {
			start,
			stop,
			speak,
			stopSpeaking,
			markSpeaking,
			markIdleWake,
			armPostReplyListen,
			handleSttResult,
			getMode,
			matchWakeWord,
			supported
		};
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createVoiceController = createVoiceController;
	global.MMM_AICharacterLib.matchWakeWord = matchWakeWord;
})(typeof window !== "undefined" ? window : this);
