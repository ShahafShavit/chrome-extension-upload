'use strict'

/**
 * Local runner for the action entrypoint.
 *
 * GitHub's runner sets inputs like file-path as env vars named INPUT_FILE-PATH
 * (hyphen after INPUT_). @actions/core getInput() looks up that exact key.
 * A .env file often uses INPUT_FILE_PATH (underscore) because shells prefer it;
 * we copy those values to the hyphenated keys so getInput() works.
 *
 * See: https://github.com/actions/toolkit/issues/629
 */

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const root = path.resolve(__dirname, '..')
const envPath = path.join(root, '.env')

/** Underscore form (friendly in .env) -> exact key @actions/core uses */
const INPUT_KEY_BRIDGE = [
  ['INPUT_FILE_PATH', 'INPUT_FILE-PATH'],
  ['INPUT_EXTENSION_ID', 'INPUT_EXTENSION-ID'],
  ['INPUT_PUBLISHER_ID', 'INPUT_PUBLISHER-ID'],
  ['INPUT_CLIENT_ID', 'INPUT_CLIENT-ID'],
  ['INPUT_CLIENT_SECRET', 'INPUT_CLIENT-SECRET'],
  ['INPUT_REFRESH_TOKEN', 'INPUT_REFRESH-TOKEN'],
  ['INPUT_PUBLISH_TARGET', 'INPUT_PUBLISH-TARGET']
]

function bridgeUnderscoreInputsToActionsKeys() {
  for (const [underscoreKey, actionsKey] of INPUT_KEY_BRIDGE) {
    const fromVal = process.env[underscoreKey]
    if (fromVal === undefined || String(fromVal).trim() === '') continue
    const toVal = process.env[actionsKey]
    if (toVal === undefined || String(toVal).trim() === '') {
      process.env[actionsKey] = fromVal
    }
  }
}

function getFilePathInput() {
  return (
    process.env['INPUT_FILE-PATH'] ||
    process.env.INPUT_FILE_PATH ||
    ''
  ).trim()
}

if (!fs.existsSync(envPath)) {
  console.error(
    `Missing .env at:\n  ${envPath}\n\nCopy .env.example to .env and set your INPUT_* variables.`
  )
  process.exit(1)
}

const result = dotenv.config({path: envPath, override: true})
if (result.error) {
  console.error('Could not load .env:', result.error.message)
  process.exit(1)
}

bridgeUnderscoreInputsToActionsKeys()

const filePath = getFilePathInput()
if (!filePath) {
  console.error(
    'file-path input is missing.\n\n' +
      '@actions/core expects env vars with hyphens, e.g. INPUT_FILE-PATH=./extension.zip\n' +
      'You can also use INPUT_FILE_PATH=... in .env; this script copies it automatically.\n' +
      'See .env.example.'
  )
  process.exit(1)
}

require(path.join(root, 'lib', 'main.js'))
