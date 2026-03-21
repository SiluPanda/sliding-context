import type { ContextState } from './types';
/**
 * Serialize context state to a JSON string.
 * Always includes `version: 1`.
 */
export declare function serialize(state: ContextState): string;
/**
 * Deserialize a JSON string back to ContextState.
 * Throws if the version field does not match the expected schema version.
 */
export declare function deserialize(data: string): ContextState;
//# sourceMappingURL=serialization.d.ts.map