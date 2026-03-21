"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serialize = serialize;
exports.deserialize = deserialize;
const CURRENT_VERSION = 1;
/**
 * Serialize context state to a JSON string.
 * Always includes `version: 1`.
 */
function serialize(state) {
    return JSON.stringify({ ...state, version: CURRENT_VERSION });
}
/**
 * Deserialize a JSON string back to ContextState.
 * Throws if the version field does not match the expected schema version.
 */
function deserialize(data) {
    let parsed;
    try {
        parsed = JSON.parse(data);
    }
    catch (err) {
        throw new Error(`sliding-context: failed to parse serialized state: ${String(err)}`);
    }
    if (typeof parsed !== 'object' ||
        parsed === null ||
        parsed['version'] !== CURRENT_VERSION) {
        throw new Error(`sliding-context: schema mismatch — expected version ${CURRENT_VERSION}, ` +
            `got ${String(parsed?.['version'])}`);
    }
    return parsed;
}
//# sourceMappingURL=serialization.js.map