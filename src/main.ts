import * as core from '@actions/core'
import fs from 'fs'
import glob from 'glob'
import path from 'path'
import createChromeWebstoreClient from './chrome-webstore-client'
import {
	explainChromeWebstoreStatus,
	formatRevisionStatusLogLines
} from './chrome-webstore-status-docs'

type WebStoreClient = ReturnType<typeof createChromeWebstoreClient>

/** Outcome returned from upload/publish for job summary and exit bookkeeping. */
type UploadOutcome = {
	ok: boolean
	resolvedPath: string
	lastUploadState?: string
	publishAttempted: boolean
	publishSucceeded?: boolean
}

/** Same signal as GitHub’s step debug logging (`ACTIONS_STEP_DEBUG`). */
function debugJson(payload: unknown): void {
	const flag = String(process.env.ACTIONS_STEP_DEBUG || '').toLowerCase()
	if (flag !== 'true' && flag !== '1') {
		return
	}
	core.debug(JSON.stringify(payload))
}

/** Writes the job summary (GitHub Actions UI). No-op locally unless `GITHUB_STEP_SUMMARY` is set. */
async function writeRunSummary(context: {
	ok: boolean
	extensionId: string
	packageDisplay: string
	apiLabel: string
	publishRequested: boolean
	lastUploadState?: string
	publishAttempted: boolean
	publishSucceeded?: boolean
}): Promise<void> {
	if (!process.env.GITHUB_STEP_SUMMARY) {
		return
	}

	const publishLine = !context.publishRequested
		? 'Not requested'
		: !context.publishAttempted
			? context.ok
				? '—'
				: 'Not run (failed earlier)'
			: context.publishSucceeded
				? 'Completed'
				: 'Failed'

	const rows: Parameters<typeof core.summary.addTable>[0] = [
		[
			{data: 'Key', header: true},
			{data: 'Value', header: true}
		],
		['Result', context.ok ? 'Success' : 'Failed'],
		['Extension ID', context.extensionId],
		['Package', context.packageDisplay],
		['API', context.apiLabel],
		['Publish', publishLine]
	]
	if (context.lastUploadState) {
		rows.push(['Last upload state', context.lastUploadState])
	}

	try {
		await core.summary
			.addHeading('Chrome Web Store upload', 2)
			.addTable(rows)
			.addRaw(
				'\n\n_Logs use collapsible groups: Inputs and client, Resolve package, Upload package, Extension state after upload, Publish._',
				true
			)
			.write()
	} catch (e) {
		core.debug(
			`Job summary skipped or failed: ${
				e instanceof Error ? e.message : String(e)
			}`
		)
	}
}

