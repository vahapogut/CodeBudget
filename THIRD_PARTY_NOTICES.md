# Third-party notices

CodeBudget uses the packages below under their respective licenses. This inventory was generated from the installed production dependency graph plus TypeScript, which the staged release requires for local hidden-evaluator typechecks. Build and test dependencies can be inspected separately with `pnpm licenses list --json`. Platform-specific optional dependencies may differ in another installed graph. Original license and NOTICE texts are linked per entry and remain authoritative. The js-tiktoken archive omits its root license; its MIT text is preserved from the exact npm gitHead with source and SHA-256 recorded in the inventory.

Generated inventory: [dependency-licenses.json](docs/dependency-licenses.json). Refresh after dependency changes using:

```sh
pnpm licenses list --prod --json | node scripts/generate-notices.mjs
```

Node.js is supplied by the user and retains its own distribution licenses. SQLite is used through Node's built-in runtime. Tree-sitter runtime and grammar packages appear below. No RTK, Serena, Aider or Context Mode implementation was copied into this distribution.

| Package | Version | License | Original text |
| --- | --- | --- | --- |
| @hono/node-server | 2.1.3 | MIT | [text 1](docs/third-party-licenses/_hono_node-server-2.1.3-LICENSE) |
| @modelcontextprotocol/sdk | 1.31.0 | MIT | [text 1](docs/third-party-licenses/_modelcontextprotocol_sdk-1.31.0-LICENSE) |
| accepts | 2.0.0 | MIT | [text 1](docs/third-party-licenses/accepts-2.0.0-LICENSE) |
| ajv | 8.20.0 | MIT | [text 1](docs/third-party-licenses/ajv-8.20.0-LICENSE) |
| ajv-formats | 3.0.1 | MIT | [text 1](docs/third-party-licenses/ajv-formats-3.0.1-LICENSE) |
| base64-js | 1.5.1 | MIT | [text 1](docs/third-party-licenses/base64-js-1.5.1-LICENSE) |
| body-parser | 2.3.0 | MIT | [text 1](docs/third-party-licenses/body-parser-2.3.0-LICENSE) |
| bytes | 3.1.2 | MIT | [text 1](docs/third-party-licenses/bytes-3.1.2-LICENSE) |
| call-bind-apply-helpers | 1.0.2 | MIT | [text 1](docs/third-party-licenses/call-bind-apply-helpers-1.0.2-LICENSE) |
| call-bound | 1.0.4 | MIT | [text 1](docs/third-party-licenses/call-bound-1.0.4-LICENSE) |
| commander | 15.0.0 | MIT | [text 1](docs/third-party-licenses/commander-15.0.0-LICENSE) |
| content-disposition | 1.1.0 | MIT | [text 1](docs/third-party-licenses/content-disposition-1.1.0-LICENSE) |
| content-type | 1.0.5 | MIT | [text 1](docs/third-party-licenses/content-type-1.0.5-LICENSE) |
| content-type | 2.1.0 | MIT | [text 1](docs/third-party-licenses/content-type-2.1.0-LICENSE) |
| cookie | 0.7.2 | MIT | [text 1](docs/third-party-licenses/cookie-0.7.2-LICENSE) |
| cookie-signature | 1.2.2 | MIT | [text 1](docs/third-party-licenses/cookie-signature-1.2.2-LICENSE) |
| cors | 2.8.6 | MIT | [text 1](docs/third-party-licenses/cors-2.8.6-LICENSE) |
| cross-spawn | 7.0.6 | MIT | [text 1](docs/third-party-licenses/cross-spawn-7.0.6-LICENSE) |
| debug | 4.4.3 | MIT | [text 1](docs/third-party-licenses/debug-4.4.3-LICENSE) |
| depd | 2.0.0 | MIT | [text 1](docs/third-party-licenses/depd-2.0.0-LICENSE) |
| dunder-proto | 1.0.1 | MIT | [text 1](docs/third-party-licenses/dunder-proto-1.0.1-LICENSE) |
| ee-first | 1.1.1 | MIT | [text 1](docs/third-party-licenses/ee-first-1.1.1-LICENSE) |
| encodeurl | 2.0.0 | MIT | [text 1](docs/third-party-licenses/encodeurl-2.0.0-LICENSE) |
| es-define-property | 1.0.1 | MIT | [text 1](docs/third-party-licenses/es-define-property-1.0.1-LICENSE) |
| es-errors | 1.3.0 | MIT | [text 1](docs/third-party-licenses/es-errors-1.3.0-LICENSE) |
| es-object-atoms | 1.1.2 | MIT | [text 1](docs/third-party-licenses/es-object-atoms-1.1.2-LICENSE) |
| escape-html | 1.0.3 | MIT | [text 1](docs/third-party-licenses/escape-html-1.0.3-LICENSE) |
| etag | 1.8.1 | MIT | [text 1](docs/third-party-licenses/etag-1.8.1-LICENSE) |
| eventsource | 3.0.7 | MIT | [text 1](docs/third-party-licenses/eventsource-3.0.7-LICENSE) |
| eventsource-parser | 3.1.1 | MIT | [text 1](docs/third-party-licenses/eventsource-parser-3.1.1-LICENSE) |
| express | 5.2.1 | MIT | [text 1](docs/third-party-licenses/express-5.2.1-LICENSE) |
| express-rate-limit | 8.7.0 | MIT | [text 1](docs/third-party-licenses/express-rate-limit-8.7.0-license) |
| fast-deep-equal | 3.1.3 | MIT | [text 1](docs/third-party-licenses/fast-deep-equal-3.1.3-LICENSE) |
| fast-uri | 3.1.8 | BSD-3-Clause | [text 1](docs/third-party-licenses/fast-uri-3.1.8-LICENSE) |
| finalhandler | 2.1.1 | MIT | [text 1](docs/third-party-licenses/finalhandler-2.1.1-LICENSE) |
| forwarded | 0.2.0 | MIT | [text 1](docs/third-party-licenses/forwarded-0.2.0-LICENSE) |
| fresh | 2.0.0 | MIT | [text 1](docs/third-party-licenses/fresh-2.0.0-LICENSE) |
| function-bind | 1.1.2 | MIT | [text 1](docs/third-party-licenses/function-bind-1.1.2-LICENSE) |
| get-intrinsic | 1.3.0 | MIT | [text 1](docs/third-party-licenses/get-intrinsic-1.3.0-LICENSE) |
| get-proto | 1.0.1 | MIT | [text 1](docs/third-party-licenses/get-proto-1.0.1-LICENSE) |
| gopd | 1.2.0 | MIT | [text 1](docs/third-party-licenses/gopd-1.2.0-LICENSE) |
| has-symbols | 1.1.0 | MIT | [text 1](docs/third-party-licenses/has-symbols-1.1.0-LICENSE) |
| hasown | 2.0.4 | MIT | [text 1](docs/third-party-licenses/hasown-2.0.4-LICENSE) |
| hono | 4.13.11 | MIT | [text 1](docs/third-party-licenses/hono-4.13.11-LICENSE) |
| http-errors | 2.0.1 | MIT | [text 1](docs/third-party-licenses/http-errors-2.0.1-LICENSE) |
| iconv-lite | 0.7.3 | MIT | [text 1](docs/third-party-licenses/iconv-lite-0.7.3-LICENSE) |
| ignore | 7.0.10 | MIT | [text 1](docs/third-party-licenses/ignore-7.0.10-LICENSE-MIT) |
| inherits | 2.0.4 | ISC | [text 1](docs/third-party-licenses/inherits-2.0.4-LICENSE) |
| ip-address | 10.7.2 | MIT | [text 1](docs/third-party-licenses/ip-address-10.7.2-LICENSE) |
| ipaddr.js | 1.9.1 | MIT | [text 1](docs/third-party-licenses/ipaddr.js-1.9.1-LICENSE) |
| is-promise | 4.0.0 | MIT | [text 1](docs/third-party-licenses/is-promise-4.0.0-LICENSE) |
| isexe | 2.0.0 | ISC | [text 1](docs/third-party-licenses/isexe-2.0.0-LICENSE) |
| jose | 6.2.12 | MIT | [text 1](docs/third-party-licenses/jose-6.2.12-LICENSE.md) |
| js-tiktoken | 1.0.21 | MIT | [text 1](docs/third-party-licenses/js-tiktoken-1.0.21-LICENSE) |
| json-schema-traverse | 1.0.0 | MIT | [text 1](docs/third-party-licenses/json-schema-traverse-1.0.0-LICENSE) |
| json-schema-typed | 8.0.2 | BSD-2-Clause | [text 1](docs/third-party-licenses/json-schema-typed-8.0.2-LICENSE.md) |
| math-intrinsics | 1.1.0 | MIT | [text 1](docs/third-party-licenses/math-intrinsics-1.1.0-LICENSE) |
| media-typer | 1.1.1 | MIT | [text 1](docs/third-party-licenses/media-typer-1.1.1-LICENSE) |
| merge-descriptors | 2.0.0 | MIT | [text 1](docs/third-party-licenses/merge-descriptors-2.0.0-license) |
| mime-db | 1.54.0 | MIT | [text 1](docs/third-party-licenses/mime-db-1.54.0-LICENSE) |
| mime-types | 3.0.2 | MIT | [text 1](docs/third-party-licenses/mime-types-3.0.2-LICENSE) |
| ms | 2.1.3 | MIT | [text 1](docs/third-party-licenses/ms-2.1.3-license.md) |
| negotiator | 1.1.0 | MIT | [text 1](docs/third-party-licenses/negotiator-1.1.0-LICENSE) |
| node-addon-api | 8.9.2 | MIT | [text 1](docs/third-party-licenses/node-addon-api-8.9.2-LICENSE.md) |
| node-gyp-build | 4.8.4 | MIT | [text 1](docs/third-party-licenses/node-gyp-build-4.8.4-LICENSE) |
| object-assign | 4.1.1 | MIT | [text 1](docs/third-party-licenses/object-assign-4.1.1-license) |
| object-inspect | 1.13.4 | MIT | [text 1](docs/third-party-licenses/object-inspect-1.13.4-LICENSE) |
| on-finished | 2.4.1 | MIT | [text 1](docs/third-party-licenses/on-finished-2.4.1-LICENSE) |
| once | 1.4.0 | ISC | [text 1](docs/third-party-licenses/once-1.4.0-LICENSE) |
| parseurl | 1.3.3 | MIT | [text 1](docs/third-party-licenses/parseurl-1.3.3-LICENSE) |
| path-key | 3.1.1 | MIT | [text 1](docs/third-party-licenses/path-key-3.1.1-license) |
| path-to-regexp | 8.4.2 | MIT | [text 1](docs/third-party-licenses/path-to-regexp-8.4.2-LICENSE) |
| pkce-challenge | 5.0.1 | MIT | [text 1](docs/third-party-licenses/pkce-challenge-5.0.1-LICENSE) |
| proxy-addr | 2.0.8 | MIT | [text 1](docs/third-party-licenses/proxy-addr-2.0.8-LICENSE) |
| qs | 6.16.0 | BSD-3-Clause | [text 1](docs/third-party-licenses/qs-6.16.0-LICENSE.md) |
| range-parser | 1.3.0 | MIT | [text 1](docs/third-party-licenses/range-parser-1.3.0-LICENSE) |
| raw-body | 3.0.2 | MIT | [text 1](docs/third-party-licenses/raw-body-3.0.2-LICENSE) |
| react | 19.3.0 | MIT | [text 1](docs/third-party-licenses/react-19.3.0-LICENSE) |
| react-dom | 19.3.0 | MIT | [text 1](docs/third-party-licenses/react-dom-19.3.0-LICENSE) |
| require-from-string | 2.0.2 | MIT | [text 1](docs/third-party-licenses/require-from-string-2.0.2-license) |
| router | 2.2.0 | MIT | [text 1](docs/third-party-licenses/router-2.2.0-LICENSE) |
| safer-buffer | 2.1.2 | MIT | [text 1](docs/third-party-licenses/safer-buffer-2.1.2-LICENSE) |
| scheduler | 0.28.0 | MIT | [text 1](docs/third-party-licenses/scheduler-0.28.0-LICENSE) |
| send | 1.2.1 | MIT | [text 1](docs/third-party-licenses/send-1.2.1-LICENSE) |
| serve-static | 2.2.1 | MIT | [text 1](docs/third-party-licenses/serve-static-2.2.1-LICENSE) |
| setprototypeof | 1.2.0 | ISC | [text 1](docs/third-party-licenses/setprototypeof-1.2.0-LICENSE) |
| shebang-command | 2.0.0 | MIT | [text 1](docs/third-party-licenses/shebang-command-2.0.0-license) |
| shebang-regex | 3.0.0 | MIT | [text 1](docs/third-party-licenses/shebang-regex-3.0.0-license) |
| side-channel | 1.1.1 | MIT | [text 1](docs/third-party-licenses/side-channel-1.1.1-LICENSE) |
| side-channel-list | 1.0.1 | MIT | [text 1](docs/third-party-licenses/side-channel-list-1.0.1-LICENSE) |
| side-channel-map | 1.0.1 | MIT | [text 1](docs/third-party-licenses/side-channel-map-1.0.1-LICENSE) |
| side-channel-weakmap | 1.0.2 | MIT | [text 1](docs/third-party-licenses/side-channel-weakmap-1.0.2-LICENSE) |
| smol-toml | 1.9.0 | BSD-3-Clause | [text 1](docs/third-party-licenses/smol-toml-1.9.0-LICENSE) |
| statuses | 2.0.2 | MIT | [text 1](docs/third-party-licenses/statuses-2.0.2-LICENSE) |
| toidentifier | 1.0.1 | MIT | [text 1](docs/third-party-licenses/toidentifier-1.0.1-LICENSE) |
| tree-sitter-javascript | 0.23.1 | MIT | [text 1](docs/third-party-licenses/tree-sitter-javascript-0.23.1-LICENSE) |
| tree-sitter-javascript | 0.25.0 | MIT | [text 1](docs/third-party-licenses/tree-sitter-javascript-0.25.0-LICENSE) |
| tree-sitter-typescript | 0.23.2 | MIT | [text 1](docs/third-party-licenses/tree-sitter-typescript-0.23.2-LICENSE) |
| type-is | 2.1.0 | MIT | [text 1](docs/third-party-licenses/type-is-2.1.0-LICENSE) |
| typescript | 5.9.3 | Apache-2.0 | [text 1](docs/third-party-licenses/typescript-5.9.3-LICENSE.txt) |
| unpipe | 1.0.0 | MIT | [text 1](docs/third-party-licenses/unpipe-1.0.0-LICENSE) |
| vary | 1.1.2 | MIT | [text 1](docs/third-party-licenses/vary-1.1.2-LICENSE) |
| web-tree-sitter | 0.27.0 | MIT | [text 1](docs/third-party-licenses/web-tree-sitter-0.27.0-LICENSE) |
| which | 2.0.2 | ISC | [text 1](docs/third-party-licenses/which-2.0.2-LICENSE) |
| wrappy | 1.0.2 | ISC | [text 1](docs/third-party-licenses/wrappy-1.0.2-LICENSE) |
| zod | 4.6.5 | MIT | [text 1](docs/third-party-licenses/zod-4.6.5-LICENSE) |
| zod-to-json-schema | 3.25.2 | ISC | [text 1](docs/third-party-licenses/zod-to-json-schema-3.25.2-LICENSE) |
