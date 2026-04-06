import type {ReadStream} from 'fs'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const V2_ORIGIN = 'https://chromewebstore.googleapis.com'
const V1_ROOT = 'https://www.googleapis.com'

export type ChromeWebstoreClientOptions = {
  /** When set (non-empty), uses Chrome Web Store API v2. Otherwise uses legacy v1 until you migrate. */
  publisherId?: string
  extensionId: string
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** Shapes aligned with legacy `chrome-webstore-upload` / v1 item resource for this action. */
export type ItemResourceLike = {
  kind: 'chromewebstore#item'
  id: string
  uploadState: 'FAILURE' | 'IN_PROGRESS' | 'NOT_FOUND' | 'SUCCESS'
  itemError: {error_code: string; error_detail: string}[]
  publishState?: string
  status?: string
}

export type PublishResponseLike = {
  kind: 'chromewebstore#item'
  item_id: string
  status: string[]
  statusDetail?: string[]
}

type V2UploadResponse = {
  name?: string
  itemId?: string
  crxVersion?: string
  uploadState?: string
}

type V2FetchStatusResponse = {
  name?: string
  itemId?: string
  publishedItemRevisionStatus?: {state?: string}
  submittedItemRevisionStatus?: {state?: string}
  lastAsyncUploadState?: string
}

type V2PublishResponse = {
  name?: string
  itemId?: string
  state?: string
}

type GoogleErrorBody = {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: {[k: string]: unknown}[]
  }
}

export type ChromeWebstoreApi = {
  uploadExisting: (stream: ReadStream) => Promise<ItemResourceLike>
  get: (projection?: string) => Promise<ItemResourceLike>
  publish: (target?: string) => Promise<PublishResponseLike>
}

type V1ItemResource = {
  kind?: string
  id?: string
  uploadState?: ItemResourceLike['uploadState']
  itemError?: ItemResourceLike['itemError']
  publishState?: string
  status?: string
}

function itemResourceName(publisherId: string, extensionId: string): string {
  return `publishers/${publisherId}/items/${extensionId}`
}

function mapUploadState(v2: string | undefined): ItemResourceLike['uploadState'] {
  switch (v2) {
    case 'SUCCEEDED':
      return 'SUCCESS'
    case 'FAILED':
      return 'FAILURE'
    case 'IN_PROGRESS':
    case 'UPLOAD_IN_PROGRESS':
      return 'IN_PROGRESS'
    case 'NOT_FOUND':
      return 'NOT_FOUND'
    case undefined:
    case '':
    case 'UPLOAD_STATE_UNSPECIFIED':
      return 'SUCCESS'
    default:
      return 'IN_PROGRESS'
  }
}

function failureItem(
  code: string,
  detail: string,
  extensionId: string
): ItemResourceLike {
  return {
    kind: 'chromewebstore#item',
    id: extensionId,
    uploadState: 'FAILURE',
    itemError: [{error_code: code, error_detail: detail}]
  }
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function sharedFetchToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  const json = (await res.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `OAuth token request failed (${res.status})`
    )
  }
  return json.access_token
}

function createChromeWebstoreV2Client(options: {
  publisherId: string
  extensionId: string
  clientId: string
  clientSecret: string
  refreshToken: string
}): ChromeWebstoreApi {
  const {publisherId, extensionId, clientId, clientSecret, refreshToken} =
    options
  const name = itemResourceName(publisherId, extensionId)

  async function fetchToken(): Promise<string> {
    return sharedFetchToken(clientId, clientSecret, refreshToken)
  }

  async function uploadExisting(stream: ReadStream): Promise<ItemResourceLike> {
    const token = await fetchToken()
    const url = `${V2_ORIGIN}/upload/v2/${name}:upload`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/zip'
      },
      body: stream as unknown as BodyInit,
      duplex: 'half'
    } as RequestInit & {duplex?: string})
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as V2UploadResponse | GoogleErrorBody | null

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      return failureItem(String(ge?.error?.code ?? res.status), msg, extensionId)
    }

    const body = parsed as V2UploadResponse
    const uploadState = mapUploadState(body?.uploadState)
    return {
      kind: 'chromewebstore#item',
      id: body.itemId || extensionId,
      uploadState,
      itemError: []
    }
  }

  async function get(_projection?: string): Promise<ItemResourceLike> {
    void _projection
    const token = await fetchToken()
    const url = `${V2_ORIGIN}/v2/${name}:fetchStatus`
    const res = await fetch(url, {
      method: 'GET',
      headers: {Authorization: `Bearer ${token}`}
    })
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as V2FetchStatusResponse | GoogleErrorBody | null

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      return {
        kind: 'chromewebstore#item',
        id: extensionId,
        uploadState: 'FAILURE',
        itemError: [{error_code: String(ge?.error?.code ?? res.status), error_detail: msg}],
        publishState: 'error',
        status: msg
      }
    }

    const body = parsed as V2FetchStatusResponse
    const published = body.publishedItemRevisionStatus?.state
    const submitted = body.submittedItemRevisionStatus?.state
    return {
      kind: 'chromewebstore#item',
      id: body.itemId || extensionId,
      uploadState: 'SUCCESS',
      itemError: [],
      publishState: published ?? 'not_published',
      status: submitted ?? body.lastAsyncUploadState ?? published ?? 'n/a'
    }
  }

  async function publish(_target = 'default'): Promise<PublishResponseLike> {
    void _target
    const token = await fetchToken()
    const url = `${V2_ORIGIN}/v2/${name}:publish`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as V2PublishResponse | GoogleErrorBody | null

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      throw Object.assign(new Error(msg), {
        response: {
          kind: 'chromewebstore#item',
          item_id: extensionId,
          status: ['ITEM_PENDING_REVIEW'],
          statusDetail: [msg]
        } as PublishResponseLike
      })
    }

    const body = parsed as V2PublishResponse
    const state = body.state || ''
    if (state === 'REJECTED' || state === 'CANCELLED') {
      return {
        kind: 'chromewebstore#item',
        item_id: body.itemId || extensionId,
        status: [state],
        statusDetail: [state]
      }
    }
    return {
      kind: 'chromewebstore#item',
      item_id: body.itemId || extensionId,
      status: ['OK'],
      statusDetail: state ? [state] : []
    }
  }

  return {uploadExisting, get, publish}
}

