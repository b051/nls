#!npx ts-node
import * as inquirer from 'inquirer'
import { Env, init } from '../src'
import * as fs from 'fs'
import * as yaml from 'js-yaml'

const actions = {
  "NLP Demo": async () => {
    return {
      iat_test: () => import('./iat_test').then(m => m.iat_test),
      tts_test: () => import('./tts_test').then(m => m.tts_test)
    }
  }
}

const BACK = '⇡back'
const prompt = async () => {
  const env: Env = yaml.load(fs.readFileSync(process.env.ENV_YML).toString('utf-8'))
  
  init(env)
  while (true) {
    const { category } = await inquirer.prompt([{
      type: 'list',
      name: 'category',
      choices: Object.keys(actions)
    }])
    const choices = await actions[category]()
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      choices: [...Object.keys(choices), BACK]
    }])
    if (action === BACK) {
      continue
    }
    const fn = await choices[action]()
    await fn()
    break
  }
}

(async () => {
  try {
    await prompt()
    process.exit(0)
  } catch (error) {
    console.error(error.stack)
    process.exit(1)
  }
})()
