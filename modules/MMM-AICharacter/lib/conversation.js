/* global window */
/**
 * Caption + request lifecycle helpers for MMM-AICharacter.
 */
(function (global) {
	"use strict";

	/**
	 * @param {object} options
	 * @param {HTMLElement} options.userEl
	 * @param {HTMLElement} options.assistantEl
	 * @param {HTMLElement} options.statusEl
	 * @returns {object}
	 */
	function createConversation (options) {
		const { userEl, assistantEl, statusEl } = options;
		let currentRequestId = null;
		let assistantBuffer = "";
		let history = [];

		function setStatus (text) {
			if (statusEl) statusEl.textContent = text || "";
		}

		function setUserCaption (text) {
			if (userEl) userEl.textContent = text || "";
		}

		function setAssistantCaption (text) {
			assistantBuffer = text || "";
			if (assistantEl) assistantEl.textContent = assistantBuffer;
		}

		function appendAssistantDelta (delta) {
			assistantBuffer += delta || "";
			if (assistantEl) assistantEl.textContent = assistantBuffer;
		}

		function beginRequest (requestId, userText) {
			currentRequestId = requestId;
			assistantBuffer = "";
			setUserCaption(userText);
			setAssistantCaption("");
			setStatus("Thinking…");
		}

		function isCurrent (requestId) {
			return currentRequestId !== null && requestId === currentRequestId;
		}

		function clearRequest () {
			currentRequestId = null;
		}

		function getCurrentRequestId () {
			return currentRequestId;
		}

		function getAssistantText () {
			return assistantBuffer;
		}

		/**
		 * @param {number} maxHistory
		 * @param {{role:string, content:string}} turn
		 */
		function pushHistory (maxHistory, turn) {
			history.push(turn);
			const max = Math.max(2, (maxHistory || 10) * 2);
			if (history.length > max) {
				history = history.slice(history.length - max);
			}
		}

		function getHistory () {
			return history.slice();
		}

		function resetHistory () {
			history = [];
		}

		return {
			setStatus,
			setUserCaption,
			setAssistantCaption,
			appendAssistantDelta,
			beginRequest,
			isCurrent,
			clearRequest,
			getCurrentRequestId,
			getAssistantText,
			pushHistory,
			getHistory,
			resetHistory
		};
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createConversation = createConversation;
})(typeof window !== "undefined" ? window : this);
