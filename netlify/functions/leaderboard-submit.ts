import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const BUCKET = 'leaderboard'
const KEY = 'entries.json'
const TOP_N = 100

interface Entry { name: string; timeSurvived: number; score: number; createdAt: string; mode?: 'normal' | 'daily'; dailyId?: string }
interface Stored { entries: Entry[] }

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN
  const manual = Boolean(siteID && token)
  console.log('blobs config (submit):', { manual, siteIDPresent: !!siteID, tokenPresent: !!token })
  if (!manual) return getStore(BUCKET)
  const optsVariants = [
    { siteID, token },
    { siteId: siteID, token },
    { siteID, accessToken: token },
    { siteId: siteID, accessToken: token },
    { siteID, authToken: token },
    { siteId: siteID, authToken: token },
  ] as any[]
  for (const opts of optsVariants) {
    try { return getStore(BUCKET, opts) } catch {}
    try { return getStore({ name: BUCKET, ...opts }) as any } catch {}
  }
  return getStore(BUCKET, { siteID, token } as any)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok('', 204)
  if (event.httpMethod !== 'POST') return error('Method not allowed', 405)
  try {
    const store = makeStore()
    const incoming = JSON.parse(event.body || '{}') as Partial<Entry>

    const name = String((incoming.name ?? '').toString())
    const timeSurvived = Number(incoming.timeSurvived ?? NaN)
    const score = Number(incoming.score ?? NaN)
    const mode = (incoming.mode === 'daily' ? 'daily' : 'normal') as 'normal' | 'daily'
    const dailyId = mode === 'daily' ? String(incoming.dailyId || '') : ''

    if (!name || !isFinite(timeSurvived) || !isFinite(score)) return error('Invalid payload', 400)
    if (mode === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(dailyId)) return error('Invalid dailyId', 400)

    const trimmedName = name.slice(0, 20)

    const bucketKey = mode === 'daily' ? `daily/${dailyId}.json` : KEY
    const current = (await (store as any).get(bucketKey, { type: 'json' })) as Stored | null
    const entries: Entry[] = Array.isArray(current?.entries) ? (current!.entries as Entry[]) : []

    entries.push({ name: trimmedName, timeSurvived: Math.max(0, Math.floor(timeSurvived)), score: Math.max(0, Math.floor(score)), createdAt: new Date().toISOString(), mode, dailyId: mode === 'daily' ? dailyId : undefined })

    const sorted = entries.sort((a, b) => (b.timeSurvived - a.timeSurvived) || (b.score - a.score)).slice(0, TOP_N)

    await (store as any).set(bucketKey, JSON.stringify({ entries: sorted }), { contentType: 'application/json' })

    return ok(JSON.stringify({ ok: true }))
  } catch (e: any) {
    console.error('leaderboard-submit error:', e?.message || e)
    return error(`Failed to submit leaderboard: ${e?.message || 'unknown error'}`)
  }
}

function ok(body: string, status = 200, contentType: string = 'application/json') {
  return { statusCode: status, headers: corsHeaders(contentType), body }
}

function error(message: string, status = 500) {
  return ok(JSON.stringify({ error: message }), status)
}

function corsHeaders(contentType: string) {
  return { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
}
