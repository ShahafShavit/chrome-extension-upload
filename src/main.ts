import * as core from '@actions/core'
import chromeWebstoreUpload from 'chrome-webstore-upload'
import fs from 'fs'
import glob from 'glob'

async function uploadFile(
  webStore: any,
  filePath: string,
  publishFlg: string,
  publishTarget: string
): Promise<void> {
  const myZipFile = fs.createReadStream(filePath)

  try {
    const uploadRes = await webStore.uploadExisting(myZipFile)
    console.log(uploadRes)
    core.debug(uploadRes)

    if (
      uploadRes.uploadState &&
      (uploadRes.uploadState === 'FAILURE' ||
        uploadRes.uploadState === 'NOT_FOUND')
    ) {
      uploadRes.itemError.forEach((itemError: any) => {
        core.error(Error(`${itemError.error_detail} (${itemError.error_code})`))
      })
      core.setFailed(
        'Upload Error - You will need to go to the Chrome Web Store Developer Dashboard and upload it manually.'
      )
      return
    }

    // Probe the extension's current publish state after successful upload
    try {
      const itemInfo = await webStore.get()
      console.log('Extension info:', itemInfo)
      core.info(`Extension publish state: ${itemInfo.publishState}`)
      core.info(`Extension status: ${itemInfo.status}`)
    } catch (getError) {
      core.warning(`Could not retrieve extension state: ${getError.message}`)
    }

    if (publishFlg === 'true') {
      try {
        const publishRes = await webStore.publish(publishTarget)
        console.log(publishRes)
        core.debug(publishRes)

        // Check for non-OK status in the response
        if (publishRes.status && !publishRes.status.includes('OK')) {
          core.error(
            `Publish failed with status: ${publishRes.status.join(', ')}`
          )
          if (publishRes.statusDetail) {
            core.error(`Reason: ${publishRes.statusDetail}`)
          }
          core.setFailed('Publish Error: Please check the details above')
          return
        }
        core.info('Extension published successfully')
      } catch (e) {
        console.log(e)
        core.error(e)
        // Log additional details if available
        if (e.response?.statusDetail) {
          core.error(`Reason: ${e.response.statusDetail}`)
        }
        if (e.response?.status) {
          core.error(`Status: ${e.response.status}`)
        }
        core.setFailed(
          'Publish Error - You will need to access the Chrome Web Store Developer Dashboard and publish manually.'
        )
      }
    }
  } catch (e) {
    console.log(e)
    core.error(e)
    core.setFailed(
      'Upload Error - You will need to go to the Chrome Web Store Developer Dashboard and upload it manually.'
    )
  }
}

async function run(): Promise<void> {
  try {
    const filePath = core.getInput('file-path', {required: true})
    const extensionId = core.getInput('extension-id', {required: true})
    const clientId = core.getInput('client-id', {required: true})
    const clientSecret = core.getInput('client-secret', {required: true})
    const refreshToken = core.getInput('refresh-token', {required: true})
    const globFlg = core.getInput('glob') as 'true' | 'false'
    const publishFlg = core.getInput('publish') as 'true' | 'false'
    const publishTarget = core.getInput('publish-target')

    const webStore = chromeWebstoreUpload({
      extensionId,
      clientId,
      clientSecret,
      refreshToken
    })

    if (globFlg === 'true') {
      const files = glob.sync(filePath)
      if (files.length > 0) {
        await uploadFile(webStore, files[0], publishFlg, publishTarget)
      } else {
        core.setFailed('No files to match.')
      }
    } else {
      await uploadFile(webStore, filePath, publishFlg, publishTarget)
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

run()
