import path from "node:path";

/**
 * Request validation and load shedding for the card renderer.
 *
 * Kept in its own module with no express or puppeteer imports so the security
 * relevant parts can be exercised directly.
 */

/** A Discord snowflake: 17-20 digits, nothing else. */
export const SNOWFLAKE = /^\d{17,20}$/;

export const isValidDiscordId = (id) => typeof id === "string" && SNOWFLAKE.test(id);

/**
 * Build a resolver for cached card paths.
 *
 * The id used to be interpolated straight into path.join, and Express
 * percent-decodes route params, so `..%2F..%2Fx` walked out of the cache
 * directory - reachable as an arbitrary .png read and, via DELETE
 * /api/cache/:id, an arbitrary .png unlink.
 *
 * Returns null for anything that is not a snowflake or does not resolve to a
 * path inside `imagesDir`.
 */
export const makeCardPathResolver = (imagesDir) => {
    const root = path.resolve(imagesDir);
    const rootWithSep = root + path.sep;

    return (discordId) => {
        if (!isValidDiscordId(discordId)) return null;
        const resolved = path.resolve(root, `${discordId}.png`);
        return resolved.startsWith(rootWithSep) ? resolved : null;
    };
};

/**
 * Per-IP fixed-window rate limiter. Dependency-free so deploying needs no new
 * install.
 */
export const createRateLimiter = ({ windowMs, max, message }) => {
    const hits = new Map();

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, windowMs);
    sweep.unref(); // must never hold the process open

    const middleware = (req, res, next) => {
        const key = req.ip || req.socket?.remoteAddress || "unknown";
        const now = Date.now();

        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;

        if (entry.count > max) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({ error: message, retryAfterSeconds: retryAfter });
        }
        return next();
    };

    middleware.reset = () => hits.clear();
    middleware.size = () => hits.size;
    return middleware;
};

/**
 * Hard ceiling on simultaneous Chromium processes.
 *
 * This is the protection that actually matters: a per-IP limit does not stop a
 * burst spread across addresses, and each render holds roughly 250MB for up to
 * 45 seconds. Past the cap we shed load with 503 instead of exhausting memory.
 *
 * `acquire` is called at the point a browser is about to launch - never as
 * route middleware, because a cache hit costs nothing and must not be turned
 * away just because two renders are in flight.
 */
export const createRenderGate = ({ max }) => {
    let active = 0;

    return {
        get active() {
            return active;
        },
        acquire(res) {
            if (active >= max) {
                res.set("Retry-After", "15");
                res.status(503).json({
                    error: "Card renderer is busy. Please try again shortly.",
                    activeRenders: active,
                });
                return false;
            }

            active += 1;
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                active -= 1;
            };
            // 'close' covers client disconnects as well as normal completion
            res.on("finish", release);
            res.on("close", release);
            return true;
        },
    };
};
