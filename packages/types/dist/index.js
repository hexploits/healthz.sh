"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.parseInterval = parseInterval;
exports.parseTimeout = parseTimeout;
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
function parseInterval(interval) {
    const match = interval.match(/^(\d+)(m|h|s)$/);
    if (!match)
        return 300;
    const [, val, unit] = match;
    const n = parseInt(val, 10);
    if (unit === "h")
        return n * 3600;
    if (unit === "m")
        return n * 60;
    return n;
}
function parseTimeout(timeout) {
    const match = timeout.match(/^(\d+)(s|ms)$/);
    if (!match)
        return 10000;
    const [, val, unit] = match;
    return unit === "s" ? parseInt(val, 10) * 1000 : parseInt(val, 10);
}
//# sourceMappingURL=index.js.map