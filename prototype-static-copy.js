#!/usr/bin/env node

const {exec} = require('node:child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')

const {getOrRequestDetails} = require("./lib/getOrRequestDetails")

if (!fs.existsSync(path.join(process.cwd(), 'app', 'assets'))) {
  console.error('It looks like you\'re not in a prototype, please run this command from inside a prototype')
  process.exit(10)
}

function getAuthArgsForWGet(username, password) {
  const args = []
  if (username || password) {
    args.push('--auth-no-challenge')
  }
  if (username) {
    args.push(`--user="${username}"`)
  }
  if (password) {
    args.push(`--password="${password}"`)
  }
  return args
}

(async () => {
  const {name, url, username, password} = await getOrRequestDetails()

  const args = ['-r', '--timeout=1', '--tries=5', '--wait=0.3', '--waitretry=2', '-e', 'robots=off']
  console.log('Running command: wget', ...args)
  console.log()
  console.log('This can take some time, feel free to make yourself a coffee while you wait.')

  const pathToUse = path.join(os.tmpdir(), 'prototype-static-copy', '' + Date.now())

  await fsp.mkdir(pathToUse, {recursive: true})
  const knownErrors = []

  const interval = setInterval(async () => {
    const successes = await getHtmlFiles(pathToUse)
    console.log('')
    console.log('--- update ---')
    console.log('Successes', successes.length)
    console.log('failures', knownErrors.length)
    console.log('')
  }, 2000)

  getAuthArgsForWGet(username, password).forEach(arg => args.push(arg))

  args.push(url)

  runWGet(args, pathToUse, knownErrors)
    .catch((err) => {
      console.warn('')
      console.warn(err)
      console.warn('')
      console.warn('Continuing anyway')
    })
    .then(async () => {
      clearInterval(interval)
      const publicUrl = `/public/${name}`;
      await prepareAndCopy(url, pathToUse, path.join(process.cwd(), 'app', 'assets', name), publicUrl, username, password)
      // if (knownErrors.length > 0) {
      //   console.warn('')
      //   console.warn('The following URLs failed to be downloaded:')
      //   console.warn('')
      //   knownErrors.forEach(x => console.warn('-', x))
      // }
      console.log('')
      
      try {
        await addLinkToHomepage(publicUrl, url)
        console.log('Finished.  Link added to your prototype homepage.')
      } catch (e) {
        console.log('Finished.')
      }
      
    })
})()

async function getHtmlFiles(dir) {
  let files
  try {
    files = await fsp.readdir(dir)
  } catch (e) {
    console.error('Couldn\'t read dir', dir)
    process.exit(11)
  }
  return (await Promise.all(files.map(async (ref) => {
    const refPath = path.join(dir, ref);
    if ((await fsp.lstat(refPath)).isDirectory()) {
      return await getHtmlFiles(refPath)
    }
    const parts = ref.split('.')
    if (parts.length === 1 || parts[parts.length - 1] === 'html') {
      return refPath
    }
  }))).flat().filter(x => x)
}

async function prepareAndCopy(url, tmpDir, finalDir, publicUrl, username, password) {
  const downloadDir = path.join(tmpDir, (await fsp.readdir(tmpDir))[0])
  const files = await getHtmlFiles(downloadDir)
  const additionalDownloads = []
  while (files.length > 0) {
    const fullPath = files.pop()
    let finalFilePath = fullPath
    if (!fullPath.endsWith('.html')) {
      const tmpPath = fullPath + '.tmp'
      await fsp.mkdir(tmpPath)
      const tmpFullPath = path.join(tmpPath, 'index.html')
      await fsp.rename(fullPath, tmpFullPath)
      await fsp.rename(tmpPath, fullPath)
      finalFilePath = path.join(fullPath, 'index.html')
    }
    const originalFileContents = await fsp.readFile(finalFilePath, 'utf8')
    const updatedFileContents = originalFileContents.replaceAll(/(href|src|action)(="?)\//g, `$1$2${publicUrl}/`)
    await fsp.writeFile(finalFilePath, updatedFileContents)

    const matches = originalFileContents.match(/(?:href|src|action)="(\/[^"]+")/g) || []
    const preparedMatches = matches
      .map(x => x.split('"')[1].split('?')[0])
      .filter(x => x.lastIndexOf('.') > x.lastIndexOf('/'))

    preparedMatches.forEach(preparedMatch => {
      if (!additionalDownloads.includes(preparedMatch)) {
        additionalDownloads.push(preparedMatch)
      }
    })
  }

  const remainingToDownload = additionalDownloads
    .filter(x => !fs.existsSync(path.join(tmpDir, x)))
    .map(x => (url + x).replaceAll(/\/+/g, '/')
      .replace(':/', '://'))


  while (remainingToDownload.length > 0) {
    const url = remainingToDownload.pop()
    await runWGet(['--force-directories', ...getAuthArgsForWGet(username, password), url], tmpDir)
      .catch(err => process.env.LOG_EVERYTHING === 'true' && console.error(err))
  }

  await fsp.rename(downloadDir, finalDir)
}

function runWGet(args, pathToUse, knownErrorUrls = []) {
  return new Promise((resolve, reject) => {
    const errs = []
    const wget = exec(`wget ${args.join(' ')}`, {
      cwd: pathToUse
    })

    if (process.env.LOG_EVERYTHING === 'true') {
      wget.stdout.on('data', x => console.log(x.toString()))
    }
    wget.stderr.on('data', x => {
      const content = x.toString()
      errs.push(content)
      if (errs.length > 5) {
        errs.shift()
      }
      const match = (content.match(/(https?:\/\/\S+)/) || [])[0]
      if (match && !knownErrorUrls.includes(match)) {
        knownErrorUrls.push(match)
      }
    })
    
    wget.on('close', async (code) => {
      if (code === 0 || code === 3) {
        console.log('successfully ran command', `[wget ${args.join(' ')}] in dir [${pathToUse}]`)
        resolve()
      } else {
        if (process.env.LOG_EVERYTHING === 'true') {
          console.error(errs.join('\n'))
        }
        reject(new Error(`non-zero exit status [${code}] for command [wget ${args.join(' ')}] in dir [${pathToUse}]`))
      }
    })
  })
}

async function addLinkToHomepage(publicUrl, url) {
  const indexFilePath = path.join(process.cwd(), 'app', 'views', 'index.html')
  const indexFileContents = await fsp.readFile(indexFilePath, 'utf8')
  const newContents = indexFileContents.replace(/({%\s*endblock\s*%})/, `<p class="govuk-body"><a href="${publicUrl}">Downloaded copy of ${url}.</a></p>$1`)
  await fsp.writeFile(indexFilePath, newContents)
}
