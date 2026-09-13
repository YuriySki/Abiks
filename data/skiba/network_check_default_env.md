# Проверка сети: окружение по умолчанию (Claude Code on the web)

Дата: 2026-09-13 (UTC, ~08:23)
Ветка: `claude/skiba-netcheck-default`
Команда для каждого хоста: `curl -sS -o /dev/null -w '%{http_code}' --max-time 30 URL`

## Результаты

| URL | HTTP-код | curl exit code | Ошибка |
|-----|----------|----------------|--------|
| https://gwar.mil.ru/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://1914.svrt.ru/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://www.svrt.ru/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://grandeguerre.icrc.org/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://centrasia.org/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://forum.vgd.ru/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://www.rigsarkivet.dk/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |
| https://www.deutsche-digitale-bibliothek.de/ | 000 | 56 | curl: (56) CONNECT tunnel failed, response 403  |

Итог: все 8 хостов недоступны. Код ответа `000` (соединение не установлено), curl завершается с кодом 56: `CONNECT tunnel failed, response 403`. Прокси отклоняет CONNECT на уровне сетевой политики окружения (`connect_rejected`, "policy denial or upstream failure"). Проблема не в TLS и не в самих сайтах: до них запрос не доходит.

## Вывод `curl -sS "$HTTPS_PROXY/__agentproxy/status"`

Переменная `HTTPS_PROXY` задана.

```json
{
  "enabled": true,
  "port": 35523,
  "caBundlePath": "/root/.ccr/ca-bundle.crt",
  "hasSystemCa": true,
  "bundleCoversEveryHost": true,
  "noProxy": "localhost,127.0.0.1,::1,127.0.0.0/8,0.0.0.0/8,::,169.254.0.0/16,api.anthropic.com,api-staging.anthropic.com,api-pr-preview.anthropic.com,mcp-proxy.anthropic.com,mcp-proxy-staging.anthropic.com,registry.npmjs.org,jsr.io,npm.jsr.io,pypi.org,files.pythonhosted.org,index.crates.io,proxy.golang.org,host.docker.internal,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,.svc.cluster.local,*.svc.cluster.local",
  "selective": false,
  "standalone": false,
  "toolScoped": false,
  "installedProxyPreconfiguredClis": [],
  "javaTrustStorePath": "/root/.ccr/java-truststore.p12",
  "readmePath": "/root/.ccr/README.md",
  "gitConfigInjection": true,
  "gitSshRewrite": true,
  "recentRelayFailures": [
    {
      "ts": "2026-09-13T08:23:39.478Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "gwar.mil.ru:443"
    },
    {
      "ts": "2026-09-13T08:23:39.781Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "1914.svrt.ru:443"
    },
    {
      "ts": "2026-09-13T08:23:40.051Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "www.svrt.ru:443"
    },
    {
      "ts": "2026-09-13T08:23:40.364Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "grandeguerre.icrc.org:443"
    },
    {
      "ts": "2026-09-13T08:23:40.653Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "centrasia.org:443"
    },
    {
      "ts": "2026-09-13T08:23:40.940Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "forum.vgd.ru:443"
    },
    {
      "ts": "2026-09-13T08:23:41.225Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "www.rigsarkivet.dk:443"
    },
    {
      "ts": "2026-09-13T08:23:41.366Z",
      "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "www.deutsche-digitale-bibliothek.de:443"
    }
  ],
  "downloadQueuedBytes": 0,
  "downloadQueuedPeakBytes": 0,
  "downloadReceivePauseSupported": true,
  "downloadReceiveGateEnabled": true,
  "uploadPausedClients": 0,
  "uploadPauses": 0,
  "uploadPauseSupported": true,
  "uploadGateEnabled": true,
  "bufferedAmountTrusted": true
}
```

## Вывод

Сетевая политика окружения по умолчанию не пропускает трафик к внешним архивным сайтам (gwar.mil.ru, svrt.ru, icrc.org, centrasia.org, vgd.ru, rigsarkivet.dk, deutsche-digitale-bibliothek.de). Для работы с этими источниками нужно окружение с более широкой сетевой политикой (см. https://code.claude.com/docs/en/claude-code-on-the-web) либо добавить хосты в allowlist.
