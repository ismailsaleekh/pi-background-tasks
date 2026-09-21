import { buildSessionContext, convertToLlm, } from '@earendil-works/pi-coding-agent';
import { isJsonObject } from '../common.js';
function entriesById(entries) {
    const byId = new Map();
    for (const entry of entries)
        byId.set(entry.id, entry);
    return byId;
}
function readArray(record, key) {
    const value = record[key];
    return Array.isArray(value) ? value : undefined;
}
function recordOf(value) {
    if (!isJsonObject(value) || Array.isArray(value))
        return undefined;
    return value;
}
function entryMessage(entry) {
    if (entry.type !== 'message')
        return undefined;
    return recordOf(entry.message);
}
function toolCallPartMatches(part, toolCallId, toolName) {
    const record = recordOf(part);
    if (record === undefined || record['type'] !== 'toolCall')
        return false;
    if (toolCallId !== undefined)
        return record['id'] === toolCallId;
    return record['name'] === toolName;
}
function messageContainsToolCall(message, toolCallId, toolName) {
    if (message['role'] !== 'assistant')
        return false;
    const content = readArray(message, 'content');
    if (content === undefined)
        return false;
    for (const part of content) {
        if (toolCallPartMatches(part, toolCallId, toolName))
            return true;
    }
    return false;
}
function effectiveLeafForTool(sessionManager, toolCallId, toolName) {
    const leaf = sessionManager.getLeafEntry();
    if (leaf === undefined)
        return { leafId: sessionManager.getLeafId(), activeToolCallLeafExcluded: false };
    const message = entryMessage(leaf);
    if (message !== undefined && messageContainsToolCall(message, toolCallId, toolName)) {
        return { leafId: leaf.parentId, activeToolCallLeafExcluded: true };
    }
    return { leafId: sessionManager.getLeafId(), activeToolCallLeafExcluded: false };
}
export function resolveEffectiveLeaf(sessionManager, options) {
    if (!options.excludeActiveToolCallLeaf)
        return { leafId: sessionManager.getLeafId(), activeToolCallLeafExcluded: false };
    return effectiveLeafForTool(sessionManager, options.toolCallId, options.toolName);
}
/**
 * Freeze the parent conversation into LLM messages.
 *
 * Callers must complete every downstream use of the returned snapshot without
 * re-reading the session, so the seed cannot drift while a child is being
 * launched.
 */
export function snapshotParentConversation(ctx, options) {
    const entries = ctx.sessionManager.getEntries();
    const leaf = resolveEffectiveLeaf(ctx.sessionManager, options);
    const sessionContext = buildSessionContext(entries, leaf.leafId, entriesById(entries));
    return {
        messages: convertToLlm(sessionContext.messages),
        leafId: leaf.leafId,
        activeToolCallLeafExcluded: leaf.activeToolCallLeafExcluded,
    };
}
//# sourceMappingURL=parent-snapshot.js.map