/**
 * Legacy Chrome Web Store publish API (v1.1). Google plans to turn this off after 2026-10-15.
 * @see https://developer.chrome.com/blog/cws-api-v2
 */
function createChromeWebstoreV1Client(options: {
  extensionId: string
  clientId: string
  clientSecret: string
  refreshToken: string
}): ChromeWebstoreApi {
  const {extensionId, clientId, clientSecret, refreshToken} = options

  const uploadExistingURI = (id: string): string =>
    `${V1_ROOT}/upload/chromewebstore/v1.1/items/${id}`

  const publishURI = (id: string, target: string): string => {
    const url = new URL(`${V1_ROOT}/chromewebstore/v1.1/items/${id}/publish`)
    url.searchParams.set('publishTarget', target)
    return url.href
  }

  const getURI = (id: string, projection: string): string =>
    `${V1_ROOT}/chromewebstore/v1.1/items/${id}?projection=${projection}`

  async function fetchToken(): Promise<string> {
    return sharedFetchToken(clientId, clientSecret, refreshToken)
  }

  function v1Headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'x-goog-api-version': '2'
    }
  }

  function v1UploadHeaders(token: string, fileName: string): Record<string, string> {
    return {
      ...v1Headers(token),
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': fileName
    }
  }

  async function uploadExisting(stream: ReadStream): Promise<ItemResourceLike> {
    const token = await fetchToken()
    const res = await fetch(uploadExistingURI(extensionId), {
      method: 'PUT',
      headers: v1UploadHeaders(token, 'extension.zip'),
      body: stream as unknown as BodyInit,
      duplex: 'half'
    } as RequestInit & {duplex?: string})
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as V1ItemResource | GoogleErrorBody | null
    const body = (parsed || {}) as V1ItemResource

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      return failureItem(String(ge?.error?.code ?? res.status), msg, extensionId)
    }

    const uploadState = body.uploadState || 'SUCCESS'
    const itemError = body.itemError || []
    return {
      kind: 'chromewebstore#item',
      id: body.id || extensionId,
      uploadState,
      itemError
    }
  }

  async function get(projection = 'DRAFT'): Promise<ItemResourceLike> {
    const token = await fetchToken()
    const res = await fetch(getURI(extensionId, projection), {
      method: 'GET',
      headers: v1Headers(token)
    })
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as V1ItemResource | GoogleErrorBody | null

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      throw new Error(msg)
    }

    const body = parsed as V1ItemResource
    return {
      kind: 'chromewebstore#item',
      id: body.id || extensionId,
      uploadState: body.uploadState || 'SUCCESS',
      itemError: body.itemError || [],
      publishState: body.publishState ?? body.uploadState ?? 'n/a',
      status: body.status ?? body.uploadState ?? 'n/a'
    }
  }

  async function publish(target = 'default'): Promise<PublishResponseLike> {
    const token = await fetchToken()
    const res = await fetch(publishURI(extensionId, target), {
      method: 'POST',
      headers: v1Headers(token)
    })
    const text = await res.text()
    const parsed = parseJsonMaybe(text) as
      | PublishResponseLike
      | GoogleErrorBody
      | null

    if (!res.ok) {
      const ge = parsed as GoogleErrorBody
      const msg = ge?.error?.message || text || res.statusText
      throw Object.assign(new Error(msg), {
        response: parsed as PublishResponseLike
      })
    }

    const body = parsed as PublishResponseLike
    return {
      kind: 'chromewebstore#item',
      item_id: body.item_id || extensionId,
      status: body.status || ['OK'],
      statusDetail: body.statusDetail
    }
  }

  return {uploadExisting, get, publish}
}

export default function createChromeWebstoreClient(
  options: ChromeWebstoreClientOptions
): ChromeWebstoreApi {
  const publisherId = options.publisherId?.trim()
  if (publisherId) {
    return createChromeWebstoreV2Client({
      publisherId,
      extensionId: options.extensionId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      refreshToken: options.refreshToken
    })
  }
  return createChromeWebstoreV1Client({
    extensionId: options.extensionId,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    refreshToken: options.refreshToken
  })
}
