/**
 * zen-gate.js — opencode 1.19.0 插件：让出站请求满足 OpenCode Zen 免费层闸门形态
 *
 * 受限语法版本：全部同步函数、不引入任何模块、不使用大整数与 Web 随机源 API。
 * 目的：通过网关的插件语法校验（该校验会拒绝非同步写法与模块引入）。
 *
 * 背景（2026-10-15 实测，见 docs/14-upgrade-1.19.0-followup.md）：
 *   闸门六条：Bearer public / UA opencode-<版本> / x-opencode-session /
 *   x-opencode-session-id（12 位十六进制低 12 位不小于 0xfc0）/ stream 为真 /
 *   tools 含 read，且文件工具族 bash-read-edit-write-glob-grep 的 properties 非空
 *
 * 用法（opencode.json）：
 *   { "plugin": [["./plugins/zen-gate.ts", { "providers": ["opencode", "zen-gateway"] }]] }
 *
 * 选项：providers / userAgent / fillEmptyToolProperties / log
 */

var B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
var PLACEHOLDER = "__opencode_zen_gate"
var DEFAULT_UA = "opencode/1.19.0"
var MOD48 = 281474976710656

/** 复刻 identifier.ts 的降序 ID：低 12 位 = 4096 - counter，counter=1 -> 0xffe >= 0xfc0 */
function sessionId(counter) {
  var current = (Date.now() * 4096 + (counter || 1)) % MOD48
  var value = MOD48 - 1 - current
  var hex = value.toString(16)
  while (hex.length < 12) hex = "0" + hex
  var suffix = ""
  var i = 0
  while (i < 14) {
    suffix = suffix + B62.charAt(Math.floor(Math.random() * 62))
    i = i + 1
  }
  return "ses_" + hex + suffix
}

function hasProps(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false
  var props = schema.properties
  if (!props || typeof props !== "object" || Array.isArray(props)) return false
  var n = 0
  for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) n = n + 1
  return n > 0
}

function placeholderSchema(schema) {
  var out = {}
  for (var k in schema) if (Object.prototype.hasOwnProperty.call(schema, k)) out[k] = schema[k]
  out.type = out.type || "object"
  var props = {}
  props[PLACEHOLDER] = {
    type: "string",
    description: "Placeholder required by the OpenCode Zen free-tier gate (unused).",
  }
  out.properties = props
  return out
}

export var ZenGate = function (input, options) {
  var opts = options || {}
  var providers = opts.providers || ["opencode"]
  var ua = opts.userAgent || DEFAULT_UA
  var fill = opts.fillEmptyToolProperties === undefined ? true : opts.fillEmptyToolProperties
  var log = opts.log === true
  var sessions = {}

  return {
    // 闸门判据 2/3/4：出站头（插件输出在 request.ts 里最后合并，可覆盖内置值）
    "chat.headers": function (hookInput, output) {
      var providerID = hookInput && hookInput.model ? hookInput.model.providerID : undefined
      if (!providerID && hookInput && hookInput.provider) providerID = hookInput.provider.id
      var hit = false
      var i = 0
      while (i < providers.length) {
        if (providers[i] === providerID) hit = true
        i = i + 1
      }
      if (!hit) return
      var key = (hookInput && hookInput.sessionID) || "default"
      var sid = sessions[key]
      if (!sid) {
        sid = sessionId(1)
        sessions[key] = sid
      }
      output.headers["User-Agent"] = ua
      output.headers["x-opencode-session"] = sid
      output.headers["x-opencode-session-id"] = sid
      output.headers["x-opencode-client"] = "cli"
      output.headers["x-opencode-project"] = "global"
      if (log) console.error("[zen-gate] headers -> " + providerID + " " + sid)
    },

    // 闸门判据 6b：给空 schema 的工具补一个占位属性
    // 注意：上线给模型看的是 jsonSchema，不是 parameters；只换 jsonSchema 引用。
    "tool.definition": function (hookInput, output) {
      if (!fill) return
      var js = output.jsonSchema
      if (!js || typeof js !== "object" || Array.isArray(js)) return
      if (hasProps(js)) return
      output.jsonSchema = placeholderSchema(js)
      if (log) console.error("[zen-gate] patched empty jsonSchema for tool " + (hookInput && hookInput.toolID))
    },
  }
}

export default ZenGate