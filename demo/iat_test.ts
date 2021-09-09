import * as chalk from 'chalk'
import * as inquirer from 'inquirer'
import { XFYun } from '../src'
import { buildMic } from './nls_mic'
import * as fs from 'fs'

const BUFFER_SIZE = 1280

const run = (socket: XFYun.IAT.Socket, display: 'string' | 'pinyin') => {
  return new Promise<void>((resolve, reject) => {
    socket.on('close', (event) => {
      console.log(chalk.magenta('connection closed'), event.code, event.reason)
      resolve()
    })

    const parts: { string: string, removed: boolean }[] = []
    socket.on('message', (data) => {
      const { code, result, status, message } = data
      if (code === 0) {
        const { pgs, rg, string, pinyin } = result
        parts.push({ string: display === 'string' ? string : pinyin, removed: false })
        if (pgs === 'rpl') {
          for (let i = rg[0] - 1; i < rg[1]; i++) {
            parts[i].removed = true
          }
        }
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        process.stdout.write(parts.filter(p => p.removed == false).map(p => p.string).join(display === 'string' ? '' : ' '))
        if (status === 2) {
          console.log(chalk.greenBright(' ✓'))
        }
      } else {
        reject(new Error(`${code}: ${message}`))
      }
    })

    socket.on('error', (error) => {
      console.log(chalk.redBright(`[error] Data received from server: ${error.message}`))
      reject(error)
    })
  })
}

export const iat_test = async () => {
  while (true) {
    const { source, ptt, vad_eos, display } = await inquirer.prompt([{
      type: 'confirm',
      name: 'ptt',
      default: true,
      message: 'return punctuation?'
    }, {
      type: 'number',
      name: 'vad_eos',
      default: 5000,
      message: 'exit on silence (milliseconds)?'
    }, {
      type: 'list',
      name: 'display',
      choices: ['string', 'pinyin']
    }, {
      type: 'list',
      name: 'source',
      choices: ['system mic', 'pcm file'],
      message: 'select source:',
    }])

    const xfsocket = new XFYun.IAT.Socket({ ptt: ptt ? 1 : 0, vad_eos, nunum: 0 })

    console.log(chalk.magenta('establishing connection...'))
    await xfsocket.connected()
    const promise = run(xfsocket, display)
    console.log(chalk.magenta('connected'))

    if (source === 'pcm file') {
      const files = fs.readdirSync(`${__dirname}/..`).filter(f => new RegExp(`\.(wav|mp3)$`).test(f))
      if (!files.length) {
        console.log(`no audio files found under ${__dirname}/..`)
        process.exit(0)
      }
      const { file } = await inquirer.prompt([{
        type: 'list',
        name: 'file',
        message: `please select file:`,
        choices: files
      }])
      const stream = fs.createReadStream(file)
      let bytes: Buffer
      while ((bytes = stream.read(BUFFER_SIZE))) {
        xfsocket.send(bytes)
      }
      await promise
    } else {
      const { micInstance, micStream } = buildMic(vad_eos)
      micStream.on('readable', () => {
        let bytes: Buffer
        while ((bytes = micStream.read(BUFFER_SIZE))) {
          xfsocket.send(bytes)
        }
      })
      micInstance.start()
    }

    try {
      await promise
    } catch (error) {
    } finally {
    }

    const { repeat } = await inquirer.prompt([{
      type: 'confirm',
      name: 'repeat',
      message: 'run again?',
      default: true
    }])
    if (!repeat) break
  }
  console.log('\nBye bye...')
}