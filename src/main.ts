import * as core from '@actions/core'
import fs from 'fs'
import glob from 'glob'
import createChromeWebstoreClient from './chrome-webstore-client'
import {
  explainChromeWebstoreStatus,
  formatRevisionStatusLogLines
} from './chrome-webstore-status-docs'

type WebStoreClient = ReturnType<typeof createChromeWebstoreClient>

/** Same signal as GitHub’s step debug logging (`ACTIONS_STEP_DEBUG`). */
function debugJson(payload: unknown): void {
  const flag = String(process.env.ACTIONS_STEP_DEBUG || '').toLowerCase()
  if (flag !== 'true' && flag !== '1') {
    return
  }
  core.debug(JSON.stringify(payload))
}

async function uploadFile(
  webStore: WebStoreClient,
  filePath: string,
  publishFlg: string,
  publishTarget: string,
  usingWebstoreApiV2: boolean
): Promise<void> {
  const myZipFile = fs.createReadStream(filePath)

  try {
    const uploadRes = await webStore.uploadExisting(myZipFile)
    debugJson(uploadRes)

    if (uploadRes.uploadState) {
      core.info(
        `Package upload state: ${uploadRes.uploadState} — ${explainChromeWebstoreStatus(
          uploadRes.uploadState
        )}`
      )
    }

    if (
      uploadRes.uploadState &&
      (uploadRes.uploadState === 'FAILURE' ||
        uploadRes.uploadState === 'NOT_FOUND')
    ) {
      uploadRes.itemError.forEach((itemError: any) => {
        core.error(Error(`${itemError.error_detail} (${itemError.error_code})`))
      })
      core.setFailed(
        'Upload failed. Fix the errors above, or upload the package manually in the Chrome Web Store Developer Dashboard.'
      )
      return
    }

    // Probe the extension's current publish state after successful upload
    try {
      const itemInfo = await webStore.get()
      debugJson(itemInfo)
      // API v2 fetchStatus: publishState = published revision; status = submitted revision / last upload hint.
      const lines = formatRevisionStatusLogLines({
        publishedLabel: 'Live listing (publishedItemRevisionStatus.state)',
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

    if (publishFlg === 'true') {
      if (usingWebstoreApiV2 && publishTarget === 'trustedTesters') {
        core.warning(
          'With API v2, visibility (including trusted testers) is configured in the Developer Dashboard — not via this action. The publish step still submits your draft for review using the visibility you already set there.'
        )
      }
      try {
        const publishRes = await webStore.publish(publishTarget)
        debugJson(publishRes)

        // Check for non-OK status in the response
        if (publishRes.status && !publishRes.status.includes('OK')) {
          core.error(
            `Publish failed with status: ${publishRes.status.join(', ')}`
          )
          for (const code of publishRes.status) {
            core.error(`  ${code}: ${explainChromeWebstoreStatus(code)}`)
          }
          if (publishRes.statusDetail) {
            core.error(`Reason: ${publishRes.statusDetail}`)
            for (const d of publishRes.statusDetail) {
              core.error(`  ${d}: ${explainChromeWebstoreStatus(d)}`)
            }
          }
          core.setFailed(
            'Publish step did not succeed. See the error output above, or finish publishing from the Developer Dashboard.'
          )
          return
        }
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
            `Could not refresh extension state after publish: ${(refreshErr as Error).message}`
          )
        }
      } catch (e) {
        core.error(e instanceof Error ? e : String(e))
        // Log additional details if available
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
    }
  } catch (e) {
    core.error(e instanceof Error ? e : String(e))
    core.setFailed(
      'Something went wrong during upload. Check the logs above, or upload the package manually in the Developer Dashboard.'
    )
  }
}

async function run(): Promise<void> {
  try {
    const filePath = core.getInput('file-path', {required: true})
    const publisherId = core.getInput('publisher-id').trim()
    const extensionId = core.getInput('extension-id', {required: true})
    const clientId = core.getInput('client-id', {required: true})
    const clientSecret = core.getInput('client-secret', {required: true})
    const refreshToken = core.getInput('refresh-token', {required: true})
    const globFlg = core.getInput('glob') as 'true' | 'false'
    const publishFlg = core.getInput('publish') as 'true' | 'false'
    const publishTarget = core.getInput('publish-target')

    const usingWebstoreApiV2 = publisherId.length > 0
    if (!usingWebstoreApiV2) {
      core.warning(
        'You did not set `publisher-id`, so this run uses the legacy Chrome Web Store API (v1.1). That still works today, but Google plans to turn it off after October 15, 2026. When you are ready, add `publisher-id` from Developer Dashboard → Account to switch to API v2. Guide: https://developer.chrome.com/docs/webstore/using-api#obtain_your_publisher_id'
      )
    }

    const webStore = createChromeWebstoreClient({
      ...(usingWebstoreApiV2 ? {publisherId} : {}),
      extensionId,
      clientId,
      clientSecret,
      refreshToken
    })

    core.info(
      usingWebstoreApiV2
        ? 'Chrome Web Store API v2 (publisher-id set).'
        : 'Chrome Web Store API v1.1 (legacy — add publisher-id when you can).'
    )

    if (globFlg === 'true') {
      const files = glob.sync(filePath)
      if (files.length > 0) {
        await uploadFile(
          webStore,
          files[0],
          publishFlg,
          publishTarget,
          usingWebstoreApiV2
        )
      } else {
        core.setFailed(
          `No file matched the glob pattern "${filePath}". Check \`file-path\` and try again.`
        )
      }
    } else {
      await uploadFile(
        webStore,
        filePath,
        publishFlg,
        publishTarget,
        usingWebstoreApiV2
      )
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

run()
