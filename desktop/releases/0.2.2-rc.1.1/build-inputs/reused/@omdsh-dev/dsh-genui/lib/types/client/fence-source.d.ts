export interface SourceFence {
    language: string;
    raw: string;
}
export declare function normalizedFenceBody(raw: string): string;
/** Conservative top-level fence reader. Track ALL languages and delimiter
 * lengths so a literal dsh-ui example inside a longer code fence is not an
 * instruction. Nested list/quote fences are deliberately left to the host:
 * an uncertain source/DOM correspondence must keep the stock code visible. */
export declare function sourceFences(text: string): SourceFence[];
/** Only the already-selected session's public Chat source is read. There is
 * no session I/O, event-log traversal, private React state or content cache. */
export declare function assistantSourceFences(snapshot: unknown, key: string): SourceFence[] | undefined;
