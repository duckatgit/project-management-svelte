//
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Analytics } from '@hcengineering/analytics'
import { generateId, toWorkspaceString, type MeasureContext } from '@hcengineering/core'
import { UNAUTHORIZED } from '@hcengineering/platform'
import { serialize, type Response } from '@hcengineering/rpc'
import { decodeToken, type Token } from '@hcengineering/server-token'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import http, { type IncomingMessage } from 'http'
import os from 'os'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { getStatistics, wipeStatistics } from './stats'
import {
  LOGGING_ENABLED,
  type ConnectionSocket,
  type HandleRequestFunction,
  type PipelineFactory,
  type SessionManager
} from './types'

import 'bufferutil'
import 'utf-8-validate'
import { doSessionOp, processRequest, type WebsocketData } from './utils'

/**
 * @public
 * @param sessionFactory -
 * @param port -
 * @param host -
 */
export function startHttpServer (
  sessions: SessionManager,
  handleRequest: HandleRequestFunction,
  ctx: MeasureContext,
  pipelineFactory: PipelineFactory,
  port: number,
  productId: string,
  enableCompression: boolean,
  accountsUrl: string
): () => Promise<void> {
  if (LOGGING_ENABLED) {
    ctx.info('starting server on', {
      port,
      productId,
      enableCompression,
      accountsUrl,
      parallel: os.availableParallelism()
    })
  }

  const app = express()
  app.use(cors())
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression'] != null) {
          // don't compress responses with this request header
          return false
        }

        // fallback to standard filter function
        return compression.filter(req, res)
      },
      level: 1,
      memLevel: 9
    })
  )

  const getUsers = (): any => Array.from(sessions.sessions.entries()).map(([k, v]) => v.session.getUser())

  app.get('/api/v1/version', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        version: process.env.MODEL_VERSION
      })
    )
  })

  app.get('/api/v1/statistics', (req, res) => {
    try {
      const token = req.query.token as string
      const payload = decodeToken(token)
      const admin = payload.extra?.admin === 'true'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const json = JSON.stringify({
        ...getStatistics(ctx, sessions, admin),
        users: getUsers,
        admin
      })
      res.end(json)
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      res.writeHead(404, {})
      res.end()
    }
  })
  app.put('/api/v1/manage', (req, res) => {
    try {
      const token = req.query.token as string
      const payload = decodeToken(token)
      if (payload.extra?.admin !== 'true') {
        res.writeHead(404, {})
        res.end()
        return
      }

      const operation = req.query.operation

      switch (operation) {
        case 'maintenance': {
          const timeMinutes = parseInt((req.query.timeout as string) ?? '5')
          sessions.scheduleMaintenance(timeMinutes)

          res.writeHead(200)
          res.end()
          return
        }
        case 'wipe-statistics': {
          wipeStatistics(ctx)

          res.writeHead(200)
          res.end()
          return
        }
        case 'force-close': {
          const wsId = req.query.wsId as string
          void sessions.forceClose(wsId)
          res.writeHead(200)
          res.end()
          return
        }
        case 'reboot': {
          process.exit(0)
        }
      }

      res.writeHead(404, {})
      res.end()
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      res.writeHead(404, {})
      res.end()
    }
  })

  const httpServer = http.createServer(app)

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: enableCompression
      ? {
          zlibDeflateOptions: {
            // See zlib defaults.
            chunkSize: 32 * 1024,
            memLevel: 9,
            level: 1
          },
          zlibInflateOptions: {
            chunkSize: 32 * 1024,
            level: 1,
            memLevel: 9
          },
          serverNoContextTakeover: true,
          clientNoContextTakeover: true,
          // Below options specified as default values.
          concurrencyLimit: Math.max(10, os.availableParallelism()), // Limits zlib concurrency for perf.
          threshold: 1024 // Size (in bytes) below which messages
          // should not be compressed if context takeover is disabled.
        }
      : false,
    skipUTF8Validation: true
  })
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const handleConnection = async (
    ws: WebSocket,
    request: IncomingMessage,
    token: Token,
    rawToken: string,
    sessionId?: string
  ): Promise<void> => {
    const data = {
      remoteAddress: request.socket.remoteAddress ?? '',
      userAgent: request.headers['user-agent'] ?? '',
      language: request.headers['accept-language'] ?? '',
      email: token.email,
      mode: token.extra?.mode,
      model: token.extra?.model
    }
    const cs: ConnectionSocket = createWebsocketClientSocket(ws, data)

    const webSocketData: WebsocketData = {
      connectionSocket: cs,
      payload: token,
      token: rawToken,
      session: sessions.addSession(ctx, cs, token, rawToken, pipelineFactory, productId, sessionId, accountsUrl),
      url: ''
    }

    if (webSocketData.session instanceof Promise) {
      void webSocketData.session.then((s) => {
        if ('upgrade' in s || 'error' in s) {
          if ('error' in s) {
            ctx.error('error', { error: s.error?.message, stack: s.error?.stack })
          }
          void cs
            .send(ctx, { id: -1, result: { state: 'upgrading', stats: (s as any).upgradeInfo } }, false, false)
            .then(() => {
              cs.close()
            })
        }
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ws.on('message', (msg: RawData) => {
      try {
        let buff: any | undefined
        if (msg instanceof Buffer) {
          buff = msg
        } else if (Array.isArray(msg)) {
          buff = Buffer.concat(msg)
        }
        if (buff !== undefined) {
          doSessionOp(webSocketData, (s) => {
            processRequest(s.session, cs, s.context, s.workspaceId, buff, handleRequest)
          })
        }
      } catch (err: any) {
        Analytics.handleError(err)
        if (LOGGING_ENABLED) {
          ctx.error('message error', err)
        }
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ws.on('close', async (code: number, reason: Buffer) => {
      doSessionOp(webSocketData, (s) => {
        if (!(s.session.workspaceClosed ?? false)) {
          // remove session after 1seconds, give a time to reconnect.
          void sessions.close(cs, toWorkspaceString(token.workspace))
        }
      })
    })

    ws.on('error', (err) => {
      doSessionOp(webSocketData, (s) => {
        console.error(s.session.getUser(), 'error', err)
      })
    })
  }
  wss.on('connection', handleConnection as any)

  httpServer.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL('http://localhost' + (request.url ?? ''))
    const token = url.pathname.substring(1)

    try {
      const payload = decodeToken(token ?? '')
      const sessionId = url.searchParams.get('sessionId')

      if (payload.workspace.productId !== productId) {
        if (LOGGING_ENABLED) {
          ctx.error('invalid product', { required: payload.workspace.productId, productId })
        }
        throw new Error('Invalid workspace product')
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        void handleConnection(ws, request, payload, token, sessionId ?? undefined)
      })
    } catch (err: any) {
      Analytics.handleError(err)
      if (LOGGING_ENABLED) {
        ctx.error('invalid token', err)
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const resp: Response<any> = {
          id: -1,
          error: UNAUTHORIZED,
          result: 'hello'
        }
        ws.send(serialize(resp, false), { binary: false })
        ws.onmessage = (msg) => {
          const resp: Response<any> = {
            error: UNAUTHORIZED
          }
          ws.send(serialize(resp, false), { binary: false })
        }
      })
    }
  })
  httpServer.on('error', (err) => {
    if (LOGGING_ENABLED) {
      ctx.error('server error', err)
    }
  })

  httpServer.listen(port)
  return async () => {
    await sessions.closeWorkspaces(ctx)
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => {
        if (err != null) {
          reject(err)
        }
        resolve()
      })
    })
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => {
        if (err != null) {
          reject(err)
        }
        resolve()
      })
    )
  }
}
function createWebsocketClientSocket (
  ws: WebSocket,
  data: { remoteAddress: string, userAgent: string, language: string, email: string, mode: any, model: any }
): ConnectionSocket {
  const cs: ConnectionSocket = {
    id: generateId(),
    isClosed: false,
    close: () => {
      cs.isClosed = true
      ws.close()
    },
    data: () => data,
    send: async (ctx: MeasureContext, msg, binary, compression) => {
      if (ws.readyState !== ws.OPEN && !cs.isClosed) {
        return 0
      }
      const smsg = serialize(msg, binary)

      while (ws.bufferedAmount > 128 && ws.readyState === ws.OPEN) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve)
        })
      }
      ctx.measure('send-data', smsg.length)
      await new Promise<void>((resolve, reject) => {
        ws.send(smsg, { binary: true, compress: compression }, (err) => {
          if (err != null) {
            reject(err)
          }
          resolve()
        })
      })
      return smsg.length
    }
  }
  return cs
}
