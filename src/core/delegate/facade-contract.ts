/** Light registration constants shared by the delegate facade and budget engine. */
export const DELEGATE_DEFAULT_MAX_TURNS = 24;
export const DELEGATE_DEFAULT_MAX_TOOL_CALLS = 120;
export const DELEGATE_DEFAULT_TIMEOUT_SECONDS = 1200;
/** Answers at or under this serialize inline; larger ones degrade explicitly. */
export const DELEGATE_INLINE_ANSWER_BYTES = 48 * 1024;
