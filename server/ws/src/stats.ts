import {
  type MeasureContext,
  MeasureMetricsContext,
  type Metrics,
  metricsAggregate,
  type MetricsData,
  toWorkspaceString
} from '@hcengineering/core'
import os from 'os'
import { type SessionManager } from './types'

/**
 * @public
 */
export function getStatistics (ctx: MeasureContext, sessions: SessionManager, admin: boolean): any {
  const data: Record<string, any> = {
    metrics: metricsAggregate((ctx as any).metrics),
    statistics: {
      activeSessions: {}
    }
  }
  data.statistics.totalClients = sessions.sessions.size
  if (admin) {
    for (const [k, vv] of sessions.workspaces) {
      data.statistics.activeSessions[k] = {
        sessions: Array.from(vv.sessions.entries()).map(([k, v]) => ({
          userId: v.session.getUser(),
          data: v.socket.data(),
          mins5: v.session.mins5,
          total: v.session.total,
          current: v.session.current,
          upgrade: v.session.isUpgradeClient()
        })),
        name: vv.workspaceName,
        wsId: toWorkspaceString(vv.workspaceId),
        sessionsTotal: vv.sessions.size,
        upgrading: vv.upgrade,
        closing: vv.closing !== undefined
      }
    }
  }

  data.statistics.memoryUsed = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100
  data.statistics.memoryTotal = Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100
  data.statistics.cpuUsage = Math.round(os.loadavg()[0] * 100) / 100
  data.statistics.freeMem = Math.round((os.freemem() / 1024 / 1024) * 100) / 100
  data.statistics.totalMem = Math.round((os.totalmem() / 1024 / 1024) * 100) / 100

  return data
}

/**
 * @public
 */
export function wipeStatistics (ctx: MeasureContext): void {
  const toClean: (Metrics | MetricsData)[] = []
  function cleanMetrics (m: Metrics | MetricsData): void {
    m.operations = 0
    m.value = 0
    m.topResult = undefined
    if ('measurements' in m) {
      for (const v of Object.values(m.measurements)) {
        toClean.push(v)
      }
      for (const v of Object.values(m.params)) {
        for (const vv of Object.values(v)) {
          toClean.push(vv)
        }
      }
    }
  }

  if (ctx instanceof MeasureMetricsContext) {
    toClean.push(ctx.metrics)
    while (toClean.length > 0) {
      const v = toClean.shift()
      if (v === undefined) {
        break
      }
      cleanMetrics(v)
    }
  }
}