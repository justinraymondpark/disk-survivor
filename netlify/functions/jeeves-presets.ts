import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

const STORE = 'jeeves-presets'

export const handler: Handler = async (event) => {
	const store = getStore(STORE)

	if (event.httpMethod === 'OPTIONS') return { statusCode: 200 }

	if (event.httpMethod === 'POST') {
		try {
			const { name, coords } = JSON.parse(event.body || '{}')
			if (!name || !Array.isArray(coords)) return { statusCode: 400, body: 'Invalid payload' }
			await store.set(name, JSON.stringify({ name, coords }), { contentType: 'application/json' })
			return { statusCode: 200, body: JSON.stringify({ ok: true }) }
		} catch (e: any) {
			return { statusCode: 500, body: String(e?.message || e) }
		}
	}

	if (event.httpMethod === 'GET') {
		try {
			const { blobs } = await store.list()
			const presets: Record<string, any> = {}
			for (const b of blobs) {
				const data = await store.get(b.key, { type: 'json' }) as any
				if (data?.name && data?.coords) presets[data.name] = data.coords
			}
			return { statusCode: 200, body: JSON.stringify({ presets }) }
		} catch (e: any) {
			return { statusCode: 500, body: String(e?.message || e) }
		}
	}

	return { statusCode: 405, body: 'Method Not Allowed' }
}