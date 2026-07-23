/* global window */
/**
 * Pixelated AI humanoid renderer for MMM-AICharacter.
 * Draws a low-res humanoid figure with state-driven animations.
 */
(function (global) {
	"use strict";

	const SCALE = 8;
	const WIDTH = 24;
	const HEIGHT = 36;

	// Palette: cool AI cyan / violet on black
	const COLORS = {
		void: "rgba(0,0,0,0)",
		body: "#6ec8ff",
		bodyDim: "#3a7a9e",
		glow: "#a8f0ff",
		accent: "#c77dff",
		eye: "#e8ffff",
		mouth: "#1a3040"
	};

	/**
	 * @param {HTMLCanvasElement} canvas
	 * @returns {object}
	 */
	function createPixelCharacter (canvas) {
		const ctx = canvas.getContext("2d");
		canvas.width = WIDTH * SCALE;
		canvas.height = HEIGHT * SCALE;
		ctx.imageSmoothingEnabled = false;

		let state = "idle";
		let frame = 0;
		let rafId = null;
		let running = false;

		/**
		 * Set animation state: idle | listening | thinking | speaking | error
		 * @param {string} next
		 */
		function setState (next) {
			if (state !== next) {
				state = next;
				frame = 0;
			}
		}

		function getState () {
			return state;
		}

		/**
		 * Build a WIDTH x HEIGHT pixel grid (0 = empty, color string = filled)
		 * @returns {Array<Array<string|0>>}
		 */
		function buildFrame () {
			const grid = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
			const breath = Math.sin(frame / 18) * 0.5;
			const lean = state === "listening" ? Math.sin(frame / 12) * 0.8 : 0;
			const flicker = state === "thinking" ? (frame % 10 < 5 ? 1 : 0) : 0;
			const speak = state === "speaking" ? Math.floor((frame / 4) % 4) : 0;
			const errorPulse = state === "error" ? (frame % 16 < 8 ? 1 : 0) : 0;

			const ox = Math.round(lean);
			const oy = Math.round(breath);

			// Head (pixel skull)
			fillRect(grid, 7 + ox, 2 + oy, 10, 9, errorPulse ? COLORS.accent : COLORS.body);
			fillRect(grid, 8 + ox, 3 + oy, 8, 7, COLORS.bodyDim);

			// Antenna / AI crest
			fillRect(grid, 11 + ox, 0 + oy, 2, 2, COLORS.accent);
			plot(grid, 11 + ox, 0 + oy, COLORS.glow);

			// Eyes
			const eyeBright = state === "listening" || state === "speaking" || flicker;
			const eyeColor = eyeBright ? COLORS.eye : COLORS.glow;
			plot(grid, 9 + ox, 5 + oy, eyeColor);
			plot(grid, 10 + ox, 5 + oy, eyeColor);
			plot(grid, 13 + ox, 5 + oy, eyeColor);
			plot(grid, 14 + ox, 5 + oy, eyeColor);
			if (state === "thinking") {
				plot(grid, 9 + ox + (frame % 3), 6 + oy, COLORS.accent);
				plot(grid, 14 + ox - (frame % 3), 6 + oy, COLORS.accent);
			}

			// Mouth
			if (state === "speaking") {
				const mouthOpen = [1, 2, 3, 2][speak];
				fillRect(grid, 10 + ox, 8 + oy, 4, mouthOpen, COLORS.mouth);
				fillRect(grid, 10 + ox, 8 + oy, 4, 1, COLORS.glow);
			} else if (state === "listening") {
				fillRect(grid, 10 + ox, 8 + oy, 4, 1, COLORS.glow);
			} else {
				fillRect(grid, 10 + ox, 8 + oy, 4, 1, COLORS.mouth);
			}

			// Neck
			fillRect(grid, 11 + ox, 11 + oy, 2, 2, COLORS.bodyDim);

			// Torso
			fillRect(grid, 6 + ox, 13 + oy, 12, 12, COLORS.body);
			fillRect(grid, 7 + ox, 14 + oy, 10, 10, COLORS.bodyDim);

			// Chest core glow
			const core = state === "thinking" ? COLORS.accent : COLORS.glow;
			fillRect(grid, 10 + ox, 17 + oy, 4, 4, core);
			if (state === "idle" || state === "listening") {
				plot(grid, 11 + ox, 18 + oy, COLORS.eye);
				plot(grid, 12 + ox, 18 + oy, COLORS.eye);
			}

			// Arms
			const armSwing = state === "idle" ? Math.round(Math.sin(frame / 22) * 1) : 0;
			const listenLift = state === "listening" ? 1 : 0;
			fillRect(grid, 3 + ox, 14 + oy - listenLift, 3, 9 + armSwing, COLORS.body);
			fillRect(grid, 18 + ox, 14 + oy - listenLift, 3, 9 - armSwing, COLORS.body);
			fillRect(grid, 3 + ox, 14 + oy - listenLift, 3, 2, COLORS.bodyDim);
			fillRect(grid, 18 + ox, 14 + oy - listenLift, 3, 2, COLORS.bodyDim);

			// Legs
			fillRect(grid, 8 + ox, 25 + oy, 3, 9, COLORS.body);
			fillRect(grid, 13 + ox, 25 + oy, 3, 9, COLORS.body);
			fillRect(grid, 8 + ox, 32 + oy, 3, 2, COLORS.bodyDim);
			fillRect(grid, 13 + ox, 32 + oy, 3, 2, COLORS.bodyDim);

			// Listening ear pulse rings (visual only, right side)
			if (state === "listening" && frame % 20 < 10) {
				plot(grid, 20 + ox, 6 + oy, COLORS.glow);
				plot(grid, 21 + ox, 5 + oy, COLORS.accent);
			}

			return grid;
		}

		function plot (grid, x, y, color) {
			if (y < 0 || y >= HEIGHT || x < 0 || x >= WIDTH) return;
			grid[y][x] = color;
		}

		function fillRect (grid, x, y, w, h, color) {
			for (let dy = 0; dy < h; dy++) {
				for (let dx = 0; dx < w; dx++) {
					plot(grid, x + dx, y + dy, color);
				}
			}
		}

		function draw () {
			const grid = buildFrame();
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Soft outer glow behind figure
			ctx.save();
			ctx.globalAlpha = state === "speaking" ? 0.35 : 0.18;
			ctx.fillStyle = state === "error" ? COLORS.accent : COLORS.glow;
			ctx.beginPath();
			ctx.ellipse(canvas.width / 2, canvas.height * 0.55, canvas.width * 0.38, canvas.height * 0.42, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();

			for (let y = 0; y < HEIGHT; y++) {
				for (let x = 0; x < WIDTH; x++) {
					const c = grid[y][x];
					if (!c) continue;
					ctx.fillStyle = c;
					ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
				}
			}

			frame += 1;
		}

		function loop () {
			if (!running) return;
			draw();
			rafId = global.requestAnimationFrame(loop);
		}

		function start () {
			if (running) return;
			running = true;
			loop();
		}

		function stop () {
			running = false;
			if (rafId) {
				global.cancelAnimationFrame(rafId);
				rafId = null;
			}
		}

		return { setState, getState, start, stop, draw };
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.createPixelCharacter = createPixelCharacter;
})(typeof window !== "undefined" ? window : this);
