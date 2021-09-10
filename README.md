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

### Use it in your project

```javascript

import { Azure, XFYun, Baidu } from '@b051/nls'

const env: Env = yaml.load(...)

Azure.init(env.azure)
XFYun.init(env.xfyun)
Baidu.init(env.baidu)

```

### Docker Support

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

#### Try it out

Put `env.yml` like above in your home directory, start `pulseaudio` daemon, then

```sh
docker run -it -e PULSE_SERVER=docker.for.mac.localhost -e ENV_YML=/root/env.yml -v ~/.config/pulse:/root/.config/pulse -v ~/env.yml:/root/env.yml --rm b051/nls-demo:latest npm run demo
```
