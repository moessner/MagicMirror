/* global window */
/**
 * Open-Meteo WMO weathercode → weathericons class stem (same mapping as default weather module).
 */
(function (global) {
	"use strict";

	const WEATHER_CONDITIONS = {
		0: "clear",
		1: "mainly-clear",
		2: "partly-cloudy",
		3: "overcast",
		45: "fog",
		48: "depositing-rime-fog",
		51: "drizzle-light-intensity",
		53: "drizzle-moderate-intensity",
		55: "drizzle-dense-intensity",
		56: "freezing-drizzle-light-intensity",
		57: "freezing-drizzle-dense-intensity",
		61: "rain-slight-intensity",
		63: "rain-moderate-intensity",
		65: "rain-heavy-intensity",
		66: "freezing-rain-light-intensity",
		67: "freezing-rain-heavy-intensity",
		71: "snow-fall-slight-intensity",
		73: "snow-fall-moderate-intensity",
		75: "snow-fall-heavy-intensity",
		77: "snow-grains",
		80: "rain-showers-slight",
		81: "rain-showers-moderate",
		82: "rain-showers-violent",
		85: "snow-showers-slight",
		86: "snow-showers-heavy",
		95: "thunderstorm",
		96: "thunderstorm-slight-hail",
		99: "thunderstorm-heavy-hail"
	};

	function weatherTypeFromCode (weathercode, isDayTime) {
		const condition = WEATHER_CONDITIONS[weathercode];
		if (!condition) return "na";

		const day = isDayTime !== false;
		const mappings = {
			clear: day ? "day-sunny" : "night-clear",
			"mainly-clear": day ? "day-cloudy" : "night-alt-cloudy",
			"partly-cloudy": day ? "day-cloudy" : "night-alt-cloudy",
			overcast: day ? "day-sunny-overcast" : "night-alt-partly-cloudy",
			fog: day ? "day-fog" : "night-fog",
			"depositing-rime-fog": day ? "day-fog" : "night-fog",
			"drizzle-light-intensity": day ? "day-sprinkle" : "night-sprinkle",
			"rain-slight-intensity": day ? "day-sprinkle" : "night-sprinkle",
			"rain-showers-slight": day ? "day-sprinkle" : "night-sprinkle",
			"drizzle-moderate-intensity": day ? "day-showers" : "night-showers",
			"rain-moderate-intensity": day ? "day-showers" : "night-showers",
			"rain-showers-moderate": day ? "day-showers" : "night-showers",
			"drizzle-dense-intensity": day ? "day-thunderstorm" : "night-thunderstorm",
			"rain-heavy-intensity": day ? "day-thunderstorm" : "night-thunderstorm",
			"rain-showers-violent": day ? "day-thunderstorm" : "night-thunderstorm",
			"freezing-rain-light-intensity": day ? "day-rain-mix" : "night-rain-mix",
			"freezing-drizzle-light-intensity": "snowflake-cold",
			"freezing-drizzle-dense-intensity": "snowflake-cold",
			"snow-grains": day ? "day-sleet" : "night-sleet",
			"snow-fall-slight-intensity": day ? "day-snow-wind" : "night-snow-wind",
			"snow-fall-moderate-intensity": day ? "day-snow-wind" : "night-snow-wind",
			"snow-fall-heavy-intensity": day ? "day-snow-thunderstorm" : "night-snow-thunderstorm",
			"freezing-rain-heavy-intensity": day ? "day-snow-thunderstorm" : "night-snow-thunderstorm",
			"snow-showers-slight": day ? "day-rain-mix" : "night-rain-mix",
			"snow-showers-heavy": day ? "day-rain-mix" : "night-rain-mix",
			thunderstorm: day ? "day-thunderstorm" : "night-thunderstorm",
			"thunderstorm-slight-hail": day ? "day-sleet" : "night-sleet",
			"thunderstorm-heavy-hail": day ? "day-sleet-storm" : "night-sleet-storm"
		};

		return mappings[condition] || "na";
	}

	function weatherIconClass (weathercode, isDayTime) {
		return `wi wi-${weatherTypeFromCode(weathercode, isDayTime)}`;
	}

	global.MMM_AICharacterLib = global.MMM_AICharacterLib || {};
	global.MMM_AICharacterLib.weatherTypeFromCode = weatherTypeFromCode;
	global.MMM_AICharacterLib.weatherIconClass = weatherIconClass;
})(typeof window !== "undefined" ? window : this);
