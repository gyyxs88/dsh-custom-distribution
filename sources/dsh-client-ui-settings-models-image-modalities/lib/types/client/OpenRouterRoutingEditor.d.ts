/** Friendly editor for the OpenRouter upstream-routing policy sent by pi-ai. */
import type { ReactNode } from 'react';
import type { en } from './locales.ts';
export interface OpenRouterRoutingEditorProps {
    value: unknown;
    onChange: (value: Record<string, unknown> | undefined) => void;
    t: (key: keyof typeof en) => string;
    disabled: boolean;
}
export declare function OpenRouterRoutingEditor(props: OpenRouterRoutingEditorProps): ReactNode;
//# sourceMappingURL=OpenRouterRoutingEditor.d.ts.map