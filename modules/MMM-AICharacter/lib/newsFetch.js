/**
 * RSS headline helpers for MMM-AICharacter (Node helper).
 * Thin one-shot fetch — not coupled to the default newsfeed module lifecycle.
 */

const { Readable } = require("node:stream");
const FeedMe = require("feedme");

const DEFAULT_FEEDS = [
	{
		title: "Tagesschau",
		url: "https://www.tagesschau.de/xml/rss2/"
	}
];

function stripHtml (value) {
	if (value == null) return "";
	return String(value)
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function asText (value) {
	if (value == null) return "";
	if (typeof value === "string") return stripHtml(value);
	if (typeof value === "object") {
		if (typeof value.text === "string") return stripHtml(value.text);
		if (typeof value.href === "string") return value.href;
	}
	return stripHtml(String(value));
}

function parsePubDate (value) {
	if (!value) return null;
	const ms = Date.parse(String(value));
	return Number.isFinite(ms) ? ms : null;
}

function normalizeFeeds (feeds) {
	if (!Array.isArray(feeds) || feeds.length === 0) {
		return DEFAULT_FEEDS;
	}
	return feeds
		.map((feed) => {
			if (typeof feed === "string") {
				return { title: "", url: feed.trim() };
			}
			if (feed && typeof feed.url === "string" && feed.url.trim()) {
				return {
					title: typeof feed.title === "string" ? feed.title.trim() : "",
					url: feed.url.trim()
				};
			}
			return null;
		})
		.filter(Boolean);
}

async function fetchFeedText (url, timeoutMs = 12000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "MMM-AICharacter/1.0 (+MagicMirror)",
				Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
			}
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} for ${url}`);
		}
		return await response.text();
	} finally {
		clearTimeout(timer);
	}
}

function parseFeedXml (xml, sourceHint) {
	return new Promise((resolve, reject) => {
		const parser = new FeedMe(true);
		const items = [];
		let feedTitle = sourceHint || "";

		parser.on("title", (title) => {
			if (!feedTitle) feedTitle = asText(title);
		});

		parser.on("item", (item) => {
			const title = asText(item.title);
			if (!title) return;
			const summary = asText(item.description || item.summary || item.content || "");
			const link = asText(item.link || item.url || item.guid || "");
			const pubRaw = item.pubdate || item.published || item.updated || item["dc:date"] || item["a10:updated"];
			const pubMs = parsePubDate(pubRaw);
			items.push({
				source: feedTitle || sourceHint || "News",
				title,
				summary: summary.slice(0, 280),
				link,
				pubDate: pubMs ? new Date(pubMs).toISOString() : null,
				pubMs: pubMs || 0
			});
		});

		parser.on("error", (error) => reject(error));
		parser.on("finish", () => {
			const done = parser.done() || {};
			if (!feedTitle && done.title) feedTitle = asText(done.title);
			const source = feedTitle || sourceHint || "News";
			for (const item of items) {
				if (!item.source || item.source === sourceHint) item.source = source;
			}
			resolve({ source, items });
		});

		Readable.from([xml]).pipe(parser);
	});
}

async function fetchOneFeed (feed) {
	const xml = await fetchFeedText(feed.url);
	return parseFeedXml(xml, feed.title || "");
}

/**
 * Fetch and merge headlines from RSS feeds.
 * @param {object} options
 * @param {Array<{title?: string, url: string}|string>} [options.feeds]
 * @param {number} [options.limit=5]
 * @param {string} [options.topic] optional keyword filter
 */
async function fetchNews ({ feeds, limit = 5, topic } = {}) {
	const resolvedFeeds = normalizeFeeds(feeds);
	const max = Math.max(1, Math.min(Number(limit) || 5, 12));
	const topicNeedle = typeof topic === "string" ? topic.trim().toLowerCase() : "";

	const results = await Promise.allSettled(resolvedFeeds.map((feed) => fetchOneFeed(feed)));
	const headlines = [];
	const sources = [];
	const errors = [];

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const feed = resolvedFeeds[i];
		if (result.status === "fulfilled") {
			sources.push(result.value.source || feed.title || feed.url);
			headlines.push(...result.value.items);
		} else {
			errors.push({
				url: feed.url,
				message: result.reason?.message || String(result.reason)
			});
		}
	}

	if (headlines.length === 0) {
		const detail = errors.map((e) => e.message).join("; ") || "No headlines returned.";
		throw new Error(detail);
	}

	headlines.sort((a, b) => (b.pubMs || 0) - (a.pubMs || 0));

	let selected = headlines;
	let topicNote = null;
	if (topicNeedle) {
		const filtered = headlines.filter((item) => {
			const hay = `${item.title} ${item.summary}`.toLowerCase();
			return hay.includes(topicNeedle);
		});
		if (filtered.length > 0) {
			selected = filtered;
		} else {
			topicNote = `No headlines matched topic "${topic}". Showing latest headlines instead.`;
		}
	}

	const top = selected.slice(0, max).map(({ source, title, summary, link, pubDate }) => ({
		source,
		title,
		summary,
		link,
		pubDate
	}));

	return {
		ok: true,
		topic: topicNeedle || null,
		topicNote,
		sources: [...new Set(sources)],
		headlines: top,
		summary: {
			topic: topicNeedle || null,
			topicNote,
			count: top.length,
			sources: [...new Set(top.map((h) => h.source))],
			headlines: top.map((h) => ({
				source: h.source,
				title: h.title,
				pubDate: h.pubDate
			}))
		}
	};
}

module.exports = {
	DEFAULT_FEEDS,
	fetchNews,
	stripHtml,
	normalizeFeeds
};
