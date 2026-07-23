/* global window, speechSynthesis, SpeechSynthesisUtterance */
/**
 * Hands-free voice I/O for MMM-AICharacter:
 * continuous recognition, wake word, silence end-of-turn, barge-in, TTS.
 */
(function (global) {
	"use strict";

	/**
	 * Normalize text for wake-word matching.
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
		const remainder = t.slice(idx + w.length).trim();
		return { matched: true, remainder };
	}

	/**
	 * @param {object} config
	 * @param {string} config.wakeWord
	 * @param {string} config.lang
	 * @param {number} config.silenceMs
	 * @param {number} config.postSpeakListenMs
	 * @param {function} config.onState - (state) => void
	 * @param {function} config.onPartial - (text, mode) => void
	 * @param {function} config.onUtterance - (text) => void
	 * @param {function} config.onBargeIn - () => void
	 * @param {function} config.onError - (message) => void
	 * @returns {object}
	 */
	function createVoiceController (config) {
		const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
		let recognition = null;
		let mode = "wake"; // wake | listening | speaking
		let armedUntil = 0;
		let silenceTimer = null;
		let pendingTranscript = "";
		let restartTimer = null;
		let active = false;
		let speaking = false;

		function clearSilenceTimer () {
			if (silenceTimer) {
				global.clearTimeout(silenceTimer);
				silenceTimer = null;
			}
		}

		function scheduleSilenceCommit () {
			clearSilenceTimer();
			silenceTimer = global.setTimeout(() => {
				const text = pendingTranscript.trim();
				pendingTranscript = "";
				if (!text) {
					setMode("wake");
					return;
				}
				setMode("wake");
				config.onUtterance(text);
			}, config.silenceMs || 1500);
		}

		function setMode (next) {
			mode = next;
			if (typeof config.onState === "function") {
				config.onState(next);
			}
		}

		function ensureRecognition () {
			if (!SpeechRecognition) {
				config.onError("Speech recognition is not supported in this browser.");
				return null;
			}
			if (recognition) return recognition;

			recognition = new SpeechRecognition();
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.lang = config.lang || "en-US";
			recognition.maxAlternatives = 1;

			recognition.onresult = (event) => {
				let interim = "";
				let finalChunk = "";
				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i];
					const text = result[0].transcript;
					if (result.isFinal) finalChunk += text;
					else interim += text;
				}

				const combined = `${pendingTranscript} ${finalChunk} ${interim}`.trim();

				if (speaking || mode === "speaking") {
					if (normalize(finalChunk) || normalize(interim).length > 2) {
						speaking = false;
						config.onBargeIn();
						armedUntil = Date.now() + (config.postSpeakListenMs || 8000);
						setMode("listening");
						pendingTranscript = normalize(finalChunk || interim);
						config.onPartial(pendingTranscript, "listening");
						if (finalChunk) scheduleSilenceCommit();
					}
					return;
				}

				if (mode === "wake") {
					const openMic = Date.now() < armedUntil;
					const wake = matchWakeWord(combined, config.wakeWord || "hey mirror");
					if (openMic || wake.matched) {
						setMode("listening");
						pendingTranscript = openMic && !wake.matched ? normalize(combined) : wake.remainder;
						config.onPartial(pendingTranscript || "Listening…", "listening");
						if (finalChunk && pendingTranscript) scheduleSilenceCommit();
					}
					return;
				}

				// listening
				if (finalChunk) {
					pendingTranscript = `${pendingTranscript} ${finalChunk}`.trim();
				}
				config.onPartial((pendingTranscript || interim).trim(), "listening");
				if (finalChunk || interim) scheduleSilenceCommit();
			};

			recognition.onerror = (event) => {
				if (event.error === "no-speech" || event.error === "aborted") return;
				if (event.error === "not-allowed") {
					config.onError("Microphone permission denied. Allow mic access for hands-free talk.");
					return;
				}
				config.onError(`Speech error: ${event.error}`);
			};

			recognition.onend = () => {
				if (!active) return;
				restartTimer = global.setTimeout(() => {
					tryStart();
				}, 250);
			};

			return recognition;
		}

		function tryStart () {
			if (!active) return;
			const rec = ensureRecognition();
			if (!rec) return;
			try {
				rec.start();
			} catch {
				// Already started
			}
		}

		function start () {
			active = true;
			setMode("wake");
			tryStart();
		}

		function stop () {
			active = false;
			clearSilenceTimer();
			if (restartTimer) {
				global.clearTimeout(restartTimer);
				restartTimer = null;
			}
			stopSpeaking();
			if (recognition) {
				try {
					recognition.onend = null;
					recognition.stop();
				} catch {
					// ignore
				}
				recognition = null;
			}
		}

		function markSpeaking () {
			speaking = true;
			setMode("speaking");
			clearSilenceTimer();
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

		/**
		 * Speak text with browser TTS.
		 * @param {string} text
		 * @param {function} [onEnd]
		 */
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
			if (global.speechSynthesis) {
				global.speechSynthesis.cancel();
			}
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
			getMode,
			matchWakeWord,
			supported: Boolean(SpeechRecognition)
		};
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createVoiceController = createVoiceController;
	global.MMM_AICharacterLib.matchWakeWord = matchWakeWord;
})(typeof window !== "undefined" ? window : this);
