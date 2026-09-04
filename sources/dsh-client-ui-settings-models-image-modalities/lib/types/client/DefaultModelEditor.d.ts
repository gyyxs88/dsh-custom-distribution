/** Editor for the model and reasoning defaults applied to newly created sessions. */
import type { ReactNode } from 'react';
import type { ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import type { ModelsOperations } from './operations.ts';
import type { ModelsSettingsStore } from './store.ts';
import type { en } from './locales.ts';
export interface DefaultModelEditorProps {
    namespace: SettingsNamespaceView;
    groups: readonly ModelProviderGroup[];
    operations: ModelsOperations;
    controller: ModelsSettingsStore;
    t: (key: keyof typeof en) => string;
    readOnly: boolean;
}
export declare function DefaultModelEditor(props: DefaultModelEditorProps): ReactNode;
//# sourceMappingURL=DefaultModelEditor.d.ts.map