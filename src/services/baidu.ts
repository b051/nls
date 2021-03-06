import { pRateLimit } from 'p-ratelimit'
import * as request from 'superagent'
import { URL } from 'url'
import { Env } from '../env'

// https://console.bce.baidu.com/ai/?_=1569565200181&fromai=1&locale=zh-cn#/ai/nlp/app/detail~appId=1195683
let env: Env['baidu']

export namespace Baidu {

  export function init(_env: Env['baidu']) {
    env = _env
  }

  class Request {
    private token: string
    private expires_in: number

    private async get_access_token() {
      if (this.token && this.expires_in > Date.now()) {
        return this.token
      }
      const res = await request.get('https://openapi.baidu.com/oauth/2.0/token').query({
        grant_type: 'client_credentials',
        client_id: env.key,
        client_secret: env.secret
      })
      const { access_token, expires_in } = res.body
      this.token = access_token
      this.expires_in = expires_in - 60
      return this.token
    }

    async send(service: Service, body: object, type: 'form'|'json' = 'json') {
      const access_token = await this.get_access_token()
      return await service.qps(async () => {
        const req = request.post(service.url.href)
        if ('aip.baidubce.com' === service.url.host) {
          req.query({ access_token, charset: 'UTF-8' })
        } else if (service.url.host.includes('baidu.com')) {
          if (type === 'form') {
            Object.assign(body, {
              cuid: env.app_id,
              tok: access_token
            })
          } else {
            Object.assign(body, {
              cuid: env.app_id,
              token: access_token
            })
          }
        }
        return await req.type(type).send(body)
      })
    }
  }

  const req = new Request()

  export class Service {
    readonly qps: <T>(fn: () => Promise<T>) => Promise<T>

    constructor(readonly url: URL,  rate: number) {
      this.qps = pRateLimit({
        interval: 1000,
        rate: rate,
        concurrency: rate
      })
    }

    send(body: object, type: 'form'|'json' = 'json') {
      return req.send(this, body, type)
    }
  }

  export namespace IAT {

    const SERVICE = new Service(new URL('http://vop.baidu.com/server_api'), 5)

    const _iat = async (buffer: Buffer, method: 'json' | 'raw') => {
      return await SERVICE.send({
        format: 'wav',
        rate: 16000,
        dev_pid: 1536,
        channel: 1,
        speech: buffer.toString('base64'),
        len: buffer.length
      })
    }

    export const iat = async (buffer: Buffer, method: 'json'|'raw' = 'json', retry: number = 0) => {
      const res = await _iat(buffer, method)
      const { result, err_no } = res.body
      if (err_no === 3302 && retry < 1) {
        return await iat(buffer, method, retry + 1)
      }
      return result && result[0]
    }
  }

  export namespace TTS {

    const SERVICE_3 = new Service(new URL('https://tsn.baidu.com/text2audio'), 3)
    const SERVICE_10 = new Service(new URL('https://tsn.baidu.com/text2audio'), 10)

    const _tts = async (text: string, per: number, speed: number, format: 'wav' | 'mp3') => {
      const tts_service = per > 4 ? SERVICE_3 : SERVICE_10
      return await tts_service.send({
        tex: text.substr(0, 2048),
        ctp: 1,
        lan: 'zh',
        per, //?????????=1????????????=0????????????=3????????????=4 ?????????=106????????????=110????????????=111????????????=103????????????=5
        spd: speed !== undefined ? speed : 4, //speed 0-15
        aue: format === 'wav' ? 6 : 3
      }, 'form')
    }

    export const tts = async (text: string, per: number, speed: number, format: 'wav' | 'mp3', retry: number = 0) => {
      const res = await _tts(text, per, speed, format)
      if (res.header['content-type'].startsWith('audio/')) {
        return res.body
      } else {
        const { err_no } = res.body
        if (err_no === 3302 && retry < 1) {
          return await tts(text, per, speed, format, retry + 1)
        }
        throw new Error(JSON.stringify(res.body))
      }
    }
  }

  export namespace CONLL {

