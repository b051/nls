### Intro

This package will help you to quickly start using either or some of the supported nature language services like azure, baidu and xfyun.

### Start

I would consolidate secret keys into an environment yaml file like

```yaml
    baidu: &baidu
      app_id: ----
      key: ----
      secret: ----
    xfyun: &xfyun
      iat: &xfyun_iat
        app_id: ----
        api_key: ----
        api_secret: ----
      tts: *xfyun_iat
      ots: *xfyun_iat
    azure: &azure
      tts:
        region: ----
        subscription_key: ----
```

and load the configuration with 

```javascript

import { Azure } from '@b051/nls'

const env: Env = yaml.load(...)

Azure.init(env.azure)

```

### Run Demo

```shell
npm run demo
```

### Remote Container

This project works with [Remote Container](https://code.visualstudio.com/docs/remote/containers). To enable audio from your Mac to container, please start pulseaudio daemon.

If you have trouble with built-in service (I think you have to edit the plist each time)

```shell
brew services start pulseaudio
```

Please start your pulseaudio by

```shell
pulseaudio --load=module-native-protocol-tcp --exit-idle-time=-1 --daemon
```

and kill it by 

```shell
pulseaudio --kill 
```

