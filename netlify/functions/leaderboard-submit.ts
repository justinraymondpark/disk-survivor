import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const BUCKET = 'leaderboard'
const KEY = 'entries.json'
const TOP_N = 100

interface Entry {
  name: string
  timeSurvived: number
  score: number
  createdAt: string
}

interface Stored { entries: Entry[] }

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN
  if (siteID && token) return getStore({ name: BUCKET, siteID, token })
  return getStore({ name: BUCKET })
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

    if (!name || !isFinite(timeSurvived) || !isFinite(score)) {
      return error('Invalid payload', 400)
    }

    const trimmedName = name.slice(0, 20)

    const current = (await store.get(KEY, { type: 'json' })) as Stored | null
    const entries: Entry[] = Array.isArray(current?.entries) ? (current!.entries as Entry[]) : []

    entries.push({
      name: trimmedName,
      timeSurvived: Math.max(0, Math.floor(timeSurvived)),
      score: Math.max(0, Math.floor(score)),
      createdAt: new Date().toISOString(),
    })

    const sorted = entries.sort((a, b) => {
      if (b.timeSurvived !== a.timeSurvived) return b.timeSurvived - a.timeSurvived
      return b.score - a.score
    }).slice(0, TOP_N)

    await store.set(KEY, JSON.stringify({ entries: sorted }), { contentType: 'application/json' })

    return ok(JSON.stringify({ ok: true }))
  } catch (e: any) {
    console.error('leaderboard-submit error:', e?.message || e)
    return error(`Failed to submit leaderboard: ${e?.message || 'unknown error'}`)
  }
}

function ok(body: string, status = 200, contentType: string = 'application/json') {
  return {
    statusCode: status,
    headers: corsHeaders(contentType),
    body,
  }
}

function error(message: string, status = 500) {
  return ok(JSON.stringify({ error: message }), status)
}

function corsHeaders(contentType: string) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
