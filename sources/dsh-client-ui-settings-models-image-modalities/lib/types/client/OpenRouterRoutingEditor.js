import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Friendly editor for the OpenRouter upstream-routing policy sent by pi-ai. */
import { useState } from 'react';
import styles from './ModelsSection.module.css';
function objectValue(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function stringList(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string' && entry.length > 0)
        : [];
}
function parseList(value) {
    return [...new Set(value.split(/[\n,]/u).map(entry => entry.trim()).filter(entry => entry.length > 0))];
}
function RoutingListInput(props) {
    const [draft, setDraft] = useState(() => stringList(props.value).join(', '));
    return (_jsx("input", { className: styles['input'], type: "text", "aria-label": props.label, value: draft, placeholder: props.placeholder, disabled: props.disabled, onChange: (event) => {
            setDraft(event.target.value);
            props.onChange(parseList(event.target.value));
        } }));
}
export function OpenRouterRoutingEditor(props) {
    const routing = objectValue(props.value);
    const { t, disabled } = props;
    const set = (field, next) => {
        const updated = { ...routing };
        if (next === undefined || next === '' || (Array.isArray(next) && next.length === 0)) {
            Reflect.deleteProperty(updated, field);
        }
        else {
            updated[field] = next;
        }
        props.onChange(Object.keys(updated).length === 0 ? undefined : updated);
    };
    const booleanField = (field, label) => (_jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t(label) }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, "aria-label": t(label), value: typeof routing[field] === 'boolean' ? String(routing[field]) : '', disabled: disabled, onChange: (event) => { set(field, event.target.value === '' ? undefined : event.target.value === 'true'); }, children: [_jsx("option", { value: "", children: t('automatic') }), _jsx("option", { value: "true", children: t('enabled') }), _jsx("option", { value: "false", children: t('disabled') })] })] }));
    const listField = (field, label, placeholder) => (_jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t(label) }), _jsx(RoutingListInput, { value: routing[field], label: t(label), placeholder: placeholder, disabled: disabled, onChange: (next) => { set(field, next); } })] }));
    const price = objectValue(routing['max_price']);
    const setPrice = (field, next) => {
        const updated = { ...price };
        if (next.trim().length === 0)
            Reflect.deleteProperty(updated, field);
        else
            updated[field] = next.trim();
        set('max_price', Object.keys(updated).length === 0 ? undefined : updated);
    };
    return (_jsxs("details", { className: styles['customized'], children: [_jsx("summary", { className: styles['customizedSummary'], children: t('openRouterRouting') }), _jsxs("div", { className: styles['modelAdvanced'], style: { paddingTop: '12px' }, children: [listField('only', 'routingOnly', 'DeepSeek, Google'), listField('order', 'routingOrder', 'DeepSeek, Google'), listField('ignore', 'routingIgnore', 'Provider slug'), listField('quantizations', 'routingQuantizations', 'fp16, bf16'), booleanField('allow_fallbacks', 'routingFallbacks'), booleanField('require_parameters', 'routingRequireParameters'), booleanField('zdr', 'routingZdr'), booleanField('enforce_distillable_text', 'routingDistillable'), _jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t('routingDataCollection') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: typeof routing['data_collection'] === 'string' ? routing['data_collection'] : '', disabled: disabled, onChange: (event) => { set('data_collection', event.target.value || undefined); }, children: [_jsx("option", { value: "", children: t('automatic') }), _jsx("option", { value: "deny", children: t('routingDataDeny') }), _jsx("option", { value: "allow", children: t('routingDataAllow') })] })] }), _jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t('routingSort') }), _jsxs("select", { className: `${styles['input']} ${styles['selectInput']}`, value: typeof routing['sort'] === 'string' ? routing['sort'] : '', disabled: disabled, onChange: (event) => { set('sort', event.target.value || undefined); }, children: [_jsx("option", { value: "", children: t('automatic') }), _jsx("option", { value: "price", children: t('routingSortPrice') }), _jsx("option", { value: "throughput", children: t('routingSortThroughput') }), _jsx("option", { value: "latency", children: t('routingSortLatency') })] })] }), ['prompt', 'completion'].map(field => (_jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t(field === 'prompt' ? 'routingMaxPromptPrice' : 'routingMaxCompletionPrice') }), _jsx("input", { className: styles['input'], type: "text", inputMode: "decimal", value: typeof price[field] === 'string' || typeof price[field] === 'number' ? price[field] : '', disabled: disabled, onChange: (event) => { setPrice(field, event.target.value); } })] }, field))), ['preferred_min_throughput', 'preferred_max_latency'].map(field => (_jsxs("label", { className: styles['modelField'], children: [_jsx("span", { className: styles['modelFieldLabel'], children: t(field === 'preferred_min_throughput' ? 'routingMinThroughput' : 'routingMaxLatency') }), _jsx("input", { className: styles['input'], type: "number", min: "0", step: field === 'preferred_max_latency' ? '0.1' : undefined, value: typeof routing[field] === 'number' ? routing[field] : '', disabled: disabled, onChange: (event) => { set(field, event.target.value === '' ? undefined : Number(event.target.value)); } })] }, field)))] })] }));
}
//# sourceMappingURL=OpenRouterRoutingEditor.js.map