import { spawn } from 'node:child_process'
import z from '@deepseek-ai/schemastery'

export const name = 'local-service-control'
export const inject = ['webServer']

export const Config = z.object({
  projectRoot: z.string().required(),
  launcherScript: z.string().required(),
  powershellExecutable: z.string().default('powershell.exe'),
})

const BASE_PATH = '/api/local-service-control'
const CONTROL_HEADER = 'x-dsh-service-control'

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isSameOrigin(req) {
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string' || typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host === host
  } catch {
    return false
  }
}

export function isAuthorizedActionRequest(req) {
  return req.method === 'POST'
    && isLoopbackAddress(req.socket?.remoteAddress)
    && isSameOrigin(req)
    && req.headers[CONTROL_HEADER] === '1'
}

export function createServiceControlHandlers({ dispatch, pid = process.pid, logger = console }) {
  const instanceId = `${pid}:${Date.now()}`
  let pendingAction = null

  const status = (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
      return
    }
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: 'LOOPBACK_REQUIRED' })
      return
    }
    sendJson(res, 200, { pid, instanceId, pendingAction })
  }

  const action = (requestedAction) => (req, res) => {
    if (!isAuthorizedActionRequest(req)) {
      sendJson(res, 403, { error: 'ACTION_NOT_AUTHORIZED' })
      return
    }
    if (pendingAction !== null) {
      sendJson(res, 409, { error: 'ACTION_ALREADY_PENDING', pendingAction })
      return
    }

    pendingAction = requestedAction
    sendJson(res, 202, { accepted: true, action: requestedAction, pid, instanceId })

    queueMicrotask(() => {
      Promise.resolve().then(() => dispatch(requestedAction, pid)).catch((error) => {
        pendingAction = null
        logger.error(error)
      })
    })

    const recoveryTimer = setTimeout(() => {
      if (pendingAction === requestedAction) pendingAction = null
    }, 15_000)
    recoveryTimer.unref?.()
  }

  return {
    status,
    restart: action('restart'),
    shutdown: action('shutdown'),
  }
}

export function apply(ctx, config) {
  const dispatch = (action, pid) => {
    return new Promise((resolve, reject) => {
      const child = spawn(config.powershellExecutable, [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        config.launcherScript,
        '-Action',
        action,
        '-ExpectedHarnessPid',
        String(pid),
        '-InstallRoot',
        config.projectRoot,
      ], {
        cwd: config.projectRoot,
        windowsHide: true,
        stdio: 'ignore',
      })
      child.once('exit', (code) => code === 0
        ? resolve()
        : reject(new Error(`service-control launcher exited with code ${code ?? 'unknown'}`)))
      child.once('error', reject)
    })
  }

  const handlers = createServiceControlHandlers({
    dispatch,
    logger: ctx.logger,
  })

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/status`, handler: handlers.status }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/restart`, handler: handlers.restart }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/shutdown`, handler: handlers.shutdown }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'local-service-control: loopback routes')
}
