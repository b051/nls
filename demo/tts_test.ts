import * as fs from 'fs'
import * as inquirer from 'inquirer'
import { Baidu, Gender, XFYun } from '../src'
import { exec } from './cmd'

type Service = {
  extension: string
  generate: (text: string, path: string) => Promise<string>
}

const services: { [key: string]: Service } = {
  xfyun: {
    extension: 'mp3',
    generate: async (t, path) => {
      const { vcn, speed } = await inquirer.prompt([{
        type: 'list',
        name: 'vcn',
        default: 'aisjiuxu',
        message: 'choose voice actor:',
        choices: ['xiaoyan', 'x2_yezi', 'x2_xiaoxue', 'x2_xiaomo',
                  'x2_xiaolan', 'x_jiajia', 'x2_yifei', 'x2_chaoge',
                  'x2_xiaoding', 'x2_xiaoyuan', 'x_xiaoling', 'x_mengchun']
      }, {
        type: 'list',
        name: 'speed',
        default: 2,
        message: 'choose speed:',
        choices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        loop: false
      }])
      path = path.replace(':voice', vcn)
      const stream = fs.createWriteStream(path)
      console.log(`generating and saving to ${path}`)
      const label = `xunfei (vcn=${vcn} speed=${speed})`
      console.time(label)
      await XFYun.TTS.tts(t, stream, { vcn, gender: Gender.female, speed, ext: 'mp3', volume: 100 })
      console.timeEnd(label)

      return path
    }
  },
  baidu: {
    extension: 'wav',
    generate: async (t, path) => {
      const { per, speed } = await inquirer.prompt([{
        type: 'list',
        name: 'per',
        default: 0,
        message: 'choose voice actor:',
        choices: '度小宇=1，度小美=0，度逍遥（基础）=3，度丫丫=4，度逍遥（精品）=5003，度小鹿=5118，度博文=106，度小童=110，度小萌=111，度米朵=103，度小娇=5'.split('，').map(exp => {
          const [name, value] = exp.split('=')
          return { value: Number(value), name }
        }),
        loop: false
      }, {
        type: 'list',
        name: 'speed',
        default: 4,
        message: 'choose speed:',
        choices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        loop: false
      }])
      const label = `baidu(per=${per} speed=${speed})`
      path = path.replace(':voice', per)
      console.time(label)
      const buffer = await Baidu.TTS.tts(t, per, speed, 'wav')
      fs.writeFileSync(path, buffer)
      console.timeEnd(label)

      return path
    }
  }
}

const select_text = async () => {
  const { text } = await inquirer.prompt([{
    type: 'input',
    name: 'text',
    default: "我想吃漢堡和薯條，你想吃什麼呢？",
    message: 'Enter text for the comparison'
  }])
  return text
}

const generate_speech = async (text: string) => {
  while (true) {
    const { key } = await inquirer.prompt([{
      type: 'list',
      name: 'key',
      choices: [...Object.keys(services), 'change text', 'done']
    }])

    if (key == 'change text') {
      text = await select_text()
      continue
    }

    if (key == 'done') break
    const pathTemplate = `/tmp/${key}-:voice-${text}.${services[key].extension}`
    const path = await services[key].generate(text, pathTemplate)
    await exec(`play ${path}`)
  }
}

export const tts_test = async () => {
  const text = await select_text()
  await generate_speech(text)
}