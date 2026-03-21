import type { ContextState } from './types';

const CURRENT_VERSION = 1 as const;

/**
 * Serialize context state to a JSON string.
 * Always includes `version: 1`.
 */
export function serialize(state: ContextState): string {
  return JSON.stringify({ ...state, version: CURRENT_VERSION });
}

/**
 * Deserialize a JSON string back to ContextState.
 * Throws if the version field does not match the expected schema version.
 */
export function deserialize(data: string): ContextState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error(`sliding-context: failed to parse serialized state: ${String(err)}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>)['version'] !== CURRENT_VERSION
  ) {
    throw new Error(
      `sliding-context: schema mismatch — expected version ${CURRENT_VERSION}, ` +
        `got ${String((parsed as Record<string, unknown>)?.['version'])}`,
    );
  }

  return parsed as ContextState;
}
