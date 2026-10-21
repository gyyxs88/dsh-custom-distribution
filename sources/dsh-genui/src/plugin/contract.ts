/** Shared model instructions: the budget belongs to one display, never a session. */
export const GENUI_AUTHORING_RULE = '先获取字段说明：加载 genui 技能正文后再编写 spec；技能不可用时直接用普通 Markdown 交付内容。常用字段：callout.content 为字符串（兼容 text 别名）；keyvalue.pairs 为 [{"key":"名称","value":"内容"}]；table.columns 为字符串数组、rows 为二维数组；tabs.tabs 为 [{"label":"名称","items":[]}]。'

export const GENUI_RETRY_RULE = '同一展示总共最多 2 次 validate_dsh_ui（初次 + 1 次修复验证；包括同一个 run_code 中的批量调用）。初次失败只按诊断修正一次；修复后仍失败，立即用普通 Markdown 交付原本内容，停止 UI 尝试。不得枚举组件变体探测、换组件继续凑次数或无限重试。'
