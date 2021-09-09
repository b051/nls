import { tone2num } from '@wohui/pinyin'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import { WriteStream } from 'fs'
import { Readable } from 'stream'
import * as request from 'superagent'
import { URL } from 'url'
import * as WebSocket from 'ws'
import { Env, Gender, Language, XfYunApp } from '../env'


const BUFFER_SIZE = 1280

let env: Env['xfyun']

export namespace XFYun {
  
  export function init(_env: Env['xfyun']) {
    env = _env
  }

  export enum Frame {
    first = 0,
    continue = 1,
    last = 2
  }

  export class Service {
    readonly app: XfYunApp
    constructor(readonly url: URL, key: keyof Env['xfyun']) {
      this.app = env[key]
    }

    private authorizationGet(date: string) {
      const signature_origin = `host: ${this.url.host}\ndate: ${date}\nGET ${this.url.pathname} HTTP/1.1`
      const signature = crypto.createHmac('sha256', this.app.api_secret).update(signature_origin).digest('base64')
      const authorization_origin = `api_key="${this.app.api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
      return Buffer.from(authorization_origin).toString('base64')
    }

    private authorizationPost(date: string, digest: string) {
      const signature_origin = `host: ${this.url.host}\ndate: ${date}\nPOST ${this.url.pathname} HTTP/1.1\ndigest: ${digest}`
      const signature = crypto.createHmac('sha256', this.app.api_secret).update(signature_origin).digest('base64')
      const authorization_origin = `api_key="${this.app.api_key}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${signature}"`
      return authorization_origin
    }
    
    createSocket() {
      const date = new Date().toUTCString()
      const authorization = this.authorizationGet(date)
      return new WebSocket(`${this.url}?authorization=${authorization}&date=${encodeURI(date)}&host=${this.url.host}`)
    }

    async createHttp(body: object) {
      const date = new Date().toUTCString()
      Object.assign(body, { common: { app_id: this.app.app_id } })
      const digest = 'SHA-256=' + crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64')
      const authorization = this.authorizationPost(date, digest)
      return await request.post(this.url.href)
      .set('Date', date)
      .set('Digest', digest)
      .set('Authorization', authorization)
      .send(body)
      .ok(() => true)
    }
  }

  abstract class SocketWrap<T> extends EventEmitter {
    protected status = Frame.first
    protected socket: WebSocket
    protected outgoingMessageType: T

    constructor(protected readonly service: Service) {
      super()

      this.socket = service.createSocket()
      this.socket.onopen = (event) => {
        this.emit('open', event)
      }
      this.socket.onclose = (event) => {
        this.emit('close', event)
      }
      this.socket.onerror = (event) => {
        this.emit('error', event.error)
      }
      this.socket.onmessage = (event) => {
        const parsed = JSON.parse(event.data.toString())
        const response = this.translateMessage(parsed)
        this.emit('message', response)
        if (parsed?.data?.status === 2) {
          // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
          console.log('[completed]', parsed.sid)
          // xf will close this connect with a delay (iat immediately, ise aroudn 5 seconds)
          // but we here initial close on our end
          this.socket.close(1000)
        }
      }
    }

    async connected() {
      await new Promise<void>((resolve) => {
        this.on('open', async() => {
          this.emit('connected')
          resolve()
        })
      })
    }

    read(stream: Readable) {
      stream.on('readable', () => {
        let bytes: Buffer
        while ((bytes = stream.read(BUFFER_SIZE))) {
          this.send(bytes)
          if (bytes.length < BUFFER_SIZE) {
            this.end()
          }
        }
      })
    }

    proxy(socket: WebSocket, stringify: (message: T) => string) {
      socket.on('message', (raw_data) => {
        try {
          const data = JSON.parse(raw_data.toString())
          if (data.audio) {
            this.send(data.audio)
          }
          if (data.status == 2 || data.finished) {
            this.end()
          }
        } catch (error) {
          socket.close(4400, error.message)
        }
      })
      this.on('message', (message: T) => {
        if (message) {
          socket.send(stringify(message))
        }
      })
    }

    protected abstract translateMessage(parsed: any): any

    abstract send(audio: Buffer|string): void

    end() {
      this.status = Frame.last
      this.send("")
    }

  }

  export namespace IAT {
    export type Options = { ptt: 0|1, vad_eos: number, nunum: 0|1 }

    type IncomingMessage = {
      code: number
      message: string
      data: {
        status: number,
        result: {
          pgs: string,
          rg?: number[],
          ws: { cw: { w: string }[] }[]
        }
      }
    }

    export type OutgoingMessage = {
      code: number
      status: number
      message: string
      result: {
        pgs: 'apd' | 'rpl'
        rg?: [number, number]
        string: string
      }
    }

    const SERVICE = new Service(new URL('wss://iat-api.xfyun.cn/v2/iat'), 'iat')

    // IATSocket
    export class Socket extends SocketWrap<OutgoingMessage> {
      constructor(private readonly options: Options) {
        super(SERVICE)
      }

      translateMessage(parsed: IncomingMessage): OutgoingMessage {
        const { code, data, message } = parsed
        if (!data) {
          return
        }
        const { result: xfresult, status } = data
        const string = xfresult.ws.map(ws => ws.cw.map(cw => cw.w).join('')).join('')
        const result: any = {
          pgs: xfresult.pgs,
          string,
        }
        if (xfresult.rg) {
          result.rg = xfresult.rg
        }
        return { code, status, result, message }
      }

      send(audio: Buffer|string) {
        let frame: object
        const data = {
          "status": this.status,
          "format": "audio/L16;rate=16000",
          "audio": audio.toString('base64'),
          "encoding": "raw"
        }
        switch (this.status) {
        case Frame.first:
          frame = {
            common: {
              app_id: this.service.app.app_id
            },
            business: {
              ...this.options,
              language: "zh_cn",
              domain: "iat",
              accent: "mandarin",
              dwa: "wpgs"
            },
            data
          }
          this.status = Frame.continue
          break;
        case Frame.continue:
        case Frame.last:
          frame = {
            data
          }
          break
        }
        this.socket.send(JSON.stringify(frame))
      }
    }
  }

  export namespace TTS {
    const SERVICE = new XFYun.Service(new URL('wss://tts-api.xfyun.cn/v2/tts'), 'tts')

    type TTSOptions = { vcn?: string, gender: Gender, speed: number, ext: 'wav'|'mp3', volume: number };

    export const xfyun_tts = async (text: string, stream: WriteStream, options: TTSOptions) => {
      return await new Promise<void>((resolve, reject) => {
        const socket = SERVICE.createSocket()
        socket.onopen = function() {
          socket.send(JSON.stringify({
            common: {
              app_id: SERVICE.app.app_id
            },
            business: {
              ent: 'intp65',
              aue: options.ext === 'wav' ? 'raw' : 'lame',
              auf: 'audio/L16;rate=16000',
              vcn: options.vcn || (options.gender === 'female' ? 'xiaoyan' : 'aisjiuxu'),
              speed: options.speed * 10,
              volume: options.volume,
              // pitch: 50,
              // bgs: 0,
              tte: 'UTF8'
            },
            data: {
              text: Buffer.from(text).toString('base64'),
              status: 2
            }
          }))
        }
        socket.onmessage = function(event) {
          const data = JSON.parse(event.data.toString())
          if (data.code === 0) {
            const buffer = Buffer.from(data.data.audio, 'base64')
            if (data.data.status === 2) {
              stream.write(buffer, () => resolve())
            } else {
              stream.write(buffer)
            }
          } else {
            reject(new Error(`tts("${text}") => ${data.message} (${data.code})`))
          }
        }

        socket.onerror = function(error) {
          reject(error)
        }
      })
    }
  }

  export namespace OTS {
    const SERVICE = new XFYun.Service(new URL('https://ntrans.xfyun.cn/v2/ots'), 'ots')

    interface OTPOptions {
      from: Language
      to: Language
    }

    export const translate = async (text: string, options: OTPOptions) => {
      const _text = Buffer.from(text).toString('base64')
      const res = await SERVICE.createHttp({
        business: {
          from: options.from,
          to: options.to
        },
        data: {
          text: _text
        }
      })
      const { data, code } = res.body
      if (code === 0) {
        return data.result.trans_result.dst
      } else {
        console.log(res.body)
        return res.body
      }
    }
  }
}
