import { numeric_tones, PinyinRegexp, valid_phone } from '@wohui/pinyin'
import * as request from 'superagent'
import { AzureApp, Env, Gender } from '../env'

const ChineseRegexp = /[\u3400-\u4DBF\u4e00-\u9fa5]/

let env: Env['azure']

export namespace Azure {

  export function init(_env: Env['azure']) {
    env = _env
  }

  export enum Frame {
    first = 0,
    continue = 1,
    last = 2
  }

  export class Service {
    readonly app: AzureApp
    readonly url: URL
    
    constructor(url_suffix: string, readonly key: keyof Env['azure']) {
      this.app = env[key]
      this.url = new URL(`https://${this.app.region}.${url_suffix}`)
    }

    ssml() {
      return request.post(this.url.href)
      .set('User-Agent', 'superagent')
      .set('Ocp-Apim-Subscription-Key', this.app.subscription_key)
      .set('Content-Type', 'application/ssml+xml')
    }
  }

  export namespace TTS {

    export enum Voice {
      Yunxi = 'zh-CN-YunxiNeural',
      Xiaoxuan = 'zh-CN-XiaoxuanNeural',
      Xiaohan = 'zh-CN-XiaohanNeural',
      Xiaomo = 'zh-CN-XiaomoNeural',
      Xiaorui = 'zh-CN-XiaoruiNeural'
    }

    export class DialogLine {
      readonly voice: Voice

      static genderVoiceMapping = {
        male: Voice.Yunxi,
        female: Voice.Xiaohan,
        other: Voice.Xiaohan
      }

      constructor(readonly material: { readonly text?: string, readonly pinyin?: string }, voice_or_gender: Voice|Gender|(keyof typeof preferredVoiceNameMapping)) {
        if (preferredVoiceNameMapping[voice_or_gender]) {
          this.voice = preferredVoiceNameMapping[voice_or_gender]
        } else if (Object.keys(Gender).includes(voice_or_gender)) {
          this.voice = DialogLine.genderVoiceMapping[voice_or_gender]
        } else {
          this.voice = voice_or_gender as Voice
        }
      }

      private prosody_args() {
        const text = this.material.pinyin ?? this.material.text
        const pinyinCount = text.match(new RegExp(PinyinRegexp, 'g'))?.length ?? 0
        const charCount = text.match(new RegExp(ChineseRegexp, 'g'))?.length ?? 0
        const length = pinyinCount + charCount

        if (length === 1) {
          return 'rate="x-slow"'
        } else if (length < 2) {
          return 'rate="x-slow"'
        } else {
          return 'rate="0.75"'
        }
      }

      private group(text: string) {
        const character_array: {isPinyin: boolean, group: string }[] = []
        let last: {isPinyin: boolean, group: string }
        let previous = 0
        text.replace(PinyinRegexp, (_, group, start) => {
          if (start !== previous) {
            const group = text.substring(previous, start)
            if (group === ' ') {
              last.group += group
            } else {
              last = {
                isPinyin: false,
                group
              }
              character_array.push(last)
            }
          }
          previous = start + group.length
          const ph: string[] = []
          let isPinyin = true
          for (const [phone, tone] of numeric_tones(group)) {
            if (valid_phone(phone)) {
              ph.push(`${phone} ${tone}`)
            } else {
              isPinyin = false
            }
          }
          if (isPinyin) {
            group = ph.join(' - ')
          }
          if (isPinyin && last && last.isPinyin) {
            last.group += ' - ' + group
          } else {
            last = {
              isPinyin,
              group
            }
            character_array.push(last)
          }
          return ''
        })
        if (previous !== text.length) {
          const group = text.substring(previous)
          last = {
            isPinyin: false,
            group
          }
          character_array.push(last)
        }
        return character_array
      }

      /**
       * Convert standard numeric pinyin to ms [sapi](https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/speech-ssml-phonetic-sets?tabs=zh-CN):
       * "zu3 zhi1 guan1 xi"   =>   "zu 3 - zhi 1 - guan 1 - xi 5"
       */
      private phoneme() {
        const xml: string[] = []
        if (this.material.pinyin) {
          for (const { isPinyin, group } of this.group(this.material.pinyin)) {
            if (isPinyin) {
              xml.push(`<phoneme alphabet="sapi" ph="${group}" />`)
            } else {
              xml.push(group)
            }
          }
        } else {
          xml.push(this.material.text)
        }
        const node = xml.join('')
        return node
      }

      voiceXml() {
        return `
          <voice name='${this.voice}'>
            <prosody ${this.prosody_args()}>
              ${this.phoneme()}
            </prosody>
          </voice>
          `
      }
    }

    const preferredVoiceNameMapping = {
      A: Voice.Xiaohan,
      B: Voice.Yunxi,
      C: Voice.Xiaoxuan,
      D: Voice.Xiaomo,
      E: Voice.Xiaorui
    }

    export function assignVoices(names: string[]) {
      const generated: { [key: string]: Voice } = {}
      const remaining = Object.values(preferredVoiceNameMapping)
      for (const name of names) {
        const voice = preferredVoiceNameMapping[name]
        if (voice) {
          const idx = remaining.indexOf(voice)
          if (idx >= 0) {
            remaining.splice(idx, 1)
          }
          generated[name] = voice
        }
      }
      if (Object.keys(generated).length < names.length) {
        for (const name of names) {
          let voice = generated[name]
          if (!voice) {
            voice = remaining.shift() || Voice.Xiaoxuan
            generated[name] = voice
            remaining.push(voice)
          }
        }
      }
      return generated
    }

    const SERVICE = new Service('tts.speech.microsoft.com/cognitiveservices/v1', 'tts')

    export const tts = async (...lines: DialogLine[]): Promise<Buffer> => {
      const wav = await SERVICE.ssml()
      .set('X-Microsoft-OutputFormat', 'audio-24khz-48kbitrate-mono-mp3')
      .send(`
        <speak version='1.0' xml:lang='en-US'>
          ${lines.map(line => line.voiceXml()).join('\n')}
        </speak>`)
      return wav.body
    }
  }
}
