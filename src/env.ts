export enum Gender {
  male = 'male',
  female = 'female',
  other = 'other'
}

export enum Language {
  en = 'en',
  zh = 'zh'
}

export interface XfYunApp {
  app_id: string
  api_key: string
  api_secret: string
}

export interface AzureApp {
  region: string
  subscription_key: string
}

export interface Env {
  xfyun?: {
    tts: XfYunApp
    iat: XfYunApp
    ise: XfYunApp
    ots: XfYunApp
  }
  baidu?: {
    app_id: string
    key: string
    secret: string
  }
  azure?: {
    tts: AzureApp
  }
}
