import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const TOP_N = 13
const BUCKET = 'leaderboard'
const KEY = 'entries.json'

type Entry = {
  name: string
  timeSurvived: number
  score: number
  createdAt: string
}

type Stored = { entries: Entry[] }

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok('', 204)
  if (event.httpMethod !== 'GET') return error('Method not allowed', 405)

  try {
    const store = getStore({ name: BUCKET })
    const json = (await store.get(KEY, { type: 'json' })) as Stored | null
    const entries = Array.isArray(json?.entries) ? (json!.entries as Entry[]) : []
    const sorted = [...entries].sort((a, b) => {
      if (b.timeSurvived !== a.timeSurvived) return b.timeSurvived - a.timeSurvived
      return b.score - a.score
    }).slice(0, TOP_N)
    return ok(JSON.stringify({ entries: sorted }), 200, 'application/json')
  } catch (e: any) {
    console.error('leaderboard-top error:', e?.message || e)
    return error(`Failed to fetch leaderboard: ${e?.message || 'unknown error'}`)
  }
}

function ok(body: string, status = 200, contentType = 'text/plain') {
  return {
    statusCode: status,
    headers: corsHeaders(contentType),
    body,
  }
}

function error(message: string, status = 500) {
  return ok(JSON.stringify({ error: message }), status, 'application/json')
}

function corsHeaders(contentType: string) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