async function uploadFile(
	webStore: WebStoreClient,
	filePath: string,
	publishFlg: string,
	publishTarget: string,
	usingWebstoreApiV2: boolean
): Promise<UploadOutcome> {
	const outcome: UploadOutcome = {
		ok: false,
		resolvedPath: filePath,
		publishAttempted: false
	}

	core.startGroup('Upload package')
	try {
		if (!fs.existsSync(filePath)) {
			core.setFailed(`Package file not found: ${filePath}`)
			return outcome
		}

		const myZipFile = fs.createReadStream(filePath)
		const uploadRes = await webStore.uploadExisting(myZipFile)
		debugJson(uploadRes)

		if (uploadRes.uploadState) {
			outcome.lastUploadState = uploadRes.uploadState
			core.info(
				`Package upload state: ${
					uploadRes.uploadState
				} — ${explainChromeWebstoreStatus(uploadRes.uploadState)}`
			)
		}

		if (
			uploadRes.uploadState &&
			(uploadRes.uploadState === 'FAILURE' ||
				uploadRes.uploadState === 'NOT_FOUND')
		) {
			uploadRes.itemError.forEach((itemError: any) => {
				core.error(
					Error(`${itemError.error_detail} (${itemError.error_code})`)
				)
			})
			core.setFailed(
				'Upload failed. Fix the errors above, or upload the package manually in the Chrome Web Store Developer Dashboard.'
			)
			return outcome
		}
	} catch (e) {
		core.error(e instanceof Error ? e : String(e))
		core.setFailed(
			'Something went wrong during upload. Check the logs above, or upload the package manually in the Developer Dashboard.'
		)
		return outcome
	} finally {
		core.endGroup()
	}

	core.startGroup('Extension state after upload')
	try {
		try {
			const itemInfo = await webStore.get()
			debugJson(itemInfo)
			const lines = formatRevisionStatusLogLines({
				publishedLabel:
					'Live listing (publishedItemRevisionStatus.state)',
				publishedRaw: itemInfo.publishState,
				submittedLabel:
					'Submitted / in-flight revision (submittedItemRevisionStatus or lastAsyncUploadState)',
				submittedRaw: itemInfo.status
			})
			for (const line of lines) {
				core.info(line)
			}
			if (publishFlg === 'true') {
				core.info(
					'(Snapshot after upload, before the publish step in this run — submitted line often changes after publish.)'
				)
			}
		} catch (getError) {
			core.warning(
				`Could not retrieve extension state: ${(getError as Error).message}`
			)
		}
	} finally {
		core.endGroup()
	}

	if (publishFlg === 'true') {
		outcome.publishAttempted = true
		if (usingWebstoreApiV2 && publishTarget === 'trustedTesters') {
			core.warning(
				'With API v2, visibility (including trusted testers) is configured in the Developer Dashboard — not via this action. The publish step still submits your draft for review using the visibility you already set there.'
			)
		}
		core.startGroup('Publish to Chrome Web Store')
		try {
			try {
				const publishRes = await webStore.publish(publishTarget)
				debugJson(publishRes)

				if (publishRes.status && !publishRes.status.includes('OK')) {
					core.error(
						`Publish failed with status: ${publishRes.status.join(', ')}`
					)
					for (const code of publishRes.status) {
						core.error(
							`  ${code}: ${explainChromeWebstoreStatus(code)}`
						)
					}
					if (publishRes.statusDetail) {
						core.error(`Reason: ${publishRes.statusDetail}`)
						for (const d of publishRes.statusDetail) {
							core.error(
								`  ${d}: ${explainChromeWebstoreStatus(d)}`
							)
						}
					}
					core.setFailed(
						'Publish step did not succeed. See the error output above, or finish publishing from the Developer Dashboard.'
					)
					return outcome
				}
				outcome.publishSucceeded = true
				outcome.ok = true
				core.info('Publish step completed successfully.')
				const detailParts = publishRes.statusDetail?.length
					? publishRes.statusDetail
					: publishRes.status
				for (const part of detailParts) {
					core.info(`  ${part}: ${explainChromeWebstoreStatus(part)}`)
				}
				core.info(
					'Publish API returned OK; statusDetail (e.g. PENDING_REVIEW) is the new submission state from that response, not a contradiction with an earlier fetchStatus snapshot.'
				)
				try {
					const afterPublish = await webStore.get()
					debugJson(afterPublish)
					core.info('Fresh fetchStatus after publish:')
					const afterLines = formatRevisionStatusLogLines({
						publishedLabel:
							'Live listing (publishedItemRevisionStatus.state)',
						publishedRaw: afterPublish.publishState,
						submittedLabel:
							'Submitted / in-flight revision (submittedItemRevisionStatus or lastAsyncUploadState)',
						submittedRaw: afterPublish.status
					})
					for (const line of afterLines) {
						core.info(line)
					}
				} catch (refreshErr) {
					core.warning(
						`Could not refresh extension state after publish: ${
							(refreshErr as Error).message
						}`
					)
				}
			} catch (e) {
				core.error(e instanceof Error ? e : String(e))
				const err = e as {
					response?: {statusDetail?: string[]; status?: string[]}
				}
				if (err.response?.statusDetail) {
					core.error(`Reason: ${err.response.statusDetail}`)
				}
				if (err.response?.status) {
					core.error(`Status: ${err.response.status}`)
				}
				core.setFailed(
					'Publish failed. Check the messages above, or publish from the Chrome Web Store Developer Dashboard.'
				)
			}
		} finally {
			core.endGroup()
		}
	} else {
		outcome.ok = true
	}

	return outcome
}

