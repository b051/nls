import { Env, Gender, Language } from './env'
import { Baidu } from './services/baidu'
import { Azure } from './services/azure'
import { XFYun } from './services/xfyun'

export const init = (env: Env) => {
  if (env.baidu) {
    Baidu.init(env.baidu)
  }
  if (env.azure) {
    Azure.init(env.azure)
  }
  if (env.xfyun) {
    XFYun.init(env.xfyun)
  }
}

export { Baidu, Azure, XFYun, Env, Gender, Language }