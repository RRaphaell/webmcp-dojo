import './styles/tokens.css'
import { ensureModelContext } from './webmcp/shim'

const engine = ensureModelContext()

const params = new URLSearchParams(location.search)
if (params.get('test') === 'registry') {
  const { installTestHooks } = await import('./testhooks')
  installTestHooks(engine)
} else {
  const { boot } = await import('./app')
  boot(engine)
}