    export type Conll = { id: string, word: string, postag: string, head: string, deprel: string }

    const SERVICE = new Service(new URL('https://aip.baidubce.com/rpc/2.0/nlp/v1/depparser'), 2)

    export const conll = async (text: string): Promise<Conll[]> => {
      const res = await SERVICE.send({ text, mode: 0 })
      const { items, error_code } = res.body
      return items
    }

    const speakerTags = [
      'aa',
      'ab',
      'an',
      'ann',
      'anv',
      'at',
      'bn',
      'j',
      'jj',
      'jn',
      'n',
      'nr',
      'na',
      'nd',
      'nm',
      'nmm',
      'nn',
      'nvn',
      'r',
      'rr',
      'tt',
      'van',
      'x',
      'z',
    ]

    const ignoredTexts = new RegExp(
      '^(?:' +
        ['??????', '?????????', '?????????', '??????', '??????', '??????', '??????', '??????', '??????', '?????????', '????????????'].join('|') +
        ')[???\n]',
      'm',
    )

    const dialogLine = /^([A-Z]{1}|[\u4e00-\u8bf3 \u8bf5-\u9fa5]{1,5})(???([A-Z]{1}|[\u4e00-\u8bf3 \u8bf5-\u9fa5]{1,5}))*???(?!$)/gm

    /**
     * A dialogue line may be prefixed 1) a zh name or 2) a single letter:
     * 1. ????????????
     *    ????????????
     * 2. A??????
     *    B??????
     */
    export const identify_speaker = async (text: string) => {
      const replaced = new Map<number, string>()
      if (!ignoredTexts.test(text)) {
        let m: RegExpExecArray
        while ((m = dialogLine.exec(text)) !== null) {
          for (const segment of m[0].replace('???', '').split('???')) {
            const res = await conll(segment)
            const tags = res.map(c => c.postag.toLowerCase()).join('')
            // const items = await baidu_lexer(segment)
            // const tags = items.map(c => c.pos.toLowerCase()).join('')
            if (speakerTags.includes(tags)) {
              replaced.set(dialogLine.lastIndex - m[0].length + m[0].indexOf(segment), segment)
            }
          }
        }
      }
      return replaced
    }
  }

  export namespace LEXER {

    export type Lexer = { item: string, pos: string }

    const SERVICE = new Service(new URL('https://aip.baidubce.com/rpc/2.0/nlp/v1/lexer'), 2)

    const _lexer = async (text: string): Promise<Lexer[]> => {
      if (text.trim() === '') {
        return []
      }
      const res = await SERVICE.send({ text })
      const { items, error_code } = res.body
      if (error_code) {
        throw new Error(JSON.stringify(res.body))
      } else {
      }
      return items
    }

    export const lexer = async (text: string): Promise<Lexer[]> => {
      let prev = 0
      const parts: Promise<Lexer[]>[] = []
      text.replace(/([\u3400-\u4DBF]+)/g, (m, group, start) => {
        if (start !== prev) {
          const part = text.substring(prev, start)
          parts.push(_lexer(part))
        }
        parts.push(Promise.resolve([{ item: m, pos: undefined }]))
        prev = start + m.length
        return null
      })
      if (prev < text.length) {
        let part = text.substring(prev)
        parts.push(_lexer(part))
      }
      const lexers: Lexer[] = []
      for (const part of parts) {
        const l = await part
        if (l) {
          lexers.push(...l)
        }
      }
      return lexers
    }
  }

  export namespace OPENQA {

    const SERVICE = new Service(new URL('https://aip.baidubce.com/rpc/2.0/kg/v2/openqa'), 2)

    export const openqa = async (text: string) => {
      console.log('baidu:openqa', { text })
      const res = await SERVICE.send({ query: text })
      return res.body.result
    }

    export const definition = async (text: string) => {
      const result = await openqa(text)
      for (const { response: { entity } } of result) {
        for (const { attrs } of entity) {
          for (const attr of attrs) {
            if (attr.key === 'definition') {
              return attr.objects[0]['@value']
            }
          }
        }
      }
    }
  }
}
