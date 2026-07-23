/**
 * Open-Meteo helpers for MMM-AICharacter (Node helper).
 * Thin dedicated fetch — not coupled to the default weather module lifecycle.
 */

const GEOCODE_REVERSE = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const GEOCODE_FORWARD = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

const CONDITION_LABELS = {
	0: "Clear",
	1: "Mainly clear",
	2: "Partly cloudy",
	3: "Overcast",
	45: "Fog",
	48: "Icy fog",
	51: "Light drizzle",
	53: "Drizzle",
	55: "Heavy drizzle",
	56: "Freezing drizzle",
	57: "Heavy freezing drizzle",
	61: "Light rain",
	63: "Rain",
	65: "Heavy rain",
	66: "Freezing rain",
	67: "Heavy freezing rain",
	71: "Light snow",
	73: "Snow",
	75: "Heavy snow",
	77: "Snow grains",
	80: "Light showers",
	81: "Showers",
	82: "Heavy showers",
	85: "Light snow showers",
	86: "Heavy snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm with hail",
	99: "Severe thunderstorm with hail"
};

async function fetchJson (url, timeoutMs = 12000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} for ${url}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

function conditionLabel (code) {
	return CONDITION_LABELS[code] || "Unknown";
}

async function geocodeLocation (location, language = "en") {
	const url = `${GEOCODE_FORWARD}?name=${encodeURIComponent(location)}&count=1&language=${encodeURIComponent(language)}&format=json`;
	const data = await fetchJson(url);
	const hit = data?.results?.[0];
	if (!hit) {
		throw new Error(`Could not find location "${location}".`);
	}
	const parts = [hit.name, hit.admin1, hit.country].filter(Boolean);
	return {
		lat: hit.latitude,
		lon: hit.longitude,
		label: parts.join(", ")
	};
}

async function reverseGeocode (lat, lon, language = "en") {
	const url = `${GEOCODE_REVERSE}?latitude=${lat}&longitude=${lon}&localityLanguage=${encodeURIComponent(language)}`;
	try {
		const data = await fetchJson(url, 8000);
		if (data?.city) {
			const region = data.principalSubdivisionCode || data.principalSubdivision || "";
			return region ? `${data.city}, ${region}` : data.city;
		}
		if (data?.locality) return data.locality;
	} catch {
		// label is optional for the model
	}
	return `${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`;
}

async function fetchWeather ({ lat, lon, location, units = "metric", language = "en" }) {
	let resolvedLat = lat;
	let resolvedLon = lon;
	let label = null;

	const place = typeof location === "string" ? location.trim() : "";
	if (place) {
		const geo = await geocodeLocation(place, language);
		resolvedLat = geo.lat;
		resolvedLon = geo.lon;
		label = geo.label;
	}

	if (resolvedLat == null || resolvedLon == null || Number.isNaN(Number(resolvedLat)) || Number.isNaN(Number(resolvedLon))) {
		throw new Error("Missing coordinates. Enable geolocation or set lat/lon in module config.");
	}

	resolvedLat = Number(resolvedLat);
	resolvedLon = Number(resolvedLon);

	const imperial = units === "imperial";
	const tempUnit = imperial ? "fahrenheit" : "celsius";
	const windUnit = imperial ? "mph" : "kmh";
	const tempSymbol = imperial ? "°F" : "°C";
	const windSymbol = imperial ? "mph" : "km/h";

	const params = new URLSearchParams({
		latitude: String(resolvedLat),
		longitude: String(resolvedLon),
		current: "temperature_2m,weather_code,wind_speed_10m,is_day",
		daily: "weather_code,temperature_2m_max,temperature_2m_min",
		forecast_days: "4",
		timezone: "auto",
		temperature_unit: tempUnit,
		wind_speed_unit: windUnit
	});

	const forecast = await fetchJson(`${FORECAST_BASE}?${params.toString()}`);
	if (!label) {
		label = await reverseGeocode(resolvedLat, resolvedLon, language);
	}

	const current = forecast.current || {};
	const weatherCode = current.weather_code ?? current.weathercode;
	const isDay = current.is_day === 1 || current.is_day === true;

	const daily = [];
	const times = forecast.daily?.time || [];
	for (let i = 0; i < Math.min(times.length, 4); i++) {
		// Skip "today" as first forecast row if we already show current — keep next 3 days starting tomorrow when available
		daily.push({
			date: times[i],
			weatherCode: forecast.daily.weather_code?.[i],
			tempMax: forecast.daily.temperature_2m_max?.[i],
			tempMin: forecast.daily.temperature_2m_min?.[i],
			condition: conditionLabel(forecast.daily.weather_code?.[i])
		});
	}

	// Prefer next 3 days after today for the card row
	const today = times[0];
	const forecastDays = daily.filter((d) => d.date !== today).slice(0, 3);
	const daysForUi = forecastDays.length ? forecastDays : daily.slice(0, 3);

	return {
		ok: true,
		place: label,
		lat: resolvedLat,
		lon: resolvedLon,
		units: imperial ? "imperial" : "metric",
		tempSymbol,
		windSymbol,
		current: {
			temperature: current.temperature_2m,
			weatherCode,
			condition: conditionLabel(weatherCode),
			windSpeed: current.wind_speed_10m,
			isDay
		},
		daily: daysForUi,
		summary: {
			place: label,
			temperature: current.temperature_2m,
			tempSymbol,
			condition: conditionLabel(weatherCode),
			windSpeed: current.wind_speed_10m,
			windSymbol,
			forecast: daysForUi.map((d) => ({
				date: d.date,
				condition: d.condition,
				high: d.tempMax,
				low: d.tempMin,
				tempSymbol
			}))
		}
	};
}

module.exports = {
	fetchWeather,
	conditionLabel
};
