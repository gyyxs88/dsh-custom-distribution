// Rebuild first-party entries while retaining approved third-party asset bytes.
import configs from '../tsdown.config.ts'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('../', import.meta.url))
export default configs.filter(config => !config.name?.includes('/assets/')).map(config => ({ ...config, cwd }))
