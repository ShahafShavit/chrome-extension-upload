/**
 * Human-readable meanings for Chrome Web Store API states.
 * Sources: ItemState, UploadState (v2), and legacy v1.1 upload / publish codes.
 *
 * @see https://developers.chrome.com/docs/webstore/api/reference/rest/v2/ItemState
 * @see https://developers.chrome.com/docs/webstore/api/reference/rest/v2/UploadState
 */

export const DOCS_ITEM_STATE =
	'https://developers.chrome.com/docs/webstore/api/reference/rest/v2/ItemState'
export const DOCS_UPLOAD_STATE =
	'https://developers.chrome.com/docs/webstore/api/reference/rest/v2/UploadState'

/** `google.type` ItemState (v2 fetchStatus / publish response). */
const V2_ITEM_STATE: Record<string, string> = {
	ITEM_STATE_UNSPECIFIED:
		'Unused default enum value from the API (treat as “no specific state”).',
	PENDING_REVIEW:
		'A package is waiting in Google’s review queue (policy / security checks).',
	STAGED: 'Review passed; the build is staged (e.g. staged publishing or waiting for you to publish from the dashboard).',
	PUBLISHED:
		'A version is live for users according to your visibility (typically the public store listing).',
	PUBLISHED_TO_TESTERS:
		'A version is live only for trusted testers (per Developer Dashboard → Distribution).',
	REJECTED:
		'Review did not pass. Open the Developer Dashboard for the rejection reason, fix the issue, then upload and submit again.',
	CANCELLED:
		'No active submission at this moment (e.g. previous one finished or was cancelled). The live listing can still be PUBLISHED. If you run publish next, this value usually updates on a later fetchStatus.'
}

/** UploadState (v2 media upload + fetchStatus lastAsyncUploadState). */
const V2_UPLOAD_STATE: Record<string, string> = {
	UPLOAD_STATE_UNSPECIFIED:
		'Default / unspecified upload state from the API.',
	SUCCEEDED: 'The .zip was uploaded and processed successfully.',
	IN_PROGRESS:
		'The store is still processing the package; poll fetchStatus or wait before uploading again.',
	FAILED: 'The package failed validation or processing; see API error details or the dashboard.',
	NOT_FOUND:
		'No recent upload state on record (common for lastAsyncUploadState when nothing ran in the last 24 hours).'
}

/**
 * Normalized package upload outcome used by this action after v2 (maps SUCCEEDED → SUCCESS, etc.).
 * Legacy v1.1 uses the same string values on the wire.
 */
const NORMALIZED_PACKAGE_UPLOAD: Record<string, string> = {
	SUCCESS:
		'Package accepted: the .zip is on the store side as a draft (or updated draft). Bump manifest version when required.',
	FAILURE:
		'Package rejected: invalid manifest, duplicate version, bad zip layout, or other validation errors — see itemError[].',
	IN_PROGRESS:
		'Upload still processing asynchronously; the API may return this briefly before SUCCEEDED/FAILED.',
	NOT_FOUND:
		'No upload in the expected state (legacy API); often paired with diagnostic itemError entries.'
}

/** v1.1 items.publish response status[] entries (chromewebstore#item). */
const V1_PUBLISH_STATUS: Record<string, string> = {
	OK: 'The publish request was accepted by the API (the item may still be pending review before it goes live).',
	NOT_AUTHORIZED:
		'OAuth token or client is not allowed to publish this item.',
	INVALID_DEVELOPER:
		'Developer account or client configuration is invalid for this operation.',
	DEVELOPER_NO_OWNERSHIP: 'The authorized account does not own this item.',
	DEVELOPER_SUSPENDED: 'The developer account is suspended.',
	ITEM_NOT_FOUND: 'No store item matches the extension ID.',
	ITEM_PENDING_REVIEW:
		'The item is in (or re-entered) review; wait for Google’s decision.',
	ITEM_TAKEN_DOWN:
		'The item was taken down; resolve policy issues in the dashboard.',
	PUBLISHER_SUSPENDED: 'The publisher account is suspended.'
}

const SPECIAL_SENTINELS: Record<string, string> = {
	'n/a': 'Not applicable or not returned (placeholder from this action).',
	not_published: 'There is no live published revision yet for this item.',
	error: 'Status could not be read (an earlier API error was mapped here).'
}

/**
 * Single-line explanation for any raw status string we might log (ItemState, UploadState, v1 publish code, or normalized upload).
 */
export function explainChromeWebstoreStatus(raw: string | undefined): string {
	const v = (raw ?? '').trim()
	if (!v) {
		return 'No value (empty).'
	}
	const special = SPECIAL_SENTINELS[v]
	if (special !== undefined) {
		return special
	}

	const item = V2_ITEM_STATE[v]
	if (item !== undefined) return item
	const upload = V2_UPLOAD_STATE[v]
	if (upload !== undefined) return upload
	const pkg = NORMALIZED_PACKAGE_UPLOAD[v]
	if (pkg !== undefined) return pkg
	const pub = V1_PUBLISH_STATUS[v]
	if (pub !== undefined) return pub

	return `No built-in description for “${v}”. See ${DOCS_ITEM_STATE} and ${DOCS_UPLOAD_STATE}, or v1 publish status codes in the legacy Items API.`
}

/** Multi-line block for workflow logs (published vs submitted revision). */
export function formatRevisionStatusLogLines(args: {
	publishedLabel: string
	publishedRaw: string | undefined
	submittedLabel: string
	submittedRaw: string | undefined
}): string[] {
	const lines: string[] = []
	lines.push(`${args.publishedLabel}: ${args.publishedRaw ?? 'n/a'}`)
	lines.push(`  → ${explainChromeWebstoreStatus(args.publishedRaw)}`)
	lines.push(`${args.submittedLabel}: ${args.submittedRaw ?? 'n/a'}`)
	lines.push(`  → ${explainChromeWebstoreStatus(args.submittedRaw)}`)
	return lines
}