async function run(): Promise<void> {
	let extensionId = ''
	let packageDisplay = ''
	let apiLabel = ''
	let publishRequested = false

	try {
		core.startGroup('Inputs and Chrome Web Store client')
		let filePath: string
		let publisherId: string
		let usingWebstoreApiV2: boolean
		let globFlg: 'true' | 'false'
		let publishFlg: 'true' | 'false'
		let publishTarget: string
		let webStore: WebStoreClient

		try {
			filePath = core.getInput('file-path', {required: true})
			publisherId = core.getInput('publisher-id').trim()
			extensionId = core.getInput('extension-id', {required: true})
			const clientId = core.getInput('client-id', {required: true})
			const clientSecret = core.getInput('client-secret', {
				required: true
			})
			const refreshToken = core.getInput('refresh-token', {
				required: true
			})
			globFlg = core.getInput('glob') as 'true' | 'false'
			publishFlg = core.getInput('publish') as 'true' | 'false'
			publishTarget = core.getInput('publish-target')

			publishRequested = publishFlg === 'true'

			usingWebstoreApiV2 = publisherId.length > 0
			if (!usingWebstoreApiV2) {
				core.warning(
					'You did not set `publisher-id`, so this run uses the legacy Chrome Web Store API (v1.1). That still works today, but Google plans to turn it off after October 15, 2026. When you are ready, add `publisher-id` from Developer Dashboard → Account to switch to API v2. Guide: https://developer.chrome.com/docs/webstore/using-api#obtain_your_publisher_id'
				)
			}

			apiLabel = usingWebstoreApiV2
				? 'Chrome Web Store API v2'
				: 'Chrome Web Store API v1.1 (legacy)'

			webStore = createChromeWebstoreClient({
				...(usingWebstoreApiV2 ? {publisherId} : {}),
				extensionId,
				clientId,
				clientSecret,
				refreshToken
			})

			core.info(apiLabel + '.')
		} finally {
			core.endGroup()
		}

		core.startGroup('Resolve package file')
		let resolvedPath: string
		try {
			if (globFlg === 'true') {
				const files = glob.sync(filePath)
				if (files.length === 0) {
					core.setFailed(
						`No file matched the glob pattern "${filePath}". Check \`file-path\` and try again.`
					)
					await writeRunSummary({
						ok: false,
						extensionId,
						packageDisplay: filePath,
						apiLabel,
						publishRequested,
						publishAttempted: false
					})
					return
				}
				resolvedPath = files[0]
				core.info(`Glob matched: ${resolvedPath}`)
			} else {
				resolvedPath = filePath
				core.info(`Using package: ${resolvedPath}`)
			}
			packageDisplay = path.basename(resolvedPath)
		} finally {
			core.endGroup()
		}

		const outcome = await uploadFile(
			webStore,
			resolvedPath,
			publishFlg,
			publishTarget,
			usingWebstoreApiV2
		)

		await writeRunSummary({
			ok: outcome.ok,
			extensionId,
			packageDisplay:
				packageDisplay || path.basename(outcome.resolvedPath),
			apiLabel,
			publishRequested,
			lastUploadState: outcome.lastUploadState,
			publishAttempted: outcome.publishAttempted,
			publishSucceeded: outcome.publishSucceeded
		})
	} catch (error) {
		core.setFailed((error as Error).message)
		await writeRunSummary({
			ok: false,
			extensionId,
			packageDisplay: packageDisplay || '—',
			apiLabel: apiLabel || '—',
			publishRequested,
			publishAttempted: false
		})
	}
}

run()
