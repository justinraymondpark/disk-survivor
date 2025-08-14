import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const STORE = 'jeeves-presets'

function makeStore() {
	const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID
	const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN
	const manual = Boolean(siteID && token)
	console.log('blobs config (jeeves):', { manual, siteIDPresent: !!siteID, tokenPresent: !!token })
	if (!manual) return getStore(STORE)
	const variants = [
		{ siteID, token },
		{ siteId: siteID, token },
		{ siteID, accessToken: token },
		{ siteId: siteID, accessToken: token },
		{ siteID, authToken: token },
		{ siteId: siteID, authToken: token },
	] as any[]
	for (const opts of variants) {
		try { return getStore(STORE, opts) } catch {}
		try { return getStore({ name: STORE, ...opts }) as any } catch {}
	}
	return getStore(STORE, { siteID, token } as any)
}

export const handler: Handler = async (event) => {
	const store = makeStore()

	if (event.httpMethod === 'OPTIONS') return { statusCode: 200 }

	if (event.httpMethod === 'POST') {
		try {
			const { name, coords } = JSON.parse(event.body || '{}')
			if (!name || !Array.isArray(coords)) return { statusCode: 400, body: 'Invalid payload' }
			await (store as any).set(name, JSON.stringify({ name, coords }), { contentType: 'application/json' })
			return { statusCode: 200, body: JSON.stringify({ ok: true }) }
		} catch (e: any) {
			return { statusCode: 500, body: String(e?.message || e) }
		}
	}

	if (event.httpMethod === 'GET') {
		try {
			const { blobs } = await (store as any).list()
			const presets: Record<string, any> = {}
			for (const b of blobs) {
				const data = await (store as any).get(b.key, { type: 'json' }) as any
				if (data?.name && data?.coords) presets[data.name] = data.coords
			}
			return { statusCode: 200, body: JSON.stringify({ presets }) }
		} catch (e: any) {
			return { statusCode: 500, body: String(e?.message || e) }
		}
	}

	return { statusCode: 405, body: 'Method Not Allowed' }
}