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
      ise: *xfyun_iat
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

