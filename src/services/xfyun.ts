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

  export namespace ISE {
    const PHONE_WEIGHT = 0.6
    const TONE_WEIGHT = 0.4
    const PASS_THRESHOLD = 50

    type XmlAttr = { name: string, value: string }
    type XmlSentenceProps = { content: string }
    type XmlWordProps = { content: string, symbol: string }
    type XmlSyllProps = { rec_node_type: string, content: string, symbol: string, dp_message: number }
    type XmlPhoneProps = { is_yun: string, content: string, mono_tone: string, perr_msg: string, dp_message: number }
    type XmlSyllPhoneProps = { initial: XmlPhoneProps, final: XmlPhoneProps }
    type XmlScoreProps = { tone_score: string, phone_score: string, total_score: string }
    type XmlSentenceScoreProps = XmlScoreProps & {
      accuracy_score: string,
      emotion_score: string,
      fluency_score: string,
      integrity_score: string
    }

    type IncomingMessage = {
      code: number,
      message: string,
      data: {
        data: string,
        status: number
      }
    }

    const TONE_MAP = { 'TONE1': 1, 'TONE2': 2, 'TONE3': 3, 'TONE4': 4 }

    const getNodeProperties = <T>(node: Element) => {
      const attrs = <XmlAttr[]>Array.from(node.attributes)
      return attrs.reduce((o, n) => { o[n.name] = n.value; return o }, {} as T)
    }

    const getSyllPhoneProperties = (syllNode: Element): XmlSyllPhoneProps => {
      const componentNodes = Array.from(syllNode.getElementsByTagName('phone'))
      const componentProps = componentNodes.map(c => getNodeProperties<XmlPhoneProps>(c))
      const initial: XmlPhoneProps = componentProps.find(c => c.is_yun === '0')
      const final = componentProps.find(c => c.is_yun === '1')

      return { initial, final }
    }

    const getScoreEvaluation = (scoreProps: XmlScoreProps) => {
      const weighted_score = PHONE_WEIGHT * parseFloat(scoreProps.phone_score) + TONE_WEIGHT * parseFloat(scoreProps.tone_score)
      const pass = weighted_score > PASS_THRESHOLD
      return {
        pass,
        weighted_score,
        tone_score: parseFloat(scoreProps.tone_score),
        phone_score: parseFloat(scoreProps.phone_score),
        total_score: parseFloat(scoreProps.total_score),
      }
    }

    const getSentenceScoreEvaluation = (scoreProps: XmlSentenceScoreProps) => {
      return {
        ...getScoreEvaluation(scoreProps),
        accuracy_score: parseFloat(scoreProps.accuracy_score),
        emotion_score: parseFloat(scoreProps.emotion_score),
        fluency_score: parseFloat(scoreProps.fluency_score),
        integrity_score: parseFloat(scoreProps.integrity_score),
      }
    }

    const getWordSyllNodes = (wordNode: Element) => {
      const syllNodes = Array.from(wordNode.getElementsByTagName('syll'))

      return syllNodes.filter(c => {
        const props = <XmlSyllProps>getNodeProperties(c)
        return props.rec_node_type === 'paper'
      })
    }

    const humanReadableDpMessage = (msg) => {
      switch (msg) {
        case "0": return undefined
        case "16": return 'missed'
        case "32": return 'extra'
        case "64": return 'repeated'
        case "128": return 'replaced'
      }
    }

    const getCharacterEvaluations = (node: Element) => {
      const syllables = getWordSyllNodes(node)

      return {
        characters: syllables.map(syllable => {
          const props = <XmlSyllProps>getNodeProperties(syllable)
          const syll = getSyllPhoneProperties(syllable)
          return {
            zh: props.content,
            pinyin: props.symbol,
            reason: humanReadableDpMessage(props.dp_message),
            initial: {
              phone: syll.initial.content,
              phone_score: syll.initial.perr_msg === '0' ? 100 : 0,
              reason: humanReadableDpMessage(syll.initial.dp_message)
            },
            final: {
              phone: syll.final.content,
              tone: TONE_MAP[syll.final.mono_tone] ?? 5,
              phone_score: ['0', '2'].includes(syll.final.perr_msg) ? 100 : 0,
              tone_score: ['0', '1'].includes(syll.final.perr_msg) ? 100 : 0,
              reason: humanReadableDpMessage(syll.final.dp_message)
            },
          }
        })
      }
    }

    const getWordEvaluations = (node: Element) => {
      const words = Array.from(node.getElementsByTagName('word'))

      return {
        words: words.map(word => {
          const props = getNodeProperties<XmlWordProps>(word)
          return {
            zh: props.content,
            pinyin: props.symbol,
            ...getCharacterEvaluations(word)
          }
        })
      }
    }

    const getSentenceEvaluations = (node: Element) => {
      const sentences = Array.from(node.getElementsByTagName('sentence'))

      return {
        sentences: sentences.map(sentence => {
          const props = getNodeProperties<XmlSentenceProps>(sentence)
          return {
            zh: props.content,
            ...getWordEvaluations(sentence)
          }
        })
      }
    }

    function evaluateSyllable(root: Element) {
      const node = root.getElementsByTagName('read_syllable')[0]
      const props = getNodeProperties<XmlScoreProps>(node)

      return {
        ...getScoreEvaluation(props),
        ...getSentenceEvaluations(node)
      }
    }

    const evaluateWord = (root: Element) => {
      const node = root.getElementsByTagName('read_word')[0]
      const props = getNodeProperties<XmlScoreProps>(node)

      return {
        ...getScoreEvaluation(props),
        ...getSentenceEvaluations(node)
      }
    }

    const evaluateSentence = (root: Element) => {
      const node = root.getElementsByTagName('read_sentence')[0]
      const props = getNodeProperties<XmlSentenceScoreProps>(node)

      return {
        ...getSentenceScoreEvaluation(props),
        ...getSentenceEvaluations(node)
      }
    }

    export enum CNCategory {
      read_syllable = 'read_syllable',
      read_word = 'read_word',
      read_sentence = 'read_sentence',
      read_chapter = 'read_chapter'
    }
    export type Options = { category: CNCategory, zh: string, pinyin: string }

    export type OutgoingMessage = {
      status: 'complete' | 'error' | 'pending'
      evaluation?: {} | ReturnType<typeof evaluateSyllable> | ReturnType<typeof evaluateWord> | ReturnType<typeof evaluateSentence>
      code?: number
      message?: string
    }

    const SERVICE = new Service(new URL('wss://ise-api.xfyun.cn/v2/open-ise'), 'ise')

    // ISESocket
    export class Socket extends SocketWrap<OutgoingMessage> {
      private pinyin: string
      private zh: string
      private category: CNCategory

      constructor(options: Options) {
        super(SERVICE)
        this.pinyin = tone2num(options.pinyin).replace(/\s+/g, '|')
        this.zh = options.zh
        this.category = options.category
      }

      translateMessage(parsed: IncomingMessage): OutgoingMessage {
        const data = parsed?.data?.data
        const { code, message } = (parsed ?? {})

        let response: OutgoingMessage
        if (data) {
          const xml = Buffer.from(data, 'base64')?.toString('utf8')

          const doc = new DOMParser().parseFromString(xml, 'text/xml')
          const paper = doc.getElementsByTagName('rec_paper')[0]

          let evaluation = {}
          if (this.category === CNCategory.read_syllable) {
            evaluation = evaluateSyllable(paper)
          } else if (this.category === CNCategory.read_word) {
            evaluation = evaluateWord(paper)
          } else if (this.category === CNCategory.read_sentence) {
            evaluation = evaluateSentence(paper)
          }
          response = { status: 'complete', evaluation }
        } else if (code && code > 0) {
          response = { status: 'error', code, message }
        } else {
          response = { status: 'pending' }
        }
        return response
      }

      send(audio: Buffer|string) {
        let frame: object
        const common = {
          app_id: this.service.app.app_id
        }
        switch (this.status) {
          case Frame.first:
            frame = {
              common,
              "business": {
                sub: "ise",
                ent: "cn_vip",
                category: this.category,
                text: `\uFEFF${this.zh}\n${this.pinyin}`,
                tte: "utf-8",
                rstcd: 'utf8',
                ttp_skip: true,
                cmd: "ssb",
                aue: "raw",
                auf: "audio/L16;rate=16000"
              },
              "data": { "status": 0 }
            }
            this.socket.send(JSON.stringify(frame))
            frame = {
              common,
              "business": { "aus": 1, "cmd": "auw", "aue": "raw" },
              "data": { "status": 1, "data": audio.toString('base64') }
            }
            this.status = Frame.continue
            break;
          case Frame.continue:
            frame = {
              common,
              "business": { "aus": 2, "cmd": "auw", "aue": "raw" },
              "data": { "status": 1, "data": audio.toString('base64') }
            }
            break;
          case Frame.last:
            frame = {
              common,
              "business": { "aus": 4, "cmd": "auw", "aue": "raw" },
              "data": { "status": 2, "data": audio.toString('base64') }
            }
            break;
        }
        this.socket.send(JSON.stringify(frame))
      }
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
