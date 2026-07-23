/* global window */
/**
 * Estimate OpenAI Realtime / transcription spend from usage objects.
 * Rates are USD per 1M tokens (OpenAI list prices; override via config).
 */
(function (global) {
	"use strict";

	/** Default list prices for gpt-realtime (USD / 1M tokens). */
	const DEFAULT_REALTIME_RATES = {
		textInput: 4,
		textInputCached: 0.4,
		textOutput: 16,
		audioInput: 32,
		audioInputCached: 0.4,
		audioOutput: 64
	};

	/** Default list prices for gpt-4o-mini-transcribe (USD / 1M tokens). */
	const DEFAULT_TRANSCRIPTION_RATES = {
		audioInput: 3,
		textOutput: 5
	};

	function num (value) {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	}

	function tokensToUsd (tokens, usdPerMillion) {
		return (num(tokens) / 1_000_000) * num(usdPerMillion);
	}

	/**
	 * @param {object} [options]
	 * @param {object} [options.realtimeRates]
	 * @param {object} [options.transcriptionRates]
	 * @param {string} [options.currencyLabel] e.g. "$"
	 * @param {function} [options.onUpdate] (snapshot) => void
	 */
	function createCostTracker (options) {
		const opts = options || {};
		const realtimeRates = Object.assign({}, DEFAULT_REALTIME_RATES, opts.realtimeRates || {});
		const transcriptionRates = Object.assign({}, DEFAULT_TRANSCRIPTION_RATES, opts.transcriptionRates || {});
		const currencyLabel = opts.currencyLabel || "$";

		let session = emptyBucket();
		let lastTurn = emptyBucket();
		let turnCount = 0;

		function emptyBucket () {
			return {
				usd: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				audioInputTokens: 0,
				audioOutputTokens: 0,
				textInputTokens: 0,
				textOutputTokens: 0,
				cachedTokens: 0
			};
		}

		function estimateRealtimeUsd (usage) {
			const input = usage.input_token_details || {};
			const output = usage.output_token_details || {};
			const cached = input.cached_tokens_details || {};

			const textIn = Math.max(0, num(input.text_tokens) - num(cached.text_tokens));
			const audioIn = Math.max(0, num(input.audio_tokens) - num(cached.audio_tokens));
			const textInCached = num(cached.text_tokens);
			const audioInCached = num(cached.audio_tokens);
			const textOut = num(output.text_tokens);
			const audioOut = num(output.audio_tokens);

			return (
				tokensToUsd(textIn, realtimeRates.textInput) +
				tokensToUsd(textInCached, realtimeRates.textInputCached) +
				tokensToUsd(audioIn, realtimeRates.audioInput) +
				tokensToUsd(audioInCached, realtimeRates.audioInputCached) +
				tokensToUsd(textOut, realtimeRates.textOutput) +
				tokensToUsd(audioOut, realtimeRates.audioOutput)
			);
		}

		function estimateTranscriptionUsd (usage) {
			const input = usage.input_token_details || {};
			const audioIn = num(input.audio_tokens) || num(usage.input_tokens);
			const textOut = num(usage.output_tokens);
			return tokensToUsd(audioIn, transcriptionRates.audioInput) + tokensToUsd(textOut, transcriptionRates.textOutput);
		}

		function accumulate (bucket, usage, usd) {
			const input = usage.input_token_details || {};
			const output = usage.output_token_details || {};
			bucket.usd += usd;
			bucket.inputTokens += num(usage.input_tokens);
			bucket.outputTokens += num(usage.output_tokens);
			bucket.totalTokens += num(usage.total_tokens) || num(usage.input_tokens) + num(usage.output_tokens);
			bucket.audioInputTokens += num(input.audio_tokens);
			bucket.audioOutputTokens += num(output.audio_tokens);
			bucket.textInputTokens += num(input.text_tokens);
			bucket.textOutputTokens += num(output.text_tokens);
			bucket.cachedTokens += num(input.cached_tokens);
		}

		function formatUsd (value) {
			if (value < 0.01) return `${currencyLabel}${value.toFixed(4)}`;
			return `${currencyLabel}${value.toFixed(3)}`;
		}

		function snapshot () {
			return {
				sessionUsd: session.usd,
				lastTurnUsd: lastTurn.usd,
				turnCount,
				session,
				lastTurn,
				label: formatLabel()
			};
		}

		function formatLabel () {
			if (turnCount <= 0) return `Kosten ${currencyLabel}0.000`;
			return `Kosten ${formatUsd(session.usd)} · letzte Antwort ${formatUsd(lastTurn.usd)}`;
		}

		function notify () {
			if (typeof opts.onUpdate === "function") opts.onUpdate(snapshot());
		}

		/**
		 * @param {object} usage
		 * @param {"realtime"|"transcription"} kind
		 */
		function addUsage (usage, kind) {
			if (!usage || typeof usage !== "object") return snapshot();
			const usd = kind === "transcription" ? estimateTranscriptionUsd(usage) : estimateRealtimeUsd(usage);
			lastTurn = emptyBucket();
			accumulate(lastTurn, usage, usd);
			accumulate(session, usage, usd);
			if (kind === "realtime") turnCount += 1;
			notify();
			return snapshot();
		}

		function reset () {
			session = emptyBucket();
			lastTurn = emptyBucket();
			turnCount = 0;
			notify();
			return snapshot();
		}

		return {
			addUsage,
			reset,
			snapshot,
			formatUsd
		};
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createCostTracker = createCostTracker;
	global.MMM_AICharacterLib.DEFAULT_REALTIME_RATES = DEFAULT_REALTIME_RATES;
	global.MMM_AICharacterLib.DEFAULT_TRANSCRIPTION_RATES = DEFAULT_TRANSCRIPTION_RATES;
})(typeof window !== "undefined" ? window : this);
