import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const TOP_N = 13
const BUCKET = 'leaderboard'
const KEY = 'entries.json'

type Entry = { name: string; timeSurvived: number; score: number; createdAt: string; mode?: 'normal' | 'daily'; dailyId?: string }

type Stored = { entries: Entry[] }

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN
  const manual = Boolean(siteID && token)
  console.log('blobs config (top):', { manual, siteIDPresent: !!siteID, tokenPresent: !!token })
  if (!manual) return getStore(BUCKET)
  // Try multiple option shapes and overloads
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
  // Last resort (will likely throw with clear error)
  return getStore(BUCKET, { siteID, token } as any)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok('', 204)
  if (event.httpMethod !== 'GET') return error('Method not allowed', 405)

  try {
    const store = makeStore()
    const mode = (event.queryStringParameters?.mode === 'daily' ? 'daily' : 'normal') as 'normal' | 'daily'
    const dailyId = event.queryStringParameters?.dailyId || ''
    const bucketKey = mode === 'daily' ? `daily/${dailyId}.json` : KEY
    const json = (await (store as any).get(bucketKey, { type: 'json' })) as Stored | null
    const entries = Array.isArray(json?.entries) ? (json!.entries as Entry[]) : []
    const sorted = [...entries].sort((a, b) => (b.timeSurvived - a.timeSurvived) || (b.score - a.score)).slice(0, TOP_N)
    return ok(JSON.stringify({ entries: sorted }), 200, 'application/json')
  } catch (e: any) {
    console.error('leaderboard-top error:', e?.message || e)
    return error(`Failed to fetch leaderboard: ${e?.message || 'unknown error'}`)
  }
}

function ok(body: string, status = 200, contentType = 'text/plain') {
  return { statusCode: status, headers: corsHeaders(contentType), body }
}

function error(message: string, status = 500) {
  return ok(JSON.stringify({ error: message }), status, 'application/json')
}

function corsHeaders(contentType: string) {
  return { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
}
