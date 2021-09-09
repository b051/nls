import * as chalk from 'chalk'
import * as mic from 'mic'
import { Transform } from 'stream'

export const buildMic = (vad_eos: number) => {
  const micInstance = mic({
    rate: '16000',
    channels: '1',
    exitOnSilence: vad_eos / 1000
  })

  const micStream: Transform = micInstance.getAudioStream()
  micStream.on('silence', () => {
    console.log(chalk.magenta('[silence detected]'))
    micInstance.stop()
  })

  micStream.on('startComplete', () => {
    console.log(chalk.magenta('[speak to your mic]'))
  })

  return { micInstance, micStream }
}