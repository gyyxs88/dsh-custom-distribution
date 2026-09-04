import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Editor for the model and reasoning defaults applied to newly created sessions. */
import { useState } from 'react';
import styles from './ModelsSection.module.css';
function objectValue(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
export function DefaultModelEditor(props) {
    const current = objectValue(props.namespace.value);
    const initialProvider = typeof current['provider'] === 'string' ? current['provider'] : props.groups[0]?.id ?? '';
    const initialGroup = props.groups.find(group => group.id === initialProvider);
    const [provider, setProvider] = useState(initialProvider);
    const [model, setModel] = useState(typeof current['model'] === 'string' ? current['model'] : initialGroup?.models[0]?.id ?? '');
    const [reasoningEffort, setReasoningEffort] = useState(typeof current['reasoningEffort'] === 'string' ? current['reasoningEffort'] : '');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState();
    const group = props.groups.find(entry => entry.id === provider);
    const selected = group?.models.find(entry => entry.id === model);
    const unavailableProvider = provider.length > 0 && group === undefined;
    const unavailableModel = model.length > 0 && selected === undefined;
    const efforts = selected?.reasoning?.efforts ?? [];
    const unavailableReasoning = reasoningEffort.length > 0
        && !efforts.some(effort => effort.id === reasoningEffort);
    const changeProvider = (next) => {
        setProvider(next);
        const nextModel = props.groups.find(entry => entry.id === next)?.models[0];
        setModel(nextModel?.id ?? '');
        setReasoningEffort(nextModel?.reasoning?.defaultEffort ?? '');
    };
    const changeModel = (next) => {
        setModel(next);
        const nextModel = group?.models.find(entry => entry.id === next);
        setReasoningEffort(nextModel?.reasoning?.defaultEffort ?? '');
    };
    const save = async () => {
        if (provider.length === 0 || model.length === 0
            || unavailableProvider || unavailableModel || unavailableReasoning)
            return;
        setBusy(true);
        setFailure(undefined);
        try {
            const written = await props.operations.writeSettings('agent-default-model', [
                { op: 'set', path: ['provider'], value: provider },
                { op: 'set', path: ['model'], value: model },
                reasoningEffort.length === 0
                    ? { op: 'unset', path: ['reasoningEffort'] }
                    : { op: 'set', path: ['reasoningEffort'], value: reasoningEffort },
            ], props.namespace.revision);
            if (written.kind !== 'written') {
                setFailure(written.kind === 'conflict' ? props.t('conflict') : written.message);
                return;
            }
            await props.controller.load();
        }
        catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("section", { className: styles['editor'], children: [_jsx("h3", { className: styles['editorTitle'], children: props.t('defaultModelTitle') }), _jsx("p", { className: styles['advancedHint'], children: props.t('defaultModelDescription') }), _jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: props.t('provider') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: provider, disabled: props.readOnly || busy, onChange: (event) => { changeProvider(event.target.value); }, children: [unavailableProvider
                                ? _jsxs("option", { value: provider, disabled: true, children: [provider, " (", props.t('unavailable'), ")"] })
                                : null, props.groups.map(entry => _jsx("option", { value: entry.id, children: entry.name }, entry.id))] })] }), _jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: props.t('model') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: model, disabled: props.readOnly || busy || group === undefined, onChange: (event) => { changeModel(event.target.value); }, children: [unavailableModel ? _jsxs("option", { value: model, disabled: true, children: [model, " (", props.t('unavailable'), ")"] }) : null, (group?.models ?? []).map(entry => _jsx("option", { value: entry.id, children: entry.name }, entry.id))] })] }), _jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: props.t('reasoningDefault') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: reasoningEffort, disabled: props.readOnly || busy || selected?.reasoning === undefined, onChange: (event) => { setReasoningEffort(event.target.value); }, children: [_jsx("option", { value: "", children: selected?.reasoning === undefined ? props.t('reasoningUnavailable') : props.t('providerDefault') }), unavailableReasoning
                                ? _jsxs("option", { value: reasoningEffort, disabled: true, children: [reasoningEffort, " (", props.t('unavailable'), ")"] })
                                : null, efforts.map(effort => _jsx("option", { value: effort.id, children: effort.name }, effort.id))] })] }), unavailableReasoning
                ? _jsx("p", { className: styles['notice'], children: props.t('reasoningSelectionUnavailable') })
                : null, failure === undefined ? null : _jsx("p", { className: styles['error'], children: failure }), _jsx("button", { type: "button", className: styles['primaryButton'], disabled: props.readOnly || busy || provider.length === 0 || model.length === 0
                    || unavailableProvider || unavailableModel || unavailableReasoning, onClick: () => { void save(); }, children: busy ? props.t('applying') : props.t('saveDefault') })] }));
}
//# sourceMappingURL=DefaultModelEditor.js.map